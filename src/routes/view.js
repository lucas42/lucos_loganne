import express from 'express';
import { getEvents } from './events.js';
import { formatEvent, resolveLevel, LEVEL_VOCABULARY } from '../handleEvents.js';
export const router = express.Router();

router.use((req, res, next) => req.app.auth(req, res, next));

router.get('/', (req, res) => {
	const currentLevel = resolveLevel(req.query.level);
	const events = getEvents(null, currentLevel).map(formatEvent);
	const levels = LEVEL_VOCABULARY.map(name => ({ name, active: name === currentLevel }));
	res.render("events", { events, levels });
});
