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
const IpTranslator = require('./IpTranslator');
const Tracker = require('./Tracker');
const Rooms = require('./Rooms');

function init() {
    const ice = new IceServers(updateChannel, remoteLog, app);
    ice.start();

    const tracker = new Tracker(updateChannel, remoteLog, app, emitter);
    tracker.start();

    const rooms = new Rooms(updateChannel, remoteLog, app, emitter, ice, tracker);
    rooms.start();

    const events = new Events(rooms.rooms, updateChannel, remoteLog, app, emitter);
    events.start();

    //const network = new Topology(room.rooms, updateChannel, remoteLog, app, emitter, peers, tracker);
    //network.start();
}

init();

const started = new Promise((resolve, reject) => {

    if (module === require.main) {
        const server = app.listen(webPort, () => {
            const host = server.address().address;
            const actualPort = server.address().port;
            console.log(`App started at ${host}:${actualPort}`);
        });
    }
});

app.get('index.*', (req, res) => {
    res.sendFile(path.join(__dirname, 'ui/index.html'));
});

app.get('/.well-known/pki-validation/AC5282DE1EF367EB3D1FCCD30628F8D9.txt', (req, res) => {
    res.sendFile(path.join(__dirname, 'secret/AC5282DE1EF367EB3D1FCCD30628F8D9.txt'));
});

module.exports = {app, started};
