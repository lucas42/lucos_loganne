import express from 'express';
import { getEvents } from './events.js';
import { formatEvent, resolveLevel } from '../handleEvents.js';
export const router = express.Router();

router.use((req, res, next) => req.app.auth(req, res, next));

router.get('/', (req, res) => {
	const threshold = resolveLevel(req.query.level);
	const events = getEvents(null, threshold).map(formatEvent);
	res.render("events", { events });
});
