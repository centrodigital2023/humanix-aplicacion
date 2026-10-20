#!/usr/bin/env bash
# Prueba 20261020150000_referrals_security.sql sobre la RÉPLICA de producción: código propio, uso del código con auth.uid(), filas de solo
# lectura y recompensa con mp_subscriptions (escenario «producción», donde referrals no existe); y la conversión donde ya se aplicó el
# diseño anterior 20260606000001 (escenario «diseño anterior»).
# ⚠️  SOLO para un PostgreSQL DESECHABLE: crea y BORRA hx_replica_base (si no existe), hx_referrals y hx_referrals_legacy. Nunca contra Lovable Cloud.
#   HX_TEST_CONFIRM=desechable supabase/e2e/referrals/run.sh   (como usuario postgres del sistema o con PGHOST/PGUSER)
# HX_MIGRATION=/ruta.sql prueba un «mutante» de la migración. HX_SKIP_BASE=1 reutiliza hx_replica_base si ya existe.
set -euo pipefail
[ "${HX_TEST_CONFIRM:-}" = "desechable" ] || { echo "Define HX_TEST_CONFIRM=desechable (solo en un Postgres de pruebas)." >&2; exit 2; }
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
MIGS="$REPO/supabase/migrations"
MIG="${HX_MIGRATION:-$MIGS/20261020150000_referrals_security.sql}"
OLD="$MIGS/20260606000001_referrals.sql"
HELPERS="$REPO/supabase/e2e/clinical_scope/helpers.sql"
FAILED=0
newdb() { psql -q -d postgres -c "DROP DATABASE IF EXISTS $1" -c "CREATE DATABASE $1 ${2:+TEMPLATE $2}" >/dev/null; }

if [ "${HX_SKIP_BASE:-}" = "1" ] && [ "$(psql -Atq -d postgres -c "SELECT count(*) FROM pg_database WHERE datname = 'hx_replica_base'")" = "1" ]; then
  echo "[referrals] reutilizando hx_replica_base"
else
  echo "[referrals] cargando la réplica de producción y su cadena…"
  HX_ONLY_LOAD=1 "$REPO/supabase/e2e/prod_replica/run.sh" >/dev/null
fi

run_scenario() {
  local label=$1 db=$2 file=$3 out line
  newdb "$db" hx_replica_base
  echo "── Escenario «$label»"
  out=$(psql -v ON_ERROR_STOP=1 -d "$db" -v HELPERS="$HELPERS" -v MIG="$MIG" -v OLD="$OLD" -f "$HERE/$file" 2>&1 | grep -v '^$') || { echo "$out"; FAILED=1; return; }
  echo "$out" | grep -v -E '^(NOTICE|psql:.*NOTICE)' || true
  line=$(echo "$out" | grep -E '^[0-9]+\|[0-9]+\|[0-9]+$' | tail -1)
  { [ -n "$line" ] && [ "$(echo "$line" | cut -d'|' -f2)" = "0" ]; } || FAILED=1
}

run_scenario "producción (sin referidos todavía)" hx_referrals scenario.sql
run_scenario "diseño anterior ya aplicado" hx_referrals_legacy scenario_legacy.sql
if [ "$FAILED" = "0" ]; then echo "[referrals] TODO BIEN"; else echo "[referrals] HAY FALLOS"; exit 1; fi
