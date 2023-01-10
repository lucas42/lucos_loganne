import { WebSocketServer } from 'ws';
import querystring from 'querystring';
import { isAuthenticated } from './auth.js';
const DEBUG = false;

export function sendToAllClients(server, event) {
	const authenticatedClients = Array.from(server.clients).filter(client => client.authenticated);
	if (DEBUG) console.log(`Sending event to ${authenticatedClients.length} clients`);
	authenticatedClients.forEach(client => {
		try {
			client.send(JSON.stringify(event), {}, error => {
				if (error) console.error("Failed to Send", error);
			});
		} catch (error) {
			console.error("Didn't Send", error);
		}
	});
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
		if (DEBUG) {
			console.log(`New Web Socket Connected, isAuthenticated=${client.authenticated}`);
		}
		if (!client.authenticated) client.close(1008, "Forbidden");
	});
	app.websocket = {
		send: event => {
			sendToAllClients(server, event);
		},
	};
}
