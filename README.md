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

## TODO & Bugs
