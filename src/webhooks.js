/* Delay before a single automatic retry on transient webhook failure (ms) */
export const RETRY_DELAY_MS = 30 * 1000;

/* Delay before a second automatic retry, if the first retry also fails (ms) */
export const SECOND_RETRY_DELAY_MS = 5 * 60 * 1000;

/**
 * Validates that every subscriber URL in the config has a corresponding entry
 * in consumerTokens for its hostname. Throws if any hostname is unmapped — an
 * unmapped hostname causes getAuthHeader() to return null, which results in
 * every delivery to that subscriber failing with HTTP 401.
 *
 * Call this at startup (before creating a Webhooks instance) so misconfiguration
 * is caught immediately rather than silently producing permanent 401s.
 */
export function validateWebhooksConfig(config) {
	const { consumerTokens = {}, ...eventConfigs } = config;
	const missingHostnames = new Set();
	for (const urls of Object.values(eventConfigs)) {
		if (!Array.isArray(urls)) continue;
		for (const url of urls) {
			try {
				const { hostname } = new URL(url);
				if (!consumerTokens[hostname]) {
					missingHostnames.add(hostname);
				}
			} catch { /* skip invalid URLs */ }
		}
	}
	if (missingHostnames.size > 0) {
		throw new Error(
			`Webhook config validation failed: the following subscriber hostnames have no consumerTokens entry ` +
			`(deliveries will 401 without an auth header): ${[...missingHostnames].sort().join(', ')}`
		);
	}
}

export class Webhooks {
	constructor(config) {
		this.eventConfig = config;
		this.consumerTokens = config.consumerTokens || {};
	}

	/**
	 * Returns a sorted, deduplicated list of lucos system names that this
	 * Webhooks instance delivers events to. Used by /_info to populate the
	 * dependsOn list on the webhook-error-rate check.
	 *
	 * Hostname → system name mapping is via the consumerTokens env var keys:
	 *   KEY_LUCOS_ARACHNE → lucos_arachne
	 */
	listAllSystems() {
		const { consumerTokens = {}, ...eventConfigs } = this.eventConfig;

		const hostnames = new Set();
		for (const urls of Object.values(eventConfigs)) {
			if (Array.isArray(urls)) {
				for (const url of urls) {
					try { hostnames.add(new URL(url).hostname); } catch { /* skip invalid URLs */ }
				}
			}
		}

		const systems = new Set();
		for (const hostname of hostnames) {
			const envVar = consumerTokens[hostname];
			if (envVar?.startsWith('KEY_')) {
				systems.add(envVar.slice(4).toLowerCase()); // KEY_LUCOS_X → lucos_x
			}
		}

		return [...systems].sort();
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

	/**
	 * Builds the headers object for a webhook delivery to the given URL.
	 * Includes Authorization if a token is configured for that consumer.
	 */
	buildHeaders(url) {
		const headers = {
			'Content-Type': 'application/json',
			'User-Agent': process.env.SYSTEM,
		};
		const authHeader = this.getAuthHeader(url);
		if (authHeader) headers['Authorization'] = authHeader;
		return headers;
	}

	trigger(event, stateChange) {
		const hooks = this.eventConfig[event.type] || [];
		event.webhooks = { all: {} };
		summariseStatus();

		// Retry schedule: delays (ms) between consecutive delivery attempts.
		// On the Nth failure, retryDelays[N] gives the wait before attempt N+1.
		// If retryDelays[N] is undefined, the Nth failure is permanent.
		const retryDelays = [RETRY_DELAY_MS, SECOND_RETRY_DELAY_MS];

		// attemptDelivery makes one HTTP POST for a single hook URL.
		// On failure, if retryDelays[attemptIndex] exists it schedules the next
		// attempt via setTimeout (returning immediately with the hook in 'pending'
		// state so the caller can call summariseStatus()); otherwise the failure
		// is permanent and the caller's summariseStatus() will see 'failure'.
		const attemptDelivery = async (hook, attemptIndex) => {
			const at = new Date().toISOString();
			const startTime = performance.now();
			try {
				const res = await fetch(hook, {
					method: 'POST',
					body: JSON.stringify(event),
					headers: this.buildHeaders(hook),
				});
				if (!res.ok) throw new Error(`Server returned ${res.statusText}`);
				const durationMs = Math.round(performance.now() - startTime);
				appendAttempt(event.webhooks.all[hook], {at, status: 'success', durationMs});
			} catch (error) {
				const durationMs = Math.round(performance.now() - startTime);
				const causeCode = error.cause?.code;
				const detail = causeCode ? `${error.message} (${causeCode})` : error.message;
				const errorPhase = getErrorPhase(causeCode);
				const failureLabel = attemptIndex === 0 ? "Webhook failure" : "Webhook auto-retry failure";
				console.error((new Date()).toISOString(), failureLabel, hook, detail, ...(errorPhase ? [`phase: ${errorPhase}`] : []));
				appendAttempt(event.webhooks.all[hook], {at, status: 'failure', durationMs, errorMessage: detail, ...(errorPhase ? {errorPhase} : {})});
				const delay = retryDelays[attemptIndex];
				if (delay !== undefined) {
					// Schedule next attempt. Status stays 'failure' until the retry fires.
					// .unref() prevents the timer from keeping the process alive unnecessarily.
					setTimeout(async () => {
						console.log((new Date()).toISOString(), "Webhook auto-retry", hook);
						event.webhooks.all[hook].status = 'pending';
						summariseStatus();
						await attemptDelivery(hook, attemptIndex + 1);
						summariseStatus();
					}, delay).unref();
					return; // retry is scheduled; caller's summariseStatus() will see 'failure'
				}
			}
		};

		hooks.forEach(async hook => {
			event.webhooks.all[hook] = {status: 'pending', attempts: []};
			summariseStatus();
			await attemptDelivery(hook, 0);
			summariseStatus();
		});
		function summariseStatus() {
			const hooklist = Object.values(event.webhooks.all);
			event.webhooks.status = getSummaryStatus(hooklist);
			if (event.webhooks.status === 'failure') {
				event.webhooks.errorMessage = hooklist
					.filter(hook => hook.status === 'failure')
					.map(hook => hook.attempts?.at(-1)?.errorMessage)
					.filter(Boolean)
					.join("; ");
			}
			stateChange(event);
		}
	}
}


/**
 * Appends a completed delivery attempt to the hook record's attempts[] and updates
 * the top-level mirror fields (status, durationMs) to reflect the latest attempt.
 * Removes any transient 'pending' state fields before committing.
 */
export function appendAttempt(hookRecord, attempt) {
	hookRecord.attempts.push(attempt);
	hookRecord.status = attempt.status;
	hookRecord.durationMs = attempt.durationMs;
}

/**
 * Returns the delivery phase associated with a given error cause code, or null
 * if the code is not a timeout variant. Used to populate errorPhase on failures.
 *   'connect'  — TCP/TLS connection could not be established (UND_ERR_CONNECT_TIMEOUT)
 *   'response' — connection was open but the response didn't complete in time (ETIMEDOUT)
 */
export function getErrorPhase(causeCode) {
	if (causeCode === 'UND_ERR_CONNECT_TIMEOUT') return 'connect';
	if (causeCode === 'ETIMEDOUT') return 'response';
	return null;
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
