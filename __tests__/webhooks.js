import { jest } from '@jest/globals'
import { Webhooks, getErrorPhase, appendAttempt, RETRY_DELAY_MS, SECOND_RETRY_DELAY_MS, validateWebhooksConfig } from '../src/webhooks.js';
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
		const hookRecord = finalEvent.webhooks.all["http://127.0.0.1:7950/webhook"];
		expect(hookRecord.attempts).toHaveLength(1);
		expect(hookRecord.attempts[0].errorMessage).toMatch(/\(ECONNREFUSED\)/);
		expect(hookRecord.errorMessage).toBeUndefined();
		expect(finalEvent.webhooks.errorMessage).toMatch(/\(ECONNREFUSED\)/);
		expect(console.error).toHaveBeenCalledWith(
			expect.anything(), "Webhook failure", "http://127.0.0.1:7950/webhook", expect.stringMatching(/\(ECONNREFUSED\)/)
		);
		expect(hookRecord.durationMs).toBeGreaterThanOrEqual(0);
		expect(Number.isInteger(hookRecord.durationMs)).toBe(true);
		expect(hookRecord.attempts[0].durationMs).toBeGreaterThanOrEqual(0);
	}, 10000);
	it("errorMessage includes cause code on DNS failure", async () => {
		// Simulate a DNS failure via mocked fetch (ENOTFOUND) for determinism.
		const dnsError = new TypeError('fetch failed');
		dnsError.cause = { code: 'ENOTFOUND' };
		const originalFetch = global.fetch;
		global.fetch = jest.fn().mockRejectedValueOnce(dnsError);
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
		global.fetch = originalFetch;
		const hookRecord = finalEvent.webhooks.all["http://nonexistent.invalid/webhook"];
		expect(hookRecord.attempts).toHaveLength(1);
		expect(hookRecord.attempts[0].errorMessage).toMatch(/\(ENOTFOUND\)/);
		expect(hookRecord.errorMessage).toBeUndefined();
		expect(finalEvent.webhooks.errorMessage).toMatch(/\(ENOTFOUND\)/);
		expect(console.error).toHaveBeenCalledWith(
			expect.anything(), "Webhook failure", "http://nonexistent.invalid/webhook", expect.stringMatching(/\(ENOTFOUND\)/)
		);
	});
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
		const hookRecord = finalEvent.webhooks.all["http://example.com/webhook"];
		expect(hookRecord.attempts[0].errorPhase).toEqual('response');
		expect(hookRecord.errorPhase).toBeUndefined();
		expect(hookRecord.attempts[0].errorMessage).toMatch(/\(ETIMEDOUT\)/);
		expect(hookRecord.errorMessage).toBeUndefined();
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
		const hookRecord = finalEvent.webhooks.all["http://example.com/webhook"];
		expect(hookRecord.attempts[0].errorPhase).toEqual('connect');
		expect(hookRecord.errorPhase).toBeUndefined();
		expect(hookRecord.attempts[0].errorMessage).toMatch(/\(UND_ERR_CONNECT_TIMEOUT\)/);
		expect(hookRecord.errorMessage).toBeUndefined();
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
		const hookRecord = finalEvent.webhooks.all["http://example.com/webhook"];
		expect(hookRecord.attempts[0].errorPhase).toBeUndefined();
		expect(hookRecord.errorPhase).toBeUndefined();
	});
});

describe('appendAttempt', () => {
	it('appends an attempt to the attempts array', () => {
		const hookRecord = { status: 'pending', attempts: [] };
		appendAttempt(hookRecord, { at: '2026-05-22T00:00:00.000Z', status: 'success', durationMs: 42 });
		expect(hookRecord.attempts).toHaveLength(1);
		expect(hookRecord.attempts[0]).toEqual({ at: '2026-05-22T00:00:00.000Z', status: 'success', durationMs: 42 });
	});
	it('updates the top-level status and durationMs to mirror the latest attempt', () => {
		const hookRecord = { status: 'pending', attempts: [] };
		appendAttempt(hookRecord, { at: '2026-05-22T00:00:00.000Z', status: 'failure', durationMs: 100, errorMessage: 'oops' });
		expect(hookRecord.status).toEqual('failure');
		expect(hookRecord.durationMs).toEqual(100);
	});
	it('accumulates multiple attempts without overwriting earlier ones', () => {
		const hookRecord = { status: 'pending', attempts: [] };
		appendAttempt(hookRecord, { at: '2026-05-22T00:00:00.000Z', status: 'failure', durationMs: 200, errorMessage: 'first error' });
		appendAttempt(hookRecord, { at: '2026-05-22T00:01:00.000Z', status: 'success', durationMs: 50 });
		expect(hookRecord.attempts).toHaveLength(2);
		expect(hookRecord.attempts[0].errorMessage).toEqual('first error');
		expect(hookRecord.attempts[1].status).toEqual('success');
		expect(hookRecord.status).toEqual('success');
		expect(hookRecord.durationMs).toEqual(50);
	});
});

