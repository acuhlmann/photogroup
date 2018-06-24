'use strict';

/** Inspired by https://instant.io */
const express = require('express');
const path = require('path');
const EventEmitter = require('events');
const twilio = require('twilio');
const util = require('util');
const compress = require('compression');

const app = express();
const Stream = new EventEmitter();
Stream.setMaxListeners(0);

const bodyParser = require('body-parser');
app.use(bodyParser.json()); // support json encoded bodies
app.use(bodyParser.urlencoded({ extended: true })); // support encoded bodies

// Use GZIP
app.use(compress());

app.use(function (req, res, next) {
    //res.header('Access-Control-Allow-Origin', '*');

    // Prevents IE and Chrome from MIME-sniffing a response. Reduces exposure to
    // drive-by download attacks on sites serving user uploaded content.
    res.header('X-Content-Type-Options', 'nosniff');

    // Prevent rendering of site within a frame.
    res.header('X-Frame-Options', 'DENY');

    // Enable the XSS filter built into most recent web browsers. It's usually
    // enabled by default anyway, so role of this headers is to re-enable for this
    // particular website if it was disabled by the user.
    res.header('X-XSS-Protection', '1; mode=block');

    // Force IE to use latest rendering engine or Chrome Frame
    res.header('X-UA-Compatible', 'IE=Edge,chrome=1');

    next();
});


const urls = [];
Stream.emit("push", "urls", { urls: urls });

app.get('/rooms', (req, res) => {
    res.send(urls);
});

app.delete('/rooms', (req, res) => {
    const url = req.body.url;
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
            Stream.emit("push", "urls", { urls: urls });
        }
    }
    res.send([found]);
});

app.post('/rooms', (req, res) => {

    const url = req.body.url;
    if (url) {
        if (!urls.includes(url)) {
            urls.push(url);
            Stream.emit("push", "urls", { urls: urls });
        }
    }
    res.send([url])
});

app.get('/roomstream', (request, response) => {

    response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        //no-transform is only for create-react-app dev server hack
        'Cache-Control': 'no-cache,no-transform',
        'Connection': 'keep-alive'
    });

    Stream.on("push", (event, data) => {
        response.write("event: " + String(event) + "\n" + "data: " + JSON.stringify(data) + "\n\n");
    });
});


app.use(express.static(__dirname + '/ui'));
app.set('views', path.join(__dirname, 'ui'));
app.set('view engine', 'ejs');
app.engine('html', require('ejs').renderFile);
app.get('/', (req, res) => {
    res.render('index.html');
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