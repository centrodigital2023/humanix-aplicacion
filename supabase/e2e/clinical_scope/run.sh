#!/usr/bin/env bash
# Prueba supabase/migrations/20261012100000_clinical_data_scope.sql desde tres puntos de partida, sobre la RÉPLICA de la
# estructura real de producción (supabase/e2e/prod_replica):
#   A) cadena del repositorio, con las políticas «por rol»: la fuga existe antes, desaparece después y se conserva lo
#      legítimo; segunda pasada idempotente; y la migración FALLA (sin cambiar nada) si hay una política «por rol» que no
#      conoce.
#   B) base sin tablas clínicas: no crea ni cambia nada.
#   C) como producción hoy (solo `clinical_alerts` de drizzle/0007): no toca las políticas, solo retira privilegios.
#
# ⚠️  SOLO para un PostgreSQL DESECHABLE. Crea y BORRA las bases hx_clin_base, hx_clin_chain, hx_clin_a, hx_clin_a2,
#     hx_clin_b y hx_clin_c.
#     NUNCA lo apuntes a Supabase / Lovable Cloud ni a una base con datos reales.
#
#   HX_TEST_CONFIRM=desechable PGHOST=localhost PGPORT=5432 PGUSER=postgres supabase/e2e/clinical_scope/run.sh
#   (o, como usuario postgres del sistema, sin PGHOST: se conecta por el socket)
# Resultado esperado: cada escenario termina en «N|0|N» y el script sale con 0.
set -euo pipefail

if [ "${HX_TEST_CONFIRM:-}" != "desechable" ]; then
  echo "Este script borra y crea bases de datos. Define HX_TEST_CONFIRM=desechable (solo en un Postgres de pruebas)." >&2
  exit 2
fi

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
REPLICA="$REPO/supabase/e2e/prod_replica"
MIG="$REPO/supabase/migrations"
TARGET="${HX_MIGRATION:-$MIG/20261012100000_clinical_data_scope.sql}"   # HX_MIGRATION: solo para probar mutantes de la migración
P="psql -v ON_ERROR_STOP=1 -q"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
FAILED=0

newdb() { psql -q -d postgres -c "DROP DATABASE IF EXISTS $1" -c "CREATE DATABASE $1 ${2:+TEMPLATE $2}" >/dev/null; }

echo "[clinical_scope] base: estructura real de producción…"
newdb hx_clin_base
for f in 00_stubs.sql 01_schema.sql 02_functions_triggers.sql 03_policies.sql; do
  $P -d hx_clin_base -f "$REPLICA/$f" >/dev/null
done

echo "[clinical_scope] cadena del repositorio (políticas «por rol»)…"
newdb hx_clin_chain hx_clin_base
$P -d hx_clin_chain -c "CREATE EXTENSION IF NOT EXISTS pgcrypto" >/dev/null
for m in 20260606100000_clinical_monitoring.sql 20260606130000_fix_checkins_rls.sql \
         20260606180000_wearable_connections.sql 20260606220000_sos_familiar_alert.sql; do
  $P -d hx_clin_chain -f "$MIG/$m" >/dev/null 2>"$TMP/err" || { echo "FALLÓ $m"; cat "$TMP/err"; exit 1; }
done

# SQL de `clinical_alerts` tal como lo creó la cadena que SÍ llegó a producción (drizzle/migrations/0007).
sed -n '/^CREATE TABLE IF NOT EXISTS public.clinical_alerts/,/^  WITH CHECK (patient_id = auth.uid() OR public.is_staff(auth.uid()));$/p' \
  "$REPO/drizzle/migrations/0007_foundation_care_logs_alerts_credits.sql" >"$TMP/prod_clinical_alerts.sql"
[ "$(grep -c 'CREATE POLICY' "$TMP/prod_clinical_alerts.sql")" = "2" ] || { echo "No se pudo extraer clinical_alerts de drizzle/0007"; exit 1; }

run_scenario() {
  local label=$1 db=$2 file=$3 out
  echo "── Escenario «$label»"
  out=$(psql -v ON_ERROR_STOP=1 -d "$db" -v HELPERS="$HERE/helpers.sql" -v MIG="$TARGET" -v DRIZZLE_CLINICAL="$TMP/prod_clinical_alerts.sql" \
        -f "$HERE/$file" 2>&1 | grep -v '^$') || { echo "$out"; FAILED=1; return; }
  echo "$out" | grep -v -E '^(NOTICE|psql:.*NOTICE)' || true
  local line; line=$(echo "$out" | grep -E '^[0-9]+\|[0-9]+\|[0-9]+$' | tail -1)
  [ -n "$line" ] && [ "$(echo "$line" | cut -d'|' -f2)" = "0" ] || FAILED=1
}

newdb hx_clin_a hx_clin_chain;  run_scenario "A · cadena del repositorio: de «por rol» a «por servicio»" hx_clin_a scenario_chain.sql
newdb hx_clin_b hx_clin_base;   run_scenario "B · sin tablas clínicas: no hace nada" hx_clin_b scenario_fresh.sql
newdb hx_clin_c hx_clin_base;   run_scenario "C · como producción hoy: solo retira privilegios" hx_clin_c scenario_prod.sql

# A2 — una política «por rol» desconocida (con cada uno de los tres roles): la migración falla y NO deja cambios a medias.
for ROLE in institution professional family; do
  echo "── Escenario «A2 · política desconocida que nombra «$ROLE»: falla sin cambiar nada»"
  newdb hx_clin_a2 hx_clin_chain
  $P -d hx_clin_a2 -c "CREATE POLICY zz_wide ON public.clinical_alerts FOR SELECT USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = '$ROLE'::public.app_role))" >/dev/null
  SIG="SELECT md5(string_agg(policyname || coalesce(qual,''), '|' ORDER BY tablename, policyname)) FROM pg_policies WHERE schemaname='public' AND tablename IN ('clinical_alerts','patient_risk_scores','service_checkins','vital_signs','alert_thresholds','clinical_reports')"
  BEFORE=$(psql -At -d hx_clin_a2 -c "$SIG")
  if $P -d hx_clin_a2 -f "$TARGET" >/dev/null 2>"$TMP/err"; then
    echo "  ✗ la migración debía fallar y terminó bien"; FAILED=1
  elif ! grep -q "Quedan políticas por rol" "$TMP/err" || ! grep -q "clinical_alerts.zz_wide" "$TMP/err"; then
    echo "  ✗ falló, pero no por la razón esperada:"; cat "$TMP/err"; FAILED=1
  else
    AFTER=$(psql -At -d hx_clin_a2 -c "$SIG")
    if [ "$BEFORE" = "$AFTER" ]; then echo "  ✓ falló con el aviso esperado y no cambió ninguna política (se deshizo todo)"; else echo "  ✗ falló pero dejó cambios a medias"; FAILED=1; fi
    $P -d hx_clin_a2 -c "DROP POLICY zz_wide ON public.clinical_alerts" >/dev/null
    if $P -d hx_clin_a2 -f "$TARGET" >/dev/null 2>"$TMP/err"; then echo "  ✓ retirada la política desconocida, la migración se aplica"; else echo "  ✗ no se aplicó tras retirarla"; cat "$TMP/err"; FAILED=1; fi
  fi
done

if [ "$FAILED" = "0" ]; then echo "[clinical_scope] TODO BIEN"; else echo "[clinical_scope] HAY FALLOS"; exit 1; fi
