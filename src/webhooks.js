const fetch = require('node-fetch');

class Webhooks {
	constructor(config) {
		this.eventConfig = config;
	}
	trigger(event) {
		const hooks = this.eventConfig[event.type] || [];
		hooks.forEach(async hook => {
			try {
				const res = await fetch(hook, {
					method: 'POST',
					body: JSON.stringify(event),
					headers: { 'Content-Type': 'application/json' },
				});
				if (!res.ok) throw new Error(`Server returned ${res.statusText}`);
			} catch (error) {
				console.error("Webhook failure", hook, error.message);
			}
		});
	}
}

module.exports = {Webhooks}