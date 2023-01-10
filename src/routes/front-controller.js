import express from 'express';
import mustacheExpress from 'mustache-express';
import { router as infoRouter } from './info.js';
import { router as eventsRouter } from './events.js';
import { router as viewRouter } from './view.js';

/**
 * Setups up a new express app with all the relevant routes
 * @param {string} [cwd] - The current working directory (used for loading templates and static resources)
 * @returns Express Application
 */
export default function getApp(cwd = '.') {
	const app = express();

	// Engine config needs set up at the app level, rather than just on router
	app.engine('mustache', mustacheExpress());
	app.set('view engine', 'mustache');
	app.set('views', `${cwd}/templates`);
	app.use('/_info', infoRouter);
	app.use('/events', eventsRouter);
	app.use('/view', viewRouter);

	app.use(express.static(`${cwd}/resources`, {extensions: ['png']}));
	app.use('/templates', express.static(`${cwd}/templates`, {extensions: ['mustache']}));
	app.get('/', (req, res) => res.redirect("/view"));
	return app;
}