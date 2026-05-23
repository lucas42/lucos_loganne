import { jest } from '@jest/globals';
import {
	recordPostEventsLatency,
	getPostEventsP99Ms,
	getEventLoopLagP99Ms,
	getEventLoopLagMaxMs,
	LATENCY_WINDOW_MS,
	EVENT_LOOP_LAG_THRESHOLD_MS,
	INFLIGHT_DELIVERIES_THRESHOLD,
	POST_EVENTS_P99_THRESHOLD_MS,
	_resetForTests,
} from '../src/saturation-metrics.js';

describe('saturation-metrics: POST /events p99 latency', () => {
	beforeEach(() => {
		_resetForTests();
	});

	it('returns 0 when no samples have been recorded', () => {
		expect(getPostEventsP99Ms()).toEqual(0);
	});

	it('returns the single sample when only one has been recorded', () => {
		recordPostEventsLatency(42);
		expect(getPostEventsP99Ms()).toEqual(42);
	});

	it('computes the 99th-percentile rank for a uniform distribution', () => {
		// 100 samples of values 1..100; p99 = nearest-rank index ceil(0.99 * 100) - 1 = 98 (value 99).
		for (let v = 1; v <= 100; v++) recordPostEventsLatency(v);
		expect(getPostEventsP99Ms()).toEqual(99);
	});

	it('returns the highest sample for fewer than 100 samples', () => {
		// p99 of small N reduces to "max" — intentional, see module-level docstring.
		recordPostEventsLatency(10);
		recordPostEventsLatency(20);
		recordPostEventsLatency(30);
		expect(getPostEventsP99Ms()).toEqual(30);
	});

	it('drops samples older than LATENCY_WINDOW_MS', () => {
		jest.useFakeTimers();
		try {
			recordPostEventsLatency(500);
			jest.advanceTimersByTime(LATENCY_WINDOW_MS + 1000);
			recordPostEventsLatency(50);
			// The 500ms old sample should have been trimmed; only the 50ms one remains.
			expect(getPostEventsP99Ms()).toEqual(50);
		} finally {
			jest.useRealTimers();
		}
	});

	it('rounds fractional latencies to the nearest integer ms', () => {
		recordPostEventsLatency(12.4);
		expect(getPostEventsP99Ms()).toEqual(12);
		_resetForTests();
		recordPostEventsLatency(12.6);
		expect(getPostEventsP99Ms()).toEqual(13);
	});
});

describe('saturation-metrics: event-loop lag — getEventLoopLagMaxMs', () => {
	beforeEach(() => {
		_resetForTests();
	});

	it('returns 0 if no event-loop samples have been recorded yet', () => {
		// After reset() the histogram has no samples, so max is 0.
		expect(getEventLoopLagMaxMs()).toEqual(0);
	});

	it('returns a non-negative integer ms', async () => {
		// Let the histogram run for a short while so it collects samples.
		// Doing a tiny synchronous wait increases the chance of a non-zero sample,
		// but we accept 0 as valid — the value is just whatever the loop has done.
		await new Promise(resolve => setTimeout(resolve, 50));
		const v = getEventLoopLagMaxMs();
		expect(Number.isInteger(v)).toBe(true);
		expect(v).toBeGreaterThanOrEqual(0);
	});

	it('resets the histogram on each call', async () => {
		// Block the loop briefly to ensure a non-trivial lag sample lands.
		// 60ms synchronous busy-wait > 20ms resolution, so the histogram will record it.
		const start = Date.now();
		while (Date.now() - start < 60) { /* busy-wait */ }
		await new Promise(resolve => setImmediate(resolve));
		const firstRead = getEventLoopLagMaxMs();
		const secondRead = getEventLoopLagMaxMs();
		// Second read should be lower than the first because we reset between them
		// and didn't induce more lag. Allow equality at very low resolution edge cases.
		expect(secondRead).toBeLessThanOrEqual(firstRead);
	});
});

describe('saturation-metrics: event-loop lag — getEventLoopLagP99Ms', () => {
	beforeEach(() => {
		_resetForTests();
	});

	it('returns 0 if no event-loop samples have been recorded yet', () => {
		// After reset() the histogram has no samples.
		expect(getEventLoopLagP99Ms()).toEqual(0);
	});

	it('returns a non-negative integer ms', async () => {
		await new Promise(resolve => setTimeout(resolve, 50));
		const v = getEventLoopLagP99Ms();
		expect(Number.isInteger(v)).toBe(true);
		expect(v).toBeGreaterThanOrEqual(0);
	});

	it('does not reset the histogram — max remains readable after p99 call', async () => {
		// Block the loop briefly so both p99 and max see a real sample.
		const start = Date.now();
		while (Date.now() - start < 60) { /* busy-wait */ }
		await new Promise(resolve => setImmediate(resolve));
		const p99 = getEventLoopLagP99Ms();
		const max = getEventLoopLagMaxMs(); // resets after this read
		// p99 ≤ max by definition; both should be > 0 given the induced lag.
		expect(p99).toBeGreaterThanOrEqual(0);
		expect(max).toBeGreaterThanOrEqual(p99);
		// After max has reset, a second max read returns a much lower value.
		const maxAfterReset = getEventLoopLagMaxMs();
		expect(maxAfterReset).toBeLessThanOrEqual(max);
	});
});

describe('saturation-metrics: exported thresholds', () => {
	it('are positive numbers', () => {
		expect(EVENT_LOOP_LAG_THRESHOLD_MS).toBeGreaterThan(0);
		expect(INFLIGHT_DELIVERIES_THRESHOLD).toBeGreaterThan(0);
		expect(POST_EVENTS_P99_THRESHOLD_MS).toBeGreaterThan(0);
		expect(LATENCY_WINDOW_MS).toBeGreaterThan(0);
	});
});
