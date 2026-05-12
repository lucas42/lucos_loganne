import express from 'express';
export const router = express.Router();
import { getEventsCount, getEventsLimit, getEventsRetentionMs, getWebhookErrorCount } from './events.js';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webhooksConfig = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../webhooks-config.json'), 'utf-8'));

/**
 * Returns a sorted, deduplicated list of lucos system names that loganne
 * delivers webhooks to — derived from webhooks-config.json at startup so
 * that future target additions are self-maintaining.
 *
 * Hostname → system name mapping is via the consumerTokens env var keys:
 *   KEY_LUCOS_ARACHNE  →  lucos_arachne
 */
function getWebhookDependencies(config) {
	const { consumerTokens = {}, ...eventConfigs } = config;

	const hostnames = new Set();
	for (const urls of Object.values(eventConfigs)) {
		if (Array.isArray(urls)) {
			for (const url of urls) {
				try { hostnames.add(new URL(url).hostname); } catch { /* skip invalid URLs */ }
			}
		}
	}

	const systems = new Set();
	for (const hostname of hostnames) {
		const envVar = consumerTokens[hostname];
		if (envVar?.startsWith('KEY_')) {
			systems.add(envVar.slice(4).toLowerCase()); // KEY_LUCOS_X → lucos_x
		}
	}

	return [...systems].sort();
}

const webhookDependencies = getWebhookDependencies(webhooksConfig);

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
				// Suppress this check while any webhook target is in its deploy window —
				// outgoing webhooks to a restarting container are expected to fail.
				// Derived dynamically from webhooks-config.json so future target
				// additions are self-maintaining. See #456.
				dependsOn: webhookDependencies,
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