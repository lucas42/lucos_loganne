const express = require('express');
const app = express();
const port = process.env.PORT;
if (!port) throw "no PORT environment variable set";

app.get('/', function (req, res) {
	res.send("Hello World");
})
app.listen(port, function () {
  console.log('App listening on port ' + port);
});