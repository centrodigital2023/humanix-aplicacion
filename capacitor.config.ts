import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Humanix — configuración Capacitor para Android e iOS.
 *
 * `server.url` apunta al preview de Lovable para desarrollo en caliente.
 * Para compilar la versión de producción (Play Store / App Store):
 *   1. Comenta o elimina el bloque `server` completo.
 *   2. Ejecuta `bun run build && npx cap sync`.
 *   3. Abre Android Studio / Xcode con `npx cap open android|ios`.
 */
const config: CapacitorConfig = {
  appId: "lat.humanix.app",
  appName: "Humanix",
  webDir: "dist",
  server: {
    url: "https://003f94c5-0e59-4dc4-9df5-3b694e43b976.lovableproject.com?forceHideBadge=true",
    cleartext: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: "#ffffff",
      showSpinner: false,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
  ios: {
    contentInset: "always",
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
