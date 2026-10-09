#!/usr/bin/env bash
# Prueba de punta a punta de la migración 20261010100000 («lazo de cuidado»): parte del turno, gracias,
# trayectoria, equipo de confianza + plan B e historia de cuidado, con familia, profesionales e institución.
# Además corre el escenario del hub de instituciones SOBRE la misma migración (regresión).
#
# ⚠️  SOLO para un PostgreSQL DESECHABLE (por ejemplo `docker run postgres:16`). Crea y BORRA las bases
#     `hx_care_test` y `hx_care_regress` y define roles y esquemas de apoyo (auth, anon, authenticated,
#     service_role). NUNCA lo apuntes a Supabase / Lovable Cloud ni a ninguna base con datos reales.
#
# Uso:
#   HX_TEST_CONFIRM=desechable PGHOST=localhost PGPORT=5432 PGUSER=postgres supabase/e2e/care_loop/run.sh
#
# Resultado: «pasaron|fallaron|total» de cada escenario y, si algo falla, la lista con su detalle.
set -euo pipefail

if [ "${HX_TEST_CONFIRM:-}" != "desechable" ]; then
  echo "Este script borra y crea bases de datos. Define HX_TEST_CONFIRM=desechable para continuar (solo en un Postgres de pruebas)." >&2
  exit 2
fi

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
HUB="$REPO/supabase/e2e/institution_hub"
MIG="$REPO/supabase/migrations"
P="psql -v ON_ERROR_STOP=1 -q"

load_schema() {
  local db=$1
  psql -q -d postgres -c "DROP DATABASE IF EXISTS $db" -c "CREATE DATABASE $db" >/dev/null
  # Los arranques del hub usan rutas relativas (\i real_functions.sql): se ejecutan desde su carpeta.
  (cd "$HUB" && $P -d "$db" -f bootstrap_common.sql >/dev/null && $P -d "$db" -f bootstrap_text.sql >/dev/null)
  $P -d "$db" -f "$MIG/20261007190000_booking_integrity_and_favorites.sql" >/dev/null
  $P -d "$db" -f "$MIG/20261007200000_replacement_dimensions_circle.sql" >/dev/null
  $P -d "$db" -f "$MIG/20261008200000_professional_opportunity_hub.sql" >/dev/null
  (cd "$HUB" && $P -d "$db" -f bootstrap_inst.sql >/dev/null)
  # Estado de producción previo: la bitácora original de la que parte «lazo de cuidado».
  $P -d "$db" -f "$MIG/20260606000003_care_logs.sql" >/dev/null
  $P -d "$db" -f "$MIG/20261009100000_institution_hub_smart_contracts.sql" >/dev/null 2>&1
  if [ "${2:-}" = "prodlike" ]; then
    # Supabase concede ALL a anon/authenticated sobre las tablas existentes: la migración debe cerrar lo que no corresponde.
    $P -d "$db" -c "GRANT ALL ON public.care_logs TO anon, authenticated, service_role" >/dev/null
    $P -d "$db" -c "CREATE PUBLICATION supabase_realtime" >/dev/null
  fi
  $P -d "$db" -f "$MIG/20261010100000_care_loop.sql" >/dev/null
  $P -d "$db" -f "$MIG/20261010110000_realtime_core_tables.sql" >/dev/null 2>&1
  # Segunda pasada: la migración de Realtime debe ser idempotente.
  $P -d "$db" -f "$MIG/20261010110000_realtime_core_tables.sql" >/dev/null 2>&1
}

echo "[care] cargando esquema y migraciones…"
load_schema hx_care_test prodlike
echo "[care] migración «lazo de cuidado» aplicada"
echo "── Escenario «lazo de cuidado»"
psql -v ON_ERROR_STOP=1 -d hx_care_test -f "$HERE/scenario.sql" 2>&1 | grep -v "^$"

if [ "${HX_SKIP_REGRESSION:-}" != "1" ]; then
  load_schema hx_care_regress
  echo "── Regresión: escenario del hub de instituciones con la migración nueva aplicada"
  (cd "$HUB" && psql -v ON_ERROR_STOP=1 -d hx_care_regress -f scenario.sql 2>&1 | grep -v "^$")
fi
