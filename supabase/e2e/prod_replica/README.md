# Réplica local de la estructura real de producción (Lovable Cloud)

Las otras suites de PostgreSQL (`care_loop/`, `institution_hub/`) arrancan con un esquema **aproximado** del que se
parte. Esta carpeta, en cambio, carga la **estructura real** extraída de la base de producción el **2026-10-09**
(solo estructura, sin datos): 26 tablas con sus restricciones, índices únicos, RLS y políticas; los disparadores y
funciones existentes; y los **privilegios por defecto** de Supabase. Sobre ella aplica la cadena de migraciones pendiente
y corre los escenarios.

> ⚠️ **Solo para una base desechable.** Crea y **borra** `hx_replica_base`, `hx_replica_care`, `hx_replica_hub` y
> `hx_replica_audit`. Nunca lo apuntes a Supabase / Lovable Cloud ni a una base con datos reales.

```bash
HX_TEST_CONFIRM=desechable PGHOST=localhost PGPORT=5432 PGUSER=postgres supabase/e2e/prod_replica/run.sh
# HX_SCENARIO=care|hub|audit|both (por defecto los tres) · HX_ONLY_LOAD=1 solo carga la réplica y las migraciones
```

Resultado esperado: `264|0|264` (lazo de cuidado), `252|0|252` (hub de instituciones) y `37|0|37` (este escenario).

## Qué encontró (y por qué existe)

Con el esquema aproximado las suites pasaban; contra la estructura real aparecieron **diferencias entre el repositorio y
producción** que ninguna prueba anterior podía ver:

| Hallazgo | Efecto en producción | Corrección |
|---|---|---|
| El disparador `trg_conversations_updated_at` asigna `NEW.updated_at` pero `conversations` no tiene esa columna | **Ningún mensaje se podía enviar** (cada mensaje actualiza la conversación y falla) | `conversations.updated_at` en `20261009050000_contact_and_chat_prereqs.sql` |
| Faltaban `booking_contact_reveals` y `get_or_create_booking_conversation` (la migración 20260422030000 nunca se aplicó) | La tarjeta «Contactar» (WhatsApp + chat) fallaba | Se restablecen (con comprobación de sesión más estricta) en la misma migración |
| La política `care_logs_read` de producción usa `is_staff()` y el repositorio no la conocía | HR y evaluadores leían los partes (datos de salud) | `care_loop` retira todas las políticas de lectura previas y crea la correcta |
| Privilegios por defecto: toda tabla nueva nace con `ALL` para `anon` y `authenticated` | Varias tablas nuevas (`offer_team_invites`, `opportunity_*`, `pqrs_*`…) quedaban con más privilegios que los previstos (solo RLS las protegía) | `20261010120000_new_tables_least_privilege.sql` fija el mínimo por tabla |
| `job_offers` tiene privilegio de lectura de tabla completa (no por columna) | La defensa por columna no aplica; la dirección y el teléfono siguen protegidos porque la columna queda siempre en `NULL` | Escenario ajustado; la protección real es el disparador |
| `service_contracts` no existe en producción | El flujo antiguo de contratos nunca funcionó allí; el contrato inteligente lo reemplaza | Sin cambios |

## Archivos

| Archivo | Contenido |
|---|---|
| `00_stubs.sql` | Roles, `auth`/`realtime` mínimos y los privilegios por defecto de Supabase |
| `01_schema.sql` | Tipos, tablas, restricciones, índices únicos y RLS (extraídos con `pg_get_*`) |
| `02_functions_triggers.sql` | Funciones y disparadores existentes (`match_professionals_for_offer` es un sustituto sin pgvector) |
| `03_policies.sql` | Políticas RLS existentes |
| `scenario.sql` | Chat y contacto, lectura del parte, mínimo privilegio, políticas heredadas y disparadores de producción |
| `run.sh` | Carga, aplica la cadena (`CHAIN`) y corre los escenarios |

## Límites

- Es una **fotografía**: si producción cambia, hay que volver a extraer (consultas a `pg_class`, `pg_attribute`,
  `pg_constraint`, `pg_policies`, `pg_trigger`, `pg_get_functiondef`).
- Solo incluye las tablas que tocan las migraciones recientes; no replica Supabase Auth, Realtime real ni PostgREST.
- Los privilegios de las funciones preexistentes se aproximan con los de por defecto (en producción varias ya excluyen a `anon`).
