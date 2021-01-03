const express = require('express');
const app = express();
const port = process.env.PORT;
if (!port) throw "no PORT environment variable set";

app.use(express.json());

/* The maximum number of events to hold in memory */
const EVENT_MAX = 2;

const events = [];

app.get('/', (req, res) => {
	res.send("Hello World");
});

app.get('/events', (req, res) => {
	res.send(events);
});

app.post('/events', (req, res) => {
	let eventDate;

	// Check that the event data is valid
	try {
		if (!req.body) throw "No JSON found in POST body";
		for (const key of ["source", "type", "humanReadable"]) {
			if (!req.body[key]) throw `Field \`${key}\` not found in event data`;
		}
		if ('date' in req.body) {
			eventDate = new Date(req.body.date);
			if (isNaN(eventDate)) throw `Date value ("${req.body.date}") isn't a recognised date.  Leave out to default to now.`;
		}
	} catch (validationError) {
		return res.status(400).send(`Invalid event data: ${validationError}\n`);
	}

	// Return a 202 response as early as possible to prevent blocking client unnecessarily
	res.status(202).send("Event being processed\n");


	req.body.date = eventDate || new Date();
	events.unshift(req.body);
	while (events.length > EVENT_MAX) {
		events.pop();
	}
});

app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).send(`Invalid JSON: ${err.message}\n`);
    }
    next();
});

app.get('/_info', (req, res) => {
	const output = {
		system: 'lucos_loganne',
		checks: {
			'events-in-limit': {
				ok: (events.length <= EVENT_MAX),
				techDetail: `Checks whether the number of events in memory is equal to or below the configured maximum (${EVENT_MAX})`,
			}
		},
		metrics: {
			'event-count': {
				value: events.length,
				techDetail: "The number of events currently stored in memory"
			},
		},
		ci: {
			circle: "gh/lucas42/lucos_loganne",
		}
	};
	res.send(output);
});
app.listen(port, function () {
  console.log('App listening on port ' + port);
});