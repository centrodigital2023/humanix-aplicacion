# Lazo de cuidado: familia ↔ profesional ↔ EPS/IPS en un mismo hilo

Producto mínimo **amable** (MLP): lo mínimo que hace que la gente quiera volver y recomendarlo. En el cuidado en casa la
familia sufre la incertidumbre («¿cómo va mamá?»), el profesional sufre la invisibilidad («nadie ve cómo trabajo») y la
institución sufre la falta de evidencia y de cobertura. El lazo conecta a los tres con el mismo dato: el **parte del turno**.

Migraciones: `20261010100000_care_loop.sql` (funciones, disparadores, tablas) y `20261010110000_realtime_core_tables.sql`
(publicación en Realtime). Suite de PostgreSQL real en `supabase/e2e/care_loop/`.

## Qué recibe cada rol

| Rol | Incluido para todos | Con plan de pago |
|---|---|---|
| **Familia** | Parte del turno **en vivo** con el resumen «en palabras», semáforo, alertas, ánimo y signos vitales con su rango · aviso al comenzar y al terminar · **círculo de cuidado** (hermanos o tíos ven el parte en solo lectura, con aviso por WhatsApp al invitarlos) · «Gracias» al profesional y invitación a otra familia · **equipo de confianza** · aviso de cancelación que dice **cuántos de su equipo están libres** | **Esencial**: historia de cuidado exportable (Excel/CSV) |
| **Profesional** | «Mis servicios de hoy» con el siguiente paso · parte en un toque (atajos, ánimo, signos vitales con rangos, alertas) · cierre cálido del turno · gracias recibidos · **trayectoria**: nivel, sellos, racha, horas, familias que vuelven · compartir por WhatsApp · reconocimientos agregados en el perfil público | **Pro**: pasaporte profesional imprimible con código QR |
| **Institución (EPS/IPS/clínica/geriátrico)** | **Turnos en vivo** (alertas primero, signos vitales, ánimo) · parte auditable de cada turno · **plan B automático**: si el profesional cancela, se invita solo a su equipo de confianza · equipo de confianza · gracias a los profesionales | Historia de turnos exportable (cualquier plan de pago; el plan IPS la incluye) |
| **Círculo de cuidado** | Servicio de su familiar en solo lectura: parte en vivo y avisos de alerta; sin acciones, sin chat, sin precios en la pantalla | — |

Las funciones de pago salen de `FEATURE_MIN_PLAN` (`care_history_export` → Esencial, `career_passport` → Pro). **No cambió ningún
precio**; el plan se lee siempre de `mp_subscriptions` (solo escribe el webhook de pagos). Los pagos siguen ocurriendo únicamente
en la página web: ningún texto compartido ni aceptado por el parte, los gracias o los mensajes lleva datos de pago.

## El hilo completo

```
Familia pide / propone horario ──► Profesional acepta ──► reserva «confirmado»
                                                              │
              «En camino» ──► «Llegué al sitio» (estado `in_progress`)
                                       │  trigger: registra la LLEGADA sola + avisa a la familia y a su círculo
                                       ▼
        Parte del turno (solo el profesional del servicio, solo en curso)
          medicamento · comida · actividad · signos vitales · nota · incidente
          └─ alerta ⇒ aviso inmediato a la familia (o institución) y a su círculo
                                       │
        «Finalizar» (ánimo + nota de cierre) ── trigger: registra la SALIDA sola + duración
                                       │  avisos de cierre; hito de trayectoria al profesional
                                       ▼
   Gracias (ambos sentidos) · calificación · guardar en el equipo de confianza · parte final «en palabras»
                                       │
   Si el profesional CANCELA ► familia: «N de tu equipo están libres» · institución: plan B (invita a su equipo)
```

## Reglas que impone la base de datos (no la interfaz)

- **`care_logs` es de solo-agregar**: sin UPDATE/DELETE para usuarios; `anon` sin acceso. Antes cualquier usuario podía
  insertar registros en una reserva ajena y `get_care_summary` era legible por cualquiera.
- **Quién escribe**: únicamente el profesional de la reserva y solo con el servicio **en curso** (política RLS + guardia
  `care_logs_guard`). Máximo 200 registros por turno. La **llegada y la salida no se escriben a mano** (las genera el
  disparador al cambiar el estado, de forma idempotente: si el personal corrige y reabre, no se duplican registros ni avisos).
