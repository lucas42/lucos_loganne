import { jest } from '@jest/globals';
import { generateKeyPair, exportJWK, SignJWT, jwtVerify, createLocalJWKSet } from 'jose';
import {
	parseCookies,
	hasLoganneAccess,
	verifySessionToken,
	middleware,
	csrfMiddleware,
	_setVerifier,
	isJWKSInfraError,
	createServeStaleJWKS,
} from '../src/auth.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// Sentinel verifier — throws if called unexpectedly (guards against tests
// accidentally hitting the real JWKS endpoint).
const sentinelVerifier = () => {
	throw Object.assign(new Error('Test: real verifier should not be called'), { code: 'TEST_SENTINEL' });
};

// ─── parseCookies ─────────────────────────────────────────────────────────────

describe('parseCookies', () => {
	test('returns empty object for undefined header', () => {
		expect(parseCookies(undefined)).toEqual({});
	});

	test('returns empty object for empty string', () => {
		expect(parseCookies('')).toEqual({});
	});

	test('parses a single cookie', () => {
		expect(parseCookies('foo=bar')).toEqual({ foo: 'bar' });
	});

	test('parses multiple cookies', () => {
		expect(parseCookies('foo=bar; baz=qux')).toEqual({ foo: 'bar', baz: 'qux' });
	});

	test('preserves = within cookie value (e.g. base64 JWT padding)', () => {
		expect(parseCookies('aithne_session=abc.def.ghi==')).toEqual({ aithne_session: 'abc.def.ghi==' });
	});

	test('only splits on the first = in a pair', () => {
		expect(parseCookies('k=a=b=c')).toEqual({ k: 'a=b=c' });
	});

	test('extracts aithne_session from a multi-cookie header', () => {
		const result = parseCookies('other=value; aithne_session=jwt.tok.en==; another=x');
		expect(result.aithne_session).toBe('jwt.tok.en==');
		expect(result.other).toBe('value');
		expect(result.another).toBe('x');
	});
});

// ─── hasLoganneAccess ─────────────────────────────────────────────────────────

describe('hasLoganneAccess', () => {
	test('loganne:use grants access', () => {
		expect(hasLoganneAccess(['loganne:use'])).toBe(true);
	});

	test('loganne:use alongside other scopes grants access', () => {
		expect(hasLoganneAccess(['eolas:read', 'loganne:use', 'webhook'])).toBe(true);
	});

	test('empty scopes denies access', () => {
		expect(hasLoganneAccess([])).toBe(false);
	});

	test('unrelated scopes deny access', () => {
		expect(hasLoganneAccess(['eolas:read', 'notes:use'])).toBe(false);
	});

	test('render-ui grants access in development', () => {
		const orig = process.env.ENVIRONMENT;
		process.env.ENVIRONMENT = 'development';
		try {
			expect(hasLoganneAccess(['render-ui'])).toBe(true);
		} finally {
			if (orig === undefined) { delete process.env.ENVIRONMENT; } else { process.env.ENVIRONMENT = orig; }
		}
	});

	test('render-ui is denied in production', () => {
		const orig = process.env.ENVIRONMENT;
		process.env.ENVIRONMENT = 'production';
		try {
			expect(hasLoganneAccess(['render-ui'])).toBe(false);
		} finally {
			if (orig === undefined) { delete process.env.ENVIRONMENT; } else { process.env.ENVIRONMENT = orig; }
		}
	});
});

// ─── isJWKSInfraError ─────────────────────────────────────────────────────────

describe('isJWKSInfraError', () => {
	test('matches ERR_JWKS_* codes', () => {
		expect(isJWKSInfraError({ code: 'ERR_JWKS_TIMEOUT' })).toBe(true);
	});

	test('matches ECONNREFUSED', () => {
		expect(isJWKSInfraError({ code: 'ECONNREFUSED' })).toBe(true);
	});

	test('matches ENOTFOUND', () => {
		expect(isJWKSInfraError({ code: 'ENOTFOUND' })).toBe(true);
	});

	test('does not match unrelated JWT error codes', () => {
		expect(isJWKSInfraError({ code: 'ERR_JWT_EXPIRED' })).toBe(false);
	});

	test('does not match an error with no code', () => {
		expect(isJWKSInfraError({})).toBe(false);
	});
});

