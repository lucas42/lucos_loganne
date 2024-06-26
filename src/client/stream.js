import mustache from "mustache";
import { validateEvent, formatEvent } from '../handleEvents.js';
let socket;
let eventTemplate;
const statusChannel = new BroadcastChannel("lucos_status");

function connect() {
	// If there's already an active websocket, then no need to do more
	if (socket && [WebSocket.CONNECTING, WebSocket.OPEN].includes(socket.readyState)) return;

	const protocol = location.protocol === "https:" ? "wss" : "ws";
	socket = new WebSocket(`${protocol}://${location.host}/stream`);
	socket.addEventListener('open', socketOpened);
	socket.addEventListener('close', socketClosed);
	socket.addEventListener('error', socketClosed);
	socket.addEventListener('message', messageReceived);
}

function socketOpened(domEvent) {
	console.log('WebSocket Connected');
	statusChannel.postMessage('streaming-opened');
}

function socketClosed(domEvent) {
	console.warn('WebSocket Closed', event.code, event.reason);
	statusChannel.postMessage('streaming-closed');

	/*
	 * Wait a few seconds and then try to reconnect
	 */
	window.setTimeout(connect, 5000);
}

async function messageReceived(domEvent) {
	try {
		// Check that the event data is valid (and normalise a few basic bits)
		const eventData = validateEvent(JSON.parse(domEvent.data));

		// Convert to a format needed by the template
		const event = formatEvent(eventData);

		// Look for whether the event already is displaying on the page
		let targetElement = document.querySelector(`[data-uuid="${event.uuid}"]`);

		// For a new event, create a placeholder list item to be replaced
		if (!targetElement) {
			targetElement = document.createElement("li");
			document.getElementById('events').prepend(targetElement);
		}
		targetElement.outerHTML = await renderEvent(event);
	} catch (validationError) {
		console.warn("Ignoring event", validationError);
	}
}

async function renderEvent(event) {
	const template = await getEventTemplate();
	return mustache.render(template, event);
}


async function getEventTemplate() {
	if (!eventTemplate) {
		const response = await fetch('/templates/event.mustache');
		eventTemplate = await response.text();
	}
	return eventTemplate;
}

connect();
getEventTemplate();