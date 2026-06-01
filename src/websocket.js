import { WebSocketServer } from 'ws';
import querystring from 'querystring';
import { isAuthenticated } from './auth.js';
import { getEvents } from './routes/events.js';
import { meetsThreshold, resolveLevel } from './handleEvents.js';
const DEBUG = false;

export function sendToAllClients(server, event) {
	const authenticatedClients = Array.from(server.clients).filter(client => client.authenticated);
	if (DEBUG) console.log(`Sending event to ${authenticatedClients.length} clients`);
	authenticatedClients.forEach(client => {
		if (meetsThreshold(event.level, client.levelThreshold)) {
			sendEvent(client, event);
		}
	});
}

function sendEvent(client, event) {
	try {
		client.send(JSON.stringify(event), {}, error => {
			if (error) console.error("Failed to Send", error);
		});
	} catch (error) {
		console.error("Didn't Send", error);
	}

}

export function startup(httpServer, app) {
	const server = new WebSocketServer({
		clientTracking: true,
		server: httpServer,
		path: '/stream',
	});
	server.on('listening', () => {
		console.log(`WebSocketServer listening`);
	});
	server.on('connection', async (client, request) => {
		const cookies = querystring.parse(request.headers.cookie, '; ');
		const token = cookies['auth_token'];
		client.authenticated = await isAuthenticated(token);

		/* Parse and store the level threshold from the connection URL */
		const urlParts = (request.url || '').split('?');
		const urlParams = new URLSearchParams(urlParts[1] || '');
		client.levelThreshold = resolveLevel(urlParams.get('level'));

		if (DEBUG) {
			console.log(`New Web Socket Connected, isAuthenticated=${client.authenticated}, levelThreshold=${client.levelThreshold}`);
		}
		if (!client.authenticated) return client.close(1008, "Forbidden");

		/* Send recent events in case any were missed since previous connection */
		getEvents().forEach(event => {
			if (meetsThreshold(event.level, client.levelThreshold)) {
				sendEvent(client, event);
			}
		});
	});
	app.websocket = {
		send: event => {
			sendToAllClients(server, event);
		},
	};
}
