import { jest } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Set STATE_DIR before importing filesystem-state.js, which reads it at
// module-evaluation time and throws if absent.
const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'loganne-fs-test-'));
process.env.STATE_DIR = TEST_STATE_DIR;
// Seed a parseable (empty) events.json so the initial readFileSync succeeds.
fs.writeFileSync(path.join(TEST_STATE_DIR, 'events.json'), '[]');

const { save, SAVE_THROTTLE_MS, _resetThrottleForTests } = await import('../src/filesystem-state.js');

describe('filesystem-state save() throttle', () => {
	let writeFileSpy;

	beforeEach(() => {
		jest.useFakeTimers();
		_resetThrottleForTests();
		writeFileSpy = jest.spyOn(fs, 'writeFile').mockImplementation((p, c, cb) => cb && cb());
	});

	afterEach(() => {
		writeFileSpy.mockRestore();
		jest.useRealTimers();
	});

	it('writes immediately on the first call (leading edge)', () => {
		save(['event1']);
		expect(writeFileSpy).toHaveBeenCalledTimes(1);
		expect(JSON.parse(writeFileSpy.mock.calls[0][1])).toEqual(['event1']);
	});

	it('coalesces a burst of rapid calls into one trailing write', () => {
		save(['a']);
		save(['a', 'b']);
		save(['a', 'b', 'c']);
		// Only the leading-edge write so far
		expect(writeFileSpy).toHaveBeenCalledTimes(1);
		// Advance to end of throttle window; trailing write should fire
		jest.advanceTimersByTime(SAVE_THROTTLE_MS);
		expect(writeFileSpy).toHaveBeenCalledTimes(2);
		// Trailing write captures the latest events array, not earlier intermediates
		expect(JSON.parse(writeFileSpy.mock.calls[1][1])).toEqual(['a', 'b', 'c']);
	});

	it('a single save() within the window schedules exactly one trailing write', () => {
		save(['initial']);             // leading edge
		jest.advanceTimersByTime(100); // still within window
		save(['initial', 'next']);     // schedules trailing
		expect(writeFileSpy).toHaveBeenCalledTimes(1);
		jest.advanceTimersByTime(SAVE_THROTTLE_MS); // window elapses
		expect(writeFileSpy).toHaveBeenCalledTimes(2);
	});

	it('writes immediately if no save() has been called within the throttle window', () => {
		save(['first']);
		expect(writeFileSpy).toHaveBeenCalledTimes(1);
		// Advance past the throttle window with no further calls
		jest.advanceTimersByTime(SAVE_THROTTLE_MS + 100);
		save(['second']);
		expect(writeFileSpy).toHaveBeenCalledTimes(2);
		expect(JSON.parse(writeFileSpy.mock.calls[1][1])).toEqual(['second']);
	});

	it('handles back-to-back bursts correctly', () => {
		// Burst 1
		save(['a']);                                 // leading edge → write 1
		save(['a', 'b']);                            // coalesced into trailing
		jest.advanceTimersByTime(SAVE_THROTTLE_MS);  // trailing fires → write 2
		expect(writeFileSpy).toHaveBeenCalledTimes(2);

		// Burst 2 starting just after trailing fired (still within next window)
		save(['a', 'b', 'c']);                       // schedules trailing (no immediate)
		save(['a', 'b', 'c', 'd']);                  // coalesced
		expect(writeFileSpy).toHaveBeenCalledTimes(2);
		jest.advanceTimersByTime(SAVE_THROTTLE_MS);  // trailing fires → write 3
		expect(writeFileSpy).toHaveBeenCalledTimes(3);
		expect(JSON.parse(writeFileSpy.mock.calls[2][1])).toEqual(['a', 'b', 'c', 'd']);
	});

	it('many rapid calls within a window produce at most two writes', () => {
		save(['e0']); // leading edge → 1 write
		for (let i = 1; i < 100; i++) {
			save([`e${i}`]);
		}
		expect(writeFileSpy).toHaveBeenCalledTimes(1);
		jest.advanceTimersByTime(SAVE_THROTTLE_MS);
		// 1 leading + 1 trailing = 2 writes total for a 100-call burst
		expect(writeFileSpy).toHaveBeenCalledTimes(2);
		// Trailing write captured the most recent events ref
		expect(JSON.parse(writeFileSpy.mock.calls[1][1])).toEqual(['e99']);
	});

	it('logs an error if fs.writeFile reports failure', () => {
		const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
		writeFileSpy.mockImplementationOnce((p, c, cb) => cb(new Error('disk full')));
		save(['x']);
		expect(consoleErrorSpy).toHaveBeenCalledWith(
			'Failed to save to filesystem',
			expect.objectContaining({ message: 'disk full' })
		);
		consoleErrorSpy.mockRestore();
	});
});
