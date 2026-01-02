//------------------Twillio ICE STUN/TURN
/** Inspired by https://instant.io */
import twilio from 'twilio';
import cors from 'cors';
import { inspect } from 'util';

const CORS_WHITELIST = [
    // Official WebTorrent site
    'http://www.photogroup.network/',
    'https://www.photogroup.network/'
];

export default class IceServers {

    constructor(updateChannel, remoteLog, app) {
        this.updateChannel = updateChannel;
        this.remoteLog = remoteLog;
        this.app = app;
    }

    async start() {
        // Skip Twilio initialization in test mode
        if (process.env.NODE_ENV === 'test') {
            this.registerGet();
            return;
        }

        let secret;
        try {
            // Try importing from secret/index.js first (ES module format)
            try {
                const secretIndexModule = await import('./secret/index.js');
                secret = secretIndexModule.default || secretIndexModule;
                console.log('ICE servers: Loaded from secret/index.js');
            } catch (err1) {
                // Fallback to secret.js (ES module format)
                try {
                    const secretModule = await import('./secret.js');
                    secret = secretModule.default || secretModule;
                    console.log('ICE servers: Loaded from secret.js');
                } catch (err2) {
                    console.log('ICE servers: Could not load secret files, trying environment variables');
                    throw err1; // Re-throw original error
                }
            }
            // Also check environment variables as fallback if credentials are missing
            if (!secret?.twilio?.accountSid || !secret?.twilio?.authToken) {
                const accountSid = process.env.TWILIO_ACCOUNT_SID;
                const authToken = process.env.TWILIO_AUTH_TOKEN;
                if (accountSid && authToken) {
                    secret = { twilio: { accountSid, authToken } };
                    console.log('ICE servers: Using Twilio credentials from environment variables');
                }
            }
        } catch (err) {
            console.log('ICE servers: Error loading secret file:', err.message);
            // Try environment variables as fallback
            const accountSid = process.env.TWILIO_ACCOUNT_SID;
            const authToken = process.env.TWILIO_AUTH_TOKEN;
            if (accountSid && authToken) {
                secret = { twilio: { accountSid, authToken } };
                console.log('ICE servers: Using Twilio credentials from environment variables');
            } else {
                secret = { twilio: { accountSid: '', authToken: '' } };
            }
        }

        // Fetch new iceServers from twilio token regularly
        let twilioClient;
        try {
            if (secret?.twilio?.accountSid && secret?.twilio?.authToken) {
                twilioClient = twilio(secret.twilio.accountSid, secret.twilio.authToken);
                console.log('ICE servers: Twilio client created successfully');
            } else {
                console.log('ICE servers: Twilio credentials missing - accountSid:', !!secret?.twilio?.accountSid, 'authToken:', !!secret?.twilio?.authToken);
            }
        } catch (err) {
            console.error('ICE servers: Error creating Twilio client:', err.message);
        }

        if (twilioClient) {
            this.twilioClient = twilioClient;
            this.twillioInterval = setInterval(this.updateIceServers.bind(this), 60 * 60 * 4 * 1000).unref();
            this.updateIceServers();
            console.log('ICE servers: Twilio client initialized, fetching ICE servers...');
        } else {
            console.log('ICE servers: No Twilio credentials found, using fallback STUN servers');
            // Set fallback ICE servers if Twilio is not available
            this.iceServers = [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:23.21.150.121' }
            ];
            console.log('ICE servers: Using fallback STUN servers:', this.iceServers.length);
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
            // Always return 200 for health checks (Playwright webServer needs 200 status)
            // In test mode or when iceServers not initialized, return empty array
            if (!self.iceServers) {
                return res.status(200).send({ iceServers: [] });
            }

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
            console.log('ice ' + inspect(self.iceServers));
        })
    }
};