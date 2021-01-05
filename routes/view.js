const express = require('express');
const router = express.Router();
const {getEvents} = require('./events');

function relativeDate(date) {
	const diffmillisec = new Date() - date;
	const diffsec = Math.round(diffmillisec / 1000);
	if (diffsec < 3) return "Just now";
	if (diffsec < 60) return diffsec + " seconds ago";
	const diffmins = Math.round(diffsec / 60);
	if (diffmins < 60) return diffmins + " minutes ago";
	const diffhours = Math.round(diffmins / 60);
	if (diffhours < 24) return diffhours + " hours ago";
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
	}
}

function getFormatedEvents() {
	return getEvents().map(formatEvent);
}

router.get('/', (req, res) => {
	res.render("events", {
		events: getFormatedEvents(),
	});
});


router.get('/icon', (req, res) => {
	res.sendFile("icon.png", {root:`${__dirname}/..`});
});

router.get('/style.css', (req, res) => {
	res.sendFile("style.css", {root:`${__dirname}/..`});
});

module.exports = {
	router,
	relativeDate
};