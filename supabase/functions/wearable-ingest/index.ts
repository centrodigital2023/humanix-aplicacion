// Recibe lecturas normalizadas de wearables (enviadas por la app móvil de
// Humanix o por un agregador como Open Wearables) y las inserta en
// vital_signs_readings usando el código de emparejamiento (external_user_id)
// guardado en wearable_connections para resolver el paciente.
//
// Autenticación: secreto compartido comparado en tiempo constante contra
// WEARABLE_INGEST_SECRET.
//
// Una vez insertadas las filas, el frontend recibe la actualización vía
// Supabase Realtime (la tabla vital_signs_readings tiene REPLICA IDENTITY FULL
// y está en la publicación supabase_realtime).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { buildCorsHeaders } from "../_shared/auth.ts";

const INGEST_SECRET = Deno.env.get("WEARABLE_INGEST_SECRET") ?? "";

// Mapea provider al valor permitido en vital_signs_readings.source
const DEVICE_SOURCE: Record<string, string> = {
  apple_healthkit:      "apple_healthkit",
  google_health_connect:"google_health_connect",
  garmin:               "wearable",
  fitbit:               "wearable",
  oura:                 "wearable",
  whoop:                "wearable",
  polar:                "wearable",
  samsung_health:       "wearable",
};

// Tipos válidos según el CHECK constraint actualizado en vital_signs_readings
const VALID_TYPES = new Set([
  "heart_rate", "spo2", "temperature",
  "blood_pressure_sys", "blood_pressure_dia",
  "respiration_rate", "respiratory_rate",
  "steps", "fall_detected", "glucose", "weight",
]);

interface Reading {
  type?: string;
  value?: number;
  unit?: string;
  recorded_at?: string;
  value_secondary?: number;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (!INGEST_SECRET || !timingSafeEqual(req.headers.get("x-wearable-secret") ?? "", INGEST_SECRET)) {
    return new Response(JSON.stringify({ error: "No autorizado" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json();
    const provider: string = body?.provider;
    const externalUserId: string = body?.external_user_id;
    const deviceName: string | undefined = body?.device_name;
    const readings: Reading[] = Array.isArray(body?.readings) ? body.readings : [];

    if (!provider || !externalUserId || readings.length === 0) {
      return new Response(JSON.stringify({
        error: "Payload inválido: provider, external_user_id y readings son requeridos",
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolver paciente desde el código de emparejamiento
    const { data: connection } = await supabase
      .from("wearable_connections")
      .select("id, patient_id, status")
      .eq("provider", provider)
      .eq("external_user_id", externalUserId)
      .maybeSingle();

    if (!connection) {
      return new Response(JSON.stringify({ skipped: true, reason: "conexión no encontrada" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (connection.status !== "active") {
      return new Response(JSON.stringify({ skipped: true, reason: "conexión inactiva" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const deviceSource = DEVICE_SOURCE[provider] ?? "wearable";

    // Construir filas para vital_signs_readings
    const rows = readings
      .filter((r) =>
        r.type &&
        VALID_TYPES.has(r.type) &&
        typeof r.value === "number" &&
        Number.isFinite(r.value),
      )
      .map((r) => ({
        family_user_id:  connection.patient_id,
        reading_type:    r.type,
        value:           r.value,
        value_secondary: r.value_secondary ?? null,
        unit:            r.unit ?? "",
        source:          deviceSource,
        severity:        "normal",    // el frontend recalcula según umbrales
        recorded_at:     r.recorded_at ?? new Date().toISOString(),
      }));

    if (rows.length === 0) {
      return new Response(JSON.stringify({ skipped: true, reason: "sin lecturas válidas" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: insertError } = await supabase
      .from("vital_signs_readings")
      .insert(rows);

    if (insertError) throw insertError;

    // Actualizar marca de último sync en wearable_connections
    await supabase
      .from("wearable_connections")
      .update({
        last_synced_at: new Date().toISOString(),
        ...(deviceName ? { device_name: deviceName } : {}),
        last_error:  null,
        updated_at:  new Date().toISOString(),
      })
      .eq("id", connection.id);

    return new Response(JSON.stringify({ ok: true, inserted: rows.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[wearable-ingest]", e);
    return new Response(JSON.stringify({ error: "Error interno" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
