import express from 'express';
export const router = express.Router();
import { getEventsCount, getEventsLimit, getEventsRetentionMs, getWebhookErrorCount } from './events.js';

router.get('/', (req, res) => {
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