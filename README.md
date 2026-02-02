# PhotoGroup
Zero Install, Peer-to-Peer, Lossless Photo Group Collaboration. 
This web app (React, NodeJS/Express) uses 
[WebTorrent](https://github.com/webtorrent/webtorrent) 
to share original photos between peers, 
using WebRTC and the NodeJS server that 
shares magnet links. 
The UI extracts and renders Exif and XMP metadata. 

The app tries to share p2p, but if this isn't possible 
(eg due to symmetric NATs), it falls back to the next best option for a decentralized 
exchange, incrementally adding centralization (eg relay servers using TURN), 
ultimately the UI allows to upload images to the central server too.

This is in an experimental stage.

# Install and Run

**Requirements:** Node.js >= 24.0.0

```bash
git clone <this-repo>
cd photogroup2
npm run install-start
```

- **First time:** `npm run install-start` installs dependencies for root, server, and UI, then starts both.
- **Later:** From the project root, run `npm run start` to start the server and UI in parallel.

| Service | URL | Port |
|---------|-----|------|
| **UI** (Vite) | http://localhost:3000 | 3000 |
| **API server** | http://localhost:8081 | 8081 (or `PORT` env) |

Open **http://localhost:3000** in your browser. The UI proxies `/api` to the server.

### Optional: Twilio (NAT traversal)

For TURN/STUN via Twilio, add credentials in either:

- **`server/secret/index.js`** (tried first), or  
- **`server/secret.js`**, or  
- **Environment variables:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`

Example `server/secret/index.js`:

```js
export default {
  twilio: {
    accountSid: '',
    authToken: ''
  }
};
```

If omitted, the app still runs with default WebRTC behavior.

# Other Notes

### Credits

This mostly this builds on the amazing work of 
[WebTorrent](https://github.com/webtorrent/webtorrent), 
[Instant.io](https://github.com/webtorrent/instant.io) and 
[Exif.js](https://github.com/exif-js/exif-js).
In addition some ideas are from:
* https://github.com/SilentBot1/webtorrent-examples/blob/master/resurrection/index.js
* https://github.com/webtorrent/webtorrent/issues/1412
...

### parsetorrent
This app uses [parse-torrent](https://github.com/webtorrent/parse-torrent) 
but recompiled it to make it work with the create-react-app build using: 
`browserify -s parsetorrent -e ./ -o parsetorrent.js`
The recompiled version can be found in `ui/public/parsetorrent.js`


