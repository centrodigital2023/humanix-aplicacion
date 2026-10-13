#!/usr/bin/env bash
# Prueba 20261012160000_sos_familiar.sql sobre la RÉPLICA de producción, con el DDL real de clinical_alerts (drizzle/0007) y la migración
# de datos de salud (20261012150000) ya aplicada: tal como está producción hoy.
# ⚠️  SOLO para un PostgreSQL DESECHABLE: crea y BORRA hx_replica_base (si no existe), hx_sos_prod y hx_sos_fresh. Nunca contra Lovable Cloud.
#   HX_TEST_CONFIRM=desechable supabase/e2e/sos/run.sh   (como usuario postgres del sistema o con PGHOST/PGUSER)
# HX_MIGRATION=/ruta.sql (SOS) y HX_MIGRATION2=/ruta.sql (lista de alertas) prueban un cambio deliberado («mutante»).
# HX_SKIP_BASE=1 reutiliza hx_replica_base si ya existe.
set -euo pipefail
[ "${HX_TEST_CONFIRM:-}" = "desechable" ] || { echo "Define HX_TEST_CONFIRM=desechable (solo en un Postgres de pruebas)." >&2; exit 2; }
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
REPLICA="$REPO/supabase/e2e/prod_replica"
MIG="$REPO/supabase/migrations"
TARGET="${HX_MIGRATION:-$MIG/20261012160000_sos_familiar.sql}"
FEED="${HX_MIGRATION2:-$MIG/20261012170000_sos_feed.sql}"
HEALTH="$MIG/20261012150000_health_data_access.sql"
P="psql -v ON_ERROR_STOP=1 -q"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
FAILED=0
newdb() { psql -q -d postgres -c "DROP DATABASE IF EXISTS $1" -c "CREATE DATABASE $1 ${2:+TEMPLATE $2}" >/dev/null; }

if [ "${HX_SKIP_BASE:-}" = "1" ] && [ "$(psql -Atq -d postgres -c "SELECT count(*) FROM pg_database WHERE datname = 'hx_replica_base'")" = "1" ]; then
  echo "[sos] reutilizando hx_replica_base"
else
  echo "[sos] cargando la réplica de producción y su cadena…"
  HX_ONLY_LOAD=1 "$REPLICA/run.sh" >/dev/null
fi

# DDL real de producción de las tres tablas de salud (extraído de los archivos que las crearon allí).
{
  sed -n '/^CREATE TABLE IF NOT EXISTS public.clinical_alerts/,/^  WITH CHECK (patient_id = auth.uid() OR public.is_staff(auth.uid()));$/p' "$REPO/drizzle/migrations/0007_foundation_care_logs_alerts_credits.sql"
  sed -n '/^CREATE TABLE public.vital_signs_readings/,/^CREATE INDEX idx_vs_severity/p' "$MIG/20260601145427_d7c7a2ca-0e67-47da-8dac-5b4f7c439f88.sql" | grep -v -E "^ALTER PUBLICATION|^ALTER TABLE .* REPLICA IDENTITY"
  sed -n '/^CREATE TABLE IF NOT EXISTS public.wearable_connections/,/^  USING (patient_id = auth.uid() OR public.is_staff(auth.uid()));$/p' "$MIG/20260618211526_81813377-8fcc-4180-ac08-82eff344e61e.sql"
} >"$TMP/prod_health.sql"
[ "$(grep -c 'CREATE POLICY' "$TMP/prod_health.sql")" = "10" ] || { echo "No se pudo extraer el DDL de producción (políticas: $(grep -c 'CREATE POLICY' "$TMP/prod_health.sql"))"; exit 1; }

run_scenario() {
  local label=$1 db=$2 file=$3 out
  echo "── Escenario «$label»"
  out=$(psql -v ON_ERROR_STOP=1 -d "$db" -v HELPERS="$REPO/supabase/e2e/clinical_scope/helpers.sql" -v MIG="$TARGET" -v MIG2="$FEED" -f "$HERE/$file" 2>&1 | grep -v '^$') || { echo "$out"; FAILED=1; return; }
  echo "$out" | grep -v -E '^(NOTICE|psql:.*NOTICE)' || true
  local line; line=$(echo "$out" | grep -E '^[0-9]+\|[0-9]+\|[0-9]+$' | tail -1)
  [ -n "$line" ] && [ "$(echo "$line" | cut -d'|' -f2)" = "0" ] || FAILED=1
}

# Producción hoy: tablas de salud con el DDL real + la migración de salud ya aplicada.
newdb hx_sos_prod hx_replica_base
$P -d hx_sos_prod -c "CREATE EXTENSION IF NOT EXISTS pgcrypto" >/dev/null
$P -d hx_sos_prod -f "$TMP/prod_health.sql" >/dev/null
$P -d hx_sos_prod -f "$HEALTH" >/dev/null
run_scenario "producción hoy: el SOS no puede enviarse → SOS completo" hx_sos_prod scenario.sql
# Base sin tablas de salud: no hace nada.
newdb hx_sos_fresh hx_replica_base
run_scenario "base sin clinical_alerts: no hace nada" hx_sos_fresh scenario_fresh.sql
if [ "$FAILED" = "0" ]; then echo "[sos] TODO BIEN"; else echo "[sos] HAY FALLOS"; exit 1; fi
