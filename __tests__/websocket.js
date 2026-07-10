import { jest } from '@jest/globals';
import http from 'http';
import { WebSocket } from 'ws';
import getApp from '../src/routes/front-controller.js';
import { startup, sendToAllClients } from '../src/websocket.js';
import { initEvents } from '../src/routes/events.js';
import { createAuthMiddleware } from '../src/auth.js';

// Verifier that approves every token with loganne:use scope.
// Used as the default so no live JWKS calls are made.
const approveAllVerifier = async () => ({
	payload: { sub: 'user:testuser', principal_class: 'human', scopes: ['loganne:use'], exp: 9999999999 },
});

/**
 * Start a fresh app + http server + WebSocketServer for one test, with its
 * own independently-constructed auth (construction-time-only _verifyFn —
 * lucas42/lucos_aithne_jsclient#7/lucas42/lucos#268 — so a test that needs
 * different verify behaviour builds its own server rather than mutating a
 * shared one).
 */
async function startServer(verifyFn = approveAllVerifier) {
	const app = getApp('./src');
	app.auth = (req, res, next) => next();
	const auth = createAuthMiddleware({ origin: 'https://aithne.l42.eu', _verifyFn: verifyFn });
	const server = http.createServer(app);
	startup(server, app, auth.verifySessionToken);
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	const port = server.address().port;
	return { server, app, port };
}

/**
 * Helper: open an authenticated WebSocket, attach a message listener BEFORE
 * the handshake completes (so no messages are lost), collect for `windowMs`,
 * then close and return the array of parsed payloads.
 */
function openStreamAndCollect(port, levelParam, windowMs = 400) {
	const levelSuffix = levelParam ? `?level=${levelParam}` : '';
	const ws = new WebSocket(
		`ws://127.0.0.1:${port}/stream${levelSuffix}`,
		{ headers: { Cookie: 'aithne_session=valid.jwt.token' } },
	);
	const received = [];
	// Attach the message listener immediately, before `open` fires,
	// so catch-up messages sent right after auth cannot be missed.
	ws.on('message', data => received.push(JSON.parse(data)));
	return new Promise((resolve, reject) => {
		ws.once('open', () => {
			setTimeout(() => {
				ws.close();
				resolve({ ws, messages: received });
			}, windowMs);
		});
		ws.once('error', reject);
	});
}

describe('sendToAllClients — level filtering', () => {
	it('sends to clients whose levelThreshold the event meets', () => {
		const sentA = [];
		const sentB = [];
		const mockServer = {
			clients: new Set([
				{ authenticated: true, levelThreshold: 'headline', send: (data, _opts, _cb) => sentA.push(JSON.parse(data)) },
				{ authenticated: true, levelThreshold: 'routine', send: (data, _opts, _cb) => sentB.push(JSON.parse(data)) },
			]),
		};
		const headlineEvent = { source: 'test', type: 'h', humanReadable: 'Big news', level: 'headline' };
		sendToAllClients(mockServer, headlineEvent);
		expect(sentA).toHaveLength(1);
		expect(sentB).toHaveLength(1);
	});

	it('does not send to clients whose levelThreshold the event does not meet', () => {
		const sentA = [];
		const sentB = [];
		const mockServer = {
			clients: new Set([
				{ authenticated: true, levelThreshold: 'headline', send: (data, _opts, _cb) => sentA.push(JSON.parse(data)) },
				{ authenticated: true, levelThreshold: 'routine', send: (data, _opts, _cb) => sentB.push(JSON.parse(data)) },
			]),
		};
		const detailEvent = { source: 'test', type: 'd', humanReadable: 'Churn', level: 'detail' };
		sendToAllClients(mockServer, detailEvent);
		// headline client should NOT receive detail
		expect(sentA).toHaveLength(0);
		// routine client should also NOT receive detail (detail < routine)
		expect(sentB).toHaveLength(0);
	});

	it('does not send to unauthenticated clients', () => {
		const sent = [];
		const mockServer = {
			clients: new Set([
				{ authenticated: false, levelThreshold: 'detail', send: (data, _opts, _cb) => sent.push(data) },
			]),
		};
		const event = { source: 'test', type: 'r', humanReadable: 'Routine', level: 'routine' };
		sendToAllClients(mockServer, event);
		expect(sent).toHaveLength(0);
	});
});

