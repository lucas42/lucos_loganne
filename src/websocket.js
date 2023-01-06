//import { WebSocketServer } from 'ws';
const WebSocketServer = require('ws').WebSocketServer;
const DEBUG = false;

// Listening on a separate port for now, to avoid having to write bespoke nginx config
const port = process.env.WEBSOCKET_PORT;
if (!port) throw "no WEBSOCKET_PORT environment variable set";
const server = new WebSocketServer({
	port,
	clientTracking: true,
});
server.on('listening', () => {
	console.log(`WebSocketServer listening on port ${port}`);
});
if (DEBUG) {
	server.on('connection', () => {
		console.log("New Web Socket Connected");
	});
}

function send(event) {
	if (DEBUG) console.log(`Sending event to ${server.clients.size} clients`);
	server.clients.forEach(client => {
		try {
			client.send(JSON.stringify(event), {}, error => {
				if (error) console.error("Failed to Send", error);
			});
		} catch (error) {
			console.error("Didn't Send", error);
		}
	});
}

module.exports = { send }