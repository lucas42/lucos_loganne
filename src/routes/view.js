const express = require('express');
const router = express.Router();
const {getEvents} = require('./events');

function relativeDate(date) {
	const diffmillisec = new Date() - date;
	const diffsec = Math.round(diffmillisec / 1000);
	if (diffsec < 3) return "Just now";
	if (diffsec < 60) return diffsec + " seconds ago";
	if (diffsec == 60) return "1 minute ago";
	const diffmins = Math.round(diffsec / 60);
	if (diffmins < 60) return diffmins + " minutes ago";
	if (diffmins == 60) return "1 hour ago";
	const diffhours = Math.round(diffmins / 60);
	if (diffhours < 24) return diffhours + " hours ago";
	if (diffhours == 24) return "1 day ago";
	const diffdays = Math.round(diffhours / 24);
	return diffdays + " days ago";
}

function formatEvent(event) {
	return {
		source: event.source,
		prettySource: event.source.replace('lucos_','').replaceAll('_', ' '),
		humanReadable: event.humanReadable,
		relDate: relativeDate(event.date),
		absDate: event.date.toString(),
		webhookStatus: event.webhooks?.status,
		webhookErrorMessage: event.webhooks?.errorMessage,
	}
}

function getFormatedEvents() {
	return getEvents().map(formatEvent);
}

router.use((req, res, next) => req.app.auth(req, res, next));

router.get('/', (req, res) => {
	res.render("events", {
		events: getFormatedEvents(),
	});
});

module.exports = {
	router,
	relativeDate
};