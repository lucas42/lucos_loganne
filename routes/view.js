const express = require('express');
const router = express.Router();
const {getEvents} = require('./events');


router.get('/', (req, res) => {
	res.render("events", {
		events: getEvents().map(event => {
			return {
				source: event.source,
				humanReadable: event.humanReadable,
				date: Math.round((new Date() - event.date)/1000) + " seconds ago",
			}
		})
	});
});


router.get('/icon', (req, res) => {
	res.sendFile("icon.png", {root:`${__dirname}/..`});
});

module.exports = router;