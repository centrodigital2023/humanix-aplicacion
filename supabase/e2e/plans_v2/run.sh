#!/usr/bin/env bash
# Prueba 20261023100000_plans_v2_pricing.sql (planes y precios de oct 2026) sobre la RÉPLICA de producción: comisión del 10 % con
# la regla de los dos lados, cupos por plan, círculo de cuidado y prioridad en el directorio.
# ⚠️  SOLO para un PostgreSQL DESECHABLE: crea y BORRA hx_replica_base (si no existe) y hx_plans_v2. Nunca contra Lovable Cloud.
#   HX_TEST_CONFIRM=desechable supabase/e2e/plans_v2/run.sh   (como usuario postgres del sistema o con PGHOST/PGUSER)
# HX_SKIP_BASE=1 reutiliza hx_replica_base si ya existe.
set -euo pipefail
[ "${HX_TEST_CONFIRM:-}" = "desechable" ] || { echo "Define HX_TEST_CONFIRM=desechable (solo en un Postgres de pruebas)." >&2; exit 2; }
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
MIGS="$REPO/supabase/migrations"
MIG="$MIGS/20261023100000_plans_v2_pricing.sql"
# Lo que ya está en producción cuando llega esta migración (en orden) y que el escenario usa.
PRE=(
  20261012180000_offer_moderation.sql 20261012190000_offer_alerts_and_plans.sql 20261012200000_pqrs_my_tickets.sql
  20261012210000_live_map.sql 20261013100000_public_professionals.sql 20261020120000_institution_branches.sql
  20261020130000_wallet_ledger.sql
)
newdb() { psql -q -d postgres -c "DROP DATABASE IF EXISTS $1" -c "CREATE DATABASE $1 ${2:+TEMPLATE $2}" >/dev/null; }

if [ "${HX_SKIP_BASE:-}" = "1" ] && [ "$(psql -Atq -d postgres -c "SELECT count(*) FROM pg_database WHERE datname = 'hx_replica_base'")" = "1" ]; then
  echo "[plans_v2] reutilizando hx_replica_base"
else
  echo "[plans_v2] cargando la réplica de producción y su cadena…"
  HX_ONLY_LOAD=1 "$REPO/supabase/e2e/prod_replica/run.sh" >/dev/null
fi

newdb hx_plans_v2 hx_replica_base
for f in "${PRE[@]}"; do
  psql -v ON_ERROR_STOP=1 -q -d hx_plans_v2 -f "$MIGS/$f" >/dev/null 2>&1 || { echo "FALLÓ la migración previa $f sobre la réplica"; exit 1; }
done
# Dos veces: la migración es idempotente.
for i in 1 2; do
  psql -v ON_ERROR_STOP=1 -q -d hx_plans_v2 -f "$MIG" >/dev/null 2>&1 || { echo "FALLÓ $MIG (pasada $i)"; exit 1; }
done
echo "── Escenario «planes y precios»"
out=$(psql -v ON_ERROR_STOP=1 -d hx_plans_v2 -v HELPERS="$REPO/supabase/e2e/clinical_scope/helpers.sql" -f "$HERE/scenario.sql" 2>&1 | grep -v '^$') || { echo "$out"; exit 1; }
echo "$out" | grep -v -E '^(NOTICE|psql:.*NOTICE)' || true
line=$(echo "$out" | grep -E '^[0-9]+\|[0-9]+\|[0-9]+$' | tail -1)
if [ -n "$line" ] && [ "$(echo "$line" | cut -d'|' -f2)" = "0" ]; then echo "[plans_v2] TODO BIEN"; else echo "[plans_v2] HAY FALLOS"; exit 1; fi
