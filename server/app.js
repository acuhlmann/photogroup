'use strict';

/** Inspired by https://instant.io */
const express = require('express');
const path = require('path');
const twilio = require('twilio');
const util = require('util');
const compress = require('compression');

const SseChannel = require('sse-channel');

const magnet = require('magnet-uri');
var WebTorrent = require('webtorrent');

const app = express();
app.enable('trust proxy');

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




let urls = [];

app.get('/api/rooms', (request, response) => {
    response.send({'1': urls});
});

app.delete('/api/rooms', (request, response) => {
    urls = [];
    response.send(urls);
});

app.get('/api/rooms/1', (request, response) => {
    response.send(urls);
});

const updateChannel = new SseChannel({
    retryTimeout: 1000,
    historySize: 300,
    pingInterval: 4000,
    jsonEncode: true,
    //cors: {
        //origins: ['*'] // Defaults to []
    //}
});

app.delete('/api/rooms/1', (request, response) => {
    const url = request.body.url;
    let found = undefined;
    if (url) {
        found = urls.find((item, index) => {
            if (item.url === url) {
                urls.splice(index, 1);
                return true;
            }
            return false;
        });

        if (found) {
            updateChannel.send({
                event: 'urls',
                data: { urls: urls }
            });
        }
    }
    response.send([found]);
});

app.post('/api/rooms/1', (request, response) => {

    const url = request.body.url;
    const secure = request.body.secure;
    let urlItem;
    if (url) {
        urlItem = findUrl(url);
        if (!urlItem) {
            urlItem = {url: url, secure: secure};
            urls.push(urlItem);
        }
    }
    updateChannel.send({
        event: 'urls',
        data: { urls: urls }
    });

    if(url) {

        //setupDHT(url);
        //setupWebtorret(url);
    }

    response.send(urlItem)
});

function setupWebtorret(url) {
    const parsed = magnet(url);
    console.log(parsed.infoHash);

    var client = new WebTorrent();
    console.log('add:', parsed);
    client.add(parsed.infoHash, function (torrent) {
        // Got torrent metadata!
        console.log('Client is downloading:', torrent.infoHash);
    })
}

function setupDHT(url) {

    const parsed = magnet(url);
    console.log(parsed.infoHash);

    var DHT = require('bittorrent-dht');
    var dht = new DHT();

    dht.listen(20000, function () {
        console.log('now listening')
    });
    dht.on('peer', function (peer, infoHash, from) {
        console.log('found potential peer ' + peer.host + ':' + peer.port + ' through ' + from.address + ':' + from.port)
    });

    // find peers for the given torrent info hash
    dht.lookup(parsed.infoHash);
}


function findUrl(url) {
    const index = urls.findIndex(item => item.url === url);
    let foundItem = null;
    if(index => 0) {
        foundItem = urls[index];
    }
    return foundItem;
}

function getConnectionCount() {
    return updateChannel.getConnectionCount();
}

function sendConnectionCount(connections, globalIPs) {

    const ips = [];
    for (const node of globalIPs.values()) {
        const info = {
            route: node
        };
        ips.push(info);
    }

    updateChannel.send({
        event: 'sseConnections',
        data: { sseConnections: connections, ips: ips }
    });
}

let globalIPs = new Map();
updateChannel.on('connect', (channel, request, response) => {
    globalIPs.set(request, request.ips);
    sendConnectionCount(channel.connectionCount, globalIPs);
});

updateChannel.on('disconnect', (channel, response) => {
    globalIPs.delete(response.req);
    sendConnectionCount(channel.connectionCount, globalIPs);
});

app.get('/api/updates', (request, response) => {

    response.header('X-Accel-Buffering', 'no');
    updateChannel.addClient(request, response);
});

