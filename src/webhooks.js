/* Delay before a single automatic retry on transient webhook failure (ms) */
export const RETRY_DELAY_MS = 30 * 1000;

export class Webhooks {
	constructor(config) {
		this.eventConfig = config;
		this.consumerTokens = config.consumerTokens || {};
	}

	/**
	 * Returns an Authorization: Bearer header value for the given URL, or null
	 * if no token is configured for that hostname.
	 */
	getAuthHeader(url) {
		try {
			const { hostname } = new URL(url);
			const envVar = this.consumerTokens[hostname];
			if (!envVar) return null;
			const token = process.env[envVar];
			if (!token) {
				console.warn((new Date()).toISOString(), "No token configured for webhook consumer", hostname, `(env var: ${envVar})`);
				return null;
			}
			return `Bearer ${token}`;
		} catch {
			return null;
		}
	}

	trigger(event, stateChange) {
		const hooks = this.eventConfig[event.type] || [];
		event.webhooks = { all: {} };
		summariseStatus();
		hooks.forEach(async hook => {
			event.webhooks.all[hook] = {status: 'pending'};
			summariseStatus();
			try {
				const authHeader = this.getAuthHeader(hook);
				const headers = {
					'Content-Type': 'application/json',
					'User-Agent': process.env.SYSTEM,
				};
				if (authHeader) headers['Authorization'] = authHeader;
				const res = await fetch(hook, {
					method: 'POST',
					body: JSON.stringify(event),
					headers,
				});
				if (!res.ok) throw new Error(`Server returned ${res.statusText}`);
				event.webhooks.all[hook].status = 'success';
			} catch (error) {
				console.error((new Date()).toISOString(), "Webhook failure", hook, error.message);
				event.webhooks.all[hook].status = 'failure';
				event.webhooks.all[hook].errorMessage = error.message;
				// Schedule one automatic retry to recover from transient failures (e.g. deploy windows).
				// If the retry also fails, the failure is permanent.
				// .unref() prevents the timer from keeping the process alive unnecessarily.
				setTimeout(async () => {
					console.log((new Date()).toISOString(), "Webhook auto-retry", hook);
					event.webhooks.all[hook].status = 'pending';
					delete event.webhooks.all[hook].errorMessage;
					summariseStatus();
					try {
						const retryAuthHeader = this.getAuthHeader(hook);
						const retryHeaders = {
							'Content-Type': 'application/json',
							'User-Agent': process.env.SYSTEM,
						};
						if (retryAuthHeader) retryHeaders['Authorization'] = retryAuthHeader;
						const retryRes = await fetch(hook, {
							method: 'POST',
							body: JSON.stringify(event),
							headers: retryHeaders,
						});
						if (!retryRes.ok) throw new Error(`Server returned ${retryRes.statusText}`);
						event.webhooks.all[hook].status = 'success';
						delete event.webhooks.all[hook].errorMessage;
					} catch (retryError) {
						console.error((new Date()).toISOString(), "Webhook auto-retry failure", hook, retryError.message);
						event.webhooks.all[hook].status = 'failure';
						event.webhooks.all[hook].errorMessage = retryError.message;
					}
					summariseStatus();
				}, RETRY_DELAY_MS).unref();
			}
			summariseStatus();
		});
		function summariseStatus() {
			const hooklist = Object.values(event.webhooks.all);
			event.webhooks.status = getSummaryStatus(hooklist);
			if (event.webhooks.status === 'failure') {
				event.webhooks.errorMessage = hooklist
					.filter(hook => hook.status === 'failure')
					.map(hook => hook.errorMessage)
					.join("; ");
			}
			stateChange(event);
		}
	}
}


export function getSummaryStatus(hooklist) {
	if (hooklist.length < 1) {
		return 'no-hooks';
	}
	if (hooklist.some(hook => hook.status === 'failure')) {
		return 'failure';
	}
	if (hooklist.some(hook => hook.status === 'pending')) {
		return 'pending';
	}
	if (hooklist.every(hook => hook.status === 'success')) {
		return 'success';
	}

	// Shouldn't get to this point
	console.error("Unknown webhook status", hooklist);
	return 'unknown'
}
