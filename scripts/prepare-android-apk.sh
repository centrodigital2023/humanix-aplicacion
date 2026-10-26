#!/usr/bin/env bash
# Prepara un proyecto Android (Capacitor) mínimo en ./apk-build para compilar la APK pública.
# Solo instala los paquetes @capacitor/*: la APK carga https://humanix.lat (CAP_SERVER_URL),
# así que no hace falta compilar la web ni instalar el resto de dependencias.
#
# Uso: VERSION_CODE=12 VERSION_NAME=1.0.12 bash scripts/prepare-android-apk.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/apk-build"
export CAP_SERVER_URL="${CAP_SERVER_URL:-https://humanix.lat}"
VERSION_CODE="${VERSION_CODE:-1}"
VERSION_NAME="${VERSION_NAME:-1.0.$VERSION_CODE}"

rm -rf "$OUT"
mkdir -p "$OUT/dist"
cp "$ROOT/capacitor.config.ts" "$OUT/"
cp -r "$ROOT/resources" "$OUT/"
# webDir de respaldo: la app real se carga desde CAP_SERVER_URL.
printf '<!doctype html><meta http-equiv="refresh" content="0;url=%s">\n' "$CAP_SERVER_URL" > "$OUT/dist/index.html"

node -e '
  const pkg = require(process.argv[1]);
  const all = { ...pkg.dependencies, ...pkg.devDependencies };
  const deps = Object.fromEntries(Object.entries(all).filter(([n]) => n.startsWith("@capacitor/")));
  deps.typescript = all.typescript ?? "^5.8.3";
  require("fs").writeFileSync(process.argv[2], JSON.stringify({ name: "humanix-apk", private: true, dependencies: deps }, null, 2));
' "$ROOT/package.json" "$OUT/package.json"

cd "$OUT"
npm install --no-audit --no-fund --loglevel=error
npx cap add android

# Íconos y splash a partir de resources/icon.png y resources/splash.png.
npx --yes @capacitor/assets@3 generate --android \
  --iconBackgroundColor '#ffffff' --iconBackgroundColorDark '#ffffff' \
  --splashBackgroundColor '#ffffff' --splashBackgroundColorDark '#ffffff'

# Permisos que usa Humanix (ubicación para visitas/SOS y notificaciones).
MANIFEST=android/app/src/main/AndroidManifest.xml
for perm in ACCESS_FINE_LOCATION ACCESS_COARSE_LOCATION POST_NOTIFICATIONS; do
  grep -q "android.permission.$perm" "$MANIFEST" ||
    sed -i "s#</manifest>#    <uses-permission android:name=\"android.permission.$perm\" />\n</manifest>#" "$MANIFEST"
done

# Versión: cada compilación sube el versionCode para que la APK nueva actualice la anterior.
GRADLE=android/app/build.gradle
sed -i -E "s/versionCode [0-9]+/versionCode $VERSION_CODE/; s/versionName \"[^\"]*\"/versionName \"$VERSION_NAME\"/" "$GRADLE"

npx cap sync android
echo "Proyecto Android listo en $OUT/android (servidor: $CAP_SERVER_URL, versión $VERSION_NAME/$VERSION_CODE)"
