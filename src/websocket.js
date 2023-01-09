//import { WebSocketServer } from 'ws';
const WebSocketServer = require('ws').Server;
const DEBUG = false;

function sendToAllClients(server, event) {
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

function startup(httpServer, app) {
	const server = new WebSocketServer({
		clientTracking: true,
		server: httpServer,
		path: '/stream',
	});
	server.on('listening', () => {
		console.log(`WebSocketServer listening`);
	});
	if (DEBUG) {
		server.on('connection', () => {
			console.log("New Web Socket Connected");
		});
	}
	app.websocket = {
		send: event => {
			sendToAllClients(server, event);
		},
	};
}

module.exports = { startup }