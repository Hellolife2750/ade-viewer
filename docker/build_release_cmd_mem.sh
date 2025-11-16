#!/bin/bash
# lancer la compilation

# Nom du conteneur
CONTAINER_NAME="cordova-dev-build"

# Vérifier si le conteneur existe déjà
if [ $(docker ps -a -q -f name=$CONTAINER_NAME) ]; then
  echo "Le conteneur '$CONTAINER_NAME' existe déjà. Démarrage du conteneur..."

  if [ "$1" = "rm" ]; then
        echo "Le container existe déjà, suppression."
        docker rm -f $CONTAINER_NAME
        exit 0
  fi

  # Si le conteneur existe, le démarrer
  docker start -i $CONTAINER_NAME
else
  echo "Le conteneur '$CONTAINER_NAME' n'existe pas. Création et exécution du conteneur..."


    if [ $# -ne 1 ]; then
        echo "Veuillez préciser le mdp du keystore à la création du conteneur" 
        echo "/!\ usage: ./docker/build_release_cmd.sh <keystore_pass>"
        exit 1
    fi

  # Si le conteneur n'existe pas, le créer et l'exécuter
  docker run -it \
    -v "$(pwd):/app" \
    -e ALIAS_NAME='adeviewer' \
    -e KEYSTORE_PASS="$1" \
    -e KEY_PASS="$1" \
    --name $CONTAINER_NAME \
    cordova-dev \
    bash -c '/app/docker/build_release.sh'
fi