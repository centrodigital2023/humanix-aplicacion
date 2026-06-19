/**
 * HealthKitService — Servicio de integración con Apple HealthKit y Google Health Connect
 *
 * IMPORTANTE: Este archivo está diseñado para la app móvil React Native de Humanix.
 * En la web, los datos llegan al backend (wearable-ingest) directamente desde el
 * dispositivo móvil y se muestran en tiempo real via Supabase Realtime.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CONFIGURACIÓN NATIVA REQUERIDA (antes de compilar)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * iOS (Apple HealthKit):
 *   1. En ios/Humanix/Info.plist añade:
 *      <key>NSHealthShareUsageDescription</key>
 *      <string>Humanix necesita acceder a tus signos vitales para que tu médico
 *      y familiares puedan monitorear tu salud en tiempo real.</string>
 *      <key>NSHealthUpdateUsageDescription</key>
 *      <string>Humanix requiere permisos para registrar métricas de salud en tu dispositivo.</string>
 *   2. En Xcode → Signing & Capabilities → + Capability → HealthKit
 *   Librería: npm install react-native-health
 *
 * Android (Google Health Connect):
 *   En android/app/src/main/AndroidManifest.xml dentro de <manifest>:
 *   <uses-permission android:name="android.permission.health.READ_HEART_RATE"/>
 *   <uses-permission android:name="android.permission.health.READ_OXYGEN_SATURATION"/>
 *   <uses-permission android:name="android.permission.health.READ_STEPS"/>
 *   <queries>
 *     <package android:name="com.google.android.apps.healthdata" />
 *   </queries>
 *   Librería: npm install react-native-health-connect
 *   Nota: Health Connect viene integrado de forma nativa en Android 14+.
 *         En Android 12-13 es descargable desde Play Store.
 * ════════════════════════════════════════════════════════════════════════════
 */

// Estas importaciones son exclusivas del entorno React Native móvil.
// En el bundle web se excluyen mediante el campo "react-native" de package.json.
// import { Platform } from 'react-native';
// import AppleHealthKit from 'react-native-health';
// import { initialize, requestPermission, readRecords } from 'react-native-health-connect';

// ─── Tipos compartidos ────────────────────────────────────────────────────────

export interface VitalSample {
  value: number;
  date: string;        // ISO 8601
}

export interface PatientVitalSigns {
  heartRate:         VitalSample[];
  oxygenSaturation:  VitalSample[];
  steps:             number;
  timestamp:         string;
}

/** Payload normalizado para el endpoint wearable-ingest de Humanix */
export interface WearableIngestPayload {
  provider:          string;
  external_user_id:  string;   // código de emparejamiento generado en la web
  device_name?:      string;
  readings: Array<{
    type:        string;
    value:       number;
    unit:        string;
    recorded_at: string;
  }>;
}

// ─── Configuración de permisos iOS ───────────────────────────────────────────

/**
 * Permisos que Humanix solicita a Apple HealthKit.
 * Adaptar según las métricas que se quieran monitorear.
 *
 * const permissionsiOS = {
 *   permissions: {
 *     read: [
 *       AppleHealthKit.Constants.Permissions.HeartRate,
 *       AppleHealthKit.Constants.Permissions.OxygenSaturation,
 *       AppleHealthKit.Constants.Permissions.Steps,
 *     ],
 *   },
 * };
 */

// ─── requestHealthPermissions ─────────────────────────────────────────────────

/**
 * Inicializa el SDK de salud y solicita permisos al usuario.
 * Retorna true si se otorgaron permisos mínimos requeridos.
 *
 * Uso en React Native:
 *
 * import { Platform } from 'react-native';
 * import AppleHealthKit from 'react-native-health';
 * import { initialize, requestPermission } from 'react-native-health-connect';
 *
 * export async function requestHealthPermissions(): Promise<boolean> {
 *   if (Platform.OS === 'ios') {
 *     return new Promise((resolve, reject) => {
 *       AppleHealthKit.initHealthKit(permissionsiOS, (error) => {
 *         if (error) { console.error('[HealthKit] Error de inicialización:', error); reject(false); }
 *         resolve(true);
 *       });
 *     });
 *   }
 *
 *   if (Platform.OS === 'android') {
 *     const isInitialized = await initialize();
 *     if (!isInitialized) return false;
 *     const granted = await requestPermission([
 *       { recordType: 'HeartRate' },
 *       { recordType: 'OxygenSaturation' },
 *       { recordType: 'Steps' },
 *     ]);
 *     return granted.length > 0;
 *   }
 *
 *   return false;
 * }
 */
export async function requestHealthPermissions(): Promise<boolean> {
  // Stub web — la plataforma web no accede directamente a HealthKit/Health Connect.
  // En el entorno móvil, este método se reemplaza por la implementación nativa anterior.
  console.warn(
    "[HealthKitService] requestHealthPermissions: ejecutando en entorno web. " +
    "Usar la versión React Native para acceso nativo a HealthKit / Health Connect."
  );
  return false;
}

// ─── fetchPatientVitalSigns ───────────────────────────────────────────────────