describe('attempt history — trigger()', () => {
	it('records a success attempt on first delivery', async () => {
		const requestFunc = await mockServer(7920, 200);
		const wh = new Webhooks({ "trackUpdated": ["http://localhost:7920/webhook"] });
		const eventData = { "type": "trackUpdated", "source": "test" };
		const succeeded = new Promise(resolve => {
			wh.trigger(eventData, (updatedEvent) => {
				if (updatedEvent.webhooks?.all?.["http://localhost:7920/webhook"]?.status === 'success') {
					resolve(updatedEvent);
				}
			});
		});
		await requestFunc();
		const finalEvent = await succeeded;
		const hookRecord = finalEvent.webhooks.all["http://localhost:7920/webhook"];
		expect(hookRecord.attempts).toHaveLength(1);
		expect(hookRecord.attempts[0].status).toEqual('success');
		expect(typeof hookRecord.attempts[0].at).toEqual('string');
		expect(hookRecord.attempts[0].durationMs).toBeGreaterThanOrEqual(0);
		expect(hookRecord.attempts[0].errorMessage).toBeUndefined();
	});

	it('records a failure attempt with errorMessage in attempts[0], not at top level', async () => {
		const failError = new TypeError('fetch failed');
		failError.cause = { code: 'ECONNREFUSED' };
		const originalFetch = global.fetch;
		global.fetch = jest.fn().mockRejectedValueOnce(failError);
		console.error = jest.fn();
		const wh = new Webhooks({ "trackUpdated": ["http://example.com/webhook"] });
		const eventData = { "type": "trackUpdated", "source": "test" };
		const failed = new Promise(resolve => {
			wh.trigger(eventData, (updatedEvent) => {
				if (updatedEvent.webhooks?.status === 'failure') resolve(updatedEvent);
			});
		});
		const finalEvent = await failed;
		global.fetch = originalFetch;
		const hookRecord = finalEvent.webhooks.all["http://example.com/webhook"];
		expect(hookRecord.attempts).toHaveLength(1);
		expect(hookRecord.attempts[0].status).toEqual('failure');
		expect(hookRecord.attempts[0].errorMessage).toMatch(/ECONNREFUSED/);
		// Top-level per-URL fields do NOT include errorMessage
		expect(hookRecord.errorMessage).toBeUndefined();
	});

	it('preserves first-attempt failure data when auto-retry succeeds', async () => {
		jest.useFakeTimers();
		const failError = new TypeError('fetch failed');
		failError.cause = { code: 'ETIMEDOUT' };
		global.fetch = jest.fn()
			.mockRejectedValueOnce(failError)
			.mockResolvedValueOnce({ ok: true });
		console.error = jest.fn();

		const wh = new Webhooks({ "test": ["http://example.com/hook"] });
		const eventData = { "type": "test", "source": "test" };
		let lastEvent = null;
		wh.trigger(eventData, e => { lastEvent = e; });

		await Promise.resolve();
		await Promise.resolve();

		// After initial failure, attempts has 1 entry
		expect(lastEvent.webhooks.all["http://example.com/hook"].attempts).toHaveLength(1);
		expect(lastEvent.webhooks.all["http://example.com/hook"].attempts[0].status).toEqual('failure');
		const firstAttemptErrorMessage = lastEvent.webhooks.all["http://example.com/hook"].attempts[0].errorMessage;
		expect(firstAttemptErrorMessage).toMatch(/ETIMEDOUT/);

		// Trigger auto-retry
		await jest.advanceTimersByTimeAsync(RETRY_DELAY_MS);

		// After retry succeeds, attempts has 2 entries; first entry still has the failure data
		const hookRecord = lastEvent.webhooks.all["http://example.com/hook"];
		expect(hookRecord.attempts).toHaveLength(2);
		expect(hookRecord.attempts[0].status).toEqual('failure');
		expect(hookRecord.attempts[0].errorMessage).toEqual(firstAttemptErrorMessage);
		expect(hookRecord.attempts[1].status).toEqual('success');
		expect(hookRecord.status).toEqual('success');

		jest.useRealTimers();
		delete global.fetch;
	});

	it('preserves first-attempt failure data when auto-retry also fails', async () => {
		jest.useFakeTimers();
		global.fetch = jest.fn().mockRejectedValue(new Error('Connection refused'));
		console.error = jest.fn();

		const wh = new Webhooks({ "test": ["http://example.com/hook"] });
		const eventData = { "type": "test", "source": "test" };
		let lastEvent = null;
		wh.trigger(eventData, e => { lastEvent = e; });

		await Promise.resolve();
		await Promise.resolve();

		expect(lastEvent.webhooks.all["http://example.com/hook"].attempts).toHaveLength(1);

		// After first auto-retry fires and also fails, a second retry is scheduled.
		// Status stays 'failure' between retries; 'pending' only while the fetch is in flight.
		await jest.advanceTimersByTimeAsync(RETRY_DELAY_MS);

		const hookRecord = lastEvent.webhooks.all["http://example.com/hook"];
		expect(hookRecord.attempts).toHaveLength(2);
		expect(hookRecord.attempts[0].status).toEqual('failure');
		expect(hookRecord.attempts[1].status).toEqual('failure');
		expect(hookRecord.status).toEqual('failure');
		expect(lastEvent.webhooks.status).toEqual('failure');

		// After second auto-retry also fires and fails, event is permanently failed
		await jest.advanceTimersByTimeAsync(SECOND_RETRY_DELAY_MS);

		expect(hookRecord.attempts).toHaveLength(3);
		expect(hookRecord.attempts[2].status).toEqual('failure');
		expect(hookRecord.status).toEqual('failure');
		expect(lastEvent.webhooks.status).toEqual('failure');

		jest.useRealTimers();
		delete global.fetch;
	});

	it('second auto-retry (attempt 3) recovers when first retry also fails but second succeeds', async () => {
		jest.useFakeTimers();
		const failError = new TypeError('fetch failed');
		failError.cause = { code: 'ETIMEDOUT' };
		global.fetch = jest.fn()
			.mockRejectedValueOnce(failError)
			.mockRejectedValueOnce(failError)
			.mockResolvedValueOnce({ ok: true });
		console.error = jest.fn();

		const wh = new Webhooks({ "test": ["http://example.com/hook"] });
		const eventData = { "type": "test", "source": "test" };
		let lastEvent = null;
		wh.trigger(eventData, e => { lastEvent = e; });

		await Promise.resolve();
		await Promise.resolve();

		// After initial failure
		expect(lastEvent.webhooks.all["http://example.com/hook"].attempts).toHaveLength(1);
		expect(lastEvent.webhooks.all["http://example.com/hook"].attempts[0].status).toEqual('failure');

		// After first auto-retry also fails, a second retry is scheduled.
		// Status stays 'failure' between retries; 'pending' only while fetch is in flight.
		await jest.advanceTimersByTimeAsync(RETRY_DELAY_MS);

		const hookRecord = lastEvent.webhooks.all["http://example.com/hook"];
		expect(hookRecord.attempts).toHaveLength(2);
		expect(hookRecord.status).toEqual('failure');
		expect(lastEvent.webhooks.status).toEqual('failure');

		// After second auto-retry succeeds, event recovers
		await jest.advanceTimersByTimeAsync(SECOND_RETRY_DELAY_MS);

		expect(hookRecord.attempts).toHaveLength(3);
		expect(hookRecord.attempts[2].status).toEqual('success');
		expect(hookRecord.status).toEqual('success');
		expect(lastEvent.webhooks.status).toEqual('success');

		jest.useRealTimers();
		delete global.fetch;
	});
});

