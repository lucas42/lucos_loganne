import { jest } from '@jest/globals'
import { Webhooks, getErrorPhase } from '../src/webhooks.js';
import express from 'express';
import fs from 'fs';

/**
 * Listen for a single request, respond to it with a given statusCode
 * and then tear down the server
 */
function mockServer(port, statusCode) {
	return new Promise(resolveListening => {
		const app = express();
		let server;
		app.use(express.json());
		const gotRequest = new Promise(resolveRequest => {
			app.all("*splat", async (request, response) => {
				response.sendStatus(statusCode);
				await new Promise(done => setTimeout(done, 500)); // Give it half a sec for the response to be sent
				server.close(() => {
					resolveRequest(request);
				});
			});
		});
		server = app.listen(port, server => {
			resolveListening(() => gotRequest);
		});
	});
}

describe('webhooks', () => {
	it('send a post request to all webhooks when the event is the same', async () => {
		const requestFunc1 = await mockServer(7901, 202);
		const requestFunc2 = await mockServer(7902, 200);
		const wh = new Webhooks({
			"trackUpdated": [
				"http://localhost:7901/main",
				"http://localhost:7902/webhook/index.htm",
			],
		});
		const eventData = {
			"type": "trackUpdated",
			"source": "track_updater",
			"track": "good track",
		}
		wh.trigger(eventData, () => {});
		const request1 = await requestFunc1();
		expect(request1.method).toEqual('POST');
		expect(request1.path).toEqual('/main');
		expect(request1.header("Content-Type")).toEqual("application/json");
		expect({...request1.body, webhooks: null}).toEqual({...eventData, webhooks:null});

		const request2 = await requestFunc2();
		expect(request2.method).toEqual('POST');
		expect(request2.path).toEqual('/webhook/index.htm');
		expect(request2.header("Content-Type")).toEqual("application/json");
		expect({...request2.body, webhooks: null}).toEqual({...eventData, webhooks:null});
	});
	it('Only post to webhooks with matching event type', async () => {
		const requestFunc1 = await mockServer(7903, 202);
		const wh = new Webhooks({
			"trackUpdated": [
				"http://localhost:7903/main",
			],
			"trackModified": [
				"http://localhost:7903/webhook/index.htm",
			],
		});
		const eventData = {
			"type": "trackUpdated",
			"source": "track_updater",
			"track": "good track",
		}
		wh.trigger(eventData, () => {});
		const request1 = await requestFunc1();
		expect(request1.method).toEqual('POST');
		expect(request1.header("Content-Type")).toEqual("application/json");
		expect({...request1.body, webhooks: null}).toEqual({...eventData, webhooks:null});
	});
	it('Erroring endpoint doesnt block others', async () => {
		const requestFunc1 = await mockServer(7904, 503);
		const requestFunc2 = await mockServer(7905, 204);
		const wh = new Webhooks({
			"trackUpdated": [
				"http://localhost:7904/error",
				"http://localhost:7905/webhook/index.htm",
			],
		});
		const eventData = {
			"type": "trackUpdated",
			"source": "track_updater",
			"track": "good track",
		}
		console.error = jest.fn();
		wh.trigger(eventData, () => {});
		const request1 = await requestFunc1();
		expect(request1.method).toEqual('POST');
		expect(request1.path).toEqual('/error');
		expect(request1.header("Content-Type")).toEqual("application/json");
		expect({...request1.body, webhooks: null}).toEqual({...eventData, webhooks:null});
		expect(console.error).toHaveBeenCalledWith(expect.anything(), "Webhook failure", "http://localhost:7904/error", "Server returned Service Unavailable");

		const request2 = await requestFunc2();
		expect(request2.method).toEqual('POST');
		expect(request2.path).toEqual('/webhook/index.htm');
		expect(request2.header("Content-Type")).toEqual("application/json");
		expect({...request2.body, webhooks: null}).toEqual({...eventData, webhooks:null});
	});
	it("An event with no wekhook doesn't error", async () => {
		const wh = new Webhooks({
			"trackUpdated": [
				"http://localhost:7906/main",
			],
			"trackModified": [
				"http://localhost:7907/webhook/index.htm",
			],
		});
		const eventData = {
			"type": "trackDeleted",
			"source": "track_updater",
			"track": "good track",
		}
		wh.trigger(eventData, () => {});
	});
	it("Sends Authorization header when consumerTokens config and env var are present", async () => {
		const requestFunc1 = await mockServer(7908, 200);
		process.env['TEST_WEBHOOK_TOKEN'] = 'mysecrettoken';
		const wh = new Webhooks({
			"consumerTokens": {
				"localhost": "TEST_WEBHOOK_TOKEN",
			},
			"trackUpdated": [
				"http://localhost:7908/webhook",
			],
		});
		const eventData = { "type": "trackUpdated" };
		wh.trigger(eventData, () => {});
		const request1 = await requestFunc1();
		expect(request1.header("Authorization")).toEqual("Bearer mysecrettoken");
		delete process.env['TEST_WEBHOOK_TOKEN'];
	});
	it("Omits Authorization header when token env var is not set", async () => {
		const requestFunc1 = await mockServer(7909, 200);
		delete process.env['TEST_WEBHOOK_TOKEN_MISSING'];
		const wh = new Webhooks({
			"consumerTokens": {
				"localhost": "TEST_WEBHOOK_TOKEN_MISSING",
			},
			"trackUpdated": [
				"http://localhost:7909/webhook",
			],
		});
		const eventData = { "type": "trackUpdated" };
		console.warn = jest.fn();
		wh.trigger(eventData, () => {});
		const request1 = await requestFunc1();
		expect(request1.header("Authorization")).toBeUndefined();
		expect(console.warn).toHaveBeenCalledWith(expect.anything(), "No token configured for webhook consumer", "localhost", expect.stringContaining("TEST_WEBHOOK_TOKEN_MISSING"));
	});
	it("Omits Authorization header when hostname is not in consumerTokens", async () => {
		const requestFunc1 = await mockServer(7910, 200);
		const wh = new Webhooks({
			"consumerTokens": {},
			"trackUpdated": [
				"http://localhost:7910/webhook",
			],
		});
		const eventData = { "type": "trackUpdated" };
		wh.trigger(eventData, () => {});
		const request1 = await requestFunc1();
		expect(request1.header("Authorization")).toBeUndefined();
	});
	it("Webhook config is valid", async () => {
		JSON.parse(fs.readFileSync('src/webhooks-config.json', 'utf-8'));
	});
	it("Records durationMs on successful delivery", async () => {
		const requestFunc = await mockServer(7911, 200);
		const wh = new Webhooks({
			"trackUpdated": ["http://localhost:7911/webhook"],
		});
		const eventData = { "type": "trackUpdated", "source": "test" };
		const succeeded = new Promise(resolve => {
			wh.trigger(eventData, (updatedEvent) => {
				if (updatedEvent.webhooks?.all?.["http://localhost:7911/webhook"]?.status === 'success') {
					resolve(updatedEvent);
				}
			});
		});
		await requestFunc();
		const finalEvent = await succeeded;
		const hookData = finalEvent.webhooks.all["http://localhost:7911/webhook"];
		expect(hookData.durationMs).toBeGreaterThanOrEqual(0);
		expect(Number.isInteger(hookData.durationMs)).toBe(true);
	});
	it("errorMessage includes cause code on connection refused", async () => {
		// Port 7950 has nothing listening — fetch will throw ECONNREFUSED.
		const wh = new Webhooks({
			"trackUpdated": ["http://127.0.0.1:7950/webhook"],
		});
		const eventData = { "type": "trackUpdated", "source": "test" };
		console.error = jest.fn();
		const failed = new Promise(resolve => {
			wh.trigger(eventData, (updatedEvent) => {
				if (updatedEvent.webhooks?.status === 'failure') resolve(updatedEvent);
			});
		});
		const finalEvent = await failed;
		expect(finalEvent.webhooks.all["http://127.0.0.1:7950/webhook"].errorMessage)
			.toMatch(/\(ECONNREFUSED\)/);
		expect(finalEvent.webhooks.errorMessage).toMatch(/\(ECONNREFUSED\)/);
		expect(console.error).toHaveBeenCalledWith(
			expect.anything(), "Webhook failure", "http://127.0.0.1:7950/webhook", expect.stringMatching(/\(ECONNREFUSED\)/)
		);
		expect(finalEvent.webhooks.all["http://127.0.0.1:7950/webhook"].durationMs)
			.toBeGreaterThanOrEqual(0);
		expect(Number.isInteger(finalEvent.webhooks.all["http://127.0.0.1:7950/webhook"].durationMs))
			.toBe(true);
	}, 10000);
	it("errorMessage includes cause code on DNS failure", async () => {
		// nonexistent.invalid is an IANA-reserved TLD guaranteed not to resolve.
		const wh = new Webhooks({
			"trackUpdated": ["http://nonexistent.invalid/webhook"],
		});
		const eventData = { "type": "trackUpdated", "source": "test" };
		console.error = jest.fn();
		const failed = new Promise(resolve => {
			wh.trigger(eventData, (updatedEvent) => {
				if (updatedEvent.webhooks?.status === 'failure') resolve(updatedEvent);
			});
		});
		const finalEvent = await failed;
		expect(finalEvent.webhooks.all["http://nonexistent.invalid/webhook"].errorMessage)
			.toMatch(/\(ENOTFOUND\)/);
		expect(finalEvent.webhooks.errorMessage).toMatch(/\(ENOTFOUND\)/);
		expect(console.error).toHaveBeenCalledWith(
			expect.anything(), "Webhook failure", "http://nonexistent.invalid/webhook", expect.stringMatching(/\(ENOTFOUND\)/)
		);
	}, 10000);
	it("errorPhase is 'response' for ETIMEDOUT (response-phase timeout)", async () => {
		const timeoutError = new TypeError('fetch failed');
		timeoutError.cause = { code: 'ETIMEDOUT' };
		const originalFetch = global.fetch;
		global.fetch = jest.fn().mockRejectedValueOnce(timeoutError);
		const wh = new Webhooks({
			"trackUpdated": ["http://example.com/webhook"],
		});
		const eventData = { "type": "trackUpdated", "source": "test" };
		console.error = jest.fn();
		const failed = new Promise(resolve => {
			wh.trigger(eventData, (updatedEvent) => {
				if (updatedEvent.webhooks?.status === 'failure') resolve(updatedEvent);
			});
		});
		const finalEvent = await failed;
		global.fetch = originalFetch;
		expect(finalEvent.webhooks.all["http://example.com/webhook"].errorPhase).toEqual('response');
		expect(finalEvent.webhooks.all["http://example.com/webhook"].errorMessage).toMatch(/\(ETIMEDOUT\)/);
		expect(console.error).toHaveBeenCalledWith(
			expect.anything(), "Webhook failure", "http://example.com/webhook",
			expect.stringMatching(/\(ETIMEDOUT\)/), "phase: response"
		);
	});
	it("errorPhase is 'connect' for UND_ERR_CONNECT_TIMEOUT (connect-phase timeout)", async () => {
		const connectError = new TypeError('fetch failed');
		connectError.cause = { code: 'UND_ERR_CONNECT_TIMEOUT' };
		const originalFetch = global.fetch;
		global.fetch = jest.fn().mockRejectedValueOnce(connectError);
		const wh = new Webhooks({
			"trackUpdated": ["http://example.com/webhook"],
		});
		const eventData = { "type": "trackUpdated", "source": "test" };
		console.error = jest.fn();
		const failed = new Promise(resolve => {
			wh.trigger(eventData, (updatedEvent) => {
				if (updatedEvent.webhooks?.status === 'failure') resolve(updatedEvent);
			});
		});
		const finalEvent = await failed;
		global.fetch = originalFetch;
		expect(finalEvent.webhooks.all["http://example.com/webhook"].errorPhase).toEqual('connect');
		expect(finalEvent.webhooks.all["http://example.com/webhook"].errorMessage).toMatch(/\(UND_ERR_CONNECT_TIMEOUT\)/);
		expect(console.error).toHaveBeenCalledWith(
			expect.anything(), "Webhook failure", "http://example.com/webhook",
			expect.stringMatching(/\(UND_ERR_CONNECT_TIMEOUT\)/), "phase: connect"
		);
	});
	it("errorPhase is absent for non-timeout errors (ECONNREFUSED)", async () => {
		const refusedError = new TypeError('fetch failed');
		refusedError.cause = { code: 'ECONNREFUSED' };
		const originalFetch = global.fetch;
		global.fetch = jest.fn().mockRejectedValueOnce(refusedError);
		const wh = new Webhooks({
			"trackUpdated": ["http://example.com/webhook"],
		});
		const eventData = { "type": "trackUpdated", "source": "test" };
		console.error = jest.fn();
		const failed = new Promise(resolve => {
			wh.trigger(eventData, (updatedEvent) => {
				if (updatedEvent.webhooks?.status === 'failure') resolve(updatedEvent);
			});
		});
		const finalEvent = await failed;
		global.fetch = originalFetch;
		expect(finalEvent.webhooks.all["http://example.com/webhook"].errorPhase).toBeUndefined();
	});
});

