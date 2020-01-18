#!/usr/bin/env bash

ZONE=asia-east2-a
INSTANCE=main
PROJECT=photogroup-223501

#gcloud compute ssh main --zone asia-east2-a --command "rm -r pg"
gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "rm -r pg"
gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "mkdir pg"
gcloud compute scp --recurse ./bin/* $INSTANCE:./pg/ --project $PROJECT --zone $ZONE
gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "sudo lsof -ti:8081 | sudo xargs kill"
gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "sudo lsof -ti:9000 | sudo xargs kill"
gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "sudo cp pg"
gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "cd pg && npm install"
gcloud compute ssh $INSTANCE --project $PROJECT --zone $ZONE --command "cd pg && sudo pm2 stop app && sudo pm2 delete app && sudo pm2 start app.js -- prod"