import fs from 'fs';
import { initEvents } from './routes/events.js';

// STATE_DIR should be the path of a directory which persists between restarts
const STATE_DIR = process.env.STATE_DIR;
if (!STATE_DIR) throw "no STATE_DIR environment variable set";
const STATE_FILE = `${STATE_DIR}/events.json`;
try {
	const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
	initEvents(data);
} catch (error) {
	console.log("Can't find or parse events.json; using empty events array.", error);
}

export function save(events) {
	fs.writeFile(STATE_FILE, JSON.stringify(events), error => {
		if (error) console.error("Failed to save to filesystem", error);
	});
}
