const express = require('express');
const app = express();

// Engine config needs set up at the app level, rather than just on router
app.engine('mustache', require('mustache-express')());
app.set('view engine', 'mustache');
app.set('views', `${__dirname}/../templates`);
app.use('/', require('./view').router);

app.use('/events', require('./events').router);
app.use('/_info', require('./info').router);
module.exports = app;