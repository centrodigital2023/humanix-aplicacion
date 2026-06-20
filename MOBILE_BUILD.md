# Humanix · Compilar app nativa (Android + iOS)

Humanix usa **Capacitor** para envolver la app web en binarios nativos.
La compilación se hace **en tu máquina local** (no en Lovable), porque
necesita Android Studio / Xcode.

---

## 1. Requisitos en tu máquina

| Plataforma | Necesitas |
|------------|-----------|
| Android    | [Android Studio](https://developer.android.com/studio) + JDK 17 |
| iOS        | macOS + [Xcode](https://developer.apple.com/xcode/) + cuenta Apple Developer (USD 99/año para publicar) |
| Ambos      | Node 20+ y [Bun](https://bun.sh) |

Cuenta Google Play Developer: USD 25 (pago único).

---

## 2. Primer setup (solo una vez)

```bash
# 1. Exporta el proyecto a GitHub desde Lovable (botón "GitHub" arriba a la derecha)
# 2. Clónalo y entra
git clone <tu-repo>
cd humanix

# 3. Instala dependencias
bun install

# 4. Genera el build web
bun run build

# 5. Agrega las plataformas nativas
npx cap add android
npx cap add ios          # solo si estás en macOS

# 6. Sincroniza el código web + plugins nativos
npx cap sync
```

Después de cada `git pull` con cambios web:

```bash
bun run build && npx cap sync
```

---

## 3. Desarrollo con hot reload (preview de Lovable)

`capacitor.config.ts` ya apunta `server.url` al preview de Lovable, así que
puedes ejecutar la app en tu teléfono y ver cambios en vivo sin recompilar:

```bash
npx cap run android   # con un emulador o teléfono conectado por USB
npx cap run ios       # con un simulador
```

---

## 4. Compilar versión de producción

1. **Comenta el bloque `server` completo** en `capacitor.config.ts` para
   que la app cargue el bundle local (`dist/`) en lugar del preview.
2. Ejecuta:
   ```bash
   bun run build
   npx cap sync
   ```
3. Abre el proyecto nativo:
   ```bash
   npx cap open android   # Android Studio
   npx cap open ios       # Xcode
   ```
4. Desde Android Studio: **Build → Generate Signed Bundle / APK → Android App Bundle**.
   Desde Xcode: **Product → Archive → Distribute App**.

---

## 5. Permisos nativos requeridos

### Android (`android/app/src/main/AndroidManifest.xml`)

Agrega dentro de `<manifest>` (Capacitor inserta los básicos al hacer `cap sync`,
estos son los específicos de Humanix):

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
```

### iOS (`ios/App/App/Info.plist`)

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>Humanix usa tu ubicación para coordinar visitas y enviar alertas SOS al equipo de cuidado.</string>
<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>Humanix necesita acceso a tu ubicación incluso en segundo plano para enviar alertas SOS aunque la app esté cerrada.</string>
<key>UIBackgroundModes</key>
<array>
  <string>location</string>
  <string>fetch</string>
  <string>remote-notification</string>
</array>
```

---

## 6. Push notifications (Firebase Cloud Messaging)

Las alertas clínicas y SOS actualmente salen por WhatsApp Cloud API. Para
recibirlas como notificación push nativa además, configura FCM:

### Android
1. Crea un proyecto en <https://console.firebase.google.com>.
2. **Add app → Android**, usa el `appId` `lat.humanix.app`.
3. Descarga `google-services.json` y colócalo en `android/app/`.
4. Sigue los pasos del plugin: <https://capacitorjs.com/docs/apis/push-notifications#android>

### iOS
1. En el mismo proyecto Firebase, **Add app → iOS**.
2. Descarga `GoogleService-Info.plist` y arrástralo a Xcode dentro de `App/App/`.
3. Habilita **Push Notifications** y **Background Modes → Remote notifications** en *Signing & Capabilities*.
4. Sube tu **APNs Authentication Key** (.p8) en Firebase → Project Settings → Cloud Messaging.

Luego, en el código de la app, registra el token y guárdalo en Supabase
para que el backend pueda enviar push desde una edge function.

---

## 7. Deep links para Sign in with Google

Cuando el usuario inicia sesión con Google dentro del WebView, Supabase
redirige a una URL. Para que la app la capture:

### Android
En `AndroidManifest.xml`, dentro de `<activity android:name=".MainActivity">`:

```xml
<intent-filter>
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="humanix" android:host="auth" />
</intent-filter>
```

### iOS
En `Info.plist`:

```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array><string>humanix</string></array>
  </dict>
</array>
```

Y en Supabase → Authentication → URL Configuration, agrega `humanix://auth/callback`
como Redirect URL adicional.

---

## 8. Iconos y splash

Coloca un icono cuadrado de 1024×1024 en `resources/icon.png` y un splash
2732×2732 en `resources/splash.png`, luego:

```bash
bunx @capacitor/assets generate
```

---

## 9. Subir a las tiendas

- **Google Play**: <https://play.google.com/console> · sube el `.aab` firmado.
- **App Store**: <https://appstoreconnect.apple.com> · sube desde Xcode con
  *Distribute App → App Store Connect*.

Necesitarás capturas de pantalla, descripción, política de privacidad
(usa `https://humanix.lat/privacidad`) y clasificación de contenido.

---

¿Dudas? Revisa <https://capacitorjs.com/docs> o pídeme ayuda en chat.