- **Texto**: sin teléfonos, correos, enlaces ni instrucciones de pago (una **alerta nunca se bloquea por su contenido**). Las
  fotos de pacientes se descartan hasta contar con un flujo de consentimiento (Ley 1581 de 2012: dato sensible).
- **Quién lee**: profesional, cliente (familia o institución), miembros **aceptados** del círculo con permiso de ver servicios, y
  **superadmin**. El resto del personal (HR, evaluadores) **no** ve el parte: es un dato de salud.
- **Alertas** (`is_alert` o incidente): notificación inmediata a quien contrató y a su círculo, con el motivo.
- **Gracias (`care_kudos`)**: solo `send_kudos()` escribe; servicio **completado**; participante; 1–3 reconocimientos de una lista
  cerrada por rol; mensaje ≤ 280 sin contacto ni pagos; uno por persona y servicio. Los mensajes son privados del destinatario;
  el perfil público solo muestra **cuántas personas distintas** dieron cada reconocimiento.
- **Trayectoria**: calculada en el servidor con servicios **completados** (`my_career_stats` privada; `professional_public_stats`
  pública sin identidades, sin cifras internas). Nada se autodeclara.
- **Plan B**: lo dispara la cancelación **del profesional**; invita a los favoritos de quien publicó la oferta (máx. 25, una vez
  por oferta y profesional, sin quien canceló, sin quien ya se postuló). Si cancela la institución no se invita a nadie.
- **Historia de cuidado** (`care_history_report`): exige plan de pago leído de `mp_subscriptions`; devuelve solo los servicios de
  quien consulta. Sin teléfonos, direcciones ni valores de pago; celdas neutralizadas contra inyección de fórmulas en Excel.
- Tablas nuevas con GRANT + RLS en la misma migración. En producción las tablas heredan `ALL` para `anon` y `authenticated`: la
  migración lo **revoca explícitamente** (`care_logs`, `care_kudos`) y la suite lo comprueba simulando esos permisos.

## Dónde están los bucles virales (sin pagos por WhatsApp)

| Momento | Acción | Qué se comparte |
|---|---|---|
| La familia da las gracias | «¿Conoces a otra familia que lo necesite?» | Enlace de referido (1 mes del plan Esencial gratis por quien se suscriba) |
| El profesional recibe gracias | «Comparte tu trayectoria» (WhatsApp) | Cifras agregadas y enlace al perfil público, **sin nombres de familias** |
| La familia invita a un familiar al círculo | «Avisar por WhatsApp» | Invitación y el correo con el que debe entrar |
| Profesional Pro | Pasaporte con código QR | Página pública con cifras verificables |
| Perfil público | «Trayectoria en Humanix» | Servicios, horas, familias que vuelven y reconocimientos por tipo |

Ningún texto compartido contiene datos de salud, nombres de pacientes ni importes.

## Referencia técnica

**Base de datos** (`20261010100000_care_loop.sql`)

| Objeto | Para qué |
|---|---|
| `care_logs` (+ `mood`, `system_generated`) | Parte del turno (solo-agregar, RLS, realtime) |
| `care_logs_guard`, `care_logs_after_insert` | Integridad del registro y alertas |
| `booking_care_events` | Llegada/salida automáticas, avisos y hitos (idempotente) |
| `care_can_view`, `care_watchers`, `party_display_name`, `hx_duration_label` | Utilidades internas (sin EXECUTE para usuarios) |
| `get_care_summary` (endurecida), `care_report` | Resumen autorizado del turno |
| `my_active_services` | Tablero de cada rol en una sola llamada (cliente, profesional, círculo) |
| `care_kudos`, `send_kudos`, `my_received_kudos`, `professional_kudos_summary`, `kudos_allowed_kinds` | Gracias |
| `career_stats_core`, `my_career_stats`, `professional_public_stats` | Trayectoria |
| `my_trusted_team`, `trusted_team_free_count`, `invite_team_core`, `invite_team_to_offer` (misma firma), `plan_b_after_cancel` | Equipo de confianza y plan B |
| `notify_booking_cancelled` (reemplazada) | Aviso de cancelación con «cuántos de tu equipo están libres» |
| `care_history_report` | Historia exportable (plan de pago) |
| Política `care_logs_circle_read` | El círculo lee el parte |

`20261010110000_realtime_core_tables.sql` publica en `supabase_realtime` las tablas que escuchan las pantallas (idempotente; si el
rol que migra no es dueño de la publicación, avisa sin abortar).

