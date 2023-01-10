import express from 'express';
import { validateEvent } from '../handleEvents.js';
export const router = express.Router();

router.use(express.json());

/* The maximum number of events to hold in memory */
const EVENT_MAX = 100;



let events = [];

// No authentication on POST endpoint as there's no way of retreiving data from it.
router.post('/', (req, res) => {
	let event;

	// Check that the event data is valid
	try {
		event = validateEvent(req.body);
	} catch (validationError) {
		return res
			.status(400)
			.setHeader("Content-Type", "text/plain")
			.send(`Invalid event data: ${validationError}\n`);
	}

	// Return a 202 response as early as possible to prevent blocking client unnecessarily
	res
		.status(202)
		.setHeader("Content-Type", "text/plain")
		.send("Event being processed\n");

	events.unshift(event);
	while (events.length > EVENT_MAX) {
		events.pop();
	}

	function stateChange() {
		if (req.app.websocket) req.app.websocket.send(event);
		if (req.app.filesystemState) req.app.filesystemState.save(events);
	}
	stateChange(event);
	if (req.app.webhooks) req.app.webhooks.trigger(event, stateChange);
});

router.use((req, res, next) => req.app.auth(req, res, next));
router.get('/', (req, res) => {
	res
		.setHeader("Content-Type", "application/json")
		.send(events);
});

router.use((err, req, res, next) => {
	if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
		return res
			.status(400)
			.setHeader("Content-Type", "text/plain")
			.send(`Invalid JSON: ${err.message}\n`);
	}
	next();
});

export function getEvents() {
	return events;
}
export function getEventsCount() {
	return events.length;
}
export function getEventsLimit() {
	return EVENT_MAX
}
export function initEvents(newEvents, warn=true) {
	if (warn && events.length > 0) {
		console.warn(`Loading events from filesystem after events have been added - overwriting ${events.length} events`);
	}
	events = newEvents.map(validateEvent);
}
