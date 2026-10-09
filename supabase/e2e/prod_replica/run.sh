#!/usr/bin/env bash
# Aplica las migraciones pendientes sobre una RÉPLICA de la estructura real de producción (Lovable Cloud) y corre
# los escenarios de PostgreSQL contra ella. A diferencia de los arranques «aproximados» de las otras suites, aquí
# las tablas, políticas, disparadores, funciones y privilegios por defecto son los extraídos de la base real
# (2026-10-09). Detecta deriva entre el repositorio y producción: políticas con otro nombre, objetos ausentes,
# privilegios heredados.
#
# ⚠️  SOLO para un PostgreSQL DESECHABLE. Crea y BORRA las bases hx_replica_base, hx_replica_care, hx_replica_hub,
#     hx_replica_audit y hx_replica_market.
#     NUNCA lo apuntes a Supabase / Lovable Cloud ni a una base con datos reales.
#
#   HX_TEST_CONFIRM=desechable PGHOST=localhost PGPORT=5432 PGUSER=postgres supabase/e2e/prod_replica/run.sh
#   HX_SCENARIO=care|hub|audit|market|both (por defecto both = los cuatro) · HX_ONLY_LOAD=1 solo carga la réplica y las migraciones.
set -euo pipefail

if [ "${HX_TEST_CONFIRM:-}" != "desechable" ]; then
  echo "Este script borra y crea bases de datos. Define HX_TEST_CONFIRM=desechable (solo en un Postgres de pruebas)." >&2
  exit 2
fi

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
E2E="$REPO/supabase/e2e"
MIG="$REPO/supabase/migrations"
P="psql -v ON_ERROR_STOP=1 -q"
SCEN=${HX_SCENARIO:-both}

# Migraciones pendientes en producción, en orden de aplicación (ver docs/LAZO_DE_CUIDADO.md).
CHAIN=(
  20261008100000_pqrs_marketplace_intelligence.sql
  20261008200000_professional_opportunity_hub.sql
  20261008210000_pqrs_table_grants.sql
  20261009050000_contact_and_chat_prereqs.sql
  20261009100000_institution_hub_smart_contracts.sql
  20261010100000_care_loop.sql
  20261010110000_realtime_core_tables.sql
  20261010120000_new_tables_least_privilege.sql
  20261011100000_market_validation_v2.sql
)

ERRF=$(mktemp)
trap 'rm -f "$ERRF"' EXIT
echo "[replica] creando hx_replica_base…"
psql -q -d postgres -c "DROP DATABASE IF EXISTS hx_replica_base" -c "CREATE DATABASE hx_replica_base" >/dev/null
for f in 00_stubs.sql 01_schema.sql 02_functions_triggers.sql 03_policies.sql; do
  $P -d hx_replica_base -f "$HERE/$f" >/dev/null
done
echo "[replica] estructura de producción cargada"
for m in "${CHAIN[@]}"; do
  if [ -f "$MIG/$m" ]; then
    $P -d hx_replica_base -f "$MIG/$m" >/dev/null 2>"$ERRF" || { echo "FALLÓ $m"; cat "$ERRF"; exit 1; }
    echo "[replica] aplicada $m"
  else
    echo "[replica] (omitida, no existe) $m"
  fi
done
# Segunda pasada de la migración de Realtime: debe ser idempotente.
$P -d hx_replica_base -f "$MIG/20261010110000_realtime_core_tables.sql" >/dev/null 2>&1

[ "${HX_ONLY_LOAD:-}" = "1" ] && { echo "[replica] listo (solo carga)"; exit 0; }

run_scenario() {
  local name=$1 db=$2 file=$3 dir=$4
  psql -q -d postgres -c "DROP DATABASE IF EXISTS $db" -c "CREATE DATABASE $db TEMPLATE hx_replica_base" >/dev/null
  echo "── Escenario «$name» sobre la réplica de producción"
  (cd "$dir" && psql -v ON_ERROR_STOP=1 -d "$db" -f "$file" 2>&1 | grep -v "^$")
}

[ "$SCEN" = "care" ] || [ "$SCEN" = "both" ] && run_scenario "lazo de cuidado" hx_replica_care "$E2E/care_loop/scenario.sql" "$E2E/care_loop"
[ "$SCEN" = "hub" ] || [ "$SCEN" = "both" ] && run_scenario "hub de instituciones" hx_replica_hub "$E2E/institution_hub/scenario.sql" "$E2E/institution_hub"
[ "$SCEN" = "audit" ] || [ "$SCEN" = "both" ] && run_scenario "deriva, chat y mínimo privilegio" hx_replica_audit "$HERE/scenario.sql" "$HERE"
[ "$SCEN" = "market" ] || [ "$SCEN" = "both" ] && run_scenario "validación de mercado y beneficio" hx_replica_market "$E2E/market_validation/scenario.sql" "$E2E/market_validation"
true
