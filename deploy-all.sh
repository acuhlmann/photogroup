#!/usr/bin/env bash

npm run build
sh deploy-copy.sh
#sh deploy-nginx.sh
sh deploy-app.sh