import express from 'express';
import mustacheExpress from 'mustache-express';
import { router as infoRouter } from './info.js';
import { router as eventsRouter } from './events.js';
import { router as producerRouter } from './producers.js';
import { router as viewRouter } from './view.js';
import { csrfMiddleware, AITHNE_ORIGIN } from '../auth.js';

/**
 * Setups up a new express app with all the relevant routes
 * @param {string} [cwd] - The current working directory (used for loading templates and static resources)
 * @returns Express Application
 */
export default function getApp(cwd = '.') {
	const app = express();

	// Trust one reverse proxy hop (nginx) so express-rate-limit reads the real
	// client IP from X-Forwarded-For rather than keying on the proxy IP.
	app.set('trust proxy', 1);

	// Engine config needs set up at the app level, rather than just on router
	app.engine('mustache', mustacheExpress());
	app.set('view engine', 'mustache');
	app.set('views', `${cwd}/templates`);

	// Inject aithne_origin into every render context so templates (including the
	// auth middleware's own 403 error page) can pass it to <lucos-navbar>.
	app.use((req, res, next) => {
		res.locals.aithne_origin = AITHNE_ORIGIN;
		next();
	});

	// CSRF protection for state-mutating requests.
	// Bearer-authenticated and no-Origin/Referer requests pass through safely.
	app.use(csrfMiddleware);
	app.use('/_info', infoRouter);
	app.use('/events', eventsRouter);
	app.use('/producers', producerRouter);
	app.use('/view', viewRouter);

	app.use(express.static(`${cwd}/resources`, {extensions: ['png']}));
	app.use('/templates', express.static(`${cwd}/templates`, {extensions: ['mustache']}));
	app.get('/', (req, res) => res.redirect("/view"));
	return app;
}