import { jest } from '@jest/globals';
import request from 'supertest';
import getApp from '../src/routes/front-controller.js';
import { initEvents, RETRY_COOLDOWN_MS, resetRetryCooldowns, resetEventsGetRateLimit, EVENTS_GET_RATE_LIMIT_MAX } from '../src/routes/events.js';
import { middleware as authMiddleware } from '../src/auth.js';
import { RETRY_DELAY_MS, Webhooks } from '../src/webhooks.js';
let app;
beforeEach(() => {
	app = getApp('./src');
	app.auth = (req, res, next) => {next()};
})
afterEach(() => {
	jest.resetModules();
	initEvents([], false);
	resetRetryCooldowns();
	resetEventsGetRateLimit();
});
describe('Events Endpoint', () => {
	it('should store a valid event', async () => {
		const postRes = await request(app)
			.post('/events')
			.send({
				source: 'loganne_tests',
				type: 'test',
				humanReadable: 'Running some unit tests',
			});
		expect(postRes.statusCode).toEqual(202);
		expect(postRes.text).toEqual('Event being processed\n');
		const getRes = await request(app).get('/events');
		expect(getRes.body.length).toEqual(1);

		// Check that a date was added and is recent
		expect(new Date() - new Date(getRes.body[0].date)).toBeLessThan(100);
	});
	it('should reject empty post request', async () => {
		const postRes = await request(app)
			.post('/events')
			.send();
		expect(postRes.statusCode).toEqual(400);
		expect(postRes.text).toContain('No JSON found');
		const getRes = await request(app).get('/events');
		expect(getRes.body.length).toEqual(0);
	});
	it('should reject invalid json', async () => {
		const postRes = await request(app)
			.post('/events')
			.send('{invalid:"json"}')
			.type('json');
		expect(postRes.statusCode).toEqual(400);
		expect(postRes.text).toContain('Invalid JSON');
		const getRes = await request(app).get('/events');
		expect(getRes.body.length).toEqual(0);
	});
	it('should reject missing source', async () => {
		const postRes = await request(app)
			.post('/events')
			.send({
				type: 'test',
				humanReadable: 'Running some unit tests',
			});
		expect(postRes.statusCode).toEqual(400);
		expect(postRes.text).toContain('`source` not found');
		const getRes = await request(app).get('/events');
		expect(getRes.body.length).toEqual(0);
	});
	it('should reject missing type', async () => {
		const postRes = await request(app)
			.post('/events')
			.send({
				source: 'loganne_tests',
				humanReadable: 'Running some unit tests',
			});
		expect(postRes.statusCode).toEqual(400);
		expect(postRes.text).toContain('`type` not found');
		const getRes = await request(app).get('/events');
		expect(getRes.body.length).toEqual(0);
	});
	it('should reject missing human readable string', async () => {
		const postRes = await request(app)
			.post('/events')
			.send({
				source: 'loganne_tests',
				type: 'test',
			});
		expect(postRes.statusCode).toEqual(400);
		expect(postRes.text).toContain('`humanReadable` not found');
		const getRes = await request(app).get('/events');
		expect(getRes.body.length).toEqual(0);
	});
	it('should reject invalid uuid', async () => {
		const postRes = await request(app)
			.post('/events')
			.send({
				source: 'loganne_tests',
				type: 'test',
				humanReadable: 'Running some unit tests',
				uuid: 'bob-bob-123'
			});
		expect(postRes.statusCode).toEqual(400);
		expect(postRes.text).toContain('isn\'t a valid uuid');
		const getRes = await request(app).get('/events');
		expect(getRes.body.length).toEqual(0);
	});
	it('should reject invalid date', async () => {
		const postRes = await request(app)
			.post('/events')
			.send({
				source: 'loganne_tests',
				type: 'test',
				humanReadable: 'Running some unit tests',
				date: 'tomorrow',
			});
		expect(postRes.statusCode).toEqual(400);
		expect(postRes.text).toContain('isn\'t a recognised date');
		const getRes = await request(app).get('/events');
		expect(getRes.body.length).toEqual(0);
	});
	it('should accept valid date', async () => {
		// Use a recent date (1 hour ago) so it passes the 90-day retention policy
		const recentDate = new Date(Date.now() - 60 * 60 * 1000).toISOString();
		const postRes = await request(app)
			.post('/events')
			.send({
				source: 'loganne_tests',
				type: 'test',
				humanReadable: 'Running some unit tests',
				date: recentDate,
			});
		expect(postRes.statusCode).toEqual(202);
		expect(postRes.text).toEqual('Event being processed\n');
		const getRes = await request(app).get('/events');
		expect(getRes.body.length).toEqual(1);
		expect(getRes.body[0].date).toEqual(recentDate);
	});
	it('should accept valid url', async () => {
		const postRes = await request(app)
			.post('/events')
			.send({
				source: 'loganne_tests',
				type: 'test',
				humanReadable: 'Running some unit tests',
				url: 'https://example.org/path',
			});
		expect(postRes.statusCode).toEqual(202);
		expect(postRes.text).toEqual('Event being processed\n');
		const getRes = await request(app).get('/events');
		expect(getRes.body.length).toEqual(1);
		expect(getRes.body[0].url).toEqual("https://example.org/path");
	});
	it('should reject invalid url', async () => {
		const postRes = await request(app)
			.post('/events')
			.send({
				source: 'loganne_tests',
				type: 'test',
				humanReadable: 'Running some unit tests',
				url: '/path',
			});
		expect(postRes.statusCode).toEqual(400);
		expect(postRes.text).toContain('isn\'t a valid url');
		const getRes = await request(app).get('/events');
		expect(getRes.body.length).toEqual(0);
	});
	it('should accept no url', async () => {
		const postRes = await request(app)
			.post('/events')
			.send({
				source: 'loganne_tests',
				type: 'test',
				humanReadable: 'Running some unit tests',
			});
		expect(postRes.statusCode).toEqual(202);
		expect(postRes.text).toEqual('Event being processed\n');
		const getRes = await request(app).get('/events');
		expect(getRes.body.length).toEqual(1);
		expect(getRes.body[0].url).toBeUndefined();
	});
	it('should store many recent events without trimming them', async () => {
		let count = 0;

		// Post 250 events (well below the 10,000 ceiling)
		for (; count < 250; count++) {
			const postRes = await request(app)
				.post('/events')
				.send({
					source: 'loganne_tests',
					type: 'multitest',
					count,
					humanReadable: 'Running some unit tests',
				});
			expect(postRes.statusCode).toEqual(202);
			expect(postRes.text).toEqual('Event being processed\n');
		}
		const getRes = await request(app).get('/events');

		// All 250 should be retained (all recent, below the 10,000 ceiling)
		expect(getRes.body.length).toEqual(250);

		// Check the events are in newest-first order
		await getRes.body.forEach(event => {
			count--;
			expect(event.count).toEqual(count);
		});
		expect(count).toEqual(0);
	});
	it('should trim events older than the retention period', async () => {
		// Load events via initEvents: one recent, one old (91 days ago)
		const recentDate = new Date().toISOString();
		const oldDate = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
		initEvents([
			{ source: 'test', type: 'recent', humanReadable: 'Recent', date: recentDate },
			{ source: 'test', type: 'old', humanReadable: 'Old', date: oldDate },
		], false);

		// Post a new event to trigger trimming
		await request(app)
			.post('/events')
			.send({ source: 'loganne_tests', type: 'trigger', humanReadable: 'Trigger trim' });

		const getRes = await request(app).get('/events');
		// Only the 2 recent events should remain (the new one + the recent pre-loaded one)
		expect(getRes.body.length).toEqual(2);
		expect(getRes.body.map(e => e.type)).not.toContain('old');
	});
	it('should filter events by ?since= parameter', async () => {
		const t1 = new Date(Date.now() - 3000).toISOString(); // 3s ago
		const t2 = new Date(Date.now() - 2000).toISOString(); // 2s ago
		const t3 = new Date(Date.now() - 1000).toISOString(); // 1s ago
		initEvents([
			{ source: 'test', type: 'c', humanReadable: 'C', date: t3 },
			{ source: 'test', type: 'b', humanReadable: 'B', date: t2 },
			{ source: 'test', type: 'a', humanReadable: 'A', date: t1 },
		], false);

		// Request events since t2 — should only return the one at t3
		const getRes = await request(app).get(`/events?since=${encodeURIComponent(t2)}`);
		expect(getRes.statusCode).toEqual(200);
		expect(getRes.body.length).toEqual(1);
		expect(getRes.body[0].type).toEqual('c');
	});
	it('should return 400 for invalid ?since= parameter', async () => {
		const getRes = await request(app).get('/events?since=not-a-date');
		expect(getRes.statusCode).toEqual(400);
		expect(getRes.text).toContain('Invalid');
	});
	it('should return recent events when ?since= is not provided', async () => {
		initEvents([
			{ source: 'test', type: 'a', humanReadable: 'A', date: new Date().toISOString() },
			{ source: 'test', type: 'b', humanReadable: 'B', date: new Date().toISOString() },
		], false);
		const getRes = await request(app).get('/events');
		expect(getRes.statusCode).toEqual(200);
		expect(getRes.body.length).toEqual(2);
	});
	it('should exclude events older than DEFAULT_VIEW_WINDOW_MS when ?since= is not provided', async () => {
		const recentDate = new Date().toISOString();
		const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(); // 8 days ago
		initEvents([
			{ source: 'test', type: 'recent', humanReadable: 'Recent', date: recentDate },
			{ source: 'test', type: 'old', humanReadable: 'Old', date: oldDate },
		], false);
		const getRes = await request(app).get('/events');
		expect(getRes.statusCode).toEqual(200);
		expect(getRes.body.length).toEqual(1);
		expect(getRes.body[0].type).toEqual('recent');
	});
	it('should return 429 after the rate limit is exceeded on GET /events', async () => {
		for (let i = 0; i < EVENTS_GET_RATE_LIMIT_MAX; i++) {
			const res = await request(app).get('/events');
			expect(res.statusCode).toEqual(200);
		}
		const res = await request(app).get('/events');
		expect(res.statusCode).toEqual(429);
	});
});
describe("Info Endpoint", () => {

	it('should keep track of small number of events stored in memory', async () => {

		// Post fewer than the MAX_LIMIT of events
		for (let count = 0; count < 75; count++) {
			const postRes = await request(app)
				.post('/events')
				.send({
					source: 'loganne_tests',
					type: 'multitest',
					count,
					humanReadable: 'Running some unit tests',
				});
			expect(postRes.statusCode).toEqual(202);
			expect(postRes.text).toEqual('Event being processed\n');
		}
		const infoRes = await request(app).get('/_info');
		expect(infoRes.body.system).toEqual('lucos_loganne');
		expect(infoRes.body.metrics['event-count'].value).toEqual(75);
		expect(infoRes.body.checks['events-in-limit'].ok).toEqual(true);

	});
	it('should keep track of a large number of events stored in memory', async () => {

		// Post 234 events (all recent, below the 10,000 ceiling)
		for (let count = 0; count < 234; count++) {
			const postRes = await request(app)
				.post('/events')
				.send({
					source: 'loganne_tests',
					type: 'multitest',
					count,
					humanReadable: 'Running some unit tests',
				});
			expect(postRes.statusCode).toEqual(202);
			expect(postRes.text).toEqual('Event being processed\n');
		}
		const infoRes = await request(app).get('/_info');
		expect(infoRes.body.system).toEqual('lucos_loganne');

		// All 234 events should be counted (all are recent)
		expect(infoRes.body.metrics['event-count'].value).toEqual(234);
		expect(infoRes.body.checks['events-in-limit'].ok).toEqual(true);

	});
	it('should report zero webhook errors when no events have failed webhooks', async () => {
		initEvents([
			{ source: 'loganne_tests', type: 'test', humanReadable: 'ok event', date: new Date() },
		], false);
		const infoRes = await request(app).get('/_info');
		expect(infoRes.body.metrics['webhook-error-count'].value).toEqual(0);
		expect(infoRes.body.checks['webhook-error-rate'].ok).toEqual(true);
		// failThreshold:2 rides out the auto-retry window — see #454.
		expect(infoRes.body.checks['webhook-error-rate'].failThreshold).toEqual(2);
	});
	it('should include dependsOn list derived from webhook targets for webhook-error-rate check', async () => {
		app.webhooks = new Webhooks({
			consumerTokens: {
				'example.com': 'KEY_LUCOS_ARACHNE',
				'other.example.com': 'KEY_LUCOS_PHOTOS',
			},
			someEvent: [
				'https://example.com/webhook',
				'https://other.example.com/hook',
			],
		});
		const infoRes = await request(app).get('/_info');
		const dependsOn = infoRes.body.checks['webhook-error-rate'].dependsOn;
		// Computed from app.webhooks.listAllSystems() — see #456.
		// Accuracy of the mapping is covered by webhooks unit tests.
		expect(dependsOn).toEqual([
			'lucos_arachne',
			'lucos_photos',
		]);
	});
	it('should return empty dependsOn when no webhooks are configured', async () => {
		// app.webhooks not set — fallback to []
		const infoRes = await request(app).get('/_info');
		expect(infoRes.body.checks['webhook-error-rate'].dependsOn).toEqual([]);
	});
	it('should count events with webhook failures and fail check when any failures exist', async () => {
		initEvents([
			{ source: 'loganne_tests', type: 'test', humanReadable: 'ok event', date: new Date() },
			{ source: 'loganne_tests', type: 'test', humanReadable: 'failed event', date: new Date(), webhooks: { status: 'failure' } },
			{ source: 'loganne_tests', type: 'test', humanReadable: 'another failed event', date: new Date(), webhooks: { status: 'failure' } },
		], false);
		const infoRes = await request(app).get('/_info');
		expect(infoRes.body.metrics['webhook-error-count'].value).toEqual(2);
		expect(infoRes.body.checks['webhook-error-rate'].ok).toEqual(false);
		// failThreshold:2 must still be reported when the check is failing,
		// so lucos_monitoring knows to wait for a second failing poll before
		// firing the alert — see #454.
		expect(infoRes.body.checks['webhook-error-rate'].failThreshold).toEqual(2);
	});
});
describe("Retry webhooks endpoint", () => {
	it('should return 404 for an unknown uuid', async () => {
		const res = await request(app).post('/events/00000000-0000-0000-0000-000000000000/retry-webhooks');
		expect(res.statusCode).toEqual(404);
	});
	it('should return 400 when event has no failed webhooks', async () => {
		initEvents([
			{ source: 'loganne_tests', type: 'test', humanReadable: 'ok event', date: new Date(), uuid: 'a0000000-0000-4000-8000-000000000001', webhooks: { status: 'success', all: { 'http://example.com': { status: 'success' } } } },
		], false);
		const res = await request(app).post('/events/a0000000-0000-4000-8000-000000000001/retry-webhooks');
		expect(res.statusCode).toEqual(400);
	});
	it('should retry failed hooks and update webhook status on success', async () => {
		initEvents([
			{ source: 'loganne_tests', type: 'test', humanReadable: 'failed event', date: new Date(), uuid: 'b0000000-0000-4000-8000-000000000002', webhooks: { status: 'failure', all: { 'http://example.com/hook': { status: 'failure', errorMessage: 'Server returned Bad Gateway' } } } },
		], false);

		// Mock fetch to succeed
		global.fetch = jest.fn().mockResolvedValue({ ok: true });

		const res = await request(app).post('/events/b0000000-0000-4000-8000-000000000002/retry-webhooks');
		expect(res.statusCode).toEqual(200);
		expect(res.body.status).toEqual('success');

		// Webhook error count should now be zero
		const infoRes = await request(app).get('/_info');
		expect(infoRes.body.metrics['webhook-error-count'].value).toEqual(0);
		expect(infoRes.body.checks['webhook-error-rate'].ok).toEqual(true);

		delete global.fetch;
	});
	it('should include Authorization header when retrying a hook with a configured consumer token', async () => {
		initEvents([
			{ source: 'loganne_tests', type: 'test', humanReadable: 'failed event', date: new Date(), uuid: 'e0000000-0000-4000-8000-000000000009', webhooks: { status: 'failure', all: { 'http://example.com/hook': { status: 'failure', errorMessage: 'Server returned Bad Gateway' } } } },
		], false);

		process.env.KEY_EXAMPLE = 'test-token-123';
		app.webhooks = new Webhooks({ consumerTokens: { 'example.com': 'KEY_EXAMPLE' } });

		global.fetch = jest.fn().mockResolvedValue({ ok: true });

		const res = await request(app).post('/events/e0000000-0000-4000-8000-000000000009/retry-webhooks');
		expect(res.statusCode).toEqual(200);

		expect(global.fetch).toHaveBeenCalledWith(
			'http://example.com/hook',
			expect.objectContaining({
				headers: expect.objectContaining({ Authorization: 'Bearer test-token-123' }),
			}),
		);

		delete global.fetch;
		delete process.env.KEY_EXAMPLE;
	});
	it('should set webhook status to pending before retrying', async () => {
		initEvents([
			{ source: 'loganne_tests', type: 'test', humanReadable: 'failed event', date: new Date(), uuid: 'd0000000-0000-4000-8000-000000000004', webhooks: { status: 'failure', all: { 'http://example.com/hook': { status: 'failure', errorMessage: 'Server returned Bad Gateway' } } } },
		], false);

		const statusesSeen = [];
		app.websocket = { send: jest.fn(event => statusesSeen.push(event.webhooks.status)) };

		global.fetch = jest.fn().mockResolvedValue({ ok: true });

		const res = await request(app).post('/events/d0000000-0000-4000-8000-000000000004/retry-webhooks');
		expect(res.statusCode).toEqual(200);
		expect(statusesSeen).toContain('pending');
		expect(statusesSeen[statusesSeen.length - 1]).toEqual('success');

		delete global.fetch;
	});
	it('should keep status as failure when retry also fails', async () => {
		initEvents([
			{ source: 'loganne_tests', type: 'test', humanReadable: 'failed event', date: new Date(), uuid: 'c0000000-0000-4000-8000-000000000003', webhooks: { status: 'failure', all: { 'http://example.com/hook': { status: 'failure', errorMessage: 'Server returned Bad Gateway' } } } },
		], false);

		// Mock fetch to fail again
		global.fetch = jest.fn().mockResolvedValue({ ok: false, statusText: 'Bad Gateway' });

		const res = await request(app).post('/events/c0000000-0000-4000-8000-000000000003/retry-webhooks');
		expect(res.statusCode).toEqual(200);
		expect(res.body.status).toEqual('failure');

		const infoRes = await request(app).get('/_info');
		expect(infoRes.body.metrics['webhook-error-count'].value).toEqual(1);
		expect(infoRes.body.checks['webhook-error-rate'].ok).toEqual(false);

		delete global.fetch;
	});
	it('should return 429 if the same event is retried within the cooldown window', async () => {
		initEvents([
			{ source: 'loganne_tests', type: 'test', humanReadable: 'failed event', date: new Date(), uuid: 'f0000000-0000-4000-8000-000000000001', webhooks: { status: 'failure', all: { 'http://example.com/hook': { status: 'failure', errorMessage: 'Server returned Bad Gateway' } } } },
		], false);

		global.fetch = jest.fn().mockResolvedValue({ ok: true });

		const first = await request(app).post('/events/f0000000-0000-4000-8000-000000000001/retry-webhooks');
		expect(first.statusCode).toEqual(200);

		const second = await request(app).post('/events/f0000000-0000-4000-8000-000000000001/retry-webhooks');
		expect(second.statusCode).toEqual(429);
		expect(second.headers['retry-after']).toBeDefined();

		delete global.fetch;
	});
	it('should allow retrying different events independently within the cooldown window', async () => {
		initEvents([
			{ source: 'loganne_tests', type: 'test', humanReadable: 'event A', date: new Date(), uuid: 'f0000000-0000-4000-8000-000000000002', webhooks: { status: 'failure', all: { 'http://example.com/hook': { status: 'failure', errorMessage: 'err' } } } },
			{ source: 'loganne_tests', type: 'test', humanReadable: 'event B', date: new Date(), uuid: 'f0000000-0000-4000-8000-000000000003', webhooks: { status: 'failure', all: { 'http://example.com/hook': { status: 'failure', errorMessage: 'err' } } } },
		], false);

		global.fetch = jest.fn().mockResolvedValue({ ok: true });

		const resA = await request(app).post('/events/f0000000-0000-4000-8000-000000000002/retry-webhooks');
		expect(resA.statusCode).toEqual(200);

		// Different UUID should not be rate-limited
		const resB = await request(app).post('/events/f0000000-0000-4000-8000-000000000003/retry-webhooks');
		expect(resB.statusCode).toEqual(200);

		delete global.fetch;
	});
	it('should allow retrying after the cooldown window passes', async () => {
		jest.useFakeTimers();
		initEvents([
			{ source: 'loganne_tests', type: 'test', humanReadable: 'failed event', date: new Date(), uuid: 'f0000000-0000-4000-8000-000000000004', webhooks: { status: 'failure', all: { 'http://example.com/hook': { status: 'failure', errorMessage: 'err' } } } },
		], false);

		// Mock fetch to always fail so hooks remain in failure state after each retry,
		// allowing us to verify the second call is permitted (not rate-limited) rather than 400.
		global.fetch = jest.fn().mockRejectedValue(new Error('Connection refused'));

		const first = await request(app).post('/events/f0000000-0000-4000-8000-000000000004/retry-webhooks');
		expect(first.statusCode).toEqual(200);

		await jest.advanceTimersByTimeAsync(RETRY_COOLDOWN_MS);

		const second = await request(app).post('/events/f0000000-0000-4000-8000-000000000004/retry-webhooks');
		expect(second.statusCode).toEqual(200);

		jest.useRealTimers();
		delete global.fetch;
	});
});
describe("Error page", () => {
	it('should return 404 for unknown page', () =>
		request(app)
			.get("/unknown")
			.expect(404)
			.expect(/Cannot GET/)
	);
});
describe("Icon Page", () => {
	it('should return a PNG for the icon', () =>
		request(app)
			.get("/icon")
			.expect(200)
			.expect('Content-Type', "image/png")
	);
});
describe("Stylesheet", () => {
	it('should return CSS for the stylesheet', () =>
		request(app)
			.get("/style.css")
			.expect(200)
			.expect('Content-Type', "text/css; charset=utf-8")
	);
});
describe("View Page", () => {
	it('should return HTML', () => 
		request(app)
		.get("/view")
		.expect(200)
		.expect("Content-Type", "text/html; charset=utf-8")
		.expect(/<ul id="events">/)
	);
});
describe("Front Page", () => {
	it('should redirect', () =>
		request(app)
		.get("/")
		.expect(302)
		.expect('Location', '/view')
	);
});
describe("Bearer Token Auth", () => {
	let authApp;
	const TEST_API_KEY = 'test-secret-key-12345';
	beforeEach(() => {
		authApp = getApp('./src');
		authApp.auth = (req, res, next) => authMiddleware(req, res, next);
		process.env.CLIENT_KEYS = `lucos_test:development=${TEST_API_KEY}`;
		initEvents([], false);
	});
	afterEach(() => {
		delete process.env.CLIENT_KEYS;
	});
	it('should allow GET /events with a valid Bearer token', async () => {
		const getRes = await request(authApp)
			.get('/events')
			.set('Authorization', `Bearer ${TEST_API_KEY}`);
		expect(getRes.statusCode).toEqual(200);
		expect(getRes.headers['content-type']).toContain('application/json');
	});
	it('should return 401 for GET /events with an invalid Bearer token', async () => {
		const getRes = await request(authApp)
			.get('/events')
			.set('Authorization', 'Bearer wrong-token');
		expect(getRes.statusCode).toEqual(401);
		expect(getRes.text).toContain('Unauthorized');
	});
	it('should not redirect to auth for GET /events with an invalid Bearer token', async () => {
		const getRes = await request(authApp)
			.get('/events')
			.set('Authorization', 'Bearer wrong-token');
		expect(getRes.statusCode).toEqual(401);
		expect(getRes.headers['location']).toBeUndefined();
	});
	it('should return WWW-Authenticate: Bearer header for GET /events with an invalid Bearer token', async () => {
		const getRes = await request(authApp)
			.get('/events')
			.set('Authorization', 'Bearer wrong-token');
		expect(getRes.statusCode).toEqual(401);
		expect(getRes.headers['www-authenticate']).toEqual('Bearer');
	});
	it('should redirect to auth for GET /events with no Authorization header', async () => {
		const getRes = await request(authApp)
			.get('/events');
		expect(getRes.statusCode).toEqual(302);
		expect(getRes.headers['location']).toContain('auth.l42.eu');
	});
});
describe("Bulk retry webhooks endpoint", () => {
	it('should return 200 with retriedCount 0 when no events have failed webhooks', async () => {
		initEvents([
			{ source: 'loganne_tests', type: 'test', humanReadable: 'ok event', date: new Date(), uuid: 'e0000000-0000-4000-8000-000000000001', webhooks: { status: 'success', all: { 'http://example.com/hook': { status: 'success' } } } },
		], false);
		const res = await request(app).post('/events/retry-webhooks');
		expect(res.statusCode).toEqual(200);
		expect(res.body.retriedCount).toEqual(0);
	});
	it('should retry all failed events and report retriedCount', async () => {
		initEvents([
			{ source: 'loganne_tests', type: 'test', humanReadable: 'failed event 1', date: new Date(), uuid: 'e0000000-0000-4000-8000-000000000002', webhooks: { status: 'failure', all: { 'http://example.com/hook1': { status: 'failure', errorMessage: 'Server returned Bad Gateway' } } } },
			{ source: 'loganne_tests', type: 'test', humanReadable: 'failed event 2', date: new Date(), uuid: 'e0000000-0000-4000-8000-000000000003', webhooks: { status: 'failure', all: { 'http://example.com/hook2': { status: 'failure', errorMessage: 'Server returned Bad Gateway' } } } },
			{ source: 'loganne_tests', type: 'test', humanReadable: 'ok event', date: new Date(), uuid: 'e0000000-0000-4000-8000-000000000004', webhooks: { status: 'success', all: { 'http://example.com/hook3': { status: 'success' } } } },
		], false);

		global.fetch = jest.fn().mockResolvedValue({ ok: true });

		const res = await request(app).post('/events/retry-webhooks');
		expect(res.statusCode).toEqual(200);
		expect(res.body.retriedCount).toEqual(2);

		const infoRes = await request(app).get('/_info');
		expect(infoRes.body.metrics['webhook-error-count'].value).toEqual(0);
		expect(infoRes.body.checks['webhook-error-rate'].ok).toEqual(true);

		delete global.fetch;
	});
	it('should include Authorization header when bulk-retrying a hook with a configured consumer token', async () => {
		initEvents([
			{ source: 'loganne_tests', type: 'test', humanReadable: 'failed event', date: new Date(), uuid: 'e0000000-0000-4000-8000-000000000099', webhooks: { status: 'failure', all: { 'http://example.com/hook': { status: 'failure', errorMessage: 'Server returned Bad Gateway' } } } },
		], false);

		process.env.KEY_EXAMPLE = 'test-token-456';
		app.webhooks = new Webhooks({ consumerTokens: { 'example.com': 'KEY_EXAMPLE' } });

		global.fetch = jest.fn().mockResolvedValue({ ok: true });

		const res = await request(app).post('/events/retry-webhooks');
		expect(res.statusCode).toEqual(200);

		expect(global.fetch).toHaveBeenCalledWith(
			'http://example.com/hook',
			expect.objectContaining({
				headers: expect.objectContaining({ Authorization: 'Bearer test-token-456' }),
			}),
		);

		delete global.fetch;
		delete process.env.KEY_EXAMPLE;
	});
	it('should not retry events where hooks have not failed', async () => {
		initEvents([
			{ source: 'loganne_tests', type: 'test', humanReadable: 'ok event', date: new Date(), uuid: 'e0000000-0000-4000-8000-000000000005', webhooks: { status: 'success', all: { 'http://example.com/hook': { status: 'success' } } } },
		], false);

		global.fetch = jest.fn();

		const res = await request(app).post('/events/retry-webhooks');
		expect(res.statusCode).toEqual(200);
		expect(global.fetch).not.toHaveBeenCalled();

		delete global.fetch;
	});
	it('should retry events in chronological order (oldest first)', async () => {
		const oldDate = new Date(Date.now() - 3000).toISOString();
		const midDate = new Date(Date.now() - 2000).toISOString();
		const newDate = new Date(Date.now() - 1000).toISOString();
		// initEvents expects newest-first order
		initEvents([
			{ source: 'loganne_tests', type: 'test', humanReadable: 'newest', date: newDate, uuid: 'e2000000-0000-4000-8000-000000000001', webhooks: { status: 'failure', all: { 'http://example.com/hook': { status: 'failure', errorMessage: 'err' } } } },
			{ source: 'loganne_tests', type: 'test', humanReadable: 'middle', date: midDate, uuid: 'e2000000-0000-4000-8000-000000000002', webhooks: { status: 'failure', all: { 'http://example.com/hook': { status: 'failure', errorMessage: 'err' } } } },
			{ source: 'loganne_tests', type: 'test', humanReadable: 'oldest', date: oldDate, uuid: 'e2000000-0000-4000-8000-000000000003', webhooks: { status: 'failure', all: { 'http://example.com/hook': { status: 'failure', errorMessage: 'err' } } } },
		], false);

		const processedOrder = [];
		global.fetch = jest.fn((_url, opts) => {
			const body = JSON.parse(opts.body);
			processedOrder.push(body.uuid);
			return Promise.resolve({ ok: true });
		});

		const res = await request(app).post('/events/retry-webhooks');
		expect(res.statusCode).toEqual(200);
		expect(res.body.retriedCount).toEqual(3);
		expect(processedOrder).toEqual([
			'e2000000-0000-4000-8000-000000000003', // oldest
			'e2000000-0000-4000-8000-000000000002', // middle
			'e2000000-0000-4000-8000-000000000001', // newest
		]);

		delete global.fetch;
	});
	it('should return 429 if bulk retry is called twice within the cooldown window', async () => {

		global.fetch = jest.fn().mockResolvedValue({ ok: true });

		const first = await request(app).post('/events/retry-webhooks');
		expect(first.statusCode).toEqual(200);

		const second = await request(app).post('/events/retry-webhooks');
		expect(second.statusCode).toEqual(429);
		expect(second.headers['retry-after']).toBeDefined();

		delete global.fetch;
	});
	it('should allow bulk retry after the cooldown window passes', async () => {
		jest.useFakeTimers();
		global.fetch = jest.fn().mockResolvedValue({ ok: true });

		const first = await request(app).post('/events/retry-webhooks');
		expect(first.statusCode).toEqual(200);

		await jest.advanceTimersByTimeAsync(RETRY_COOLDOWN_MS);

		const second = await request(app).post('/events/retry-webhooks');
		expect(second.statusCode).toEqual(200);

		jest.useRealTimers();
		delete global.fetch;
	});
});
describe("Automatic webhook retry", () => {
	beforeEach(() => {
		jest.useFakeTimers();
	});
	afterEach(() => {
		jest.useRealTimers();
	});
	it('should auto-retry a failed hook after the delay and clear failure on success', async () => {
		// First call fails, second call (retry) succeeds
		global.fetch = jest.fn()
			.mockRejectedValueOnce(new Error('Connection refused'))
			.mockResolvedValueOnce({ ok: true });

		const webhooks = new Webhooks({ test: ['http://example.com/hook'] });
		const event = { type: 'test', webhooks: { all: {} } };
		let lastEvent = null;
		webhooks.trigger(event, e => { lastEvent = e; });

		// Wait for async fetch to settle
		await Promise.resolve();
		await Promise.resolve();

		// After initial failure, status should be failure
		expect(lastEvent.webhooks.status).toEqual('failure');

		// Advance timers to trigger the retry
		await jest.advanceTimersByTimeAsync(RETRY_DELAY_MS);

		// After retry succeeds, status should be success
		expect(lastEvent.webhooks.status).toEqual('success');

		delete global.fetch;
	});
	it('should remain failure if auto-retry also fails', async () => {
		global.fetch = jest.fn().mockRejectedValue(new Error('Connection refused'));

		const webhooks = new Webhooks({ test: ['http://example.com/hook'] });
		const event = { type: 'test', webhooks: { all: {} } };
		let lastEvent = null;
		webhooks.trigger(event, e => { lastEvent = e; });

		await Promise.resolve();
		await Promise.resolve();

		expect(lastEvent.webhooks.status).toEqual('failure');

		await jest.advanceTimersByTimeAsync(RETRY_DELAY_MS);

		expect(lastEvent.webhooks.status).toEqual('failure');

		delete global.fetch;
	});
});
