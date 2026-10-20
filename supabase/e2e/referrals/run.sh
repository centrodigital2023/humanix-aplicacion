#!/usr/bin/env bash
# Prueba 20261020100000_referrals_v2.sql sobre la RÉPLICA de producción (estado de hoy → migración → segunda pasada).
# ⚠️  SOLO para un PostgreSQL DESECHABLE: crea y BORRA hx_replica_base (si no existe), hx_referrals y hx_referrals_old.
#   HX_TEST_CONFIRM=desechable supabase/e2e/referrals/run.sh   (como usuario postgres del sistema o con PGHOST/PGUSER)
# HX_MIGRATION=/ruta.sql prueba un «mutante» de la migración. HX_SKIP_BASE=1 reutiliza hx_replica_base si ya existe.
set -euo pipefail
[ "${HX_TEST_CONFIRM:-}" = "desechable" ] || { echo "Define HX_TEST_CONFIRM=desechable (solo en un Postgres de pruebas)." >&2; exit 2; }
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
MIG="${HX_MIGRATION:-$REPO/supabase/migrations/20261020100000_referrals_v2.sql}"
OLD="$REPO/supabase/migrations/20260606000001_referrals.sql"
if [ "${HX_SKIP_BASE:-}" = "1" ] && [ "$(psql -Atq -d postgres -c "SELECT count(*) FROM pg_database WHERE datname = 'hx_replica_base'")" = "1" ]; then
  echo "[referidos] reutilizando hx_replica_base"
else
  echo "[referidos] cargando la réplica de producción y su cadena…"
  HX_ONLY_LOAD=1 "$REPO/supabase/e2e/prod_replica/run.sh" >/dev/null
fi

# El diseño viejo con filas no se borra: la migración se detiene y pide migrarlas a mano.
psql -q -d postgres -c "DROP DATABASE IF EXISTS hx_referrals_old" -c "CREATE DATABASE hx_referrals_old TEMPLATE hx_replica_base" >/dev/null
psql -q -v ON_ERROR_STOP=1 -d hx_referrals_old -f "$OLD" >/dev/null
psql -q -v ON_ERROR_STOP=1 -d hx_referrals_old -c "INSERT INTO auth.users(id) VALUES ('00000000-0000-0000-0000-0000000000aa'); INSERT INTO public.referrals(referrer_id, referred_email) VALUES ('00000000-0000-0000-0000-0000000000aa', 'x@t.co')" >/dev/null
if psql -q -v ON_ERROR_STOP=1 -d hx_referrals_old -f "$MIG" >/dev/null 2>&1; then
  echo "[referidos] FALLA: la migración borró un diseño viejo con filas"; exit 1
fi
[ "$(psql -Atq -d hx_referrals_old -c 'SELECT count(*) FROM public.referrals')" = "1" ] || { echo "[referidos] FALLA: se perdieron filas viejas"; exit 1; }
echo "[referidos] diseño viejo con filas: la migración se detiene sin tocar nada"
psql -q -d postgres -c "DROP DATABASE hx_referrals_old" >/dev/null

psql -q -d postgres -c "DROP DATABASE IF EXISTS hx_referrals" -c "CREATE DATABASE hx_referrals TEMPLATE hx_replica_base" >/dev/null
echo "── Escenario «referidos v2»"
out=$(psql -v ON_ERROR_STOP=1 -d hx_referrals -v HELPERS="$REPO/supabase/e2e/clinical_scope/helpers.sql" -v MIG="$MIG" -v OLD="$OLD" -f "$HERE/scenario.sql" 2>&1 | grep -v '^$') || { echo "$out"; echo "[referidos] HAY FALLOS"; exit 1; }
echo "$out" | grep -v -E '^(NOTICE|psql:.*NOTICE)' || true
line=$(echo "$out" | grep -E '^[0-9]+\|[0-9]+\|[0-9]+$' | tail -1)
if [ -n "$line" ] && [ "$(echo "$line" | cut -d'|' -f2)" = "0" ]; then echo "[referidos] TODO BIEN"; else echo "[referidos] HAY FALLOS"; exit 1; fi
