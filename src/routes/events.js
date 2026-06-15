import express from 'express';
import { rateLimit, MemoryStore } from 'express-rate-limit';
import { performance } from 'perf_hooks';
import { validateEvent, meetsThreshold, resolveLevel, DEFAULT_LEVEL } from '../handleEvents.js';
import { getSummaryStatus, appendAttempt } from '../webhooks.js';
import { createCooldownMiddleware } from '../rate-limit.js';
import { recordPostEventsLatency } from '../saturation-metrics.js';
import { recordProducer, getProducers } from '../producers.js';
export const router = express.Router();

/* Per-UUID cooldown for the per-event retry endpoint (60 seconds) */
export const RETRY_COOLDOWN_MS = 60 * 1000;
const { middleware: perEventRetryCooldown, reset: resetPerEventCooldowns } = createCooldownMiddleware(
	RETRY_COOLDOWN_MS,
	req => req.params.uuid,
);

/* Global cooldown for the bulk retry endpoint (60 seconds) */
const { middleware: bulkRetryCooldown, reset: resetBulkRetryCooldown } = createCooldownMiddleware(RETRY_COOLDOWN_MS);

export function resetRetryCooldowns() {
	resetPerEventCooldowns();
	resetBulkRetryCooldown();
}

/* Rate limit for GET /events (100 requests per 15 minutes) */
export const EVENTS_GET_RATE_LIMIT_MAX = 100;
export const EVENTS_GET_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const eventsGetStore = new MemoryStore();
const eventsGetLimiter = rateLimit({
	windowMs: EVENTS_GET_RATE_LIMIT_WINDOW_MS,
	max: EVENTS_GET_RATE_LIMIT_MAX,
	store: eventsGetStore,
	standardHeaders: true,
	legacyHeaders: false,
});
export function resetEventsGetRateLimit() {
	eventsGetStore.resetAll();
}

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
	const startTime = performance.now();
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

	// Record latency immediately after res.send() so the `events-post-p99-ms`
	// metric reflects client-perceived response time, not post-response work.
	recordPostEventsLatency(performance.now() - startTime);

	events.unshift(event);
	trimEvents();

	// Record the (source, type) pair in the high-water-mark producers map.
	// If it's a new pair, persist the updated map alongside the events.
	const isNewProducer = recordProducer(event.source, event.type);

	function stateChange() {
		if (req.app.websocket) req.app.websocket.send(event);
		if (req.app.filesystemState) {
			req.app.filesystemState.save(events);
			if (isNewProducer) req.app.filesystemState.saveProducers(getProducers());
		}
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

/**
 * Retry all failed webhook deliveries for a single event.
 * Returns true if there were failed hooks to retry, false if there were none.
 */
async function retryHooksForEvent(event, stateChange, webhooks) {
	const failedHooks = Object.entries(event.webhooks?.all ?? {})
		.filter(([, hook]) => hook.status === 'failure');
	if (failedHooks.length === 0) return false;

	// Set all failed hooks to pending before retrying, and notify listeners
	for (const [hookUrl] of failedHooks) {
		event.webhooks.all[hookUrl].status = 'pending';
	}
	event.webhooks.status = getSummaryStatus(Object.values(event.webhooks.all));
	delete event.webhooks.errorMessage;
	stateChange();

	await Promise.allSettled(failedHooks.map(async ([hookUrl]) => {
		const at = new Date().toISOString();
		const startTime = performance.now();
		try {
			const fetchRes = await fetch(hookUrl, {
				method: 'POST',
				body: JSON.stringify(event),
				headers: webhooks?.buildHeaders(hookUrl),
			});
			if (!fetchRes.ok) throw new Error(`Server returned ${fetchRes.statusText}`);
			const durationMs = Math.round(performance.now() - startTime);
			appendAttempt(event.webhooks.all[hookUrl], {at, status: 'success', durationMs});
		} catch (error) {
			const durationMs = Math.round(performance.now() - startTime);
			console.error(`Webhook retry failed for ${hookUrl} (event ${event.uuid}): ${error.message}`);
			appendAttempt(event.webhooks.all[hookUrl], {at, status: 'failure', durationMs, errorMessage: error.message});
		}
	}));

	const hooklist = Object.values(event.webhooks.all);
	event.webhooks.status = getSummaryStatus(hooklist);
	if (event.webhooks.status === 'failure') {
		event.webhooks.errorMessage = hooklist
			.filter(hook => hook.status === 'failure')
			.map(hook => hook.attempts?.at(-1)?.errorMessage)
			.filter(Boolean)
			.join("; ");
	} else {
		delete event.webhooks.errorMessage;
	}
	stateChange();
	return true;
}

router.use('/retry-webhooks', bulkRetryCooldown);
router.use('/:uuid/retry-webhooks', perEventRetryCooldown);
router.use((req, res, next) => req.app.auth(req, res, next));

router.post('/retry-webhooks', async (req, res) => {
	// Events are stored newest-first; retry oldest-first so earlier failures are resolved first.
	const failedEvents = events.filter(e => e.webhooks?.status === 'failure').reverse();

	let retriedCount = 0;
	for (const event of failedEvents) {
		console.log(`Retrying webhooks for event ${event.uuid}`);
		function stateChange() {
			if (req.app.websocket) req.app.websocket.send(event);
			if (req.app.filesystemState) req.app.filesystemState.save(events);
		}
		await retryHooksForEvent(event, stateChange, req.app.webhooks);
		retriedCount++;
	}

	res.setHeader("Content-Type", "application/json").send({ retriedCount });
});

router.post('/:uuid/retry-webhooks', async (req, res) => {
	const event = events.find(e => e.uuid === req.params.uuid);
	if (!event) {
		return res.status(404).setHeader("Content-Type", "text/plain").send("Event not found\n");
	}

	function stateChange() {
		if (req.app.websocket) req.app.websocket.send(event);
		if (req.app.filesystemState) req.app.filesystemState.save(events);
	}

	console.log(`Retrying webhooks for event ${req.params.uuid}`);
	const hadFailures = await retryHooksForEvent(event, stateChange, req.app.webhooks);
	if (!hadFailures) {
		return res.status(400).setHeader("Content-Type", "text/plain").send("No failed webhooks to retry\n");
	}

	res.setHeader("Content-Type", "application/json").send(event.webhooks);
});

router.get('/', eventsGetLimiter, (req, res) => {
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
	const threshold = resolveLevel(req.query.level);
	const source = req.query.source ?? null;
	const type = req.query.type ?? null;
	res
		.setHeader("Content-Type", "application/json")
		.send(getEvents(since, threshold, { source, type }));
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
 * Return events newer than `since` that meet the given level threshold,
 * optionally filtered by source and/or type equality.
 * If `since` is null, defaults to DEFAULT_VIEW_WINDOW_MS ago.
 * If `threshold` is null/undefined, defaults to DEFAULT_LEVEL.
 * Events are stored newest-first.
 */
export function getEvents(since = null, threshold = DEFAULT_LEVEL, { source = null, type = null } = {}) {
	const cutoff = since ?? new Date(Date.now() - DEFAULT_VIEW_WINDOW_MS);
	const result = [];
	for (const event of events) {
		if (new Date(event.date) <= cutoff) break;
		if (!meetsThreshold(event.level, threshold)) continue;
		if (source && event.source !== source) continue;
		if (type && event.type !== type) continue;
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
/**
 * Returns the count of outbound webhook deliveries currently in `pending`
 * state across all events in memory. Derived from event state rather than a
 * separate counter so it cannot drift out of sync with reality.
 */
export function getInFlightDeliveryCount() {
	let count = 0;
	for (const event of events) {
		const hooks = event.webhooks?.all;
		if (!hooks) continue;
		for (const hook of Object.values(hooks)) {
			if (hook.status === 'pending') count++;
		}
	}
	return count;
}
export function getEventsLimit() {
	return EVENT_MAX;
}
export function getEventsRetentionMs() {
	return EVENT_RETENTION_MS;
}
/**
 * Migrate a webhook delivery record from the old single-attempt shape
 * (top-level status/durationMs/errorMessage/errorPhase, no attempts array)
 * to the new shape (attempts[] + top-level mirror fields).
 * If the record already has an attempts array it is left unchanged.
 * Mutates hookRecord in place.
 */
export function migrateHookRecord(hookRecord, eventDate) {
	if (hookRecord.attempts) return;
	const attempt = {
		at: eventDate instanceof Date ? eventDate.toISOString() : eventDate,
		status: hookRecord.status,
		durationMs: hookRecord.durationMs,
	};
	if (hookRecord.errorMessage !== undefined) attempt.errorMessage = hookRecord.errorMessage;
	if (hookRecord.errorPhase !== undefined) attempt.errorPhase = hookRecord.errorPhase;
	hookRecord.attempts = [attempt];
	// Drop the now-redundant per-URL error fields (they live in attempts[-1])
	delete hookRecord.errorMessage;
	delete hookRecord.errorPhase;
}

/**
 * Migrate an event's webhooks block to the new per-attempt-history shape.
 * Safe to call on events that are already in the new shape (no-op).
 * Mutates event in place.
 */
export function migrateWebhookShape(event) {
	if (!event.webhooks?.all) return;
	for (const hookRecord of Object.values(event.webhooks.all)) {
		migrateHookRecord(hookRecord, event.date);
	}
}

export function initEvents(newEvents, warn=true) {
	if (warn && events.length > 0) {
		console.warn(`Loading events from filesystem after events have been added - overwriting ${events.length} events`);
	}
	events = newEvents.map(raw => {
		const event = validateEvent(raw);
		migrateWebhookShape(event);
		return event;
	});
}
