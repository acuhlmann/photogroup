//------------------Twillio ICE STUN/TURN
/** Inspired by https://instant.io */
const twilio = require('twilio');
const cors = require('cors');
const util = require('util');

const CORS_WHITELIST = [
    // Official WebTorrent site
    'http://www.photogroup.network/',
    'https://www.photogroup.network/'
];

module.exports = class IceServers {

    constructor(updateChannel, remoteLog, app) {
        this.updateChannel = updateChannel;
        this.remoteLog = remoteLog;
        this.app = app;
    }

    start() {
        // Skip Twilio initialization in test mode
        if (process.env.NODE_ENV === 'test') {
            this.registerGet();
            return;
        }

        const secret = require('./secret');

        // Fetch new iceServers from twilio token regularly
        let twilioClient;
        try {
            twilioClient = twilio(secret.twilio.accountSid, secret.twilio.authToken)
        } catch (err) { }

        if (twilioClient) {
            this.twilioClient = twilioClient;
            this.twillioInterval = setInterval(this.updateIceServers.bind(this), 60 * 60 * 4 * 1000).unref();
            this.updateIceServers();
        }

        this.registerGet();
    }

    registerGet() {
        const self = this;

        // WARNING: This is *NOT* a public endpoint. Do not depend on it in your app.
        this.app.get('/api/__rtcConfig__', cors({
            origin: function (origin, cb) {
                const allowed = CORS_WHITELIST.indexOf(origin) >= 0 ||
                    /https?:\/\/localhost(:|$)/.test(origin);
                cb(null, allowed)
            }
        }), function (req, res) {
            if (!self.iceServers) return res.status(404).send({ iceServers: [] });

            res.send({
                //ip: res.connection._peername,
                comment: 'WARNING: This is *NOT* a public endpoint. Do not depend on it in your app',
                iceServers: self.iceServers
            })
        });
    }

    updateIceServers() {
        const updateChannel = this.updateChannel;

        const self = this;

        if(!this.twilioClient) return;
        this.twilioClient.tokens.create({}, function (err, token) {
            if (err) {
                const msg = err.message || err;
                updateChannel.send({
                    event: 'discoveryMessage',
                    data: msg
                });
                return console.error(msg);
            }
            if (!token.iceServers) {
                const msg = 'twilio response missing iceServers';
                updateChannel.send({
                    event: 'discoveryMessage',
                    data: msg
                });
                return console.error(msg);
            }

            // Support new spec (`RTCIceServer.url` was renamed to `RTCIceServer.urls`)
            self.iceServers = token.iceServers.map(server => {
                if (server.url != null) {
                    server.urls = server.url;
                    delete server.url
                }
                return server
            });

            console.log('ice.length ' + self.iceServers.length);
            console.log('ice ' + util.inspect(self.iceServers));
        })
    }
};