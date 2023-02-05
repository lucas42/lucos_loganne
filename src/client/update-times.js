import { relativeDate } from 'lucos_time_component';

document.addEventListener('tick', event => {
	document.querySelectorAll("#events .date").forEach(dateNode => {
		const absoluteDate = new Date(dateNode.dataset.date);

		// Get `now` from the event for consistency across the page and 
		// to avoid the extra computation of using `getDatetime` across all nodes
		const now = event.details; 
		dateNode.textContent = relativeDate(absoluteDate, now);
	});
})