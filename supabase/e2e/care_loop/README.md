# Suite de PostgreSQL del «lazo de cuidado»

Prueba de punta a punta la migración `supabase/migrations/20261010100000_care_loop.sql` (y la de Realtime
`20261010110000_realtime_core_tables.sql`) contra un **PostgreSQL 16 real**, con roles reales (`anon`, `authenticated`,
`service_role`), RLS y los disparadores de la migración. Después corre el escenario del hub de instituciones **sobre la
misma migración** para comprobar que no rompe nada anterior.

> ⚠️ **Solo para una base desechable** (por ejemplo `docker run -p 5432:5432 -e POSTGRES_PASSWORD=x postgres:16`).
> El script crea y **borra** las bases `hx_care_test` y `hx_care_regress` y define roles y esquemas de apoyo. **Nunca** lo
> apuntes a Supabase / Lovable Cloud ni a una base con datos reales. Por eso exige `HX_TEST_CONFIRM=desechable`.

```bash
HX_TEST_CONFIRM=desechable PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD=x \
  supabase/e2e/care_loop/run.sh
```

Variables: `HX_SKIP_REGRESSION=1` omite la regresión del hub de instituciones.

Resultado esperado: `pasaron|fallaron|total` de cada escenario con **0 fallos** (lazo de cuidado: 264 comprobaciones; regresión
del hub: 252) y una tabla vacía de verificaciones fallidas.

> Esta carpeta **no** está en `supabase/tests/` a propósito: `supabase test db` ejecuta todo lo que haya allí contra la base
> local y estos archivos no son pruebas pgTAP (crean bases y roles).

## Cómo reproduce la producción

`run.sh` reutiliza los arranques de `supabase/e2e/institution_hub/` (**aproximación** del esquema de producción: auth, tablas,
políticas y funciones copiadas de migraciones anteriores) y le añade el estado previo de la bitácora original
(`20260606000003_care_logs.sql`). La base principal se prepara en modo **«prodlike»**: se concede `ALL` a `anon`,
`authenticated` y `service_role` sobre `care_logs`, `care_favorites` y `care_circle_members`, y se crea una publicación
`supabase_realtime` vacía, igual que se encontró en Lovable Cloud. Así la suite comprueba que la migración **cierra** lo que no
corresponde (REVOKE explícitos) y que la publicación queda completa. Si producción difiere de esta aproximación, la suite puede
dar falsos positivos o negativos: antes de aplicar en producción conviene la corrida en seco descrita en
`docs/LAZO_DE_CUIDADO.md`.

## Grupos del escenario (`scenario.sql`)

| Grupo | Qué demuestra |
|---|---|
| 1 | Estado de la reserva y llegada automática (y su aviso a familia y círculo) |
| 2 | Escrituras: falsificación bloqueada, solo el profesional y solo en curso, tope de 200 registros, alertas, contenido prohibido |
| 3 | Lecturas autorizadas, resumen y parte; `hr_staff` y evaluadores **sin** acceso a datos de salud; superadmin sí |
| 3b | `my_active_services` por rol (cliente, profesional, círculo) |
| 4 | Cierre del servicio, salida automática, idempotencia (reabrir y cerrar no duplica registros ni avisos) |
| 5 | Gracias: lista cerrada por rol, uno por servicio, servicio completado, mensaje limpio |
| 6 | Trayectoria: cifras, familias que vuelven y reconocimientos públicos agregados sin identidades |
| 7 | Equipo de confianza y aviso de cancelación («N de tu equipo están libres») |
| 7b | Reemplazo coherente tras aceptar una propuesta de horario |
| 8 | Institución: parte auditable, plan B automático, gracias |
| 9 | Historia de cuidado exportable (plan de pago leído de `mp_subscriptions`) |
| 10 | Auditoría de permisos de cada tabla y función nueva (anon, authenticated, service_role) |
| 12 | Camino completo de la familia: propuesta → aceptación → servicio → cierre |
| 11 | La publicación de Realtime contiene las tablas que escuchan las pantallas |

Las variables de `psql` (`\gset`) deben ir en minúsculas. Los ayudantes (`t_run`, `t_as`, `t_val`, `t_anon`, `t_svc`, `t_int`,
`t_uuid`, `t_eq`, `t_err`, `t_ok`, `t_true`, `q1`, `n_of`) están definidos al inicio del escenario.

## Lo que NO prueba

El canal Realtime real de Lovable Cloud (WebSocket), PostgREST con JWT reales, el envío de correos y los permisos de roles
propios de Supabase que difieran de esta aproximación. Para eso: dos cuentas reales tras aplicar la migración.
