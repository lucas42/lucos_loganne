import { rateLimit, MemoryStore } from 'express-rate-limit';

/**
 * Creates an Express middleware that enforces a per-key cooldown using
 * express-rate-limit (max 1 request per cooldownMs window per key).
 *
 * @param {number} cooldownMs - Window length in milliseconds
 * @param {function} [getKey] - Function(req) -> string key; defaults to a single global key
 * @returns {{ middleware: function, reset: function }}
 *   middleware: Express middleware function
 *   reset: Clears all tracked keys (useful in tests)
 */
export function createCooldownMiddleware(cooldownMs, getKey = () => 'global') {
	const store = new MemoryStore();

	const middleware = rateLimit({
		windowMs: cooldownMs,
		max: 1,
		store,
		standardHeaders: true,
		legacyHeaders: false,
		keyGenerator: getKey,
		handler: (req, res) => {
			const retryAfterSecs = Math.ceil(cooldownMs / 1000);
			return res
				.status(429)
				.setHeader('Retry-After', String(retryAfterSecs))
				.setHeader('Content-Type', 'text/plain')
				.send(`Too many requests — try again in ${retryAfterSecs}s\n`);
		},
	});

	function reset() {
		store.resetAll();
	}

	return { middleware, reset };
}
