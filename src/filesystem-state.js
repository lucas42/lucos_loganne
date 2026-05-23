import fs from 'fs';
import { initEvents } from './routes/events.js';

// STATE_DIR should be the path of a directory which persists between restarts
const STATE_DIR = process.env.STATE_DIR;
if (!STATE_DIR) throw "no STATE_DIR environment variable set";
const STATE_FILE = `${STATE_DIR}/events.json`;
try {
	const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
	initEvents(data);
} catch (error) {
	console.log("Can't find or parse events.json; using empty events array.", error);
}

/**
 * Minimum wall-clock interval between successive disk writes.
 *
 * Throttles `JSON.stringify(events)` main-thread cost during webhook bursts:
 * with a 25 MB production events.json the synchronous stringify costs ~50–100 ms
 * each, and the existing call-graph fires save() once per webhook status
 * micro-transition (~8–14 calls per fan-out event). Without throttling, a
 * sustained burst spends ~20% of wall-clock time inside JSON.stringify on the
 * main thread, starving inbound HTTP handlers and producing the 33 % inbound
 * 499 rate observed in lucas42/lucos_loganne#485.
 *
 * Throttling to one write per second caps that overhead at ~10 % even with the
 * largest events.json (10 000 events at retention ceiling). Worst-case data
 * loss on crash extends from "between accept and async writeFile callback" to
 * "up to SAVE_THROTTLE_MS after the most recent state change" — acceptable
 * given the inbound contract is already fire-and-forget.
 */
export const SAVE_THROTTLE_MS = 1000;

let pendingEvents = null; // most recent events reference awaiting a write
let trailingTimer = null; // setTimeout handle for the trailing-edge save
let lastWriteAt = 0;      // Date.now() of most recent write start

function writeNow(events) {
	lastWriteAt = Date.now();
	fs.writeFile(STATE_FILE, JSON.stringify(events), error => {
		if (error) console.error("Failed to save to filesystem", error);
	});
}

/**
 * Persist the current events array to disk. Calls are throttled with both
 * leading-edge (first call fires immediately) and trailing-edge (subsequent
 * calls within the throttle window coalesce into one write at the window end)
 * semantics, so a burst of N rapid save() calls always produces at most two
 * disk writes and at most two main-thread `JSON.stringify(events)` runs.
 *
 * Low-traffic behaviour is unchanged: an isolated save() writes immediately.
 */
export function save(events) {
	pendingEvents = events;
	if (trailingTimer) return; // trailing save already scheduled
	const sinceLast = Date.now() - lastWriteAt;
	if (sinceLast >= SAVE_THROTTLE_MS) {
		// Leading edge: write immediately
		const toWrite = pendingEvents;
		pendingEvents = null;
		writeNow(toWrite);
		return;
	}
	// Schedule trailing-edge write at the end of the throttle window
	trailingTimer = setTimeout(() => {
		trailingTimer = null;
		const toWrite = pendingEvents;
		pendingEvents = null;
		writeNow(toWrite);
	}, SAVE_THROTTLE_MS - sinceLast);
}

/**
 * Reset internal throttle state. Used only by tests — production code should
 * not need to call this.
 */
export function _resetThrottleForTests() {
	if (trailingTimer) {
		clearTimeout(trailingTimer);
		trailingTimer = null;
	}
	pendingEvents = null;
	lastWriteAt = 0;
}
