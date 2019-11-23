//-------------------Web Peers

const Peers = require('./Peers');

module.exports = class Events {

    constructor(rooms, updateChannel, remoteLog, app, emitter) {
        this.rooms = rooms;
        this.updateChannel = updateChannel;
        this.remoteLog = remoteLog;
        this.app = app;

        emitter.on('event', this.sendAppEvent.bind(this))
    }

    start() {

        this.app.post('/api/rooms/:id/photos/events', (request, response) => {

            const level = request.body.level;
            const type = request.body.type;
            const downloader = request.body.event.downloader;
            const event = Peers.peerToAppPeer(request.body.event.sharedBy);
            event.file = request.body.event.file;
            event.downloader = downloader;
            event.action = request.body.event.action;

            const id = request.params.id;
            this.sendAppEvent(level, type, event, id);

            response.send(true);
        });
    }

    //types: peerConnect, peerDisconnect, picAdd, picRemove
    sendAppEvent(level, type, event, id) {

        if(id) {
            const room = this.rooms.get(id);
            if(room && room.clients) {
                this.updateChannel.send({
                    event: 'appEvent',
                    data: {level: level, type: type, event: event}
                }, room.clients);
            }
        }
    }
};