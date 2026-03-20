import express from 'express';
import { getEvents } from './events.js';
import { formatEvent } from '../handleEvents.js';
export const router = express.Router();

function getFormattedEvents() {
	return getEvents().map(formatEvent);
}

router.use((req, res, next) => req.app.auth(req, res, next));

router.get('/', (req, res) => {
	res.render("events", {
		events: getFormattedEvents(),
	});
});
