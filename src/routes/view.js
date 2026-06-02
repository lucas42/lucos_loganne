import express from 'express';
import { rateLimit, MemoryStore } from 'express-rate-limit';
import { getEvents } from './events.js';
import { formatEvent, resolveLevel, LEVEL_VOCABULARY, rank } from '../handleEvents.js';
export const router = express.Router();

/* Rate limit for GET /view (60 requests per minute per IP) */
export const VIEW_GET_RATE_LIMIT_MAX = 60;
export const VIEW_GET_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const viewGetStore = new MemoryStore();
const viewGetLimiter = rateLimit({
	windowMs: VIEW_GET_RATE_LIMIT_WINDOW_MS,
	max: VIEW_GET_RATE_LIMIT_MAX,
	store: viewGetStore,
	standardHeaders: true,
	legacyHeaders: false,
});
export function resetViewGetRateLimit() {
	viewGetStore.resetAll();
}

router.use(viewGetLimiter);
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
