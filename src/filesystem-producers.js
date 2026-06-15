import fs from 'fs';
import { initProducers } from './routes/producers.js';

// STATE_DIR should be the path of a directory which persists between restarts.
// This module skips I/O if STATE_DIR is absent (the canonical check is in
// filesystem-events.js, which throws at startup — so absent STATE_DIR is not
// a valid production state).
const STATE_DIR = process.env.STATE_DIR;
const PRODUCERS_FILE = STATE_DIR ? `${STATE_DIR}/producers.json` : null;

if (PRODUCERS_FILE) {
	try {
		const data = JSON.parse(fs.readFileSync(PRODUCERS_FILE, 'utf-8'));
		initProducers(data);
	} catch (error) {
		console.log("Can't find or parse producers.json; starting with empty producers map.", error);
	}
}

/**
 * Persist the producers map to disk immediately (no throttle — the file is
 * tiny and only written when a genuinely new source/type pair is observed,
 * so write frequency is naturally bounded).
 * @param {Object.<string, string[]>} producers
 */
export function saveProducers(producers) {
	if (!PRODUCERS_FILE) return;
	fs.writeFile(PRODUCERS_FILE, JSON.stringify(producers), error => {
		if (error) console.error("Failed to save producers to filesystem", error);
	});
}