// ─── createServeStaleJWKS ─────────────────────────────────────────────────────
//
// Exercises the wrapper against a fake "remote JWKS getter" shaped like jose's
// createRemoteJWKSet output (a callable function with a .jwks() property),
// using real EC keys and jwtVerify so the fallback path is genuinely proven
// end-to-end rather than just asserting on call counts.

describe('createServeStaleJWKS', () => {
	let privateKey, goodJWK;

	beforeAll(async () => {
		const keyPair = await generateKeyPair('ES256');
		privateKey = keyPair.privateKey;
		goodJWK = { ...(await exportJWK(keyPair.publicKey)), kid: 'test-kid', alg: 'ES256', use: 'sig' };
	});

	function makeToken(kid = 'test-kid') {
		return new SignJWT({})
			.setProtectedHeader({ alg: 'ES256', kid })
			.setIssuedAt()
			.setExpirationTime('1h')
			.sign(privateKey);
	}

	// A fake remote getter: `impl` is the per-call behaviour (return a key or
	// throw), `snapshot` is what .jwks() reports as the currently-fetched set.
	function fakeRemoteJWKS(impl, snapshot) {
		const fn = (protectedHeader, token) => impl(protectedHeader, token);
		fn.jwks = () => snapshot;
		return fn;
	}

	const jwksInfraError = () => Object.assign(new Error('fetch failed'), { code: 'ERR_JWKS_TIMEOUT' });

	test('resolves normally on a successful remote fetch', async () => {
		const jwks = { keys: [goodJWK] };
		const remote = fakeRemoteJWKS(
			(protectedHeader, token) => createLocalJWKSet(jwks)(protectedHeader, token),
			jwks
		);
		const wrapped = createServeStaleJWKS(remote);
		const token = await makeToken();
		const { payload } = await jwtVerify(token, wrapped);
		expect(payload).toBeTruthy();
	});

	test('falls back to the last-known-good key set on a JWKS infra error', async () => {
		const jwks = { keys: [goodJWK] };
		let callCount = 0;
		const remote = fakeRemoteJWKS((protectedHeader, token) => {
			callCount++;
			if (callCount === 1) return createLocalJWKSet(jwks)(protectedHeader, token);
			throw jwksInfraError();
		}, jwks);
		const wrapped = createServeStaleJWKS(remote);
		const token = await makeToken();

		// First call succeeds and captures the snapshot.
		await jwtVerify(token, wrapped);
		// Second call: remote throws an infra error; wrapper should serve stale.
		const { payload } = await jwtVerify(token, wrapped);
		expect(payload).toBeTruthy();
		expect(callCount).toBe(2);
	});

	test('rethrows the infra error when there is no last-known-good key set yet', async () => {
		const remote = fakeRemoteJWKS(() => { throw jwksInfraError(); }, undefined);
		const wrapped = createServeStaleJWKS(remote);
		const token = await makeToken();
		await expect(jwtVerify(token, wrapped)).rejects.toThrow();
	});

	test('still rejects a token whose kid is unknown even to the last-known-good set', async () => {
		const jwks = { keys: [goodJWK] };
		let callCount = 0;
		const remote = fakeRemoteJWKS((protectedHeader, token) => {
			callCount++;
			if (callCount === 1) return createLocalJWKSet(jwks)(protectedHeader, token);
			throw jwksInfraError();
		}, jwks);
		const wrapped = createServeStaleJWKS(remote);

		// Capture the snapshot with a successful call first.
		await jwtVerify(await makeToken(), wrapped);

		// A different kid, absent from the last-known-good set.
		const unknownKidToken = await makeToken('unknown-kid');
		await expect(jwtVerify(unknownKidToken, wrapped)).rejects.toThrow();
	});

	test('propagates non-infra errors without attempting a fallback', async () => {
		const jwks = { keys: [goodJWK] };
		const remote = fakeRemoteJWKS(() => {
			throw Object.assign(new Error('boom'), { code: 'ERR_SOMETHING_ELSE' });
		}, jwks);
		const wrapped = createServeStaleJWKS(remote);
		const token = await makeToken();
		await expect(jwtVerify(token, wrapped)).rejects.toThrow();
	});
});

// ─── verifySessionToken ───────────────────────────────────────────────────────

