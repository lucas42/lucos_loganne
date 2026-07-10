import { WebSocketServer } from 'ws';
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

// verifySessionToken is injected (rather than imported directly from
// auth.js) since it now closes over a per-process aithne client constructed
// once by index.js's composition root, not a module-level singleton
// (lucas42/lucos#268).
export function startup(httpServer, app, verifySessionToken) {
	const server = new WebSocketServer({
		clientTracking: true,
		server: httpServer,
		path: '/stream',
	});
	server.on('listening', () => {
		console.log(`WebSocketServer listening`);
	});
	server.on('connection', async (client, request) => {
		const { authenticated, authorized } = await verifySessionToken(request.headers.cookie);
		client.authenticated = authenticated && authorized;

		/* Parse and store the level threshold from the connection URL */
		const urlParts = (request.url || '').split('?');
		const urlParams = new URLSearchParams(urlParts[1] || '');
		client.levelThreshold = resolveLevel(urlParams.get('level'));

		if (DEBUG) {
			console.log(`New Web Socket Connected, isAuthenticated=${client.authenticated}, levelThreshold=${client.levelThreshold}`);
		}

		// Close unauthenticated and unauthorised connections with distinct reasons.
		// The client uses the reason to decide whether to reconnect:
		//   "Forbidden"    → no/invalid token → client may redirect to login, then reconnect.
		//   "Unauthorized" → valid token but missing loganne:use scope → client must NOT
		//                    reconnect, because the 403 page loads this very script, creating
		//                    an infinite reconnect loop.
		if (!authenticated) return client.close(1008, "Forbidden");
		if (!authorized) return client.close(1008, "Unauthorized");

		/* Send recent events in case any were missed since previous connection */
		getEvents(null, client.levelThreshold).forEach(event => {
			sendEvent(client, event);
		});
	});
	app.websocket = {
		send: event => {
			sendToAllClients(server, event);
		},
	};
}
