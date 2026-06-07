/** Shared logic between server and client **/
import { v4 as uuidv4, validate as validateUuid } from 'uuid';
import { relativeDate } from 'lucos_time_component';

/** Ordered vocabulary of event prominence levels, from lowest to highest */
export const LEVEL_VOCABULARY = ['detail', 'routine', 'notable', 'headline'];

/** Default level applied to events that don't specify one */
export const DEFAULT_LEVEL = 'routine';

/**
 * Returns the ordinal rank of a level string within LEVEL_VOCABULARY.
 * Returns -1 if the level is not in the vocabulary.
 */
export function rank(level) {
	return LEVEL_VOCABULARY.indexOf(level);
}

/**
 * Returns true if eventLevel is at or above the given threshold.
 * Both arguments must be valid vocabulary entries.
 */
export function meetsThreshold(eventLevel, threshold) {
	return rank(eventLevel) >= rank(threshold);
}

/**
 * Resolves a ?level= query-parameter value to a valid vocabulary entry.
 * Unknown or absent values degrade gracefully to DEFAULT_LEVEL (for viewing,
 * where a malformed bookmark should not 400).
 */
export function resolveLevel(levelParam) {
	if (levelParam && LEVEL_VOCABULARY.includes(levelParam)) return levelParam;
	return DEFAULT_LEVEL;
}

export function formatEvent(event) {
	return {
		source: event.source,
		prettySource: event.source.replace('lucos_','').replaceAll('_', ' '),
		humanReadable: event.humanReadable,
		relDate: relativeDate(event.date),
		absDate: event.date.toString(),
		webhookStatus: event.webhooks?.status,
		webhookFailed: event.webhooks?.status === 'failure',
		webhookErrorMessage: event.webhooks?.errorMessage,
		uuid: event.uuid,
		url: event.url,
		showUrl: (!!event.url && !event.type.endsWith("Deleted")),
	}
}

/**
 * Checks whether an event object is valid
 * Throws a string if it is invalid
 * Returns a normalised event object if it is valid
 **/
export function validateEvent(event) {
	let eventDate;

	if (!event || Object.keys(event).length === 0) throw "No JSON found in POST body";
	for (const key of ["source", "type", "humanReadable"]) {
		if (!event[key]) throw `Field \`${key}\` not found in event data`;
	}
	if ('date' in event) {
		eventDate = new Date(event.date);
		if (isNaN(eventDate)) throw `Date value ("${event.date}") isn't a recognised date.  Leave out to default to now.`;
	}
	event.date = eventDate || new Date();
	if ('uuid' in event) {
		if (!validateUuid(event.uuid)) throw `Uuid value ("${event.uuid}") isn't a valid uuid.  Leave out to automatically assign a v4 uuid.`;
	} else {
		event.uuid = uuidv4();
	}
	if ('url' in event) {
		try {
			new URL(event.url);
		} catch (TypeError) {
			throw `Url value ("${event.url}") isn't a valid url.  If this event doesn't have an associated URL, you can leave out the url parameter`;
		}
	}
	if ('level' in event) {
		if (!LEVEL_VOCABULARY.includes(event.level)) throw `Level value ("${event.level}") isn't a recognised level.  Valid levels are: ${LEVEL_VOCABULARY.join(', ')}.`;
	} else {
		console.warn(`Event missing level, defaulting to ${DEFAULT_LEVEL}: type=${event.type}, source=${event.source}`);
		event.level = DEFAULT_LEVEL;
	}
	return event;
}