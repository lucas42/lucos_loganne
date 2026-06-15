/**
 * Observed producer→event-type map.
 *
 * Every POST /events carries a mandatory `source` field (the emitting system's
 * SYSTEM identifier). This module accumulates a high-water-mark set of every
 * (source, type) pair ever seen, persisted across restarts so a rarely-emitted
 * event isn't lost between C4 regenerations.
 *
 * The map is exposed at GET /producers for external consumption (e.g. the C4
 * estate model generator in lucos_repos).
 */

/** @type {Map<string, Set<string>>} */
let producersMap = new Map();

/**
 * Load the producers map from a plain object (e.g. parsed from producers.json).
 * Existing in-memory state is discarded.
 * @param {Object.<string, string[]>} data
 */
export function initProducers(data) {
	producersMap = new Map();
	for (const [source, types] of Object.entries(data || {})) {
		producersMap.set(source, new Set(types));
	}
}

/**
 * Record a (source, eventType) pair. Idempotent — calling it multiple times
 * with the same pair is a no-op.
 * @param {string} source
 * @param {string} type
 * @returns {boolean} true if this was a new pair (state changed), false otherwise
 */
export function recordProducer(source, type) {
	if (!producersMap.has(source)) {
		producersMap.set(source, new Set());
	}
	const before = producersMap.get(source).size;
	producersMap.get(source).add(type);
	return producersMap.get(source).size > before;
}

/**
 * Return the producers map as a plain serialisable object, suitable for
 * JSON persistence and HTTP responses. Sources and event types are sorted.
 * @returns {Object.<string, string[]>}
 */
export function getProducers() {
	const result = {};
	for (const source of [...producersMap.keys()].sort()) {
		result[source] = [...producersMap.get(source)].sort();
	}
	return result;
}