describe('verifySessionToken', () => {
	afterEach(() => {
		_setVerifier(sentinelVerifier);
	});

	test('no cookie header → not authenticated, not authorized', async () => {
		const result = await verifySessionToken(undefined);
		expect(result.authenticated).toBe(false);
		expect(result.authorized).toBe(false);
	});

	test('cookie header without aithne_session → not authenticated', async () => {
		const result = await verifySessionToken('other=value');
		expect(result.authenticated).toBe(false);
		expect(result.authorized).toBe(false);
	});

	test('valid JWT with loganne:use → authenticated and authorized', async () => {
		const fakePayload = { sub: 'user:1', principal_class: 'human', scopes: ['loganne:use'], exp: 9999999999 };
		_setVerifier(async () => ({ payload: fakePayload }));
		const result = await verifySessionToken('aithne_session=valid.jwt.token');
		expect(result.authenticated).toBe(true);
		expect(result.authorized).toBe(true);
		expect(result.payload).toEqual(fakePayload);
	});

	test('valid JWT missing loganne:use → authenticated but not authorized', async () => {
		const fakePayload = { sub: 'user:2', principal_class: 'human', scopes: ['eolas:read'], exp: 9999999999 };
		_setVerifier(async () => ({ payload: fakePayload }));
		const result = await verifySessionToken('aithne_session=valid.jwt.no-scope');
		expect(result.authenticated).toBe(true);
		expect(result.authorized).toBe(false);
		expect(result.payload).toEqual(fakePayload);
	});

	test('expired JWT → not authenticated, not authorized', async () => {
		_setVerifier(async () => { throw Object.assign(new Error('JWTExpired'), { code: 'ERR_JWT_EXPIRED' }); });
		const result = await verifySessionToken('aithne_session=expired.jwt.token');
		expect(result.authenticated).toBe(false);
		expect(result.authorized).toBe(false);
	});

	test('tampered JWT → not authenticated, not authorized', async () => {
		_setVerifier(async () => { throw Object.assign(new Error('JWSSignatureVerificationFailed'), { code: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' }); });
		const result = await verifySessionToken('aithne_session=tampered.jwt.token');
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
		const req = makeReq({ authorization: 'Bearer valid-machine-token' });
		const res = makeRes();
		const next = jest.fn();
		await middleware(req, res, next);
		expect(next).toHaveBeenCalledTimes(1);
		expect(res.status).not.toHaveBeenCalled();
	});

	test('second valid Bearer token → calls next()', async () => {
		const req = makeReq({ authorization: 'Bearer another-token' });
		const res = makeRes();
		const next = jest.fn();
		await middleware(req, res, next);
		expect(next).toHaveBeenCalledTimes(1);
	});

	test('invalid Bearer token → 401 Unauthorized', async () => {
		const req = makeReq({ authorization: 'Bearer wrong-token' });
		const res = makeRes();
		const next = jest.fn();
		await middleware(req, res, next);
		expect(next).not.toHaveBeenCalled();
		expect(res.status).toHaveBeenCalledWith(401);
	});

	test('Bearer path does not read cookies', async () => {
		// Even if a valid-looking cookie is present, Bearer path should not touch it
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
		_setVerifier(sentinelVerifier);
		consoleWarnSpy.mockRestore();
	});

	// Branch 1: valid token + loganne:use scope → proceed
	test('valid JWT with loganne:use → calls next() and sets res.auth_agent', async () => {
		const fakePayload = { sub: 'user:1', principal_class: 'human', scopes: ['loganne:use'], exp: 9999999999 };
		_setVerifier(async () => ({ payload: fakePayload }));
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
		_setVerifier(async () => ({ payload: fakePayload }));
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
		const req = makeReq({ protocol: 'https', originalUrl: '/view?level=headline' });
		const res = makeRes();
		await middleware(req, res, jest.fn());
		const [, redirectUrl] = res.redirect.mock.calls[0];
		const returnUrl = decodeURIComponent(new URL(redirectUrl).searchParams.get('next'));
		expect(returnUrl.startsWith('https://')).toBe(true);
		expect(returnUrl).toContain('/view?level=headline');
	});

	test('expired JWT → redirects to login', async () => {
		_setVerifier(async () => { throw Object.assign(new Error('JWTExpired'), { code: 'ERR_JWT_EXPIRED' }); });
		const req = makeReq({ cookie: 'aithne_session=expired.jwt.token' });
		const res = makeRes();
		const next = jest.fn();
		await middleware(req, res, next);
		expect(next).not.toHaveBeenCalled();
		expect(res.redirect).toHaveBeenCalledTimes(1);
		expect(res.render).not.toHaveBeenCalled();
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
