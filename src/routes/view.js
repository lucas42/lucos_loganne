import express from 'express';
import { getEvents } from './events.js';
import { formatEvent, resolveLevel, LEVEL_VOCABULARY, rank } from '../handleEvents.js';
export const router = express.Router();

router.use((req, res, next) => req.app.auth(req, res, next));

router.get('/', (req, res) => {
	const currentLevel = resolveLevel(req.query.level);
	const events = getEvents(null, currentLevel).map(formatEvent);
	const threshold = rank(currentLevel);
	const levels = LEVEL_VOCABULARY.map(name => ({
		name,
		active: name === currentLevel,
		included: rank(name) >= threshold,
	}));
	res.render("events", { events, levels });
});