/**
 * Lee los signos vitales de las últimas 24 horas desde el repositorio nativo
 * del teléfono (Apple Health o Google Health Connect).
 *
 * Implementación React Native:
 *
 * export async function fetchPatientVitalSigns(): Promise<PatientVitalSigns> {
 *   const end   = new Date();
 *   const start = new Date(Date.now() - 24 * 60 * 60 * 1000);
 *   const data: PatientVitalSigns = { heartRate: [], oxygenSaturation: [], steps: 0, timestamp: end.toISOString() };
 *
 *   // ── iOS ──────────────────────────────────────────────────────────────────
 *   if (Platform.OS === 'ios') {
 *     return new Promise((resolve) => {
 *       const options = { startDate: start.toISOString(), endDate: end.toISOString() };
 *
 *       AppleHealthKit.getHeartRateSamples(options, (err, results) => {
 *         if (!err && results)
 *           data.heartRate = results.map(r => ({ value: r.value, date: r.startDate }));
 *
 *         AppleHealthKit.getOxygenSaturationSamples(options, (errOS, resultsOS) => {
 *           if (!errOS && resultsOS)
 *             data.oxygenSaturation = resultsOS.map(r => ({ value: r.value * 100, date: r.startDate }));
 *
 *           AppleHealthKit.getStepCount(options, (errSteps, resultsSteps) => {
 *             if (!errSteps && resultsSteps) data.steps = resultsSteps.value;
 *             resolve(data);
 *           });
 *         });
 *       });
 *     });
 *   }
 *
 *   // ── Android ──────────────────────────────────────────────────────────────
 *   if (Platform.OS === 'android') {
 *     const timeRange = {
 *       timeRangeFilter: { operator: 'between', startTime: start.toISOString(), endTime: end.toISOString() },
 *     };
 *
 *     const heartRecords = await readRecords('HeartRate', timeRange);
 *     data.heartRate = heartRecords.flatMap(record =>
 *       record.samples.map(s => ({ value: s.beatsPerMinute, date: s.time }))
 *     );
 *
 *     const oxygenRecords = await readRecords('OxygenSaturation', timeRange);
 *     data.oxygenSaturation = oxygenRecords.map(r => ({ value: r.percentage, date: r.time }));
 *
 *     const stepRecords = await readRecords('Steps', timeRange);
 *     data.steps = stepRecords.reduce((sum, record) => sum + record.count, 0);
 *   }
 *
 *   return data;
 * }
 */
export async function fetchPatientVitalSigns(): Promise<PatientVitalSigns> {
  return {
    heartRate:        [],
    oxygenSaturation: [],
    steps:            0,
    timestamp:        new Date().toISOString(),
  };
}

// ─── buildIngestPayload ───────────────────────────────────────────────────────

/**
 * Construye el payload normalizado para enviar al endpoint wearable-ingest.
 * Compatible tanto con datos de HealthKit/Health Connect como con lecturas manuales.
 */
export function buildIngestPayload(
  vitals:     PatientVitalSigns,
  provider:   string,
  pairingCode: string,
  deviceName?: string,
): WearableIngestPayload {
  const readings: WearableIngestPayload["readings"] = [];

  // Frecuencia cardíaca — usamos la última muestra disponible
  const lastHR = vitals.heartRate.at(-1);
  if (lastHR) {
    readings.push({
      type:        "heart_rate",
      value:       Math.round(lastHR.value),
      unit:        "lpm",
      recorded_at: lastHR.date,
    });
  }

  // Saturación de oxígeno
  const lastSPO2 = vitals.oxygenSaturation.at(-1);
  if (lastSPO2) {
    readings.push({
      type:        "spo2",
      value:       Math.round(lastSPO2.value * 10) / 10,
      unit:        "%",
      recorded_at: lastSPO2.date,
    });
  }

  // Pasos diarios
  if (vitals.steps > 0) {
    readings.push({
      type:        "steps",
      value:       vitals.steps,
      unit:        "pasos",
      recorded_at: vitals.timestamp,
    });
  }

  return {
    provider,
    external_user_id: pairingCode,
    ...(deviceName ? { device_name: deviceName } : {}),
    readings,
  };
}

// ─── syncVitalsToHumanix ──────────────────────────────────────────────────────

/**
 * Lee los vitales del dispositivo y los envía al backend de Humanix.
 *
 * Úsalo en un componente React Native con el código de emparejamiento
 * generado en el portal web Humanix (sección Wearables → QR).
 *
 * @example
 * // En la app móvil Humanix (React Native):
 * const success = await syncVitalsToHumanix({
 *   pairingCode: 'ABCD1234',
 *   provider: 'apple_healthkit',
 *   apiUrl: 'https://tu-proyecto.supabase.co/functions/v1/wearable-ingest',
 *   ingestSecret: process.env.WEARABLE_INGEST_SECRET,
 * });
 */
export async function syncVitalsToHumanix({
  pairingCode,
  provider,
  apiUrl,
  ingestSecret,
  deviceName,
}: {
  pairingCode:   string;
  provider:      string;
  apiUrl:        string;
  ingestSecret:  string;
  deviceName?:   string;
}): Promise<{ ok: boolean; inserted?: number; error?: string }> {
  try {
    const hasPermission = await requestHealthPermissions();
    if (!hasPermission) {
      return { ok: false, error: "Permisos de salud no otorgados" };
    }

    const vitals  = await fetchPatientVitalSigns();
    const payload = buildIngestPayload(vitals, provider, pairingCode, deviceName);

    if (payload.readings.length === 0) {
      return { ok: false, error: "Sin datos de vitales disponibles" };
    }

    const response = await fetch(apiUrl, {
      method:  "POST",
      headers: {
        "Content-Type":       "application/json",
        "x-wearable-secret":  ingestSecret,
      },
      body: JSON.stringify(payload),
    });

    const json = await response.json();
    if (!response.ok) {
      return { ok: false, error: json?.error ?? `Error HTTP ${response.status}` };
    }

    return { ok: true, inserted: json?.inserted };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    console.error("[HealthKitService] syncVitalsToHumanix:", message);
    return { ok: false, error: message };
  }
}
