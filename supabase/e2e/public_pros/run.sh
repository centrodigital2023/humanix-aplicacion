#!/usr/bin/env bash
# Prueba 20261013100000_public_professionals.sql sobre la RÉPLICA de producción: el directorio público de profesionales vuelve a mostrar
# a los profesionales publicados a familias, instituciones y visitantes, sin teléfono ni coordenadas exactas.
# ⚠️  SOLO para un PostgreSQL DESECHABLE: crea y BORRA hx_replica_base (si no existe) y hx_pubpros. Nunca contra Lovable Cloud.
#   HX_TEST_CONFIRM=desechable supabase/e2e/public_pros/run.sh   (como usuario postgres del sistema o con PGHOST/PGUSER)
# HX_MIGRATION=/ruta.sql prueba un «mutante» de la migración. HX_SKIP_BASE=1 reutiliza hx_replica_base si ya existe.
set -euo pipefail
[ "${HX_TEST_CONFIRM:-}" = "desechable" ] || { echo "Define HX_TEST_CONFIRM=desechable (solo en un Postgres de pruebas)." >&2; exit 2; }
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
MIGS="$REPO/supabase/migrations"
MIG="${HX_MIGRATION:-$MIGS/20261013100000_public_professionals.sql}"
# Lo que ya está en producción cuando llega esta migración (en orden).
PRE=("$MIGS/20261012180000_offer_moderation.sql" "$MIGS/20261012190000_offer_alerts_and_plans.sql" "$MIGS/20261012200000_pqrs_my_tickets.sql" "$MIGS/20261012210000_live_map.sql")
FAILED=0
newdb() { psql -q -d postgres -c "DROP DATABASE IF EXISTS $1" -c "CREATE DATABASE $1 ${2:+TEMPLATE $2}" >/dev/null; }

if [ "${HX_SKIP_BASE:-}" = "1" ] && [ "$(psql -Atq -d postgres -c "SELECT count(*) FROM pg_database WHERE datname = 'hx_replica_base'")" = "1" ]; then
  echo "[public_pros] reutilizando hx_replica_base"
else
  echo "[public_pros] cargando la réplica de producción y su cadena…"
  HX_ONLY_LOAD=1 "$REPO/supabase/e2e/prod_replica/run.sh" >/dev/null
fi

newdb hx_pubpros hx_replica_base
for f in "${PRE[@]}"; do
  psql -v ON_ERROR_STOP=1 -q -d hx_pubpros -f "$f" >/dev/null 2>&1 || { echo "FALLÓ la migración previa $(basename "$f") sobre la réplica"; exit 1; }
done
echo "── Escenario «directorio público de profesionales»"
out=$(psql -v ON_ERROR_STOP=1 -d hx_pubpros -v HELPERS="$REPO/supabase/e2e/clinical_scope/helpers.sql" -v MIG="$MIG" -f "$HERE/scenario.sql" 2>&1 | grep -v '^$') || { echo "$out"; FAILED=1; }
echo "$out" | grep -v -E '^(NOTICE|psql:.*NOTICE)' || true
line=$(echo "$out" | grep -E '^[0-9]+\|[0-9]+\|[0-9]+$' | tail -1)
{ [ -n "$line" ] && [ "$(echo "$line" | cut -d'|' -f2)" = "0" ]; } || FAILED=1
if [ "$FAILED" = "0" ]; then echo "[public_pros] TODO BIEN"; else echo "[public_pros] HAY FALLOS"; exit 1; fi
