import express from 'express';
import mustacheExpress from 'mustache-express';
import { router as infoRouter } from './info.js';
import { router as eventsRouter } from './events.js';
import { router as viewRouter } from './view.js';

export default function getApp() {
	const app = express();

	// Engine config needs set up at the app level, rather than just on router
	app.engine('mustache', mustacheExpress());
	app.set('view engine', 'mustache');
	app.set('views', `./templates`);
	app.use('/_info', infoRouter);
	app.use('/events', eventsRouter);
	app.use('/view', viewRouter);

	app.use(express.static('./resources', {extensions: ['png']}));
	app.get('/', (req, res) => res.redirect("/view"));
	return app;
}