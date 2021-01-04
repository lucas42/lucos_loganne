const express = require('express');
const router = express.Router();

router.use(express.json());

/* The maximum number of events to hold in memory */
const EVENT_MAX = 100;

const events = [];

router.get('/', (req, res) => {
	res.send(events);
});

router.post('/', (req, res) => {
	let eventDate;

	// Check that the event data is valid
	try {
		if (Object.keys(req.body).length === 0) throw "No JSON found in POST body";
		for (const key of ["source", "type", "humanReadable"]) {
			if (!req.body[key]) throw `Field \`${key}\` not found in event data`;
		}
		if ('date' in req.body) {
			eventDate = new Date(req.body.date);
			if (isNaN(eventDate)) throw `Date value ("${req.body.date}") isn't a recognised date.  Leave out to default to now.`;
		}
	} catch (validationError) {
		return res.status(400).send(`Invalid event data: ${validationError}\n`);
	}

	// Return a 202 response as early as possible to prevent blocking client unnecessarily
	res.status(202).send("Event being processed\n");


	req.body.date = eventDate || new Date();
	events.unshift(req.body);
	while (events.length > EVENT_MAX) {
		events.pop();
	}
});

router.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).send(`Invalid JSON: ${err.message}\n`);
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