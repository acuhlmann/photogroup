//------------Utils and Setup - Logs, SSE, express setup
import express from 'express';
import compress from 'compression';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import SseChannel from 'sse-channel';
import expressRequestId from 'express-request-id';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default class ServerSetup {

    start() {
        this.updateChannel = new SseChannel({
            retryTimeout: 1000,
            historySize: 500,
            pingInterval: 4000,
            jsonEncode: true,
            cors: {
                origins: [] // Defaults to []
            }
        });

        this.startExpress();
    }

    remoteLog(msg) {
        console.log(msg);
        /*this.updateChannel.send({
            event: 'discoveryMessage',
            data: msg
        });
        */
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

        app.use(express.static(path.join(__dirname, 'ui'), {
            etag: false
        }));
        app.use(express.json());

        const addRequestId = (expressRequestId.default || expressRequestId)();
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

        /*const isProd = process.env.args && process.env.args.includes('prod') || false;
        if(isProd) {
            app.use((req, res, next) => {
                if(req.secure) {
                    return next();
                }
                res.redirect('https://' + req.headers.host + req.url);
            })
        }*/
    }
};