describe('WebSocket /stream — level filtering integration', () => {
	let server;
	let app;
	let port;

	beforeEach(async () => {
		// Approves all aithne_session tokens without hitting the real JWKS endpoint.
		({ server, app, port } = await startServer());
	});

	afterEach(async () => {
		initEvents([], false);
		await new Promise(resolve => server.close(resolve));
	});

	it('catch-up replay: default connection receives routine events, not detail', async () => {
		initEvents([
			{ source: 'test', type: 'r', humanReadable: 'Routine', date: new Date().toISOString(), level: 'routine' },
			{ source: 'test', type: 'd', humanReadable: 'Detail', date: new Date().toISOString(), level: 'detail' },
		], false);

		const { messages } = await openStreamAndCollect(port);

		const types = messages.map(m => m.type);
		expect(types).toContain('r');
		expect(types).not.toContain('d');
	});

	it('catch-up replay: ?level=headline connection receives only headline events', async () => {
		initEvents([
			{ source: 'test', type: 'h', humanReadable: 'Headline', date: new Date().toISOString(), level: 'headline' },
			{ source: 'test', type: 'r', humanReadable: 'Routine', date: new Date().toISOString(), level: 'routine' },
		], false);

		const { messages } = await openStreamAndCollect(port, 'headline');

		const types = messages.map(m => m.type);
		expect(types).toContain('h');
		expect(types).not.toContain('r');
	});

	it('catch-up replay: ?level=detail connection receives detail AND routine events', async () => {
		initEvents([
			{ source: 'test', type: 'r', humanReadable: 'Routine', date: new Date().toISOString(), level: 'routine' },
			{ source: 'test', type: 'd', humanReadable: 'Detail', date: new Date().toISOString(), level: 'detail' },
		], false);

		const { messages } = await openStreamAndCollect(port, 'detail');

		const types = messages.map(m => m.type);
		expect(types).toContain('r');
		expect(types).toContain('d');
	});

	it('live event: ?level=headline connection receives only headline live events', async () => {
		// Open without collecting (we'll send events during the window)
		const levelSuffix = '?level=headline';
		const ws = new WebSocket(
			`ws://127.0.0.1:${port}/stream${levelSuffix}`,
			{ headers: { Cookie: 'aithne_session=valid.jwt.token' } },
		);
		const received = [];
		ws.on('message', data => received.push(JSON.parse(data)));

		// Wait for the connection to be fully established (auth + level resolved)
		await new Promise((resolve, reject) => {
			ws.once('open', resolve);
			ws.once('error', reject);
		});

		// Small pause to let the server auth complete before we send live events
		await new Promise(resolve => setTimeout(resolve, 50));

		app.websocket.send({ source: 'test', type: 'routine', humanReadable: 'Routine', level: 'routine', date: new Date(), uuid: '00000000-0000-4000-8000-000000000001' });
		app.websocket.send({ source: 'test', type: 'headline', humanReadable: 'Headline', level: 'headline', date: new Date(), uuid: '00000000-0000-4000-8000-000000000002' });

		// Wait for the live events to arrive
		await new Promise(resolve => setTimeout(resolve, 200));
		ws.close();

		const types = received.map(m => m.type);
		expect(types).not.toContain('routine');
		expect(types).toContain('headline');
	});

	it('unknown ?level= degrades to routine for /stream', async () => {
		initEvents([
			{ source: 'test', type: 'r', humanReadable: 'Routine', date: new Date().toISOString(), level: 'routine' },
			{ source: 'test', type: 'd', humanReadable: 'Detail', date: new Date().toISOString(), level: 'detail' },
		], false);

		const { messages } = await openStreamAndCollect(port, 'not-a-real-level');

		const types = messages.map(m => m.type);
		expect(types).toContain('r');
		expect(types).not.toContain('d');
	});

	it('WS connection with no aithne_session cookie is closed 1008 Forbidden', async () => {
		// No cookie — verifySessionToken never even calls _verifyFn (no token to
		// verify) → unauthenticated → close(1008, "Forbidden"). Uses the shared
		// beforeEach server since no cookie means the configured verifier is
		// never invoked either way.
		const ws = new WebSocket(`ws://127.0.0.1:${port}/stream`, {
			// No Cookie header at all
		});
		const { code, reason } = await new Promise((resolve, reject) => {
			ws.once('close', (code, reasonBuf) => resolve({ code, reason: reasonBuf.toString() }));
			ws.once('error', reject);
		});
		expect(code).toBe(1008);
		expect(reason).toBe('Forbidden');
	});

	it('WS connection with valid JWT but missing loganne:use scope is closed 1008 Unauthorized', async () => {
		// Needs a different verifier than the shared beforeEach server (valid
		// token but missing scope) → close(1008, "Unauthorized"). Distinct from
		// "Forbidden" so the client can stop reconnecting (avoids infinite loop
		// on the 403 page, which also loads stream.js). Construction-time-only
		// _verifyFn injection (lucas42/lucos#268) means this needs its own
		// server rather than mutating the shared one.
		const { server: limitedServer, port: limitedPort } = await startServer(async () => ({
			payload: { sub: 'user:limited', scopes: ['eolas:read'], exp: 9999999999 },
		}));
		try {
			const ws = new WebSocket(`ws://127.0.0.1:${limitedPort}/stream`, {
				headers: { Cookie: 'aithne_session=no-scope.jwt.token' },
			});
			const { code, reason } = await new Promise((resolve, reject) => {
				ws.once('close', (code, reasonBuf) => resolve({ code, reason: reasonBuf.toString() }));
				ws.once('error', reject);
			});
			expect(code).toBe(1008);
			expect(reason).toBe('Unauthorized');
		} finally {
			await new Promise(resolve => limitedServer.close(resolve));
		}
	});
});

