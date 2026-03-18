import express from 'express';
import { getEvents } from './events.js';
import { formatEvent } from '../handleEvents.js';
export const router = express.Router();

const DEFAULT_VIEW_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

function getFilteredEvents(since) {
	return getEvents()
		.filter(event => new Date(event.date) > since)
		.map(formatEvent);
}

router.use((req, res, next) => req.app.auth(req, res, next));

router.get('/', (req, res) => {
	const since = new Date(Date.now() - DEFAULT_VIEW_WINDOW_MS);
	res.render("events", {
		events: getFilteredEvents(since),
		sinceIso: since.toISOString(),
	});
});
