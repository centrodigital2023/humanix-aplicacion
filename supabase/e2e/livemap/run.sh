#!/usr/bin/env bash
# Prueba 20261012210000_live_map.sql sobre la RÉPLICA de producción: presencia sin GPS exacto, contadores reales (disponible / en vivo /
# ocupado), pines por rol sin datos de contacto, avisos en vivo y permisos. Incluye la mejora de una tabla de presencia ANTIGUA (la de
# la migración 20260610040000, legible por anónimos con el GPS exacto).
# ⚠️  SOLO para un PostgreSQL DESECHABLE: crea y BORRA hx_replica_base (si no existe), hx_livemap y hx_livemap_up. Nunca contra Lovable Cloud.
#   HX_TEST_CONFIRM=desechable supabase/e2e/livemap/run.sh   (como usuario postgres del sistema o con PGHOST/PGUSER)
# HX_MIGRATION=/ruta.sql prueba un «mutante» de la migración. HX_SKIP_BASE=1 reutiliza hx_replica_base si ya existe.
set -euo pipefail
[ "${HX_TEST_CONFIRM:-}" = "desechable" ] || { echo "Define HX_TEST_CONFIRM=desechable (solo en un Postgres de pruebas)." >&2; exit 2; }
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
MIGS="$REPO/supabase/migrations"
MIG="${HX_MIGRATION:-$MIGS/20261012210000_live_map.sql}"
# Lo que ya está en producción cuando llega esta migración (en orden): moderación, avisos/planes y PQRS propias.
PRE=("$MIGS/20261012180000_offer_moderation.sql" "$MIGS/20261012190000_offer_alerts_and_plans.sql" "$MIGS/20261012200000_pqrs_my_tickets.sql")
FAILED=0
newdb() { psql -q -d postgres -c "DROP DATABASE IF EXISTS $1" -c "CREATE DATABASE $1 ${2:+TEMPLATE $2}" >/dev/null; }

if [ "${HX_SKIP_BASE:-}" = "1" ] && [ "$(psql -Atq -d postgres -c "SELECT count(*) FROM pg_database WHERE datname = 'hx_replica_base'")" = "1" ]; then
  echo "[livemap] reutilizando hx_replica_base"
else
  echo "[livemap] cargando la réplica de producción y su cadena…"
  HX_ONLY_LOAD=1 "$REPO/supabase/e2e/prod_replica/run.sh" >/dev/null
fi

prepare() {
  newdb "$1" hx_replica_base
  for f in "${PRE[@]}"; do
    psql -v ON_ERROR_STOP=1 -q -d "$1" -f "$f" >/dev/null 2>&1 || { echo "FALLÓ la migración previa $(basename "$f") sobre la réplica"; FAILED=1; return 1; }
  done
}
run_scenario() {
  local label=$1 db=$2 file=$3 out
  echo "── Escenario «$label»"
  out=$(psql -v ON_ERROR_STOP=1 -d "$db" -v HELPERS="$REPO/supabase/e2e/clinical_scope/helpers.sql" -v MIG="$MIG" -f "$HERE/$file" 2>&1 | grep -v '^$') || { echo "$out"; FAILED=1; return; }
  echo "$out" | grep -v -E '^(NOTICE|psql:.*NOTICE)' || true
  local line; line=$(echo "$out" | grep -E '^[0-9]+\|[0-9]+\|[0-9]+$' | tail -1)
  [ -n "$line" ] && [ "$(echo "$line" | cut -d'|' -f2)" = "0" ] || FAILED=1
}

if prepare hx_livemap; then run_scenario "mapas en vivo y contadores" hx_livemap scenario.sql; fi
if [ -f "$HERE/scenario_upgrade.sql" ] && prepare hx_livemap_up; then run_scenario "mejora de la tabla de presencia antigua" hx_livemap_up scenario_upgrade.sql; fi
if [ "$FAILED" = "0" ]; then echo "[livemap] TODO BIEN"; else echo "[livemap] HAY FALLOS"; exit 1; fi
