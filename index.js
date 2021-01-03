const express = require('express');
const app = express();
const port = process.env.PORT;
if (!port) throw "no PORT environment variable set";

app.get('/', (req, res) => {
	res.send("Hello World");
});

app.get('/_info', (req, res) => {
	const output = {
		system: 'lucos_loganne',
		checks: {
		},
		metrics: {},
		ci: {
			circle: "gh/lucas42/lucos_loganne",
		}
	};
	res.send(output);
});
app.listen(port, function () {
  console.log('App listening on port ' + port);
});