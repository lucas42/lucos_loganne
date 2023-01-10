import fs from 'fs';
import getApp from './routes/front-controller.js';
import * as filesystemState from './filesystem-state.js';
import { Webhooks } from './webhooks.js';
import { middleware as authMiddleware } from './auth.js';
import { startup as websocketStartup } from './websocket.js';

const port = process.env.PORT;
if (!port) throw "no PORT environment variable set";
const app = getApp();
app.filesystemState = filesystemState;
const webhooksConfig = JSON.parse(fs.readFileSync('./src/webhooks-config.json', 'utf-8'));
app.webhooks = new Webhooks(webhooksConfig);
app.auth = authMiddleware;

const server = app.listen(port, function () {
  console.log('App listening on port ' + port);
});

websocketStartup(server, app);