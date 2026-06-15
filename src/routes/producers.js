import express from 'express';

export const router = express.Router();

/**
 * Observed producer→event-type map.
 *
 * Every POST /events carries a mandatory `source` field (the emitting system's
 * SYSTEM identifier). This module accumulates a high-water-mark set of every
 * (source, type) pair ever seen, persisted across restarts so rarely-emitted
 * events aren't lost between C4 regenerations.
 *
 * Filesystem persistence is injected at startup via setSaveCallback so that
 * this module remains free of filesystem imports (and testable without STATE_DIR).
 */

/** @type {Map<string, Set<string>>} */
let producersMap = new Map();

/** @type {((producers: Object.<string, string[]>) => void) | null} */
let _saveCallback = null;

/**
 * Inject a callback to be invoked whenever the producers map gains a new entry.
 * Called from index.js to wire up filesystem persistence without creating a
 * circular import between routes/producers.js and filesystem-producers.js.
 * @param {function} fn
 */
export function setSaveCallback(fn) {
	_saveCallback = fn;
}

/**
 * Load the producers map from a plain object (e.g. parsed from producers.json).
 * Discards existing in-memory state.
 * @param {Object.<string, string[]>} data
 */
export function initProducers(data) {
	producersMap = new Map();
	for (const [source, types] of Object.entries(data || {})) {
		producersMap.set(source, new Set(types));
	}
}

/**
 * Record a (source, eventType) pair.  Idempotent — calling it multiple times
 * with the same pair is a no-op.  If the pair is genuinely new, persists the
 * updated map via the registered save callback (if any).
 * @param {string} source
 * @param {string} type
 * @returns {boolean} true if this was a new pair (state changed)
 */
export function recordProducer(source, type) {
	if (!producersMap.has(source)) producersMap.set(source, new Set());
	const before = producersMap.get(source).size;
	producersMap.get(source).add(type);
	const isNew = producersMap.get(source).size > before;
	if (isNew && _saveCallback) _saveCallback(getProducers());
	return isNew;
}

/**
 * Return the producers map as a sorted, serialisable object suitable for
 * JSON persistence and HTTP responses.
 * @returns {Object.<string, string[]>}
 */
export function getProducers() {
	const result = {};
	for (const source of [...producersMap.keys()].sort()) {
		result[source] = [...producersMap.get(source)].sort();
	}
	return result;
}

router.get('/', (req, res) => {
	res.setHeader('Content-Type', 'application/json').send(getProducers());
});
