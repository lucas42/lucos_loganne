/**
 * Saturation metrics — surface loganne's own internal state via /_info, so a
 * future burst is visible while it's happening rather than only via post-hoc
 * log archaeology (see lucas42/lucos_loganne#484).
 *
 * Four orthogonal signals:
 *   - event-loop lag p99 (gates the check — sustained blockage, filters GC spikes)
 *   - event-loop lag max (metric only — human reference, same window as p99)
 *   - rolling p99 of POST /events latency (catches the symptom that drops
 *     events at the producer→bus edge)
 *   - in-flight outbound delivery count (catches the specific fan-out-pileup
 *     failure mode that produced the 2026-05-22 incident)
 */
import { monitorEventLoopDelay } from 'perf_hooks';

/**
 * Event-loop lag threshold (ms). If p99 lag since last /_info poll exceeds
 * this, the `event-loop-lag-low` check fails (see #493 — switched from max).
 *
 * Raised from 500 ms to 1500 ms (see #496): 500 ms sat right at the edge of
 * routine production noise (random clear-state spikes ~300–400 ms observed,
 * nightly weightings recalc burst trips 500 ms briefly without user impact).
 * 1500 ms sits well above that noise floor while staying well below the
 * multi-second range a real saturation event would produce (e.g. the
 * 2026-05-22 incident, which would have generated p99 in the seconds).
 */
export const EVENT_LOOP_LAG_THRESHOLD_MS = 1500;

/**
 * In-flight webhook delivery threshold. If more outbound deliveries are
 * currently pending than this, the `outbound-fan-out-within-capacity`
 * check fails. Starting point: well above steady-state, well below the
 * 200+ that the 2026-05-22 burst would have produced.
 */
export const INFLIGHT_DELIVERIES_THRESHOLD = 50;

/**
 * POST /events p99 latency threshold (ms). Sits comfortably below
 * `lucos_media_metadata_api`'s 5 s client timeout — when we cross this,
 * media-api is at risk of dropping events even though loganne accepts them.
 */
export const POST_EVENTS_P99_THRESHOLD_MS = 2000;

/** Rolling window (ms) used by the POST /events latency p99. */
export const LATENCY_WINDOW_MS = 60 * 1000;

const eventLoopHistogram = monitorEventLoopDelay({ resolution: 20 });
eventLoopHistogram.enable();

let postEventsLatencies = []; // [{at: ms, durationMs: ms}]

/**
 * Records the server-side wall-clock duration of one POST /events response.
 * Trims entries older than LATENCY_WINDOW_MS on each call to keep the buffer
 * bounded.
 */
export function recordPostEventsLatency(durationMs) {
	const now = Date.now();
	postEventsLatencies.push({ at: now, durationMs });
	const cutoff = now - LATENCY_WINDOW_MS;
	while (postEventsLatencies.length > 0 && postEventsLatencies[0].at < cutoff) {
		postEventsLatencies.shift();
	}
}

/**
 * Returns the p99 of recorded POST /events latencies (ms) over the rolling
 * LATENCY_WINDOW_MS window, or 0 if no samples are in the window.
 *
 * For small sample counts (n < 100), p99 effectively returns the max — this
 * is intentional: when we have few samples, the worst observed latency IS
 * the most informative value to surface.
 */
export function getPostEventsP99Ms() {
	const now = Date.now();
	const cutoff = now - LATENCY_WINDOW_MS;
	const recent = [];
	for (const entry of postEventsLatencies) {
		if (entry.at >= cutoff) recent.push(entry.durationMs);
	}
	if (recent.length === 0) return 0;
	recent.sort((a, b) => a - b);
	const idx = Math.min(recent.length - 1, Math.max(0, Math.ceil(recent.length * 0.99) - 1));
	return Math.round(recent[idx]);
}

/**
 * Returns the 99th-percentile event-loop lag (ms) recorded since the last
 * histogram reset. Must be called *before* getEventLoopLagMaxMs() so both
 * functions read from the same window (getEventLoopLagMaxMs resets the
 * histogram after reading).
 *
 * Gating the `event-loop-lag-low` check on p99 rather than max means the
 * check trips only when ≥ 1 % of the 20 ms sampling slots in the 60 s window
 * exceeded the threshold — filtering out isolated GC pauses that would fire
 * spuriously under max (see #493).
 */
export function getEventLoopLagP99Ms() {
	const ns = eventLoopHistogram.percentile(99);
	if (!Number.isFinite(ns) || ns <= 0) return 0;
	return Math.round(ns / 1e6);
}

/**
 * Returns max event-loop lag (ms) recorded since the last call, and resets
 * the histogram. Call this *after* getEventLoopLagP99Ms() so both reads
 * consume the same window before the reset.
 *
 * Sampled at 20 ms resolution — short blocks (< 20 ms) are not reliably
 * detected, but the threshold (1500 ms) is well above sampling noise.
 */
export function getEventLoopLagMaxMs() {
	const maxNs = eventLoopHistogram.max;
	eventLoopHistogram.reset();
	// histogram.max returns 0 if no samples recorded — propagate as 0 ms
	if (!Number.isFinite(maxNs) || maxNs <= 0) return 0;
	return Math.round(maxNs / 1e6);
}

/**
 * Reset all in-memory state. Used by tests only.
 */
export function _resetForTests() {
	postEventsLatencies = [];
	eventLoopHistogram.reset();
}
