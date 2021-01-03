const app = require('./app');
const port = process.env.PORT;
if (!port) throw "no PORT environment variable set";

app.listen(port, function () {
  console.log('App listening on port ' + port);
});