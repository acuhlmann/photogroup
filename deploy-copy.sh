#!/usr/bin/env bash

mkdir -p ./bin
rm -rf ./server/ui/
mkdir -p ./server/ui
cp -R ./ui/build/ ./server/ui/
mv ./server/ui/build/* ./server/ui/
rm -rf ./server/ui/build/

rm -rf ./bin/*
cp -R ./server/ui/ ./bin/ui/
cp -R ./server/secret/ ./bin/secret
cp -R ./server/config/ ./bin/config
#cp -R ./server/app/ ./bin/app
cp ./server/package.json ./bin/
cp ./server/app.js ./bin/
cp ./server/Events.js ./bin/
cp ./server/IceServers.js ./bin/
cp ./server/IpTranslator.js ./bin/
cp ./server/Peers.js ./bin/
cp ./server/Rooms.js ./bin/
cp ./server/ServerPeer.js ./bin/
cp ./server/ServerSetup.js ./bin/
cp ./server/Tracker.js ./bin/
cp ./server/Topology.js ./bin/