describe('getErrorPhase', () => {
	it("returns 'connect' for UND_ERR_CONNECT_TIMEOUT", () => {
		expect(getErrorPhase('UND_ERR_CONNECT_TIMEOUT')).toEqual('connect');
	});
	it("returns 'response' for ETIMEDOUT", () => {
		expect(getErrorPhase('ETIMEDOUT')).toEqual('response');
	});
	it("returns null for ECONNREFUSED", () => {
		expect(getErrorPhase('ECONNREFUSED')).toBeNull();
	});
	it("returns null for ENOTFOUND", () => {
		expect(getErrorPhase('ENOTFOUND')).toBeNull();
	});
	it("returns null for undefined", () => {
		expect(getErrorPhase(undefined)).toBeNull();
	});
});

describe('listAllSystems', () => {
	it('returns sorted, deduplicated system names derived from consumerTokens', () => {
		const wh = new Webhooks({
			consumerTokens: {
				'ceol.l42.eu': 'KEY_LUCOS_MEDIA_MANAGER',
				'arachne.l42.eu': 'KEY_LUCOS_ARACHNE',
			},
			trackUpdated: [
				'https://ceol.l42.eu/webhooks/trackUpdated',
				'https://arachne.l42.eu/webhook',
			],
		});
		expect(wh.listAllSystems()).toEqual(['lucos_arachne', 'lucos_media_manager']);
	});
	it('deduplicates when the same host appears in multiple event types', () => {
		const wh = new Webhooks({
			consumerTokens: {
				'arachne.l42.eu': 'KEY_LUCOS_ARACHNE',
			},
			trackUpdated: ['https://arachne.l42.eu/webhook'],
			trackDeleted: ['https://arachne.l42.eu/webhook'],
			trackAdded:   ['https://arachne.l42.eu/webhook'],
		});
		expect(wh.listAllSystems()).toEqual(['lucos_arachne']);
	});
	it('ignores URLs whose hostname has no consumerTokens entry', () => {
		const wh = new Webhooks({
			consumerTokens: {
				'arachne.l42.eu': 'KEY_LUCOS_ARACHNE',
			},
			trackUpdated: [
				'https://arachne.l42.eu/webhook',
				'https://unknown.l42.eu/webhook',
			],
		});
		expect(wh.listAllSystems()).toEqual(['lucos_arachne']);
	});
	it('ignores consumerToken entries whose env var does not start with KEY_', () => {
		const wh = new Webhooks({
			consumerTokens: {
				'arachne.l42.eu': 'KEY_LUCOS_ARACHNE',
				'example.com': 'SOME_OTHER_VAR',
			},
			trackUpdated: [
				'https://arachne.l42.eu/webhook',
				'https://example.com/webhook',
			],
		});
		expect(wh.listAllSystems()).toEqual(['lucos_arachne']);
	});
	it('returns empty array when no consumerTokens are configured', () => {
		const wh = new Webhooks({
			trackUpdated: ['https://example.com/webhook'],
		});
		expect(wh.listAllSystems()).toEqual([]);
	});
	it('returns empty array when no event URLs are configured', () => {
		const wh = new Webhooks({
			consumerTokens: {
				'arachne.l42.eu': 'KEY_LUCOS_ARACHNE',
			},
		});
		expect(wh.listAllSystems()).toEqual([]);
	});
	it('returns all five systems from the real webhooks-config.json', () => {
		const config = JSON.parse(fs.readFileSync('src/webhooks-config.json', 'utf-8'));
		const wh = new Webhooks(config);
		expect(wh.listAllSystems()).toEqual([
			'lucos_arachne',
			'lucos_media_manager',
			'lucos_media_weightings',
			'lucos_monitoring',
			'lucos_photos',
		]);
	});
});