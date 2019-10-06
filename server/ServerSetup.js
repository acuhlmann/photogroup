//------------Utils and Setup - Logs, SSE, express setup
const express = require('express');
const compress = require('compression');
const path = require('path');

module.exports = class ServerSetup {

    start() {
        const SseChannel = require('sse-channel');
        this.updateChannel = new SseChannel({
            retryTimeout: 1000,
            historySize: 300,
            pingInterval: 4000,
            jsonEncode: true,
            cors: {
                origins: ['*'] // Defaults to []
            }
        });

        this.startExpress();
    }

    remoteLog(msg) {
        console.log(msg);
        this.updateChannel.send({
            event: 'discoveryMessage',
            data: msg
        });
    }

    startExpress() {
        //------------Express setup

        const app = this.app = express();

        // Trust "X-Forwarded-For" and "X-Forwarded-Proto" nginx headers
        app.enable('trust proxy');
        app.set('trust proxy', true);

        // Pretty print JSON
        app.set('json spaces', 2);

        // Disable "powered by express" header
        app.set('x-powered-by', false);

        // Use GZIP
        app.use(compress());

        const bodyParser = require('body-parser');
        app.use(express.static(path.join(__dirname, 'ui'), {
            etag: false
        }));
        app.use(bodyParser.json());

        const addRequestId = require('express-request-id')();
        app.use(addRequestId);

        app.use((request, response, next) => {

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
            response.header('Cache-Control', 'no-store,no-cache');

            next();
        });
    }
};