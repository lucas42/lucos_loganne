import express from 'express';
export const router = express.Router();
import { getEventsCount, getEventsLimit } from './events.js';

router.get('/', (req, res) => {
	const output = {
		system: 'lucos_loganne',
		checks: {
			'events-in-limit': {
				ok: (getEventsCount() <= getEventsLimit()),
				techDetail: `Checks whether the number of events in memory is equal to or below the configured maximum (${getEventsLimit()})`,
			}
		},
		metrics: {
			'event-count': {
				value: getEventsCount(),
				techDetail: "The number of events currently stored in memory"
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