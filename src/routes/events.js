import express from 'express';
import { validateEvent } from '../handleEvents.js';
export const router = express.Router();

router.use(express.json());

/* The maximum number of events to hold in memory (safety ceiling) */
const EVENT_MAX = 10000;

/* How long to retain events (in milliseconds) */
const EVENT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

/* Default window for returning events (UI and websocket catch-up) */
export const DEFAULT_VIEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

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
	trimEvents();

	function stateChange() {
		if (req.app.websocket) req.app.websocket.send(event);
		if (req.app.filesystemState) req.app.filesystemState.save(events);
	}
	stateChange(event);
	if (req.app.webhooks) req.app.webhooks.trigger(event, stateChange);
});

/**
 * Remove events that are older than EVENT_RETENTION_MS or beyond the EVENT_MAX ceiling.
 * Events are stored newest-first so we trim from the tail.
 */
function trimEvents() {
	const cutoff = new Date(Date.now() - EVENT_RETENTION_MS);
	// Short-circuit from the tail: find first index that is too old
	let cutoffIndex = events.length;
	for (let i = events.length - 1; i >= 0; i--) {
		if (new Date(events[i].date) < cutoff) {
			cutoffIndex = i;
		} else {
			break;
		}
	}
	events = events.slice(0, cutoffIndex);
	// Apply hard ceiling
	if (events.length > EVENT_MAX) {
		events = events.slice(0, EVENT_MAX);
	}
}

router.use((req, res, next) => req.app.auth(req, res, next));
router.get('/', (req, res) => {
	let since = null;
	if (req.query.since) {
		since = new Date(req.query.since);
		if (isNaN(since)) {
			return res
				.status(400)
				.setHeader("Content-Type", "text/plain")
				.send(`Invalid 'since' parameter: "${req.query.since}" is not a recognised date.\n`);
		}
	}
	res
		.setHeader("Content-Type", "application/json")
		.send(getEvents(since));
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

/**
 * Return events newer than `since`. If `since` is null, defaults to DEFAULT_VIEW_WINDOW_MS ago.
 * Events are stored newest-first.
 */
export function getEvents(since = null) {
	const cutoff = since ?? new Date(Date.now() - DEFAULT_VIEW_WINDOW_MS);
	const result = [];
	for (const event of events) {
		if (new Date(event.date) <= cutoff) break;
		result.push(event);
	}
	return result;
}
export function getEventsCount() {
	return events.length;
}
export function getWebhookErrorCount() {
	return events.filter(event => event.webhooks?.status === 'failure').length;
}
export function getEventsLimit() {
	return EVENT_MAX;
}
export function getEventsRetentionMs() {
	return EVENT_RETENTION_MS;
}
export function initEvents(newEvents, warn=true) {
	if (warn && events.length > 0) {
		console.warn(`Loading events from filesystem after events have been added - overwriting ${events.length} events`);
	}
	events = newEvents.map(validateEvent);
}
