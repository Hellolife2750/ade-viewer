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
- Node

Pour lancer le projet, suivez les étapes :

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
