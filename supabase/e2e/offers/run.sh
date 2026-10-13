#!/usr/bin/env bash
# Pruebas de las migraciones de ofertas (moderación, avisos de nuevas ofertas, negociación según el plan, Trust Score) sobre la
# RÉPLICA de producción: cada escenario carga lo que cargó el anterior y aplica SU migración dentro del escenario (antes / después).
# ⚠️  SOLO para un PostgreSQL DESECHABLE: crea y BORRA hx_replica_base (si no existe) y hx_offers_*. Nunca contra Lovable Cloud.
#   HX_TEST_CONFIRM=desechable supabase/e2e/offers/run.sh   (como usuario postgres del sistema o con PGHOST/PGUSER)
# HX_MIGRATION_<N>=/ruta.sql prueba un «mutante» de la migración N (1 = moderación, 2 = avisos y planes). HX_ONLY=moderation|alerts.
# HX_SKIP_BASE=1 reutiliza hx_replica_base si ya existe.
set -euo pipefail
[ "${HX_TEST_CONFIRM:-}" = "desechable" ] || { echo "Define HX_TEST_CONFIRM=desechable (solo en un Postgres de pruebas)." >&2; exit 2; }
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
REPLICA="$REPO/supabase/e2e/prod_replica"
MIG="$REPO/supabase/migrations"
M1="${HX_MIGRATION_1:-$MIG/20261012180000_offer_moderation.sql}"
M2="${HX_MIGRATION_2:-$MIG/20261012190000_offer_alerts_and_plans.sql}"
FAILED=0
newdb() { psql -q -d postgres -c "DROP DATABASE IF EXISTS $1" -c "CREATE DATABASE $1 ${2:+TEMPLATE $2}" >/dev/null; }

if [ "${HX_SKIP_BASE:-}" = "1" ] && [ "$(psql -Atq -d postgres -c "SELECT count(*) FROM pg_database WHERE datname = 'hx_replica_base'")" = "1" ]; then
  echo "[offers] reutilizando hx_replica_base"
else
  echo "[offers] cargando la réplica de producción y su cadena…"
  HX_ONLY_LOAD=1 "$REPLICA/run.sh" >/dev/null
fi

run_scenario() {
  local label=$1 db=$2 file=$3 out
  echo "── Escenario «$label»"
  out=$(psql -v ON_ERROR_STOP=1 -d "$db" -v HELPERS="$REPO/supabase/e2e/clinical_scope/helpers.sql" -v M1="$M1" -v M2="$M2" -f "$HERE/$file" 2>&1 | grep -v '^$') || { echo "$out"; FAILED=1; return; }
  echo "$out" | grep -v -E '^(NOTICE|psql:.*NOTICE)' || true
  local line; line=$(echo "$out" | grep -E '^[0-9]+\|[0-9]+\|[0-9]+$' | tail -1)
  [ -n "$line" ] && [ "$(echo "$line" | cut -d'|' -f2)" = "0" ] || FAILED=1
}

ONLY="${HX_ONLY:-all}"
if [ "$ONLY" = "all" ] || [ "$ONLY" = "moderation" ]; then
  newdb hx_offers_mod hx_replica_base
  run_scenario "moderación de ofertas" hx_offers_mod scenario_moderation.sql
fi
if { [ "$ONLY" = "all" ] || [ "$ONLY" = "alerts" ]; } && [ -f "$HERE/scenario_alerts.sql" ] && [ -f "$M2" ]; then
  newdb hx_offers_alerts hx_replica_base
  # La moderación ya está aplicada cuando llegan los avisos (producción hoy).
  if psql -v ON_ERROR_STOP=1 -q -d hx_offers_alerts -f "$M1" >/dev/null 2>&1; then
    run_scenario "avisos de nuevas ofertas, planes y Trust Score" hx_offers_alerts scenario_alerts.sql
  else
    echo "FALLÓ la migración de moderación sobre la réplica"; FAILED=1
  fi
fi
if [ "$FAILED" = "0" ]; then echo "[offers] TODO BIEN"; else echo "[offers] HAY FALLOS"; exit 1; fi
