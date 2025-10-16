#!/bin/bash
cd /app

# Serveur ICS et build SCSS
node dev-proxy/server.js &
npm run sass:watch &

# Hot reload cordova browser
cordova run browser &
while inotifywait -r -e modify,create,delete /app/www/; do
  clear
  echo "🔁 Rechargement Cordova..."
  pkill -f "cordova run browser &"
  cordova run browser &
done
