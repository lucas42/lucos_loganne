import express from 'express';
export const router = express.Router();
import { getEventsCount, getEventsLimit, getEventsRetentionMs, getWebhookErrorCount } from './events.js';

const WEBHOOK_ERROR_THRESHOLD = 10;

router.get('/', (req, res) => {
	const output = {
		system: 'lucos_loganne',
		checks: {
			'events-in-limit': {
				ok: (getEventsCount() <= getEventsLimit()),
				techDetail: `Checks whether the number of events in memory is equal to or below the configured maximum (${getEventsLimit()}). Events older than ${getEventsRetentionMs() / (24 * 60 * 60 * 1000)} days are also trimmed automatically.`,
			},
			'webhook-error-rate': {
				ok: (getWebhookErrorCount() < WEBHOOK_ERROR_THRESHOLD),
				techDetail: `Checks whether the number of events in the last 24 hours with webhook delivery failures is below acceptable threshold (${WEBHOOK_ERROR_THRESHOLD})`,
			},
		},
		metrics: {
			'event-count': {
				value: getEventsCount(),
				techDetail: "The number of events currently stored in memory"
			},
			'webhook-error-count': {
				value: getWebhookErrorCount(),
				techDetail: "The number of events in the last 24 hours where at least one webhook delivery failed",
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