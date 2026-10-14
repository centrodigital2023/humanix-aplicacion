#!/usr/bin/env bash
# Prueba 20261014100000_institution_care_core.sql sobre la RÉPLICA de producción con todo lo anterior ya aplicado, como llegará a producción:
# pacientes, casos, notas encadenadas, tareas, NEWS2 y alertas calculados en la base, dispositivos con ingesta pública, planes (Free vs IPS
# Mejorado), módulos del personal, límites, aislamiento entre instituciones y permisos.
# ⚠️  SOLO para un PostgreSQL DESECHABLE: crea y BORRA hx_replica_base (si no existe) y hx_instcare. Nunca contra Lovable Cloud.
#   HX_TEST_CONFIRM=desechable supabase/e2e/institution_care/run.sh   (como usuario postgres del sistema o con PGHOST/PGUSER)
# HX_MIGRATION=/ruta.sql (o HX_MIGRATION2) prueba un «mutante» de la 1.ª (o de la 2.ª) migración. HX_SKIP_BASE=1 reutiliza hx_replica_base si ya existe.
# HX_DB=nombre cambia la base desechable (para correr varios mutantes a la vez).
# Los vectores de NEWS2 (news2_vectors.json) son los mismos que usa src/lib/news2.test.ts: la base y la pantalla puntúan igual.
set -euo pipefail
[ "${HX_TEST_CONFIRM:-}" = "desechable" ] || { echo "Define HX_TEST_CONFIRM=desechable (solo en un Postgres de pruebas)." >&2; exit 2; }
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
MIGS="$REPO/supabase/migrations"
MIG="${HX_MIGRATION:-$MIGS/20261014100000_institution_care_core.sql}"
MIG2="${HX_MIGRATION2:-$MIGS/20261014110000_wearable_ingest_throttle.sql}"
WORIG="$MIGS/20260618230123_6e7fb622-a98c-4f39-a312-e38c133f969d.sql"
# Lo que ya está en producción cuando llega esta migración (en orden).
PRE=("$MIGS/20261012180000_offer_moderation.sql" "$MIGS/20261012190000_offer_alerts_and_plans.sql" "$MIGS/20261012200000_pqrs_my_tickets.sql"
     "$MIGS/20261012210000_live_map.sql" "$MIGS/20261013100000_public_professionals.sql" "$MIGS/20261013110000_professional_panel.sql"
     "$MIGS/20261013120000_institution_members.sql" "$MIGS/20261013130000_institution_staff_context.sql")
DB="${HX_DB:-hx_instcare}"
FAILED=0
newdb() { psql -q -d postgres -c "DROP DATABASE IF EXISTS $1" -c "CREATE DATABASE $1 ${2:+TEMPLATE $2}" >/dev/null; }

if [ "${HX_SKIP_BASE:-}" = "1" ] && [ "$(psql -Atq -d postgres -c "SELECT count(*) FROM pg_database WHERE datname = 'hx_replica_base'")" = "1" ]; then
  echo "[institution_care] reutilizando hx_replica_base"
else
  echo "[institution_care] cargando la réplica de producción y su cadena…"
  HX_ONLY_LOAD=1 "$REPO/supabase/e2e/prod_replica/run.sh" >/dev/null
fi

newdb "$DB" hx_replica_base
for f in "${PRE[@]}"; do
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f" >/dev/null 2>&1 || { echo "FALLÓ la migración previa $(basename "$f") sobre la réplica"; exit 1; }
done
echo "── Escenario «pacientes y monitoreo clínico»"
out=$(psql -v ON_ERROR_STOP=1 -d "$DB" -v HELPERS="$REPO/supabase/e2e/clinical_scope/helpers.sql" -v MIG="$MIG" \
        -v VECTORS="$HERE/news2_vectors.json" -v MIG2="$MIG2" -v WORIG="$WORIG" -f "$HERE/scenario.sql" 2>&1 | grep -v '^$') || { echo "$out"; FAILED=1; }
echo "$out" | grep -v -E '^(NOTICE|psql:.*NOTICE)' || true
line=$(echo "$out" | grep -E '^[0-9]+\|[0-9]+\|[0-9]+$' | tail -1)
{ [ -n "$line" ] && [ "$(echo "$line" | cut -d'|' -f2)" = "0" ]; } || FAILED=1
if [ "$FAILED" = "0" ]; then echo "[institution_care] TODO BIEN"; else echo "[institution_care] HAY FALLOS"; exit 1; fi
