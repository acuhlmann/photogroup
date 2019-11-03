'use strict';
const express = require('express');
const path = require('path');
const webPort = process.env.PORT || 8081;

const ServerSetup = require('./ServerSetup');
const setup = new ServerSetup();
setup.start();

const updateChannel = setup.updateChannel;
const remoteLog = setup.remoteLog.bind(setup);
const app = setup.app;

//------------Start app logic

const EventEmitter = require('eventemitter3');
const emitter = new EventEmitter();

const IceServers = require('./IceServers');
const Events = require('./Events');
const Peers = require('./Peers');
const IpTranslator = require('./IpTranslator');
const Tracker = require('./Tracker');
const Room = require('./Room');
const Topology = require('./Topology');

function init(pgServer) {
    const ice = new IceServers(updateChannel, remoteLog, app);
    ice.start();

    const events = new Events(updateChannel, remoteLog, app, emitter);
    events.start();

    const peers = new Peers(updateChannel, remoteLog, app, emitter);
    peers.start();

    const room = new Room(updateChannel, remoteLog, app, emitter, peers, ice);
    room.start(init);

    const tracker = new Tracker(updateChannel, remoteLog, app, emitter, peers);
    tracker.start();

    const network = new Topology(updateChannel, remoteLog, app, emitter, peers, tracker);
    network.start();

    if(pgServer) {

        //peers.pgServer = pgServer;
        IpTranslator.getLookupIp('photogroup.network').then(result => {
            console.log('photogroup.network is at ' + result.ip + ' hosted at ' + result.hostname);
            peers.pgServer = result;
        });
    }

    return peers;
}

const peers = init();


if (module === require.main) {
    const server = app.listen(webPort, () => {
        const host = server.address().address;
        const actualPort = server.address().port;
        console.log(`App started at ${host}:${actualPort}`);

        IpTranslator.getLookupIp('photogroup.network').then(result => {
            console.log('photogroup.network is at ' + result.ip + ' hosted at ' + result.hostname);
            peers.pgServer = result;
        });
    });
}


app.get('index.*', (req, res) => {
    res.sendFile(path.join(__dirname, 'ui/index.html'));
});

app.get('/.well-known/pki-validation/C0058F76E8481F8C207781B1834C9B0C.txt', (req, res) => {
    res.sendFile(path.join(__dirname, 'config/C0058F76E8481F8C207781B1834C9B0C.txt'));
    //res.download('config/filename.txt')
});
