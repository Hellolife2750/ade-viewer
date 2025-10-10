#!/bin/bash

set -e

cd /app

# Variables keystore
KEYSTORE_PATH="/app/adeviewer-release-key.keystore"
ALIAS_NAME="${ALIAS_NAME}"
KEYSTORE_PASS="${KEYSTORE_PASS}"
KEY_PASS="${KEY_PASS}"
BARCODESCANNER_GRADLE_FILE="platforms/android/phonegap-plugin-barcodescanner/enseirb-barcodescanner.gradle"

# chemin des apk
APK_UNSIGNED="platforms/android/app/build/outputs/apk/release/app-release-unsigned.apk"
APK_ALIGNED="platforms/android/app/build/outputs/apk/release/app-release-aligned.apk"
APK_SIGNED="platforms/android/app/build/outputs/apk/release/app-release-signed.apk"

# couleur prompt
GREEN='\033[1;32m'
RESET='\033[0m'

echo "➡️ Ajout de la plateforme Android"
cordova platform rm android >/dev/null 2>&1 || true
rm -rf ./android/ >/dev/null 2>&1 || true
cordova platform add android

# patcher compatibilité module gradle 5
if [ -f "$BARCODESCANNER_GRADLE_FILE" ]; then
  echo "🔧 Patch du plugin BarcodeScanner : remplacement compile() -> implementation()"
  sed -i 's/\bcompile\b/implementation/g' "$BARCODESCANNER_GRADLE_FILE"
fi

echo "🎨 Génération des icônes"
cordova-res android --type icon --skip-config --copy
cordova-res android --type splash --copy

echo "⚙️ Build APK release"
cordova build android --release -- --cdvCompileSdkVersion=34

echo "🔧 Zipalign de l'APK"
zipalign -v -p 4 "$APK_UNSIGNED" "$APK_ALIGNED"

echo "🔐 Signature de l'APK"
apksigner sign \
  --ks "$KEYSTORE_PATH" \
  --ks-key-alias "$ALIAS_NAME" \
  --ks-pass pass:$KEYSTORE_PASS \
  --key-pass pass:$KEY_PASS \
  --out "$APK_SIGNED" \
  "$APK_ALIGNED"

echo "✅ Vérification de la signature"
apksigner verify -v "$APK_SIGNED"

echo -e "${GREEN}✅ APK final : $APK_SIGNED${RESET}"
