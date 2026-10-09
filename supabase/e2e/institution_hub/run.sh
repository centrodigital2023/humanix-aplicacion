#!/usr/bin/env bash
# Prueba de punta a punta de la migración 20261009100000 (hub de instituciones + contrato inteligente).
#
# ⚠️  SOLO para un PostgreSQL DESECHABLE (por ejemplo `docker run postgres:16`). Crea y BORRA la base
#     `hx_inst_test` y define roles y esquemas de apoyo (auth, anon, authenticated, service_role).
#     NUNCA lo apuntes a Supabase / Lovable Cloud ni a ninguna base con datos reales.
#
# Uso:
#   HX_TEST_CONFIRM=desechable PGHOST=localhost PGPORT=5432 PGUSER=postgres \
#     supabase/e2e/institution_hub/run.sh
#
# Resultado: «pasaron|fallaron|total» y, si algo falla, la lista de verificaciones con su detalle.
set -euo pipefail

if [ "${HX_TEST_CONFIRM:-}" != "desechable" ]; then
  echo "Este script borra y crea bases de datos. Define HX_TEST_CONFIRM=desechable para continuar (solo en un Postgres de pruebas)." >&2
  exit 2
fi

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
DB=${HX_TEST_DB:-hx_inst_test}
P="psql -v ON_ERROR_STOP=1 -q"

psql -q -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null
cd "$HERE"
$P -d "$DB" -f bootstrap_common.sql >/dev/null
$P -d "$DB" -f bootstrap_text.sql >/dev/null
# Estado de producción previo: las migraciones de las que depende la nueva.
$P -d "$DB" -f "$REPO/supabase/migrations/20261007190000_booking_integrity_and_favorites.sql" >/dev/null
$P -d "$DB" -f "$REPO/supabase/migrations/20261007200000_replacement_dimensions_circle.sql" >/dev/null
$P -d "$DB" -f "$REPO/supabase/migrations/20261008200000_professional_opportunity_hub.sql" >/dev/null
$P -d "$DB" -f bootstrap_inst.sql >/dev/null
echo "[inst] base y migraciones previas cargadas"
$P -d "$DB" -f "$REPO/supabase/migrations/20261009100000_institution_hub_smart_contracts.sql" >/dev/null 2>&1 \
  && echo "[inst] migración nueva aplicada"
$P -d "$DB" -f "$HERE/scenario.sql" 2>&1 | grep -v "^$"
