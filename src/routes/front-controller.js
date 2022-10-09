const express = require('express');
const app = express();

// Engine config needs set up at the app level, rather than just on router
app.engine('mustache', require('mustache-express')());
app.set('view engine', 'mustache');
app.set('views', `${__dirname}/../templates`);
app.use('/_info', require('./info').router);
app.use('/events', require('./events').router);
app.use('/view', require('./view').router);
app.get('/', (req, res) => res.redirect("/view"));
module.exports = app;