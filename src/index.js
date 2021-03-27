const port = process.env.PORT;
if (!port) throw "no PORT environment variable set";
const app = require('./routes/front-controller');

app.listen(port, function () {
  console.log('App listening on port ' + port);
});