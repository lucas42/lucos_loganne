document.addEventListener('click', async (e) => {
	const button = e.target.closest('[data-retry-webhooks]');
	if (!button) return;
	button.disabled = true;
	try {
		const res = await fetch(button.dataset.retryWebhooks, { method: 'POST' });
		if (!res.ok) {
			console.error('Retry failed:', await res.text());
			button.disabled = false;
		}
		// On success, the websocket broadcasts the updated event which re-renders the item
	} catch (err) {
		console.error('Retry error:', err);
		button.disabled = false;
	}
});
