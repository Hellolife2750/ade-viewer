# ADE

## Description

- Auteur : Clément
- Dernière modification : sept 2025
- Version : 1.0
- Technos : CordovaJS + Node
- Dépôt Git:

ADE viewer est une app mobile (android/IOS) permettant de visualiser un EDT ADE.

## Installation (utilisateur)

## Installation (développeur)

Prérequis :

- Git
- Docker

Pour lancer le projet, suivez les étapes :

1) Construire l'image Docker : `cd docker && docker build -t cordova-dev -f Dockerfile . && cd ..`

2) Lancer l'app conteneurisée : `docker run -it --rm --device /dev/bus/usb -v "$(pwd):/app" -v "$(pwd)/.gradle-cache:/root/.gradle" -p 8000:8000 cordova-dev bash -c 'cd /app && bash'`

3) Build l'app en prod : `docker run --rm -it -v "$(pwd):/app" "$(pwd)/.gradle-cache:/root/.gradle" -e ALIAS_NAME='adeviewer' -e KEYSTORE_PASS='<passwd>' -e KEY_PASS='<passwd>' cordova-dev bash -c '/app/docker/build_release.sh'`

### Commandes cordova utiles

todo

### Run

cordova run android --device

### Debug

cordova build android --debug
adb install -r platforms/android/app/build/outputs/apk/debug/app-debug.apk
Sur PC, ouvrir Chrome et aller dans : chrome://inspect

adb logcat | FINDSTR "BackgroundFetch"

## Build release

- `keytool -genkeypair -v -keystore adeviewer-release-key.keystore -keyalg RSA -keysize 2048 -validity 10000 -alias adeviewer`

- `cordova build android --release`

- `zipalign -v 4 .\platforms\android\app\build\outputs\apk\release\app-release-unsigned.apk .\platforms\android\app\build\outputs\apk\release\adeviewer-release.apk`

- `apksigner sign --ks adeviewer-release-key.keystore --ks-key-alias adeviewer .\platforms\android\app\build\outputs\apk\release\adeviewer-release.apk`

- `apksigner verify -v .\platforms\android\app\build\outputs\apk\release\adeviewer-release.apk`

- `adb install -r .\platforms\android\app\build\outputs\apk\release\adeviewer-release.apk`

## TODO & Bugs

- désactiver l'opti de la batterie
- rajouter les taches
- enlever cours inutiles