**Librerías puras con pruebas** (`src/lib/`): `careLog` (tipos, atajos, rangos de signos vitales, formulario Zod, línea de tiempo,
parte en palabras), `kudos`, `careerStats` (nivel, sellos, racha), `careLoop` (equipo, servicios en curso, avisos), `careExport`
(CSV para Excel), `serviceCancel` (motivos de cancelación). Espejos de SQL: listas de reconocimientos, rangos de los CHECK,
`hx_duration_label`, texto del aviso de equipo libre.

**Interfaz**: `CareFeed`, `components/humanix/care/*` (línea de tiempo, resumen, compositor, cierre, cancelación, gracias,
trayectoria, pasaporte, equipo, historia, tablero), hook `use-care-loop.ts`. `servicio.$bookingId` sirve a cliente,
profesional y círculo (solo lectura).

## Verificación

| Qué | Resultado |
|---|---|
| PostgreSQL 16 real, roles reales, permisos simulados como en producción (`supabase/e2e/care_loop/run.sh`) | **264** comprobaciones: falsificación de registros, estados, círculo, alertas, gracias, trayectoria, equipo, plan B (institución y familia), historia con plan, permisos y idempotencia |
| Regresión: escenario del hub de instituciones sobre la misma migración | **252** comprobaciones |
| **Réplica de la estructura real de producción** (`supabase/e2e/prod_replica/run.sh`): la cadena de 8 migraciones sobre las tablas, políticas, disparadores, funciones y privilegios por defecto extraídos de la base real | **264 + 252 + 37** comprobaciones |
| **Producción (Lovable Cloud), 2026-10-09**: simulacro que se deshace solo → aplicación → huellas md5 de funciones, columnas, políticas, disparadores, índices y restricciones idénticas a la réplica → prueba de humo con datos sintéticos revertidos (chat, contacto, parte, cierre, gracias, trayectoria, plan de pago, permisos) | **60** comprobaciones |
| Pruebas unitarias (`src/lib`, 32 archivos) | **534** |
| Chromium real (Playwright): componentes, página del servicio por rol, paneles de familia/profesional/institución, 390 px, consola limpia | **102 + 14** pasos |
| Render en servidor de los componentes y de la página | 9 |
| `tsc`, `eslint` (reglas de código), anidamiento HTML | sin errores nuevos |

**Qué NO se pudo verificar** (para hacerlo con dos cuentas reales): canal Realtime real de Lovable Cloud (WebSocket), RLS vía
PostgREST con JWT reales (la prueba de humo simuló al usuario con `auth.uid()` y el rol de base de datos), envío de correos,
navegadores móviles reales, impresión a PDF del pasaporte.

## Estado de la base de Lovable Cloud

La sincronización del **código** con Lovable es automática al empujar a `main`. La **base de datos** no: Lovable no aplica los
archivos de `supabase/migrations/`, y publicar el sitio es otra acción (botón *Publish* de Lovable). El **2026-10-09** se aplicó
a la base de producción, con autorización expresa, la cadena pendiente de **8 migraciones**, en este orden:

`20261008100000` → `20261008200000` → `20261008210000` → `20261009050000` → `20261009100000` → `20261010100000` →
`20261010110000` → `20261010120000`

Método: (1) la estructura real se extrajo a una réplica local (`supabase/e2e/prod_replica/`) donde la cadena se probó entera;
(2) **simulacro** en producción: todo el SQL en una sola transacción terminada en `RAISE EXCEPTION` (se deshace sola), con un
bloque de aserciones que compara huellas md5 del cuerpo de cada función, de las columnas, políticas, disparadores, índices y
restricciones con las de la réplica y revisa los privilegios; (3) **aplicación** del mismo SQL, verificado byte a byte;
(4) comprobaciones posteriores y una **prueba de humo** con datos sintéticos dentro de una transacción que se revierte.

Resultado: funciones 36 → 132, tablas 66 → 81, políticas 175 → 195, disparadores 66 → 93, índices 158 → 204; la publicación
`supabase_realtime` pasó de vacía a **14 tablas**; `anon` no tiene ningún privilegio sobre las 16 tablas nuevas; todas las
tablas tienen RLS; `care_logs` tiene exactamente `care_logs_read`, `care_logs_professional_insert` y `care_logs_circle_read`.
La prueba de humo pasó **60/60** y no dejó datos.

Qué descubrió la base real (y no se veía desde el repositorio):

