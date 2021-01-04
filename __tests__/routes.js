const request = require('supertest');
let app;
beforeEach(() => {
	app = require('../routes/front-controller');
})
afterEach(() => {
	jest.resetModules();
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
		const postRes = await request(app)
			.post('/events')
			.send({
				source: 'loganne_tests',
				type: 'test',
				humanReadable: 'Running some unit tests',
				date: -14182940000,
			});
		expect(postRes.statusCode).toEqual(202);
		expect(postRes.text).toEqual('Event being processed\n');
		const getRes = await request(app).get('/events');
		expect(getRes.body.length).toEqual(1);
		expect(getRes.body[0].date).toEqual("1969-07-20T20:17:40.000Z");
	});
	it('should limit the number of events stored in memory', async () => {
		let count = 0;

		// Post more than the MAX_LIMIT of events
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

		// Check the number of events equals MAX_LIMIT
		expect(getRes.body.length).toEqual(100);

		// Check the events remaining are the most recent ones
		await getRes.body.forEach(event => {
			count--;
			expect(event.count).toEqual(count);
		});

		// Check the number of missing events is the total posted minus MAX_LIMIT
		expect(count).toEqual(150);
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
	it('should keep track of max limit of events stored in memory', async () => {

		// Post more than the MAX_LIMIT of events
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

		// Check the event count is reported as MAX_LIMIT
		expect(infoRes.body.metrics['event-count'].value).toEqual(100);

		// It's hard to test events-in-limit failure as it should always be ok in a well-behaved system
		expect(infoRes.body.checks['events-in-limit'].ok).toEqual(true);

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