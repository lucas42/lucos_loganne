# lucos_loganne
Keeps track of high-level events of interest in lucos apps

## Dependencies
* docker
* docker-compose

## Runtime environment varibles (set inside docker-compose.yml)
* __PORT__ - The TCP port for the web server to listen on
* __STATE_DIR__ - The path of a directory which mounts a docker volume

## Running
`nice -19 docker-compose up -d --no-build`

## Running test suite
(requires node & npm installed - can install using `nvm install`)
`npm test`

## Adding an event

Send a POST request to the `/events` endpoint.  Include the following fields in a JSON encoded object:

* __source__ _required_ - The id of the lucos service which send the request
* __type__ _required_ - The type of event being logged
* __humanReadable__ _required_ - A description of the event which humans can easily understand
* __date__ - The datetime when the event occured (formatted as RFC 2822 or unix __millisecond__ timestamp).  Defaults to the time the http request is proccessed.