- **El chat no funcionaba**: cada mensaje dispara un `UPDATE` de `conversations.updated_at`, columna que no existía, así que
  ningún mensaje se podía enviar. Tampoco existían `booking_contact_reveals` ni `get_or_create_booking_conversation`, de modo que
  «Contactar» fallaba. Lo restablece `20261009050000_contact_and_chat_prereqs.sql`.
- **HR y evaluadores podían leer los partes** (datos de salud): `care_logs_read` usaba `is_staff()`. La cadena la reemplaza por
  una política que solo admite al cliente, al profesional y al superadmin (más el círculo aceptado, con su propia política).
- Toda tabla, secuencia o función nueva nace con `ALL` para `anon` y `authenticated` (privilegios por defecto de Supabase): las
  16 tablas nuevas quedan con el mínimo en `20261010120000_new_tables_least_privilege.sql`.
- `get_care_summary` no existía en producción (se crea ya endurecida), y la política de INSERT de `care_logs` de producción ya
  exigía ser el profesional de la reserva; la débil era la del repositorio.
- Muchas migraciones antiguas nunca se aplicaron en producción (referidos, billetera y pagos a profesionales, SGSST, sedes de
  instituciones…). **No se tocaron**: son una decisión aparte (ver «Límites»).

**Novena migración, aplicada el 2026-10-09:** `20261011100000_market_validation_v2.sql` (formulario inteligente de validación
de mercado, ver `docs/VALIDACION_MERCADO.md`), con el mismo método (réplica 57/57, simulacro que se deshace solo, aplicación,
huellas iguales y prueba de humo revertida). La publicación `supabase_realtime` pasó a **15 tablas**. Al cerrar la tabla al
navegador, la versión antigua publicada del formulario ya no puede guardar: conviene publicar la nueva interfaz (Publish → Update).

Comprobaciones posteriores (SQL):

```sql
select count(*) from pg_proc where proname in ('care_report','send_kudos','my_active_services','my_career_stats','my_trusted_team','care_history_report','plan_b_after_cancel');   -- 7
select tablename from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('care_logs','service_bookings','notifications');                                   -- 3
select has_table_privilege('authenticated','public.care_logs','UPDATE'), has_table_privilege('anon','public.care_logs','SELECT');                                                    -- false, false
```

En un entorno donde la migración aún no esté aplicada (un clon, por ejemplo) la interfaz **degrada con calma**: las tarjetas de
servicios en curso, trayectoria y equipo de confianza se ocultan sin mostrar errores, la historia exportable muestra un mensaje
amable al abrirla, el parte carga con `select *` y el compositor sigue funcionando (el ánimo solo se envía si se elige, y
requiere la migración). Lo que **no** existe hasta aplicarla: llegada/salida automáticas, alertas con aviso, círculo en el parte,
gracias y plan B.

## Límites y decisiones abiertas

- Las **alertas de signos vitales** usan rangos generales de adultos en reposo y siempre dicen que no son un diagnóstico; el
  profesional confirma. Pacientes con metas distintas (por ejemplo EPOC) requieren umbrales personalizados (futuro).
- El **círculo de cuidado** ve el servicio por una política por filas: a nivel de API puede leer el importe de la reserva. La
  pantalla no lo muestra; ocultarlo en la API exigiría una vista o RPC propia (pendiente de decisión).
- **Fotos del parte**: descartadas por diseño hasta tener consentimiento explícito.
- **Avisos por WhatsApp Business** (informativos, nunca pagos) quedan como siguiente paso; hoy los avisos son internos y en vivo.
- La carga masiva de `my_active_services` está limitada a 50 filas; el historial exportable, a 1.000.
- **Producción: pendientes que no se tocaron** (necesitan una decisión y, en varios casos, endurecimiento previo): las tablas que
  ya existían conservan `ALL` para `anon` y `authenticated` (solo las protege RLS); la política `pro_select_published_public`
  expone a `anon` todas las columnas de los profesionales publicados; las migraciones antiguas sin aplicar (referidos,
  billetera y pagos, SGSST, sedes); y las políticas de `realtime.messages` (los canales privados siguen sin política).
- **Sin probar con cuentas reales**: Realtime (WebSocket), PostgREST con JWT reales, correos y dispositivos móviles.
- La base de producción está casi vacía (sin reservas, perfiles de familia ni suscripciones): el primer uso real es el mejor
  momento para una prueba con dos cuentas.
