const fs = require('fs');
const { initEvents } = require('./routes/events');

// STATE_DIR should be the path of a directory which persists between restarts
const STATE_DIR = process.env.STATE_DIR;
if (!STATE_DIR) throw "no STATE_DIR environment variable set";
const STATE_FILE = `${STATE_DIR}/events.json`;
try {
	initEvents(require(STATE_FILE));
} catch (error) {
	console.log("Can't find or parse events.json; using empty events array.", error);
}

function save(events) {
	fs.writeFile(STATE_FILE, JSON.stringify(events), error => {
		if (error) console.error("Failed to save to filesystem", error);
	});
}


module.exports = { save }