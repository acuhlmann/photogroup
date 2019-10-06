#!/usr/bin/env bash

ZONE=asia-east2-a
INSTANCE=main
PROJECT=photogroup-223501

DOMAIN=photogroup.network
DOMAIN_=photogroup_network

#configure ssl
#gcloud compute scp ./server/secret/cert/$DOMAIN_.crt $INSTANCE:./ --zone $ZONE
#gcloud compute scp ./server/secret/cert/$DOMAIN_.key $INSTANCE:./ --zone $ZONE
#gcloud compute ssh $INSTANCE --zone $ZONE --command "sudo mv ./$DOMAIN_.crt /etc/ssl/private/$DOMAIN"
#gcloud compute ssh $INSTANCE --zone $ZONE --command "sudo mv ./$DOMAIN_.key /etc/ssl/private/$DOMAIN"

#configure nginx
#gcloud compute ssh $INSTANCE --zone $ZONE --command "sudo mkdir /etc/nginx/sites-enabled/$DOMAIN"
gcloud compute scp ./server/config/$DOMAIN $INSTANCE:/etc/nginx/sites-available --zone $ZONE
gcloud compute ssh $INSTANCE --zone $ZONE --command "sudo systemctl restart nginx"

#sudo systemctl enable nginx