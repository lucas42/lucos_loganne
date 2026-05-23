import express from 'express';
export const router = express.Router();
import { getEventsCount, getEventsLimit, getEventsRetentionMs, getWebhookErrorCount, getInFlightDeliveryCount } from './events.js';
import {
	getEventLoopLagP99Ms,
	getEventLoopLagMaxMs,
	getPostEventsP99Ms,
	EVENT_LOOP_LAG_THRESHOLD_MS,
	INFLIGHT_DELIVERIES_THRESHOLD,
	POST_EVENTS_P99_THRESHOLD_MS,
	LATENCY_WINDOW_MS,
} from '../saturation-metrics.js';

router.get('/', (req, res) => {
	// Snapshot saturation signals once per response so the metrics and the
	// matching checks see the same values (avoids drift across the few μs
	// between sampling for metric and sampling for check).
	// p99 must be read before max — getEventLoopLagMaxMs() resets the histogram,
	// so both need to consume the same window.
	const eventLoopLagP99Ms = getEventLoopLagP99Ms();
	const eventLoopLagMaxMs = getEventLoopLagMaxMs();
	const inFlightCount = getInFlightDeliveryCount();
	const postEventsP99Ms = getPostEventsP99Ms();

	const output = {
		system: 'lucos_loganne',
		checks: {
			'events-in-limit': {
				ok: (getEventsCount() <= getEventsLimit()),
				techDetail: `Checks whether the number of events in memory is equal to or below the configured maximum (${getEventsLimit()}). Events older than ${getEventsRetentionMs() / (24 * 60 * 60 * 1000)} days are also trimmed automatically.`,
			},
			'webhook-error-rate': {
				ok: (getWebhookErrorCount() === 0),
				techDetail: "Checks whether any events in memory have unresolved webhook delivery failures",
				// Failed webhooks are auto-retried once ~30s after the failure (see #370).
				// Without a fail threshold the monitoring poll between failure and
				// auto-retry trips an alert that recovers on the next poll — pure
				// noise. Requiring two consecutive failing polls rides out the
				// retry window while still surfacing genuinely unresolved failures.
				// See #454.
				failThreshold: 2,
				// Suppress this check while any webhook target is in its deploy window —
				// outgoing webhooks to a restarting container are expected to fail.
				// Computed from webhooks-config.json via app.webhooks so the config
				// is only parsed once and future target additions are self-maintaining.
				// See #456.
				dependsOn: req.app.webhooks?.listAllSystems() ?? [],
			},
			'event-loop-lag-low': {
				ok: (eventLoopLagP99Ms < EVENT_LOOP_LAG_THRESHOLD_MS),
				techDetail: `p99 event-loop lag since last /_info poll was ${eventLoopLagP99Ms} ms (threshold ${EVENT_LOOP_LAG_THRESHOLD_MS} ms). Max in window was ${eventLoopLagMaxMs} ms. Sampled at 20 ms resolution via perf_hooks.monitorEventLoopDelay. See #493.`,
				failThreshold: 2,
			},
			'outbound-fan-out-within-capacity': {
				ok: (inFlightCount < INFLIGHT_DELIVERIES_THRESHOLD),
				techDetail: `${inFlightCount} outbound webhook delivery attempts currently in flight (threshold ${INFLIGHT_DELIVERIES_THRESHOLD}). Counts hooks with status === 'pending' across all events in memory. See #484.`,
				failThreshold: 2,
			},
			'events-post-responsive': {
				ok: (postEventsP99Ms < POST_EVENTS_P99_THRESHOLD_MS),
				techDetail: `POST /events p99 latency over the last ${LATENCY_WINDOW_MS / 1000}s: ${postEventsP99Ms} ms (threshold ${POST_EVENTS_P99_THRESHOLD_MS} ms). See #484.`,
				failThreshold: 2,
			},
		},
		metrics: {
			'event-count': {
				value: getEventsCount(),
				techDetail: "The number of events currently stored in memory"
			},
			'webhook-error-count': {
				value: getWebhookErrorCount(),
				techDetail: "The number of events in memory where at least one webhook delivery failed",
			},
			'event-loop-lag-p99-ms': {
				value: eventLoopLagP99Ms,
				techDetail: "99th-percentile event-loop lag (ms) since the last /_info poll, sampled at 20ms resolution via perf_hooks.monitorEventLoopDelay. Gates the event-loop-lag-low check.",
			},
			'event-loop-lag-max-ms': {
				value: eventLoopLagMaxMs,
				techDetail: "Max event-loop lag (ms) observed since the last /_info poll, sampled at 20ms resolution via perf_hooks.monitorEventLoopDelay. Human reference only.",
			},
			'outbound-deliveries-in-flight': {
				value: inFlightCount,
				techDetail: "Outbound webhook deliveries currently in flight (hooks with status === 'pending' across all events in memory)",
			},
			'events-post-p99-ms': {
				value: postEventsP99Ms,
				techDetail: `p99 latency (ms) of POST /events server-side responses over the last ${LATENCY_WINDOW_MS / 1000}s`,
			},
		},
		ci: {
			circle: "gh/lucas42/lucos_loganne",
		},
		icon: "/icon",
		network_only: true,
		title: "Loganne",
		show_on_homepage: true,
		start_url: "/view",
	};
	res
		.setHeader("Content-Type", "application/json")
		.send(output);
});
