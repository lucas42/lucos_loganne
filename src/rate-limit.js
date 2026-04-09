/**
 * Creates Express middleware that enforces a per-key cooldown.
 * If the same key is seen again within cooldownMs, responds with 429
 * Too Many Requests and a Retry-After header.
 *
 * @param {number} cooldownMs - Minimum milliseconds between allowed calls per key
 * @param {function} [getKey] - Function(req) -> string key; defaults to a single global key
 * @returns {{ middleware: function, reset: function }}
 *   middleware: Express middleware function
 *   reset: Clears all tracked keys (useful in tests)
 */
export function createCooldownMiddleware(cooldownMs, getKey = () => 'global') {
	const lastCallAt = new Map();

	function middleware(req, res, next) {
		const key = getKey(req);
		const now = Date.now();
		const last = lastCallAt.get(key);
		if (last !== undefined && now - last < cooldownMs) {
			const retryAfterSecs = Math.ceil((cooldownMs - (now - last)) / 1000);
			return res
				.status(429)
				.setHeader('Retry-After', String(retryAfterSecs))
				.setHeader('Content-Type', 'text/plain')
				.send(`Too many requests — try again in ${retryAfterSecs}s\n`);
		}
		lastCallAt.set(key, now);
		next();
	}

	function reset() {
		lastCallAt.clear();
	}

	return { middleware, reset };
}
