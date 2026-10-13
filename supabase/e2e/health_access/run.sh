#!/usr/bin/env bash
# Prueba 20261012150000_health_data_access.sql sobre la RÉPLICA de producción con el DDL real de clinical_alerts (drizzle/0007),
# vital_signs_readings y wearable_connections (migraciones de Lovable): antes (con is_staff y privilegios por defecto) y después.
# ⚠️  SOLO para un PostgreSQL DESECHABLE: crea y BORRA hx_health_base, hx_health_prod y hx_health_fresh. Nunca contra Lovable Cloud.
#   HX_TEST_CONFIRM=desechable supabase/e2e/health_access/run.sh   (como usuario postgres del sistema o con PGHOST/PGUSER)
# HX_MIGRATION=/ruta.sql prueba un cambio deliberado («mutante») de la migración.
set -euo pipefail
[ "${HX_TEST_CONFIRM:-}" = "desechable" ] || { echo "Define HX_TEST_CONFIRM=desechable (solo en un Postgres de pruebas)." >&2; exit 2; }
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
REPLICA="$REPO/supabase/e2e/prod_replica"
MIG="$REPO/supabase/migrations"
TARGET="${HX_MIGRATION:-$MIG/20261012150000_health_data_access.sql}"
P="psql -v ON_ERROR_STOP=1 -q"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
FAILED=0
newdb() { psql -q -d postgres -c "DROP DATABASE IF EXISTS $1" -c "CREATE DATABASE $1 ${2:+TEMPLATE $2}" >/dev/null; }

newdb hx_health_base
for f in 00_stubs.sql 01_schema.sql 02_functions_triggers.sql 03_policies.sql; do $P -d hx_health_base -f "$REPLICA/$f" >/dev/null; done
$P -d hx_health_base -c "CREATE EXTENSION IF NOT EXISTS pgcrypto" >/dev/null

# DDL real de producción de las tres tablas (extraído de los archivos que las crearon allí).
{
  sed -n '/^CREATE TABLE IF NOT EXISTS public.clinical_alerts/,/^  WITH CHECK (patient_id = auth.uid() OR public.is_staff(auth.uid()));$/p' "$REPO/drizzle/migrations/0007_foundation_care_logs_alerts_credits.sql"
  sed -n '/^CREATE TABLE public.vital_signs_readings/,/^CREATE INDEX idx_vs_severity/p' "$MIG/20260601145427_d7c7a2ca-0e67-47da-8dac-5b4f7c439f88.sql" | grep -v -E "^ALTER PUBLICATION|^ALTER TABLE .* REPLICA IDENTITY"
  sed -n '/^CREATE TABLE IF NOT EXISTS public.wearable_connections/,/^  USING (patient_id = auth.uid() OR public.is_staff(auth.uid()));$/p' "$MIG/20260618211526_81813377-8fcc-4180-ac08-82eff344e61e.sql"
} >"$TMP/prod_health.sql"
[ "$(grep -c 'CREATE POLICY' "$TMP/prod_health.sql")" = "10" ] || { echo "No se pudo extraer el DDL de producción (políticas: $(grep -c 'CREATE POLICY' "$TMP/prod_health.sql"))"; exit 1; }

run_scenario() {
  local label=$1 db=$2 file=$3 out
  echo "── Escenario «$label»"
  out=$(psql -v ON_ERROR_STOP=1 -d "$db" -v HELPERS="$REPO/supabase/e2e/clinical_scope/helpers.sql" -v MIG="$TARGET" -v PROD_SQL="$TMP/prod_health.sql" -f "$HERE/$file" 2>&1 | grep -v '^$') || { echo "$out"; FAILED=1; return; }
  echo "$out" | grep -v -E '^(NOTICE|psql:.*NOTICE)' || true
  local line; line=$(echo "$out" | grep -E '^[0-9]+\|[0-9]+\|[0-9]+$' | tail -1)
  [ -n "$line" ] && [ "$(echo "$line" | cut -d'|' -f2)" = "0" ] || FAILED=1
}
newdb hx_health_prod hx_health_base;  run_scenario "producción hoy: de is_staff y privilegios por defecto a superadmin y mínimo privilegio" hx_health_prod scenario_prod.sql
newdb hx_health_fresh hx_health_base; run_scenario "base sin tablas de salud: no hace nada" hx_health_fresh scenario_fresh.sql
if [ "$FAILED" = "0" ]; then echo "[health_access] TODO BIEN"; else echo "[health_access] HAY FALLOS"; exit 1; fi
