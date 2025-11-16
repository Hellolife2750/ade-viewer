#!/bin/bash
# lancer la compilation

if [ $# -ne 1 ]; then
    echo "/!\ usage: ./docker/build_release_cmd.sh <keystore_pass>"
    exit 1
fi

# -v "$(pwd)/.gradle-cache:/opt/gradle-8.13" \ 
docker run --rm -it \
  -v "$(pwd):/app" \
  -e ALIAS_NAME='adeviewer' \
  -e KEYSTORE_PASS="$1" \
  -e KEY_PASS="$1" \
  cordova-dev \
  bash -c '/app/docker/build_release.sh'