describe('validateWebhooksConfig', () => {
	it('does not throw for a valid config where all subscriber hostnames have consumerTokens entries', () => {
		expect(() => validateWebhooksConfig({
			consumerTokens: {
				'arachne.l42.eu': 'KEY_LUCOS_ARACHNE',
				'ceol.l42.eu': 'KEY_LUCOS_MEDIA_MANAGER',
			},
			trackUpdated: [
				'https://ceol.l42.eu/webhooks/trackUpdated',
				'https://arachne.l42.eu/webhook',
			],
		})).not.toThrow();
	});
	it('throws when a subscriber URL hostname has no consumerTokens entry', () => {
		expect(() => validateWebhooksConfig({
			consumerTokens: {
				'arachne.l42.eu': 'KEY_LUCOS_ARACHNE',
			},
			trackUpdated: [
				'https://arachne.l42.eu/webhook',
				'https://unmapped.l42.eu/webhook',
			],
		})).toThrow(/unmapped\.l42\.eu/);
	});
	it('deduplicates hostnames in the error message when the same host appears in multiple events', () => {
		expect(() => validateWebhooksConfig({
			consumerTokens: {},
			trackUpdated: ['https://orphan.l42.eu/webhook'],
			trackDeleted: ['https://orphan.l42.eu/webhook'],
		})).toThrow(/orphan\.l42\.eu/);
	});
	it('does not throw when there are no event URL arrays', () => {
		expect(() => validateWebhooksConfig({
			consumerTokens: { 'arachne.l42.eu': 'KEY_LUCOS_ARACHNE' },
		})).not.toThrow();
	});
	it('does not throw when consumerTokens is absent and there are no event URLs', () => {
		expect(() => validateWebhooksConfig({})).not.toThrow();
	});
	it('passes validation against the real webhooks-config.json', () => {
		const config = JSON.parse(fs.readFileSync('src/webhooks-config.json', 'utf-8'));
		expect(() => validateWebhooksConfig(config)).not.toThrow();
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
	it('returns all six systems from the real webhooks-config.json', () => {
		const config = JSON.parse(fs.readFileSync('src/webhooks-config.json', 'utf-8'));
		const wh = new Webhooks(config);
		expect(wh.listAllSystems()).toEqual([
			'lucos_arachne',
			'lucos_media_manager',
			'lucos_media_metadata_api',
			'lucos_media_weightings',
			'lucos_monitoring',
			'lucos_photos',
		]);
	});
});