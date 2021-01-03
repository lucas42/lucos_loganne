const request = require('supertest');
const app = require('../app');

describe('Events', () => {
	it('should store a new event', async () => {
		const res = await request(app)
			.post('/events')
			.send({
				source: 'loganne_tests',
				type: 'test',
				humanReadable: 'Running some unit tests',
			});
		expect(res.statusCode).toEqual(202);
		expect(res.text).toEqual('Event being processed\n');
	})
})