describe('rank and meetsThreshold — comparator unit tests', () => {
	// Import directly for pure unit tests
	let rank, meetsThreshold, LEVEL_VOCABULARY, DEFAULT_LEVEL;

	beforeAll(async () => {
		const mod = await import('../src/handleEvents.js');
		rank = mod.rank;
		meetsThreshold = mod.meetsThreshold;
		LEVEL_VOCABULARY = mod.LEVEL_VOCABULARY;
		DEFAULT_LEVEL = mod.DEFAULT_LEVEL;
	});

	it('vocabulary is ordered detail < routine < notable < headline', () => {
		expect(rank('detail')).toBeLessThan(rank('routine'));
		expect(rank('routine')).toBeLessThan(rank('notable'));
		expect(rank('notable')).toBeLessThan(rank('headline'));
	});

	it('default level is routine', () => {
		expect(DEFAULT_LEVEL).toEqual('routine');
	});

	it('meetsThreshold: same level meets itself', () => {
		for (const level of LEVEL_VOCABULARY) {
			expect(meetsThreshold(level, level)).toBe(true);
		}
	});

	it('meetsThreshold: higher levels meet lower thresholds', () => {
		expect(meetsThreshold('headline', 'routine')).toBe(true);
		expect(meetsThreshold('notable', 'detail')).toBe(true);
	});

	it('meetsThreshold: lower levels do not meet higher thresholds', () => {
		expect(meetsThreshold('detail', 'routine')).toBe(false);
		expect(meetsThreshold('routine', 'headline')).toBe(false);
	});
});
