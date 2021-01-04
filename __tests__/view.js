const {relativeDate} = require('../routes/view');
describe('Dates', () => {
	it('should return just now for 1 or 2 secs ago', () => {
		const onesecago = new Date() - 1000;
		const actual = relativeDate(onesecago);
		expect(actual).toEqual("Just now");
	});
	it('should return seconds for less than a min', () => {
		const fifteensecsago = new Date() - (15 * 1000);
		const actual = relativeDate(fifteensecsago);
		expect(actual).toEqual("15 seconds ago");
	});
	it('should return mins for less than an hour', () => {
		const sixteenminsago = new Date() - (16 * 60 * 1000);
		const actual = relativeDate(sixteenminsago);
		expect(actual).toEqual("16 minutes ago");
	});
	it('should return hours for less than a day', () => {
		const seventeenhoursago = new Date() - (17 * 60 * 60 * 1000);
		const actual = relativeDate(seventeenhoursago);
		expect(actual).toEqual("17 hours ago");
	});
	it('should return days for more than 24 hours', () => {
		const fourtysevenhoursago = new Date() - (47 * 60 * 60 * 1000);
		const actual = relativeDate(fourtysevenhoursago);
		expect(actual).toEqual("2 days ago");
	});
});