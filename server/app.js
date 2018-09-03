'use strict';

/** Inspired by https://instant.io */
const express = require('express');
const path = require('path');
const twilio = require('twilio');
const util = require('util');
const compress = require('compression');

const SseChannel = require('sse-channel');

const app = express();

const bodyParser = require('body-parser');

// Use GZIP
app.use(compress());

app.use(express.static(path.join(__dirname, 'ui')));
app.use(bodyParser.json());

app.use((request, response, next) => {
    //response.header('Access-Control-Allow-Origin', '*');

    // Prevents IE and Chrome from MIME-sniffing a response. Reduces exposure to
    // drive-by download attacks on sites serving user uploaded content.
    response.header('X-Content-Type-Options', 'nosniff');

    // Prevent rendering of site within a frame.
    response.header('X-Frame-Options', 'DENY');

    // Enable the XSS filter built into most recent web browsers. It's usually
    // enabled by default anyway, so role of this headers is to re-enable for this
    // particular website if it was disabled by the user.
    response.header('X-XSS-Protection', '1; mode=block');

    // Force IE to use latest rendering engine or Chrome Frame
    response.header('X-UA-Compatible', 'IE=Edge,chrome=1');

    response.header('X-Accel-Buffering', 'no');

    next();
});


const urls = [];

app.get('/api/rooms', (request, response) => {
    response.send(urls);
});

const roomsChannel = new SseChannel({
    retryTimeout: 250,
    historySize: 300,
    pingInterval: 5000,
    jsonEncode: true,
    //cors: {
        //origins: ['*'] // Defaults to []
    //}
});

app.delete('/api/rooms', (request, response) => {
    const url = request.body.url;
    let found = undefined;
    if (url) {
        found = urls.find((item, index) => {
            if (item === url) {
                urls.splice(index, 1);
                return true;
            }
            return false;
        });

        if (found) {
            roomsChannel.send({
                event: 'urls',
                data: { urls: urls }
            });
        }
    }
    response.send([found]);
});

app.post('/api/rooms', (request, response) => {

    const url = request.body.url;
    if (url) {
        if (!urls.includes(url)) {
            urls.push(url);
            roomsChannel.send({
                event: 'urls',
                data: { urls: urls }
            });
        }
    }
    response.send([url])
});

app.get('/api/roomstream', (request, response) => {

    response.header('X-Accel-Buffering', 'no');
    roomsChannel.addClient(request, response);
});

app.get('/api/connections', (request, response) => {

    const connections = roomsChannel.getConnectionCount();
    response.send([connections]);
});

const secret = require('./secret');

// Fetch new iceServers from twilio token regularly
let iceServers;
let twilioClient;
try {
    twilioClient = twilio(secret.twilio.accountSid, secret.twilio.authToken)
} catch (err) { }

function updateIceServers() {
    twilioClient.tokens.create({}, function (err, token) {
        if (err) return console.error(err.message || err);
        if (!token.iceServers) {
            return console.error('twilio response ' + util.inspect(token) + ' missing iceServers')
        }

        // Support new spec (`RTCIceServer.url` was renamed to `RTCIceServer.urls`)
        iceServers = token.iceServers.map(function (server) {
            if (server.url != null) {
                server.urls = server.url;
                delete server.url
            }
            return server
        })
    })
}

let twillioInterval;

if (twilioClient) {
    twillioInterval = setInterval(updateIceServers, 60 * 60 * 4 * 1000).unref();
    updateIceServers();
}

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'ui/index.html'));
});

if (module === require.main) {
    // [START server]
    // Start the server
    const server = app.listen(process.env.PORT || 8081, () => {
        const port = server.address().port;
        console.log(`App listening on port ${port}`);
    });
    // [END server]
}

module.exports = app;