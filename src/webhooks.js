class Webhooks {
	constructor(config) {
		this.eventConfig = config;
	}
	trigger(event, saveState) {
		const hooks = this.eventConfig[event.type] || [];
		event.webhooks = { all: {} };
		summariseStatus();
		hooks.forEach(async hook => {
			event.webhooks.all[hook] = {status: 'pending'};
			summariseStatus();
			try {
				const res = await fetch(hook, {
					method: 'POST',
					body: JSON.stringify(event),
					headers: { 'Content-Type': 'application/json' },
				});
				if (!res.ok) throw new Error(`Server returned ${res.statusText}`);
				event.webhooks.all[hook].status = 'success';
			} catch (error) {
				console.error((new Date()).toISOString(), "Webhook failure", hook, error.message);
				event.webhooks.all[hook].status = 'failure';
				event.webhooks.all[hook].errorMessage = error.message;
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
			saveState();
		}
	}
}


function getSummaryStatus(hooklist) {
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

module.exports = {Webhooks}