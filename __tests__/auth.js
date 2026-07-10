import { jest } from '@jest/globals';
import {
	createAuthMiddleware,
	csrfMiddleware,
} from '../src/auth.js';

// parseCookies, hasLoganneAccess (including the render-ui dev bypass),
// isJWKSInfraError, createServeStaleJWKS and loginUrl's returnUrl validation
// are all owned and unit-tested by lucos_aithne_jsclient itself (ADR-0001) —
// this suite only exercises this app's own presentation on top of
// Classification.outcome (verifySessionToken/middleware), the Bearer/
// CLIENT_KEYS machine path (unaffected by this migration), and csrfMiddleware,
// all of which stay consumer-owned.

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Sentinel verifier — throws if called unexpectedly (guards against tests
// accidentally hitting the real JWKS endpoint). Used as makeAuth()'s default
// so a test only needs to supply a _verifyFn when it actually expects one
// to be called.
const sentinelVerifier = () => {
	throw Object.assign(new Error('Test: real verifier should not be called'), { code: 'TEST_SENTINEL' });
};

// Each call builds an independent client (construction-time-only _verifyFn
// injection, lucas42/lucos_aithne_jsclient#7/lucas42/lucos#268) — there's no
// shared module-level instance to reset between tests.
function makeAuth(_verifyFn = sentinelVerifier) {
	return createAuthMiddleware({ origin: 'https://aithne.l42.eu', _verifyFn });
}

function makeReq({ cookie, method = 'GET', originalUrl = '/', protocol = 'https', authorization, origin, referer } = {}) {
	return {
		headers: {
			host: 'loganne.l42.eu',
			...(cookie !== undefined && { cookie }),
			...(authorization !== undefined && { authorization }),
			...(origin !== undefined && { origin }),
			...(referer !== undefined && { referer }),
		},
		method,
		originalUrl,
		protocol,
	};
}

function makeRes() {
	const res = { auth_agent: undefined, locals: {} };
	res.redirect = jest.fn();
	res.status = jest.fn().mockReturnValue(res);
	res.render = jest.fn().mockReturnValue(res);
	res.json = jest.fn().mockReturnValue(res);
	res.setHeader = jest.fn().mockReturnValue(res);
	res.send = jest.fn().mockReturnValue(res);
	return res;
}

// ─── verifySessionToken ───────────────────────────────────────────────────────

describe('verifySessionToken', () => {
	test('no cookie header → not authenticated, not authorized', async () => {
		const { verifySessionToken } = makeAuth();
		const result = await verifySessionToken(undefined);
		expect(result.authenticated).toBe(false);
		expect(result.authorized).toBe(false);
	});

	test('cookie header without aithne_session → not authenticated', async () => {
		const { verifySessionToken } = makeAuth();
		const result = await verifySessionToken('other=value');
		expect(result.authenticated).toBe(false);
		expect(result.authorized).toBe(false);
	});

	test('valid JWT with loganne:use → authenticated and authorized', async () => {
		const fakePayload = { sub: 'user:1', principal_class: 'human', scopes: ['loganne:use'], exp: 9999999999 };
		const { verifySessionToken } = makeAuth(async () => ({ payload: fakePayload }));
		const result = await verifySessionToken('aithne_session=valid.jwt.token');
		expect(result.authenticated).toBe(true);
		expect(result.authorized).toBe(true);
		expect(result.payload).toEqual(fakePayload);
	});

	test('valid JWT missing loganne:use → authenticated but not authorized', async () => {
		const fakePayload = { sub: 'user:2', principal_class: 'human', scopes: ['eolas:read'], exp: 9999999999 };
		const { verifySessionToken } = makeAuth(async () => ({ payload: fakePayload }));
		const result = await verifySessionToken('aithne_session=valid.jwt.no-scope');
		expect(result.authenticated).toBe(true);
		expect(result.authorized).toBe(false);
		expect(result.payload).toEqual(fakePayload);
	});

	test('expired JWT → not authenticated, not authorized', async () => {
		const { verifySessionToken } = makeAuth(async () => { throw Object.assign(new Error('JWTExpired'), { code: 'ERR_JWT_EXPIRED' }); });
		const result = await verifySessionToken('aithne_session=expired.jwt.token');
		expect(result.authenticated).toBe(false);
		expect(result.authorized).toBe(false);
	});

	test('tampered JWT → not authenticated, not authorized', async () => {
		const { verifySessionToken } = makeAuth(async () => { throw Object.assign(new Error('JWSSignatureVerificationFailed'), { code: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' }); });
		const result = await verifySessionToken('aithne_session=tampered.jwt.token');
		expect(result.authenticated).toBe(false);
		expect(result.authorized).toBe(false);
	});

	test('JWKS infra failure → not authenticated, not authorized (no local unavailable page)', async () => {
		// lucos_aithne_jsclient classifies this as outcome: 'unavailable'. Problem 2
		// (a local "sign-in unavailable" page) was abandoned (lucas42/lucos#260), so
		// this consumer treats it identically to any other failed verification.
		const { verifySessionToken } = makeAuth(async () => { throw Object.assign(new Error('fetch failed'), { code: 'ERR_JWKS_TIMEOUT' }); });
		const result = await verifySessionToken('aithne_session=some.jwt.token');
		expect(result.authenticated).toBe(false);
		expect(result.authorized).toBe(false);
	});
});

// ─── middleware — Bearer / machine path ───────────────────────────────────────

describe('middleware — Bearer path', () => {
	const ORIG_CLIENT_KEYS = process.env.CLIENT_KEYS;

	beforeEach(() => {
		process.env.CLIENT_KEYS = 'svc-a=valid-machine-token;svc-b=another-token';
	});

	afterEach(() => {
		if (ORIG_CLIENT_KEYS === undefined) { delete process.env.CLIENT_KEYS; } else { process.env.CLIENT_KEYS = ORIG_CLIENT_KEYS; }
	});

	test('valid Bearer token → calls next()', async () => {
		const { middleware } = makeAuth();
		const req = makeReq({ authorization: 'Bearer valid-machine-token' });
		const res = makeRes();
		const next = jest.fn();
		await middleware(req, res, next);
		expect(next).toHaveBeenCalledTimes(1);
		expect(res.status).not.toHaveBeenCalled();
	});

	test('second valid Bearer token → calls next()', async () => {
		const { middleware } = makeAuth();
		const req = makeReq({ authorization: 'Bearer another-token' });
		const res = makeRes();
		const next = jest.fn();
		await middleware(req, res, next);
		expect(next).toHaveBeenCalledTimes(1);
	});

	test('invalid Bearer token → 401 Unauthorized', async () => {
		const { middleware } = makeAuth();
		const req = makeReq({ authorization: 'Bearer wrong-token' });
		const res = makeRes();
		const next = jest.fn();
		await middleware(req, res, next);
		expect(next).not.toHaveBeenCalled();
		expect(res.status).toHaveBeenCalledWith(401);
	});

	test('Bearer path does not read cookies', async () => {
		// Even if a valid-looking cookie is present, Bearer path should not touch it
		const { middleware } = makeAuth();
		const req = makeReq({ authorization: 'Bearer valid-machine-token', cookie: 'aithne_session=some.jwt' });
		const res = makeRes();
		const next = jest.fn();
		await middleware(req, res, next);
		expect(next).toHaveBeenCalledTimes(1);
	});
});

// ─── middleware — session path ────────────────────────────────────────────────

describe('middleware — session path', () => {
	let consoleWarnSpy;

	beforeEach(() => {
		consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
	});

	afterEach(() => {
		consoleWarnSpy.mockRestore();
	});

	// Branch 1: valid token + loganne:use scope → proceed
	test('valid JWT with loganne:use → calls next() and sets res.auth_agent', async () => {
		const fakePayload = { sub: 'user:1', principal_class: 'human', scopes: ['loganne:use'], exp: 9999999999 };
		const { middleware } = makeAuth(async () => ({ payload: fakePayload }));
		const req = makeReq({ cookie: 'aithne_session=valid.jwt.token' });
		const res = makeRes();
		const next = jest.fn();
		await middleware(req, res, next);
		expect(next).toHaveBeenCalledTimes(1);
		expect(res.redirect).not.toHaveBeenCalled();
		expect(res.render).not.toHaveBeenCalled();
		expect(res.auth_agent).toEqual(fakePayload);
	});

	// Branch 2: valid token, missing scope → render styled 403, no redirect
	test('valid JWT missing loganne:use → renders own styled 403, does not redirect', async () => {
		const fakePayload = { sub: 'user:2', principal_class: 'human', scopes: ['eolas:read'], exp: 9999999999 };
		const { middleware } = makeAuth(async () => ({ payload: fakePayload }));
		const req = makeReq({ cookie: 'aithne_session=valid.jwt.no-scope' });
		const res = makeRes();
		const next = jest.fn();
		await middleware(req, res, next);
		expect(next).not.toHaveBeenCalled();
		expect(res.redirect).not.toHaveBeenCalled();
		expect(res.status).toHaveBeenCalledWith(403);
		expect(res.render).toHaveBeenCalledWith('error', expect.objectContaining({ message: expect.any(String) }));
	});

	// Branch 3: no/expired/invalid token → redirect to aithne login
	test('no cookie → redirects to aithne login', async () => {
		const { middleware } = makeAuth();
		const req = makeReq();
		const res = makeRes();
		const next = jest.fn();
		await middleware(req, res, next);
		expect(next).not.toHaveBeenCalled();
		expect(res.render).not.toHaveBeenCalled();
		expect(res.redirect).toHaveBeenCalledTimes(1);
		const [status, url] = res.redirect.mock.calls[0];
		expect(status).toBe(302);
		expect(url).toContain('/auth/login?next=');
	});

	test('unauthenticated redirect encodes the server-side URL into next param', async () => {
		const { middleware } = makeAuth();
		const req = makeReq({ protocol: 'https', originalUrl: '/view?level=headline' });
		const res = makeRes();
		await middleware(req, res, jest.fn());
		const [, redirectUrl] = res.redirect.mock.calls[0];
		const returnUrl = decodeURIComponent(new URL(redirectUrl).searchParams.get('next'));
		expect(returnUrl.startsWith('https://')).toBe(true);
		expect(returnUrl).toContain('/view?level=headline');
	});

	test('expired JWT → redirects to login', async () => {
		const { middleware } = makeAuth(async () => { throw Object.assign(new Error('JWTExpired'), { code: 'ERR_JWT_EXPIRED' }); });
		const req = makeReq({ cookie: 'aithne_session=expired.jwt.token' });
		const res = makeRes();
		const next = jest.fn();
		await middleware(req, res, next);
		expect(next).not.toHaveBeenCalled();
		expect(res.redirect).toHaveBeenCalledTimes(1);
		expect(res.render).not.toHaveBeenCalled();
	});

	test('tampered JWT → redirects to login', async () => {
		const { middleware } = makeAuth(async () => { throw Object.assign(new Error('JWSSignatureVerificationFailed'), { code: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' }); });
		const req = makeReq({ cookie: 'aithne_session=tampered.jwt.token' });
		const res = makeRes();
		const next = jest.fn();
		await middleware(req, res, next);
		expect(next).not.toHaveBeenCalled();
		expect(res.redirect).toHaveBeenCalledTimes(1);
	});

	test('JWKS infra failure → redirects to login (no local unavailable page)', async () => {
		const { middleware } = makeAuth(async () => { throw Object.assign(new Error('fetch failed'), { code: 'ERR_JWKS_TIMEOUT' }); });
		const req = makeReq({ cookie: 'aithne_session=some.jwt.token' });
		const res = makeRes();
		const next = jest.fn();
		await middleware(req, res, next);
		expect(next).not.toHaveBeenCalled();
		expect(res.status).not.toHaveBeenCalled();
		expect(res.redirect).toHaveBeenCalledTimes(1);
	});
});

// ─── csrfMiddleware ───────────────────────────────────────────────────────────

describe('csrfMiddleware', () => {
	let origEnv;

	beforeEach(() => {
		origEnv = process.env.ENVIRONMENT;
	});

	afterEach(() => {
		if (origEnv === undefined) { delete process.env.ENVIRONMENT; } else { process.env.ENVIRONMENT = origEnv; }
	});

	test('GET request → passes through (no CSRF risk)', () => {
		const req = makeReq({ method: 'GET' });
		const res = makeRes();
		const next = jest.fn();
		csrfMiddleware(req, res, next);
		expect(next).toHaveBeenCalledTimes(1);
		expect(res.status).not.toHaveBeenCalled();
	});

	test('POST with Bearer token → passes through (CSRF-safe by construction)', () => {
		process.env.ENVIRONMENT = 'production';
		const req = makeReq({ method: 'POST', authorization: 'Bearer machine-token', origin: 'https://evil.com' });
		const res = makeRes();
		const next = jest.fn();
		csrfMiddleware(req, res, next);
		expect(next).toHaveBeenCalledTimes(1);
	});

	test('POST with *.l42.eu Origin → allowed', () => {
		const req = makeReq({ method: 'POST', origin: 'https://loganne.l42.eu' });
		const res = makeRes();
		const next = jest.fn();
		csrfMiddleware(req, res, next);
		expect(next).toHaveBeenCalledTimes(1);
	});

	test('POST with evil.com Origin → rejected with 403', () => {
		process.env.ENVIRONMENT = 'production';
		const req = makeReq({ method: 'POST', origin: 'https://evil.com' });
		const res = makeRes();
		const next = jest.fn();
		csrfMiddleware(req, res, next);
		expect(next).not.toHaveBeenCalled();
		expect(res.status).toHaveBeenCalledWith(403);
	});

	test('POST with l42.eu Referer (no Origin) → allowed', () => {
		const req = makeReq({ method: 'POST', referer: 'https://loganne.l42.eu/view' });
		const res = makeRes();
		const next = jest.fn();
		csrfMiddleware(req, res, next);
		expect(next).toHaveBeenCalledTimes(1);
	});

	test('POST with evil.com Referer (no Origin) → rejected with 403', () => {
		process.env.ENVIRONMENT = 'production';
		const req = makeReq({ method: 'POST', referer: 'https://evil.com/phishing' });
		const res = makeRes();
		const next = jest.fn();
		csrfMiddleware(req, res, next);
		expect(next).not.toHaveBeenCalled();
		expect(res.status).toHaveBeenCalledWith(403);
	});

	test('POST with no Origin and no Referer → allowed (same-origin or server-to-server)', () => {
		const req = makeReq({ method: 'POST' });
		const res = makeRes();
		const next = jest.fn();
		csrfMiddleware(req, res, next);
		expect(next).toHaveBeenCalledTimes(1);
	});

	test('POST with localhost Origin in development → allowed', () => {
		process.env.ENVIRONMENT = 'development';
		const req = makeReq({ method: 'POST', origin: 'http://localhost:8119' });
		const res = makeRes();
		const next = jest.fn();
		csrfMiddleware(req, res, next);
		expect(next).toHaveBeenCalledTimes(1);
	});

	test('POST with localhost Origin in production → rejected with 403', () => {
		process.env.ENVIRONMENT = 'production';
		const req = makeReq({ method: 'POST', origin: 'http://localhost:8119' });
		const res = makeRes();
		const next = jest.fn();
		csrfMiddleware(req, res, next);
		expect(next).not.toHaveBeenCalled();
		expect(res.status).toHaveBeenCalledWith(403);
	});
});