app.get('/api/connections', (request, response) => {

    const connections = getConnectionCount();
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
        if (err) {
            const msg = err.message || err;
            updateChannel.send({
                event: 'discoveryMessage',
                data: msg
            });
            return console.error(msg);
        }
        if (!token.iceServers) {
            const msg = 'twilio response ' + util.inspect(token) + ' missing iceServers';
            updateChannel.send({
                event: 'discoveryMessage',
                data: msg
            });
            return console.error(msg);
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

app.get('index.*', (req, res) => {
    res.sendFile(path.join(__dirname, 'ui/index.html'));
});


const port = 80; //65080;
const hostname = 'localhost';
function onlistening() {
    console.log('onlistening');
}

if (module === require.main) {
    // [START server]
    // Start the server
    const server = app.listen(process.env.PORT || 8081, () => {
        const port = server.address().port;
        console.log(`App listening on port ${port}`);
    });
    // [END server]

    startWS(server);
}

module.exports = app;



function startWS(expressServer) {

    var Server = require('bittorrent-tracker').Server

    var server = new Server({
        udp: false, // enable udp server? [default=true]
        http: true, // enable http server? [default=true]
        ws: true, // enable websocket server? [default=true]
        stats: true, // enable web-based statistics? [default=true]
        /*filter: function (infoHash, params, cb) {
            // Blacklist/whitelist function for allowing/disallowing torrents. If this option is
            // omitted, all torrents are allowed. It is possible to interface with a database or
            // external system before deciding to allow/deny, because this function is async.

            // It is possible to block by peer id (whitelisting torrent clients) or by secret
            // key (private trackers). Full access to the original HTTP/UDP request parameters
            // are available in `params`.

            // This example only allows one torrent.

            var allowed = (infoHash === 'aaa67059ed6bd08362da625b3ae77f6f4a075aaa')
            if (!allowed) {
                // If the callback is passed `null`, the torrent will be allowed.
                cb(null)
            } else {
                // If the callback is passed an `Error` object, the torrent will be disallowed
                // and the error's `message` property will be given as the reason.
                cb(new Error('disallowed torrent'))
            }
        }*/
    });

    // Internal http, udp, and websocket servers exposed as public properties.
    server.http
    server.udp
    server.ws

    server.on('error', function (err) {
        // fatal server error!
        console.log(err.message)
    });

    server.on('warning', function (err) {
        // client sent bad data. probably not a problem, just a buggy client.
        console.log(err.message)
    });

    server.on('listening', function () {
        // fired when all requested servers are listening
        console.log('listening on http port:' + server.http.address().port)
        //console.log('listening on udp port:' + server.udp.address().port)
    });


    /*var onHttpRequest = server.onHttpRequest.bind(server);
    function onHttpRequest2() {
        console.log('onHttpRequest2');
        onHttpRequest();
    }
    app.get('/announce', onHttpRequest2);
    app.get('/scrape', onHttpRequest2);*/
    //server.listen(8080);

    // start tracker server listening! Use 0 to listen on a random free port.
    server.listen(port, hostname, onlistening);

    // listen for individual tracker messages from peers:

    server.on('start', function (addr) {
        console.log('got start message from ' + addr)
    });

    server.on('complete', onlistening);
    server.on('update', onlistening);
    server.on('stop', onlistening);

    // get info hashes for all torrents in the tracker server
    Object.keys(server.torrents);


    /*var Server = require('bittorrent-tracker').Server
    var express = require('express')
    var app = express()

    // https://wiki.theory.org/BitTorrentSpecification#peer_id
    var whitelist = {
        UT: true // uTorrent
    }

    var server = new Server({
        http: false, // we do our own
        udp: false, // not interested
        ws: true, // not interested
        filter: function (params) {
            // black/whitelist for disallowing/allowing specific clients [default=allow all]
            // this example only allows the uTorrent client
            var client = params.peer_id[1] + params.peer_id[2]
            return whitelist[client]
        }
    })

    var onHttpRequest = server.onHttpRequest.bind(server)
    app.get('/announce', onHttpRequest)
    app.get('/scrape', onHttpRequest)

    app.listen(8082);*/

    /*
        var io = require('socket.io')(server);
        io.on('connection', function(){
            console.log('foo');
        });


        const TrackerServer = require('bittorrent-tracker').Server;
        var trackerServer = new TrackerServer({
            http: true,
            udp: true,
            ws: true
        });
        const onHttpRequest = trackerServer.onHttpRequest.bind(trackerServer);
        app.get('/announce', (req, res) => {
            onHttpRequest(req, res, {action: 'announce'})
        });
        app.get('/scrape', (req, res) => {
            onHttpRequest(req, res, {action: 'scrape'})
        });


        trackerServer.on('warning', function (err) {
            // client sent bad data. probably not a problem, just a buggy client.
            console.log(err.message)
        });

        trackerServer.on('listening', function () {
            // fired when all requested servers are listening
            console.log('listening on http port:' + server.http.address().port);
            console.log('listening on udp port:' + server.udp.address().port)
        });

        const port = 8081;
        const hostname = '127.0.0.1';
        // start tracker server listening! Use 0 to listen on a random free port.
        //trackerServer.listen(port, hostname, onlistening)

        // listen for individual tracker messages from peers:

        trackerServer.on('start', function (addr) {
            console.log('got start message from ' + addr)
        });

        trackerServer.on('complete', onlistening);
        trackerServer.on('update', onlistening);
        trackerServer.on('stop', onlistening);

        // get info hashes for all torrents in the tracker server
        Object.keys(trackerServer.torrents);
        */
}