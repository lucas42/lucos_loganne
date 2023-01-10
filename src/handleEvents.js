/** Shared logic between server and client **/
import { v4 as uuidv4, validate as validateUuid } from 'uuid';

export function relativeDate(date) {
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