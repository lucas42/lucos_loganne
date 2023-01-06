const port = process.env.PORT;
if (!port) throw "no PORT environment variable set";
const app = require('./routes/front-controller');
app.filesystemState = require('./filesystem-state.js');
const { Webhooks } = require('./webhooks');
app.webhooks = new Webhooks(require('./webhooks-config'));
app.websocket = require('./websocket');
app.auth = require('./auth');

app.listen(port, function () {
  console.log('App listening on port ' + port);
});
