const { Webhooks } = require('../src/webhooks');
const express = require('express');

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
			app.all("*", async (request, response) => {
				response.sendStatus(statusCode);
				await new Promise(done => setTimeout(done, 500)); // Give it half a sec for the response to be sent
				server.close();
				resolveRequest(request);
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
		wh.trigger(eventData);
		const request1 = await requestFunc1();
		expect(request1.method).toEqual('POST');
		expect(request1.path).toEqual('/main');
		expect(request1.header("Content-Type")).toEqual("application/json");
		expect(request1.body).toEqual(eventData);

		const request2 = await requestFunc2();
		expect(request2.method).toEqual('POST');
		expect(request2.path).toEqual('/webhook/index.htm');
		expect(request2.header("Content-Type")).toEqual("application/json");
		expect(request2.body).toEqual(eventData);
	});
	it('Only post to webooks with matching event type', async () => {
		const requestFunc1 = await mockServer(7901, 202);
		const wh = new Webhooks({
			"trackUpdated": [
				"http://localhost:7901/main",
			],
			"trackModified": [
				"http://localhost:7902/webhook/index.htm",
			],
		});
		const eventData = {
			"type": "trackUpdated",
			"source": "track_updater",
			"track": "good track",
		}
		wh.trigger(eventData);
		const request1 = await requestFunc1();
		expect(request1.method).toEqual('POST');
		expect(request1.header("Content-Type")).toEqual("application/json");
		expect(request1.body).toEqual(eventData);
	});
	it('Erroring endpoint doesnt block others', async () => {
		const requestFunc1 = await mockServer(7901, 503);
		const requestFunc2 = await mockServer(7902, 204);
		const wh = new Webhooks({
			"trackUpdated": [
				"http://localhost:7901/error",
				"http://localhost:7902/webhook/index.htm",
			],
		});
		const eventData = {
			"type": "trackUpdated",
			"source": "track_updater",
			"track": "good track",
		}
		console.error = jest.fn();
		wh.trigger(eventData);
		const request1 = await requestFunc1();
		expect(request1.method).toEqual('POST');
		expect(request1.path).toEqual('/error');
		expect(request1.header("Content-Type")).toEqual("application/json");
		expect(request1.body).toEqual(eventData);
		expect(console.error).toHaveBeenCalledWith("Webhook failure", "http://localhost:7901/error", "Server returned Service Unavailable");

		const request2 = await requestFunc2();
		expect(request2.method).toEqual('POST');
		expect(request2.path).toEqual('/webhook/index.htm');
		expect(request2.header("Content-Type")).toEqual("application/json");
		expect(request2.body).toEqual(eventData);
	});
	it("An event with no wekhook doesn't error", async () => {
		const wh = new Webhooks({
			"trackUpdated": [
				"http://localhost:7901/main",
			],
			"trackModified": [
				"http://localhost:7902/webhook/index.htm",
			],
		});
		const eventData = {
			"type": "trackDeleted",
			"source": "track_updater",
			"track": "good track",
		}
		wh.trigger(eventData);
	});
});