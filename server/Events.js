//-------------------Web Peers

const Peers = require('./Peers');

module.exports = class Events {

    constructor(updateChannel, remoteLog, app, emitter) {
        this.updateChannel = updateChannel;
        this.remoteLog = remoteLog;
        this.app = app;

        emitter.on('event', this.sendAppEvent.bind(this))
    }

    start() {

        this.app.post('/api/events', (request, response) => {

            const level = request.body.level;
            const type = request.body.type;
            const downloader = request.body.event.downloader;
            const event = Peers.peerToAppPeer(request.body.event.sharedBy);
            event.file = request.body.event.file;
            event.downloader = downloader;
            event.action = request.body.event.action;

            this.sendAppEvent(level, type, event);

            response.send(true);
        });
    }

    //types: peerConnect, peerDisconnect, picAdd, picRemove
    sendAppEvent(level, type, event) {

        this.updateChannel.send({
            event: 'appEvent',
            data: {level: level, type: type, event: event}
        });
    }
};