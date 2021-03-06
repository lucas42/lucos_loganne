const express = require('express');
const router = express.Router();
const fs = require('fs');

router.use(express.json());

/* The maximum number of events to hold in memory */
const EVENT_MAX = 100;

/**
 * Checks whether an event object is valid
 * Throws a string if it is invalid
 * Returns a normalised event object if it is valid
 **/
function validateEvent(event) {
	let eventDate;

	if (Object.keys(event).length === 0) throw "No JSON found in POST body";
	for (const key of ["source", "type", "humanReadable"]) {
		if (!event[key]) throw `Field \`${key}\` not found in event data`;
	}
	if ('date' in event) {
		eventDate = new Date(event.date);
		if (isNaN(eventDate)) throw `Date value ("${event.date}") isn't a recognised date.  Leave out to default to now.`;
	}
	event.date = eventDate || new Date();
	return event;
}

let STATE_FILE;
let events = [];

// STATE_DIR should be the path of a directory which persists between restarts
if ('STATE_DIR' in process.env) {
	try {
		STATE_FILE = `${process.env.STATE_DIR}/events.json`
		events = require(STATE_FILE).map(validateEvent);
	} catch (err) {
		console.log(`Can't find or parse events.json; using empty events array.`, err.code);
	}
}

router.get('/', (req, res) => {
	res
		.setHeader("Content-Type", "application/json")
		.send(events);
});

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
	if (STATE_FILE) {
		fs.writeFile(STATE_FILE, JSON.stringify(events), err => (err ? console.error(err) : null));
	}
	if (req.app.webhooks) req.app.webhooks.trigger(event);
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

function getEvents() {
	return events;
}
function getEventsCount() {
	return events.length;
}
function getEventsLimit() {
	return EVENT_MAX
}

module.exports = {
	router,
	getEvents,
	getEventsCount,
	getEventsLimit,
}