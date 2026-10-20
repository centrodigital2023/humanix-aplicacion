#!/usr/bin/env bash
# Prueba las migraciones que habilitan las piezas ocultas (20261020110000 en adelante) sobre la RÉPLICA de producción.
# Cada escenario parte de una copia limpia de la réplica: estado de hoy → migración → comprobaciones → segunda pasada.
# ⚠️  SOLO para un PostgreSQL DESECHABLE: crea y BORRA hx_replica_base (si no existe) y hx_hidden_<pieza>.
#   HX_TEST_CONFIRM=desechable supabase/e2e/hidden_pieces/run.sh [pieza…]   (por defecto, todas)
# HX_MIGRATION=/ruta.sql prueba un «mutante» (con una sola pieza). HX_SKIP_BASE=1 reutiliza hx_replica_base si ya existe.
set -euo pipefail
[ "${HX_TEST_CONFIRM:-}" = "desechable" ] || { echo "Define HX_TEST_CONFIRM=desechable (solo en un Postgres de pruebas)." >&2; exit 2; }
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
declare -A MIGS=(
  [health]=20261020110000_health_compliance.sql
  [branches]=20261020120000_institution_branches.sql
  [wallet]=20261020130000_wallet_ledger.sql
  [clinical]=20261020150000_clinical_monitoring_core.sql
  [ratings]=20261020160000_rating_responses.sql
)
PIECES=("$@"); [ ${#PIECES[@]} -gt 0 ] || PIECES=(health branches wallet clinical ratings)
if [ "${HX_SKIP_BASE:-}" = "1" ] && [ "$(psql -Atq -d postgres -c "SELECT count(*) FROM pg_database WHERE datname = 'hx_replica_base'")" = "1" ]; then
  echo "[piezas] reutilizando hx_replica_base"
else
  echo "[piezas] cargando la réplica de producción y su cadena…"
  HX_ONLY_LOAD=1 "$REPO/supabase/e2e/prod_replica/run.sh" >/dev/null
fi
FAILED=0
for p in "${PIECES[@]}"; do
  MIG="${HX_MIGRATION:-$REPO/supabase/migrations/${MIGS[$p]}}"
  [ -f "$MIG" ] || { echo "[piezas] $p: falta $MIG"; FAILED=1; continue; }
  db="hx_hidden_$p"
  psql -q -d postgres -c "DROP DATABASE IF EXISTS $db" -c "CREATE DATABASE $db TEMPLATE hx_replica_base" >/dev/null
  echo "── $p (${MIGS[$p]})"
  out=$(psql -v ON_ERROR_STOP=1 -d "$db" -v HELPERS="$REPO/supabase/e2e/clinical_scope/helpers.sql" -v STUBS="$HERE/stubs.sql" -v MIG="$MIG" -f "$HERE/$p.sql" 2>&1 | grep -v '^$') || { echo "$out"; echo "[piezas] $p: HAY FALLOS"; FAILED=1; continue; }
  echo "$out" | grep -v -E '^(NOTICE|psql:.*NOTICE|psql:.*WARNING)' || true
  line=$(echo "$out" | grep -E '^[0-9]+\|[0-9]+\|[0-9]+$' | tail -1)
  if [ -n "$line" ] && [ "$(echo "$line" | cut -d'|' -f2)" = "0" ]; then echo "[piezas] $p: TODO BIEN"; else echo "[piezas] $p: HAY FALLOS"; FAILED=1; fi
  psql -q -d postgres -c "DROP DATABASE $db" >/dev/null
done
[ "$FAILED" = "0" ] && echo "[piezas] TODO BIEN" || { echo "[piezas] HAY FALLOS"; exit 1; }
