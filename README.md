# PhotoTorrent
Zero Install, Peer-to-Peer Photo Group Collaboration. 
This is experimental; an early, hacky stage.

# Install

```
git clone ...
cd ...
npm install
```

Add an index.js file inside `server/secret/` with account credentials 
to your Twilio account for their NAT traversal. [instant.io](https://github.com/webtorrent/instant.io)
```exports.twilio = {
     accountSid: '',
     authToken: ''
   };
```

# Other Notes

### Credits

This mostly this builds on the amazing work of 
[webtorrent](https://github.com/webtorrent/webtorrent) and
 [instant.io](https://github.com/webtorrent/instant.io)
In addition some ideas are from:
* https://github.com/SilentBot1/webtorrent-examples/blob/master/resurrection/index.js
* https://github.com/webtorrent/webtorrent/issues/1412
...

### parsetorrent
This app uses [parse-torrent](https://github.com/webtorrent/parse-torrent) 
but recompiled it to make it work with the create-react-app build using: 
`browserify -s parsetorrent -e ./ -o parsetorrent.js`
The recompiled version can be found in `ui/public/parsetorrent.js`


