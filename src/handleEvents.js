/** Shared logic between server and client **/
import { v4 as uuidv4, validate as validateUuid } from 'uuid';
import { relativeDate } from 'lucos_time_component';

export function formatEvent(event) {
	return {
		source: event.source,
		prettySource: event.source.replace('lucos_','').replaceAll('_', ' '),
		humanReadable: event.humanReadable,
		relDate: relativeDate(event.date),
		absDate: event.date.toString(),
		webhookStatus: event.webhooks?.status,
		webhookErrorMessage: event.webhooks?.errorMessage,
		uuid: event.uuid,
	}
}

/**
 * Checks whether an event object is valid
 * Throws a string if it is invalid
 * Returns a normalised event object if it is valid
 **/
export function validateEvent(event) {
	let eventDate;

	if (Object.keys(event).length === 0) throw "No JSON found in POST body";
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
	return event;
}