import { createAithneClient } from 'lucos_aithne_jsclient';

const AITHNE_ORIGIN = process.env.AITHNE_ORIGIN ?? 'https://aithne.l42.eu';
export { AITHNE_ORIGIN };

const REQUIRED_SCOPE = 'loganne:use';

/**
 * Build this service's session-auth functions, closing over a single
 * locally-scoped aithne client — no module-level mutable singleton, no
 * exported runtime verifier setter. Production (index.js) calls this once
 * at startup with real config; tests call it independently per test with a
 * stub `_verifyFn`. This structurally rules out the footgun a mutable
 * module-level client + exported setter had (lucas42/lucos#268): there's no
 * shared instance a stray call could silently repoint.
 *
 * config is passed straight through to lucos_aithne_jsclient's
 * createAithneClient() (ADR-0001) — this module owns only presentation.
 * jwksUrl overrides only the JWKS fetch address (e.g. Docker bridge IP in
 * dev); the library derives the issuer check and loginUrl() from origin
 * regardless, so that invariant can't drift here.
 */
export function createAuthMiddleware(config) {
	const aithne = createAithneClient(config);

	/**
	 * Verify the aithne_session JWT from a cookie header string.
	 * Returns an object with:
	 *   - authenticated: true if the JWT signature/claims are valid
	 *   - authorized: true if authenticated AND the principal has loganne:use scope
	 *   - payload: the JWT payload (null unless authenticated)
	 *
	 * A JWKS infrastructure failure (aithne unreachable, serve-stale couldn't
	 * rescue) is reported the same as "not authenticated" — there's no local
	 * "sign-in unavailable" page (that pattern was abandoned, lucas42/lucos#260).
	 */
	async function verifySessionToken(cookieHeader) {
		const classification = await aithne.verifySession(cookieHeader, { requiredScope: REQUIRED_SCOPE });
		if (classification.outcome === 'unauthenticated' && classification.error) {
			console.error('JWT verification failed:', classification.error.message);
		}
		return {
			authenticated: classification.outcome === 'authorized' || classification.outcome === 'forbidden',
			authorized: classification.outcome === 'authorized',
			payload: classification.payload,
		};
	}

	/**
	 * Express middleware for checking authentication.
	 *
	 * Two top-level paths:
	 *
	 * 1. Bearer / CLIENT_KEYS (machine clients) — unchanged. Validates the token
	 *    against the CLIENT_KEYS env var. Returns 401 on failure; never reads
	 *    cookies or touches aithne — out of scope for this migration
	 *    (lucas42/lucos_loganne#565: this issue is only about the human login path).
	 *
	 * 2. Cookie / session (human browser clients) — three-branch pattern per
	 *    consumer-migration-guide C2:
	 *    a. Valid aithne_session JWT + loganne:use scope → proceed.
	 *    b. Valid JWT, missing scope → render loganne's own styled 403 (no redirect —
	 *       re-login yields the same scopeless token, causing an infinite loop).
	 *    c. No/expired/invalid token, or aithne unreachable → 302 redirect to
	 *       aithne login. `next` is populated from the server-side request URL
	 *       only (open-redirect guard) and validated by aithne.loginUrl().
	 */
	async function middleware(req, res, next) {

		// ── Bearer / machine path ─────────────────────────────────────────────
		// This path is unchanged and client-independent. Machine clients send
		// Authorization: Bearer <key>. The key is validated against the
		// CLIENT_KEYS env var (semicolon-separated name=value pairs). Only the
		// cookie/session branch below is migrated to aithne.
		const authHeader = req.headers.authorization;
		if (authHeader && authHeader.startsWith('Bearer ')) {
			const token = authHeader.slice(7);
			const clientKeysStr = process.env.CLIENT_KEYS || '';
			const validKeys = new Set(
				clientKeysStr.split(';').filter(entry => entry.includes('=')).map(entry => entry.split('=').slice(1).join('='))
			);
			if (validKeys.has(token)) {
				return next();
			} else {
				return res.status(401)
					.setHeader('Content-Type', 'text/plain')
					.setHeader('WWW-Authenticate', 'Bearer')
					.send('Unauthorized\n');
			}
		}

		// ── Cookie / session path ─────────────────────────────────────────────
		const result = await verifySessionToken(req.headers.cookie);

		if (result.authenticated && result.authorized) {
			res.auth_agent = result.payload;
			return next();
		}

		if (result.authenticated && !result.authorized) {
			// Valid session but missing loganne:use scope — render a 403, do not redirect.
			// Redirecting to login is pointless: they already have a valid session; a fresh
			// login yields the same scopeless token and creates an infinite loop.
			console.warn('JWT missing required %s scope:', REQUIRED_SCOPE, result.payload?.sub);
			res.status(403);
			return res.render('error', {
				message: "This action requires the `loganne:use` scope. Contact the administrator to request access.",
			});
		}

		// Not authenticated — redirect to aithne login.
		// Use APP_ORIGIN as the base URL for the `next` param — it is set by lucos_creds and
		// is not user-controllable, unlike the raw Host header. Falls back to constructing
		// the origin from protocol + host (which is correct in development / tests).
		// req.protocol is populated from X-Forwarded-Proto by Express when trust proxy
		// is set (configured in front-controller.js), so this correctly returns 'https'
		// in production.
		const appOrigin = process.env.APP_ORIGIN ?? `${req.protocol}://${req.headers.host}`;
		const returnUrl = `${appOrigin}${req.originalUrl}`;
		return res.redirect(302, aithne.loginUrl(returnUrl));
	}

	return { middleware, verifySessionToken };
}

/**
 * CSRF middleware for state-mutating requests (PUT, POST, DELETE, PATCH).
 *
 * The aithne_session cookie uses SameSite=None, so browsers send it on all
 * cross-origin requests including CSRF-triggered ones. This middleware rejects
 * state-mutating requests whose Origin (or Referer, as a fallback) does not
 * originate from an allowed domain (*.l42.eu, or localhost in development).
 *
 * Requests with no Origin and no Referer header are allowed — these are
 * same-origin or server-to-server requests that do not carry the CSRF risk.
 *
 * Bearer-authenticated requests are not affected: the Bearer token in the
 * Authorization header is not a cookie and cannot be stolen by CSRF.
 */
export function csrfMiddleware(req, res, next) {
	const method = req.method.toUpperCase();
	if (!['PUT', 'POST', 'DELETE', 'PATCH'].includes(method)) return next();

	// Bearer-authenticated requests are inherently CSRF-safe — skip check.
	if (req.headers.authorization?.startsWith('Bearer ')) return next();

	const env = process.env.ENVIRONMENT ?? 'production';

	function isAllowedOrigin(str) {
		if (!str) return false;
		try {
			const url = new URL(str);
			if (env === 'development' && url.hostname === 'localhost') return true;
			return url.hostname === 'l42.eu' || url.hostname.endsWith('.l42.eu');
		} catch {
			return false;
		}
	}

	const origin = req.headers['origin'];
	const referer = req.headers['referer'];

	if (origin !== undefined) {
		if (!isAllowedOrigin(origin)) {
			return res.status(403).json({ errorMessage: 'CSRF check failed: disallowed Origin' });
		}
	} else if (referer) {
		if (!isAllowedOrigin(referer)) {
			return res.status(403).json({ errorMessage: 'CSRF check failed: disallowed Referer' });
		}
	}
	// Neither Origin nor Referer present → allow (same-origin or server-to-server, no CSRF risk).
	next();
}
