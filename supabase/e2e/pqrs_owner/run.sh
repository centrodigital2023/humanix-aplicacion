#!/usr/bin/env bash
# Prueba 20261012200000_pqrs_my_tickets.sql sobre la RÉPLICA de producción (estado de hoy → migración → segunda pasada).
# ⚠️  SOLO para un PostgreSQL DESECHABLE: crea y BORRA hx_replica_base (si no existe) y hx_pqrs_owner. Nunca contra Lovable Cloud.
#   HX_TEST_CONFIRM=desechable supabase/e2e/pqrs_owner/run.sh   (como usuario postgres del sistema o con PGHOST/PGUSER)
# HX_MIGRATION=/ruta.sql prueba un «mutante» de la migración. HX_SKIP_BASE=1 reutiliza hx_replica_base si ya existe.
set -euo pipefail
[ "${HX_TEST_CONFIRM:-}" = "desechable" ] || { echo "Define HX_TEST_CONFIRM=desechable (solo en un Postgres de pruebas)." >&2; exit 2; }
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
MIG="${HX_MIGRATION:-$REPO/supabase/migrations/20261012200000_pqrs_my_tickets.sql}"
if [ "${HX_SKIP_BASE:-}" = "1" ] && [ "$(psql -Atq -d postgres -c "SELECT count(*) FROM pg_database WHERE datname = 'hx_replica_base'")" = "1" ]; then
  echo "[pqrs] reutilizando hx_replica_base"
else
  echo "[pqrs] cargando la réplica de producción y su cadena…"
  HX_ONLY_LOAD=1 "$REPO/supabase/e2e/prod_replica/run.sh" >/dev/null
fi
psql -q -d postgres -c "DROP DATABASE IF EXISTS hx_pqrs_owner" -c "CREATE DATABASE hx_pqrs_owner TEMPLATE hx_replica_base" >/dev/null
echo "── Escenario «PQRS propias»"
out=$(psql -v ON_ERROR_STOP=1 -d hx_pqrs_owner -v HELPERS="$REPO/supabase/e2e/clinical_scope/helpers.sql" -v MIG="$MIG" -f "$HERE/scenario.sql" 2>&1 | grep -v '^$') || { echo "$out"; echo "[pqrs] HAY FALLOS"; exit 1; }
echo "$out" | grep -v -E '^(NOTICE|psql:.*NOTICE)' || true
line=$(echo "$out" | grep -E '^[0-9]+\|[0-9]+\|[0-9]+$' | tail -1)
if [ -n "$line" ] && [ "$(echo "$line" | cut -d'|' -f2)" = "0" ]; then echo "[pqrs] TODO BIEN"; else echo "[pqrs] HAY FALLOS"; exit 1; fi
