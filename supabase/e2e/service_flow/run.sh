#!/usr/bin/env bash
# Prueba de la migración 20261024100000 («flujo del servicio en vivo»): REPLICA IDENTITY, publicación,
# aviso detallado al profesional (familia y EPS/IPS) y avisos de Aceptado / En camino a quien contrató.
#
# ⚠️  SOLO para un PostgreSQL DESECHABLE. Crea y BORRA la base `hx_service_flow_test`.
#
# Uso:
#   HX_TEST_CONFIRM=desechable PGHOST=localhost PGUSER=postgres supabase/e2e/service_flow/run.sh
set -euo pipefail

if [ "${HX_TEST_CONFIRM:-}" != "desechable" ]; then
  echo "Este script borra y crea bases de datos. Define HX_TEST_CONFIRM=desechable (solo en un Postgres de pruebas)." >&2
  exit 2
fi

HERE=$(cd "$(dirname "$0")" && pwd)
MIG="$HERE/../../migrations/20261024100000_realtime_service_flow.sql"
DB=hx_service_flow_test
P="psql -v ON_ERROR_STOP=1 -q -X"

psql -q -X -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null
$P -d "$DB" -f "$HERE/bootstrap.sql" >/dev/null
# Dos veces: la migración debe ser idempotente.
$P -d "$DB" -f "$MIG" >/dev/null
$P -d "$DB" -f "$MIG" >/dev/null
$P -d "$DB" -f "$HERE/scenario.sql"
psql -q -X -d postgres -c "DROP DATABASE IF EXISTS $DB" >/dev/null
