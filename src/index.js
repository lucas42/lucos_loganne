import fs from 'fs';
import getApp from './routes/front-controller.js';
import * as filesystemState from './filesystem-events.js';
import { saveProducers } from './filesystem-producers.js';
import { setSaveCallback } from './routes/producers.js';
import { Webhooks, validateWebhooksConfig } from './webhooks.js';
import { createAuthMiddleware, AITHNE_ORIGIN } from './auth.js';
import { startup as websocketStartup } from './websocket.js';

const port = process.env.PORT;
if (!port) throw "no PORT environment variable set";
setSaveCallback(saveProducers);
const app = getApp();
app.filesystemState = filesystemState;
const webhooksConfig = JSON.parse(fs.readFileSync('./webhooks-config.json', 'utf-8'));
validateWebhooksConfig(webhooksConfig);
app.webhooks = new Webhooks(webhooksConfig);

// Composition root: the one place a real aithne client is constructed for
// this process. Hands auth.middleware to the router and
// auth.verifySessionToken to the websocket handshake — both close over the
// same client instance (lucas42/lucos#268).
const auth = createAuthMiddleware({
  origin: AITHNE_ORIGIN,
  jwksUrl: process.env.AITHNE_JWKS_URL,
  appOrigin: process.env.APP_ORIGIN,
  environment: process.env.ENVIRONMENT,
});
app.auth = auth.middleware;

const server = app.listen(port, function () {
  console.log('App listening on port ' + port);
});

websocketStartup(server, app, auth.verifySessionToken);