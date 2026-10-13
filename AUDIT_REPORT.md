# Informe de auditoría

Base: lectura del repositorio. No se ejecutaron build, pruebas de Vitest ni nada contra Supabase, Mercado Pago o WhatsApp (el entorno no puede instalar dependencias: `bun install` devuelve 403 del registro privado).

## Hallazgos confirmados y estado

| # | Hallazgo | Estado |
|---|---|---|
| 1 | `ProAgendaModule` llamaba a `humanix-ai-chat`, inexistente | Corregido: usa `humanix-assistant` vía SDK. Si falla, muestra un aviso y la agenda sigue funcionando |
| 2 | `PatientRiskCard` mostraba un riesgo simulado cuando fallaba una función inexistente (`patient-risk-score`) | Corregido: alertas por reglas sobre `vital_signs` reales (`src/lib/patientRisk.ts`), con aviso de que no es diagnóstico. Sin datos: "Sin mediciones…" |
| 3 | CRM: `open_rate`, `click_rate`, `conversion_rate` aleatorios; gráfico con `Math.random` | Corregido: campañas como borrador, tasas nulas, "Datos insuficientes"; gráfico con contactos reales por mes (`src/lib/campaignMetrics.ts`) |
| 4 | `mp-webhook`: para créditos usaba `external_reference` (`credits:<uid>:<pack>`) como `userId`, así que la acreditación fallaba en silencio | Corregido |
| 5 | `mp-webhook`: sin idempotencia, respondía 200 aunque fallara, sin comprobar errores de escritura | Corregido: tabla `payment_webhook_events`, índice único en `ai_credit_topups(mp_payment_id)`, 500 para que Mercado Pago reintente |
| 6 | Sin `verify_jwt=false` en webhooks externos (rechazo 401 de Mercado Pago/Meta) | Corregido en `config.toml` |
| 7 | Cron RETHUS apuntaba a otro proyecto de Supabase | Corregido en migración |
| 8 | `fraud-detector` cobraba créditos IA al usuario que lo ejecutaba | Corregido (sin cobro, con límite de frecuencia) |
| 9 | Preconnect del `<head>` a un proyecto Supabase distinto | Corregido |
| 10 | WhatsApp: la IA podía mencionar medios de pago | Corregido: `paymentGuard` bloquea instrucciones y URLs fuera de `humanix.lat`/`wa.me` en `sendWhatsApp` |
| 11 | `bootstrap-superadmin` como segunda vía de superadmin | Eliminada junto con `/superadmin/activar` |

## Datos todavía no reales (no tocados)
- `EPSDashboard`: `trends` con `Math.random`, ingresos = servicios × 85.000 y reingreso fijo 4,2 %.
- `VitalSignsMonitor` (en `/evaluador`): simulador de signos vitales.
- `apply-referral-reward`: sin disparador.

## Limitaciones
Las reglas de `patientRisk.ts` son umbrales genéricos de signos vitales, **no un protocolo clínico validado**. Deben ser revisadas por un profesional de la salud antes de mostrarse a familias.

## Verificación del flujo de contratación (segunda pasada)

| # | Hallazgo | Estado |
|---|---|---|
| 12 | Un profesional no podía aceptar una propuesta de la familia: el insert en `service_bookings` exigía `client_id = auth.uid()` | Corregido con `accept_slot_proposal` (RPC atómica) |
| 13 | El proponente podía aceptar su propia propuesta (solo lo evitaba el filtro de la interfaz) | Corregido: solo el receptor puede aceptar |
| 14 | Sin protección contra doble reserva del mismo profesional ni auto-contratación | Corregido: trigger `guard_booking_integrity` con bloqueo por profesional |
| 15 | Estados de la reserva sin máquina de estados (cualquier parte podía saltar a `completed`) | Corregido para no-staff |
| 16 | La comisión mostrada era 15 % fija en la interfaz, pero el sistema acredita con 12 %/0 % según plan | Corregido: el RPC usa `platform_commission_pct` |
| 17 | `professional_bookmarks` referencia `profiles(id)` y es inutilizable con `auth.uid()` | Reemplazada por `care_favorites` |

## Riesgo abierto que requiere decisión del negocio
`credit_booking_completion` acredita en la billetera del profesional el neto de `total_amount` al pasar a `completed`, y existe `request_payout`. Pero las reservas se crean con `payment_mode = 'pending'/'direct_to_professional'`, es decir, **el cobro ocurre fuera de la plataforma**: Humanix puede estar acreditando saldo retirable por dinero que nunca recibió. Además otras vías (`QuickBooking`, `BookNowButton`) permiten que el cliente fije el monto de la reserva. Recomendación: acreditar solo reservas con pago confirmado en Mercado Pago (`payment_mode = 'platform'`) y, para pagos directos, registrar la comisión como deuda del profesional en vez de abono.

## Funciones añadidas (tercera pasada)
Migración `20261007200000_replacement_dimensions_circle.sql`: aviso de cancelación, `find_replacement_candidates`, `service_rating_dimensions` (validada en servidor, una por parte y servicio, solo servicios completados), `professional_dimension_averages` (mínimo 3), `care_circle_members` con `respond_circle_invitation` y política de solo lectura sobre `service_bookings`. Lógica pura probada: `pricing.ts`, `coverage.ts`, `ratingDimensions.ts`.

Límites conocidos: el círculo de cuidado muestra fecha, duración y estado de los servicios, no direcciones, pagos ni datos clínicos; el semáforo de cobertura usa `job_offers` y `applications` (no `slot_proposals`); los candidatos de reemplazo no filtran por ciudad ni especialidad todavía.

## Cuarta pasada: Marketplace + PQRS (superadmin)

| # | Hallazgo | Estado |
|---|---|---|
| 18 | El formulario de `/contacto` solo hacía `console.log` y mostraba «enviado»: **los mensajes de los usuarios se perdían** | Corregido: radica con la función de servidor `submitPqrs` y entrega radicado |
| 19 | Nada insertaba en `pqrs_tickets`, así que el panel de PQRS siempre estaba vacío | Corregido (canal público) |
| 20 | `superadmin.marketplace` ignoraba los errores de consulta: un fallo de permisos o esquema se veía como «0 resultados» | Corregido: aviso con error y migración requerida |
| 21 | La política `pqrs_insert_anonymous` permitía insertar tickets con estado/prioridad/resolución/asignación forjados y sin límite de frecuencia | Eliminada; solo `submitPqrs` (service role) |
| 22 | El flag `blocked` de las ofertas solo se respetaba en el detalle; `/buscar` seguía listándolas | Corregido en RLS de `job_offers` |
| 23 | El clasificador guardaba el *tipo de solicitud* en `ai_category` (la tabla documenta *tema*) y no defendía contra instrucciones dentro del ticket | Corregido: tema validado y texto delimitado como no confiable |
| 24 | El matchmaking mostraba solo un UUID truncado por profesional | Ahora nombre, razones y advertencias |
| 25 | `pqrs_tickets` fue retirada de Realtime (datos personales) pero el panel seguía suscrito, sin refresco alternativo | Refresco por intervalo y por notificación |

Detalle de reglas y límites en `docs/MARKETPLACE_PQRS_PANEL.md`.

## Quinta pasada: hub de oportunidades del profesional

| # | Hallazgo | Estado |
|---|---|---|
| 26 | **Cualquier usuario autenticado podía leer `family_needs` ajenas con dirección y notas** (política antigua nunca retirada) | Corregido: solo dueña y staff; lectura segura por RPC |
| 27 | `OpenFamilyNeedsList` y `AgendaViewer` leían `service_address` directamente: el «plan de pago» para ver la dirección habría sido solo visual | Reescritos sobre `list_open_family_needs` (sin dirección) |
| 28 | `slot_proposals` aceptaba por la API cualquier valor, estado (`accepted`) o edición posterior | Disparadores de integridad + funciones de negociación |
| 29 | `ProposalsInbox` resolvía nombres con `profiles.id` en vez de `profiles.user_id`: nunca mostraba nombres | `my_slot_proposals` (profesional ve a la familia abreviada) |
| 30 | Aceptar una propuesta solo cubría la primera hora de un turno de varias | `accept_slot_proposal` cubre todas las horas y cancela competidoras |
| 31 | La reserva creada al aceptar no llevaba la dirección del servicio | Se copia de la necesidad (o del perfil) |
| 32 | La barra «En vivo» del profesional contaba usuarios registrados (0/0) en vez de oportunidades reales | `OpportunityPulse` con turnos abiertos reales |
| 33 | TanStack Query figuraba como estándar pero no había proveedor ni ningún uso | `AppQueryProvider` en la raíz |
| 34 | `pqrs-intake` y `pqrs-assistant` eran Edge Functions nuevas (la regla del proyecto lo prohíbe) | Trasladadas a `createServerFn`; se eliminaron |
| 35 | Las tablas `pqrs_ticket_events` y `pqrs_intake_attempts` no tenían GRANT explícito | Migración `20261008210000_pqrs_table_grants.sql` |
| 36 | El calendario de la familia no guardaba tipo de cuidado ni notas, así que el match por tipo de cuidado no tenía datos | Campos opcionales en `FamilyNeedsCalendar` |

Detalle de reglas, constantes espejo y límites en `docs/PROFESIONAL_HUB_OPORTUNIDADES.md`.

## Sexta pasada: hub de instituciones y contrato inteligente

| # | Hallazgo | Estado |
|---|---|---|
| 37 | **`job_offers.address` era legible por cualquier usuario autenticado y las coordenadas eran exactas** (la dirección de una IPS o de una familia, publicada en la API) | Dirección, teléfono y coordenadas exactas pasan a `job_offer_private` (solo autor y staff); la oferta queda con coordenadas a 2 decimales |
| 38 | `applications` aceptaba por la API cualquier valor, estado (`accepted`) o edición posterior: un profesional podía aceptarse a sí mismo | Disparadores `applications_guard_insert/update` + funciones de postulación, contraoferta, aceptación y rechazo |
| 39 | `get_booking_contact` entregaba el teléfono del cliente al profesional sin mirar el plan ni dejar rastro | Plan, cupo diario y auditoría (igual que `reveal_offer_contact`) |
| 40 | El flujo de contratos anterior estaba roto e inseguro: `sign_contract` comparaba MD5 contra un SHA-256 con sal que no se guardaba (nadie podía firmar) y las políticas permitían editar cualquier columna, incluidas las firmas | Escritura cerrada; reemplazado por el contrato inteligente (identidad, código reciente, aceptación explícita, huella y cadena de eventos) |
| 41 | La institución «aceptaba» con un `UPDATE` de estado: sin reserva, sin turnos, sin dirección, sin contrato | `accept_application` crea reservas por turno (con dirección), bloquea la agenda, cierra competidoras y genera el contrato |
| 42 | `apply()` del profesional llamaba a `set_offer_reserved` desde el cliente: el privilegio estaba revocado (siempre fallaba) y, de funcionar, lo dejaría no disponible 15 días solo por postularse | Eliminado; `apply_to_offer` |
| 43 | La pestaña de ofertas del evaluador pedía `contact_phone` (columna sin permiso): la consulta fallaba | El teléfono se lee de `job_offer_private` (staff) |
| 44 | La barra «En vivo» de la institución contaba usuarios (0/0) y no había forma de saber qué turnos estaban en riesgo | Centro de cobertura con turnos reales, riesgo explicado y siguiente mejor acción |
| 45 | Las postulaciones nunca vencían: quedaban «pendientes» para siempre | Vencimiento (72 h / 24 h), cron cada 15 min y SLA visible |
| 46 | Las calificaciones decían «familia» aunque el profesional califique a una institución | Texto neutro; la institución recibe recordatorios para calificar al profesional |
| 47 | `offerQuality` penalizaba a toda oferta por «falta de dirección» una vez privada | La zona se mide con el área del servicio o el punto del mapa |
| 48 | Al leer el texto completo del contrato mientras se firmaba se perdían el código y las aceptaciones (hallado en la prueba de navegador) | La pestaña de firma permanece montada |

Detalle de reglas, constantes espejo, operación y límites en `docs/INSTITUCION_HUB_CONTRATO_INTELIGENTE.md`.

## Séptima pasada: lazo de cuidado (parte del turno, gracias, trayectoria, equipo de confianza)

| # | Hallazgo | Estado |
|---|---|---|
| 49 | **La migración original de `care_logs` (repositorio) aceptaba INSERT de cualquier autenticado sobre cualquier reserva** (la política solo comprobaba `professional_id = auth.uid()`). En producción la política ya exigía ser el profesional de la reserva, pero sin exigir servicio en curso ni tope: se podían escribir partes fuera de turno y sin límite | Política + guardia `care_logs_guard`: solo el profesional de la reserva, con el servicio en curso, tope de 200 |
| 50 | **`get_care_summary` era `SECURITY DEFINER` sin comprobar quién llama** y con EXECUTE por defecto en el repositorio: el resumen de salud de cualquier reserva era consultable con solo su id. En producción la función no existía | Se crea ya endurecida con `care_can_view` (parte, círculo aceptado o superadmin); sin acceso para `anon` |
| 51 | El compositor de la bitácora (`CareLogEntry`) no estaba montado en ninguna pantalla: el profesional no tenía cómo registrar el parte desde la interfaz | Compositor en la página del servicio (solo profesional, solo en curso) con atajos, ánimo y signos vitales con rangos |
| 52 | El panel de la familia buscaba solo reservas `confirmed`: el parte aparecía vacío antes del servicio y **desaparecía justo cuando el profesional empezaba a registrar** (`in_route` / `in_progress`) | `my_active_services` + Realtime sobre reservas y partes |
| 53 | «Cancelar» se mostraba a cualquiera que abriera la página (círculo, personal), pedía el motivo con `window.prompt` y no explicaba consecuencias | `CancelServiceDialog` solo para las partes, con motivo y consecuencia; el plan B y el aviso al equipo salen del servidor |
| 54 | **La publicación `supabase_realtime` de producción está vacía**: ningún `postgres_changes` llega en vivo (bitácora, chat, avisos). Además `realtime.messages` tiene RLS sin políticas (los canales privados quedan denegados) | `20261010110000_realtime_core_tables.sql` (idempotente) **aplicada el 2026-10-09: 14 tablas publicadas**; políticas de `realtime.messages`: decisión abierta |
| 55 | Las tablas de producción heredan `ALL` para `anon` y `authenticated` (valores por defecto de Supabase): la seguridad descansa solo en RLS | **Aplicado**: las 16 tablas nuevas con REVOKE + GRANT mínimo (`20261010120000`); `anon` sin privilegios en ellas. Las tablas que ya existían siguen con `ALL` (pendiente, tabla por tabla) |
| 56 | El círculo de cuidado puede leer el importe de la reserva por API (la política es por filas) | La interfaz no lo muestra; ocultarlo en la API exigiría una vista o RPC propia (decisión abierta) |
| 57 | Faltaban por aplicar en la base de Lovable Cloud las migraciones `20261008100000`, `20261008200000`, `20261008210000` y `20261009100000`, de las que depende esta | **Aplicadas el 2026-10-09** (8 migraciones con las dos nuevas), tras simulacro que se deshace solo; ver «Estado de la base» en `docs/LAZO_DE_CUIDADO.md` |
| 58 | **En producción no se podía enviar ningún mensaje de chat**: el disparador de `conversations` asigna `NEW.updated_at` y la columna no existía (`record "new" has no field "updated_at"`). Solo se vio contra la estructura real, no con el esquema aproximado de las suites | `conversations.updated_at` en `20261009050000_contact_and_chat_prereqs.sql`; comprobado en producción (mensajes de familia y profesional) |
| 59 | **La tarjeta «Contactar» fallaba**: no existían `booking_contact_reveals` ni `get_or_create_booking_conversation` (migración antigua nunca aplicada) | Se crean (RLS, sin sesión no abre el chat, solo las partes, auditoría de cada consulta de contacto) en la misma migración |
| 60 | **HR y evaluadores podían leer los partes del turno** (datos de salud): la política `care_logs_read` de producción usaba `is_staff()` | La cadena elimina las políticas de lectura previas y deja `care_logs_read` (cliente, profesional y superadmin) + `care_logs_circle_read`; comprobado en producción |
| 61 | Privilegios por defecto de Supabase: toda tabla, secuencia y función nueva queda con `ALL` para `anon` y `authenticated` (varias tablas nuevas de las migraciones recientes quedaban con más privilegios que los previstos) | `20261010120000_new_tables_least_privilege.sql` y REVOKE explícitos en `offer_team_invites` y `booking_contact_reveals`; el simulacro audita los privilegios de las 16 tablas y de cada función |
| 62 | Las suites de PostgreSQL usaban un esquema **aproximado** de producción: pasaban mientras la base real tenía otras políticas, columnas y disparadores | `supabase/e2e/prod_replica/`: estructura real extraída (26 tablas, políticas, disparadores, funciones, privilegios por defecto) sobre la que se prueba toda la cadena (264 + 252 + 37) |
| 63 | Pendientes **no** tocados en producción: migraciones antiguas sin aplicar (referidos, billetera y pagos, SGSST, sedes); la política `pro_select_published_public` expone a `anon` todas las columnas de los profesionales publicados; tablas previas con `ALL` para `anon` | Decisión aparte; requieren endurecimiento previo antes de aplicarlas |

Detalle de reglas, verificación y límites en `docs/LAZO_DE_CUIDADO.md`. Verificado con PostgreSQL 16 real (264 + 252
comprobaciones sobre la réplica de producción, más 37 de deriva), 534 pruebas unitarias, render en servidor y Chromium (102 + 14
pasos); en producción, simulacro, aplicación y prueba de humo de 60 comprobaciones revertida. No se pudo probar: Realtime real,
PostgREST con JWT reales, correos y navegadores móviles reales.

## Octava pasada: formulario inteligente de validación de mercado (`/validacion`)

| # | Hallazgo | Estado |
|---|---|---|
| 64 | **`validation_responses` aceptaba INSERT de cualquier visitante con cualquier columna** (política `public_insert`): se podían enviar filas con `premium_activated = true` y un `promo_code` a gusto | Política eliminada; el navegador no tiene privilegios sobre la tabla; solo el servidor (service role, `createServerFn`) escribe |
| 65 | **El panel de superadmin nunca veía una fila**: la única política de lectura era «auth.role() = service_role» y el panel consulta con la sesión del usuario | Política de lectura por rol (`has_role(..., 'superadmin')`) y la tabla entra en Realtime (RLS aplica): el panel se tabula solo |
| 66 | El código `MLP-…` se asignaba a TODA fila al insertar (verificada o no) y ninguna pantalla lo canjeaba: el «beneficio» no hacía nada | El código nace al verificar el contacto, uno por contacto y uno por cuenta (índices únicos parciales), vigencia de 60 días; `redeem_validation_benefit` activa 1 mes del plan Esencial en `mp_subscriptions` |
| 67 | **`validation_otps` guardaba el código en claro y las Edge Functions `send-validation-otp` / `verify-validation-otp` eran públicas, sin límites ni tope de intentos**: fuerza bruta del código de 6 dígitos y envío masivo de WhatsApp/correo a costa de Humanix | Reemplazadas por funciones de servidor: *hash*, vigencia 15 min, 5 intentos con contador atómico, límites por respuesta, contacto e IP. Las funciones antiguas se quitaron del repositorio; **deben retirarse también del despliegue de Lovable Cloud** |
| 68 | Las dos tablas nacían con `ALL` para `anon` y `authenticated` (privilegios por defecto de Supabase) | `REVOKE` + `GRANT` mínimo en la misma migración (`validation_otps` solo para el service role) |
| 69 | La pantalla no preguntaba 3.1 (¿paga hoy?) ni 3.3 (dónde busca; la columna existía sin campo), las alternativas eran un solo texto y la persona se calificaba sola en 6 factores de 0 a 5 | Formulario de 4 secciones con todas las preguntas; «señal de demanda» automática de 0 a 100 |
| 70 | Zod 4 omite las reglas cruzadas (`superRefine`) mientras otro campo del objeto tenga un error de tipo: en un formulario por secciones esas reglas no se aplicaban hasta el envío | `crossFieldIssues` exportada y aplicada por sección |
| 71 | Hallado en el navegador: el error de una regla cruzada («si hoy pagas, menciona una alternativa») no se quitaba al corregirlo; en 390 px el botón «Enviar» se salía de la tarjeta (scroll horizontal); el deslizador no tenía nombre accesible; el detalle del panel mostraba claves internas (`job_boards`) | Corregidos y cubiertos por la prueba de navegador |
| 72 | Hallado en el navegador: quien volvía a un borrador y enviaba rápido era tomado por robot por el filtro de rapidez (8 s) y **perdía sus respuestas** | El borrador guarda el instante de apertura original; escenario de regresión con control |

Detalle de reglas, operación y límites en `docs/VALIDACION_MERCADO.md`. Verificado con 91 pruebas unitarias nuevas (625 en
total), PostgreSQL 16 sobre la réplica de producción (57 comprobaciones de mercado; regresión completa 264 + 252 + 37 + 57),
render en servidor y Chromium (41 pasos). **La migración `20261011100000_market_validation_v2.sql` se aplicó en producción el 2026-10-09**
con autorización expresa (simulacro que se deshace solo con 28 comprobaciones, aplicación con guarda md5, 11 huellas de
estructura idénticas a la réplica y prueba de humo posterior 28/28 revertida; Realtime 14 → 15 tablas). No se pudo probar: Realtime real, PostgREST con JWT reales, envío real por
WhatsApp/Resend y navegadores móviles reales. Operación pendiente: secretos `WHATSAPP_OTP_TEMPLATE` (plantilla de
autenticación aprobada en Meta; sin ella el mensaje solo llega dentro de la ventana de 24 h) y `RESEND_API_KEY`.

## Novena pasada: funciones inteligentes y auditoría de la validación de mercado

Se añadió la capa de inteligencia (pestaña «Hallazgos», antifraude, avisos de contactos fuertes) y se auditó de nuevo toda
la lógica del formulario, con una revisión independiente del código nuevo. **No hay migración nueva**: todo se calcula
en el navegador o en funciones de servidor sobre las tablas ya aplicadas.

| # | Hallazgo | Estado |
|---|---|---|
| 73 | **La IP del cliente salía del primer valor de `x-forwarded-for`, que escribe quien llama**: los límites por IP de PQRS, contratos y del formulario se evadían cambiando un encabezado (o se podía agotar el cupo de otra persona) | `src/lib/clientIp.ts`: manda `cf-connecting-ip` (lo escribe el borde de Cloudflare), con respaldo `x-forwarded-for` y `x-real-ip`; una sola función para los tres módulos, con prueba de falsificación |
| 74 | El filtro de rapidez comparaba la hora del dispositivo con la del servidor: un reloj atrasado o adelantado dejaba pasar a un robot o tomaba por robot a una persona real | El formulario envía una **duración** (`fillMs`, `performance.now()`), obligatoria; el borrador conserva el tiempo ya invertido |
| 75 | Los límites por IP (5/h) bloqueaban a oficinas y redes móviles compartidas, justo el público de una validación de mercado | 20/h y **solo cuentan los no verificados**; freno global de WhatsApp de 300/h que no afecta al correo (`channel_unavailable`) |
| 76 | La serie «respuestas por día» agrupaba por día UTC (lo recibido desde las 7 p. m. de Colombia caía en el día siguiente) y se rompía con una fecha dañada | Alineada a la hora de Colombia y con guarda para fechas inválidas |
| 77 | Las llamadas a Meta y a Resend no tenían tiempo máximo: una caída del proveedor dejaba colgado el envío | Límite de 8 s y error claro; el cambio de canal sigue disponible |
| 78 | **Nada impedía que varias personas pegaran el mismo texto y cada una ganara 1 mes del plan Esencial**, ni usar correos temporales | `isDisposableEmail` y comparación de textos entre contactos verificados distintos (Jaccard ≥ 0,8): la respuesta queda en revisión, sin código |
| 79 | Quien quedaba en revisión perdía el borrador y debía escribir todo de nuevo | El borrador se conserva y «Reescribir con mis palabras» vuelve a la sección 2 con lo escrito |
| 80 | (Revisión independiente) **Las respuestas con aviso grave inflaban el veredicto, la madurez de la muestra, los temas, los segmentos y la lista de contacto**: 60 respuestas copiadas «perfectas» podían volver «validado» un mercado débil | Esas respuestas siguen guardadas y visibles en «Respuestas», pero no cuentan en la lectura; un hallazgo dice cuántas quedaron fuera |
| 81 | (Revisión independiente) Los segmentos se agrupaban uniendo perfil y ciudad con `\|`: una ciudad escrita con ese símbolo se partía mal | Agrupación por objeto, no por texto concatenado |
| 82 | (Revisión independiente) Los avisos de contactos fuertes no tenían tope: una ráfaga de respuestas inundaba las notificaciones de los superadmin | Tope de 30 avisos por hora; son de mejor esfuerzo y nunca rompen la verificación |
| 83 | El panel cargaba como máximo 5 000 filas sin decirlo; en 390 px el código del beneficio se salía de su tarjeta | Aviso de recorte y diseño apilado que parte el código |

Un hallazgo de la revisión se aceptó como **límite documentado**: la detección de respuestas copiadas depende del orden de
llegada (la primera persona conserva el código) y dos envíos casi simultáneos pueden pasar ambos; el costo máximo es un
mes Esencial.

Detalle de reglas, operación y límites en `docs/VALIDACION_MERCADO.md` (§4, §7.1, §11). Verificado con 250 pruebas del
módulo (783 en total en 37 archivos), PostgreSQL 16 sobre la réplica de producción (regresión completa 264 + 252 + 37 +
57, sin fallos), render en servidor (11/11) y Chromium (53/53 pasos, sin errores de consola). No se pudo probar: Realtime
real, envío real por WhatsApp/Resend y navegadores móviles reales.

## Décima pasada: panel de familia inteligente y premium

Se añadió el «centro de cuidado» del panel de familia (resumen priorizado del día para todas y, con el plan Esencial,
informe de bienestar, comparador de postulaciones, presupuesto y radar de cobertura) y se revisó lo que el panel ya hacía.
**No hay migración, ni Edge Function, ni cambio de precios**: todo son cuentas en el navegador sobre datos que la familia ya
puede leer.

| # | Hallazgo | Estado |
|---|---|---|
| 84 | `onboardingComplete` (documento, dirección, contacto de emergencia y consentimiento) se calculaba al cargar el panel de familia pero **ninguna pantalla lo leía**: una familia sin contacto de emergencia no recibía ningún aviso, aunque ya tuviera servicios | El resumen del día lo vuelve acción (prioridad alta si ya hay servicios) con su propio dato de «contacto de emergencia» |
| 85 | La historia de cuidado exportable (plan Esencial) estaba en la tarjeta de precios pero no en la tabla comparativa de `/planes` | Fila añadida, junto con la del panel de familia inteligente |
| 86 | Una solicitud de servicio **pendiente** (que el profesional aún no confirmó) habría contado como «gasto programado» y habría inflado el piso de la proyección | Solo cuentan los servicios confirmados, en camino o en curso (prueba nueva) |
| 87 | Revisión de la propia lógica nueva: el lector de números aceptaba `[]`, `true` o `"  "` como un cero escondido; mientras se leía el plan, quien ya paga veía por un instante los candados y la invitación a pagar | Solo se aceptan números y texto numérico; el centro muestra un esqueleto hasta conocer el plan (prueba de navegador con la lectura retrasada) |
| 88 | **Observación, sin tocar:** la función de plan `whatsapp_contact` está declarada pero ninguna pantalla la consulta; el botón de WhatsApp de las postulaciones del panel depende solo de que el teléfono sea legible | Pendiente de decisión del negocio (¿se cierra por plan o por servidor?) |
| 89 | **Observación, sin tocar:** el manejador de Realtime de postulaciones del panel llama a `setApplications` y a un aviso dentro de la función de actualización de `setOffers`; en modo estricto puede duplicar el aviso «Nueva postulación» | Pendiente: moverlo a una referencia con los ids de las ofertas |
| 90 | **Observación, sin tocar:** `plans.ts` (5), `planes.tsx` (1) y `dashboard.familia.tsx` (26) ya traían errores de formato de Prettier antes de esta ronda; los cambios nuevos no añaden ninguno | Pendiente de un `prettier --write` aparte |

Detalle de reglas, permisos y límites en `docs/PANEL_FAMILIA_PREMIUM.md`. Verificado con 274 pruebas unitarias nuevas
(1 057 en total, 46 archivos; ≈ 60 mutaciones deliberadas de umbrales, todas detectadas), Chromium (27/27 pasos a 1 000 y
390 px, con Realtime, cuenta vacía y consulta caída), renderizado en servidor (11/11) y ESLint/`tsc` limpios en lo nuevo. No
se pudo probar: Realtime real y navegadores móviles reales.

## Undécima pasada: paneles del profesional y de la institución, y portal EPS/IPS

Se añadieron los resúmenes «Tu día» (gratis) y las herramientas premium del profesional y de la institución, y se revisó lo que
esos paneles y el portal EPS/IPS ya hacían. **Las funciones nuevas no llevan migración, ni Edge Function, ni cambio de precios**:
todo son cuentas en el navegador sobre datos que la persona o la institución ya puede leer. La única migración de esta pasada es
de cierre de seguridad y salió de revisar los datos clínicos (#97 y #106 a #112).

| # | Hallazgo | Estado |
|---|---|---|
| 91 | Inicio del profesional y el de la institución traían una «brújula» genérica (`CareCompassCard`) que contaba solo notificaciones, propuestas y ofertas: no sabía de alertas del servicio, quien no llegó, turnos por quedar sin cubrir ni contratos sin firma | Sustituida por «Tu día» (`ProHero`, `InstHero`) con calma, saludo cálido y lo urgente primero; cada botón lleva a su sección. `CareCompassCard` y `careCompass.ts` quedan sin uso (se pueden borrar con su prueba) |
| 92 | El planificador de ingresos del profesional estaba suelto en Inicio, lejos de donde se miran los ingresos | Se mueve a la pestaña «Crecer», junto a «Ingresos reales» |
| 93 | **Portal EPS/IPS (`/dashboard/eps`): las gráficas de tendencia usaban `Math.random()`**, la «facturación» era servicios terminados × $85.000, el cumplimiento salía de una fórmula arbitraria (más 20 puntos), y los reingresos (4,2 %), «+12 %», «+3 %», «−1,2 %» y «3,2 h por visita» eran constantes | Reemplazado por datos reales (`lib/epsMetrics.ts`): servicios y alertas por día, inversión realmente pagada, riesgo clínico promedio, duración promedio con mínimo de muestra. Lo que no se puede calcular se dice («sin datos», «no se pudieron cargar»), no se inventa |
| 94 | **El resumen del portal EPS leía alertas, puntajes de riesgo y registros de entrada de TODA la plataforma**: el filtro por `tenant_id` se declaraba y nunca se aplicaba | Ahora se piden solo por los ids de los servicios de la institución (últimos 120 días, de a 100). Una prueba de navegador comprueba que una alerta crítica de otra institución **no** aparece |
| 95 | La pestaña de pacientes mostraba cuatro pacientes de ejemplo que, al tocarlos, abrían el monitoreo clínico con **el id de la propia institución** como si fuera el paciente; la de alertas hacía lo mismo | Se usan los módulos reales: `EnhancedPatientsModule` (pacientes) e `InstitutionClinicalMonitoring` (monitoreo y alertas) |
| 96 | La pestaña «Cumplimiento» mostraba porcentajes fijos (87 %, 74 %, 92 %…) y una lista de sellos que la aplicación no puede comprobar: «HIPAA Ready», «GDPR Ready», «MFA habilitado», «Encriptación TLS 1.3», «Backups automáticos», «ISO 27001»; el encabezado decía «Multi-tenant» y «HIPAA · GDPR ready». Los «Reportes IA» tenían fechas de junio de 2026 y botones sin función | Indicadores reales de calidad y cumplimiento (plan IPS Mejorado), enlaces a Habeas Data, privacidad y cumplimiento normativo, con el aviso de que el portal **no certifica** por sí solo el cumplimiento; los reportes son el centro de gestión real |
| 97 | **Corregido el 2026-10-12 — y mi hallazgo original estaba mal planteado.** Escribí que `clinical_alerts_read`, `risk_scores_read` y `checkins_patient_read` dejaban leer los datos de **todos** los pacientes a cualquier institución (y que `clinical_alerts_update` dejaba modificar cualquier alerta). Eso salía de los archivos del repositorio (`20260606100000_clinical_monitoring.sql`), **no de la base real**, y producción **no tenía esa exposición**: esos archivos nunca se aplicaron allí. En producción solo existe `clinical_alerts`, creada por otra cadena de migraciones (`drizzle/migrations/0007`) con políticas ya estrechas (el paciente, el profesional del servicio y el staff); `patient_risk_scores`, `service_checkins`, `vital_signs`, `alert_thresholds`, `clinical_reports` y la vista `eps_dashboard_metrics` no existen | El archivo del repositorio seguía siendo una trampa para cualquier entorno nuevo. Se añade `20261012100000_clinical_data_scope.sql`: reemplaza las políticas «por rol» por «por servicio» (paciente, profesional del servicio, quien contrató, superadmin), fija `security_invoker` en la vista, retira privilegios sobrantes y **falla sin cambiar nada** si encuentra una política «por rol» que no conoce; donde la tabla no existe no hace nada y nunca añade lectores. Probada sobre la réplica de producción y la cadena del repositorio (`supabase/e2e/clinical_scope`: 59 + 7 + 22 comprobaciones y 3 casos de política desconocida; 23 mutantes de SQL, todos detectados). **Aplicada en producción el 2026-10-12** tras dos simulacros que se deshicieron solos: su único efecto fue quitar de `clinical_alerts` los privilegios de `anon` y `TRUNCATE`/`REFERENCES`/`TRIGGER`/`MAINTAIN` de `authenticated`; **ninguna política cambió** (huella de las políticas de todo el esquema `public` idéntica antes y después) |
| 98 | La barra inferior del panel de la institución tenía 8 pestañas en una rejilla de 7: la octava caía a una segunda fila | Barra desplazable con la pestaña activa siempre a la vista; probada de 320 a 430 px |
| 99 | `MonthBars` (gráfica compartida): la tabla oculta para lector de pantalla ensanchaba la página en pantallas angostas con montos de siete cifras (27 px de desborde a 320 px) | La tabla va dentro de un contenedor `sr-only`; la prueba de navegador lo cubre |
| 100 | El saludo del héroe tomaba la primera palabra del nombre: «Clínica del Norte» recibía «Buenos días, Clínica» | Las instituciones se saludan por su nombre completo |
| 101 | La cabecera del panel de la institución decía «2 postulaciónes nuevas» | Corregido |
| 102 | (Lógica propia, antes de publicar) El informe de gestión nombraba a profesionales en «para atender» y «lo que va bien», y calculaba «+1100 %» contra un periodo anterior de un solo servicio | El informe no nombra a nadie (el CSV de auditoría sí lleva el profesional) y solo compara con porcentaje si el periodo anterior tuvo ≥ 3 servicios |
| 103 | (Lógica propia) Las horas salían con punto decimal («70.7 h») entre cifras con separador de miles colombiano | `hoursEs`: coma decimal en todas las pantallas, informes y CSV |
| 104 | La base **no guarda quién canceló** un servicio | Se infiere por la etiqueta del motivo de la lista; «Otro motivo» queda «sin dato» y no se atribuye a nadie (límite documentado) |
| 105 | **Observación, sin tocar:** `dashboard.institucion.tsx` conserva dos avisos previos de `react-hooks/exhaustive-deps` (`navigate` y `user`) | Pendiente de una limpieza aparte |
| 106 | **El monitoreo clínico del repositorio no existe en producción (deriva).** Faltan `service_checkins` (check-in/out con ubicación), `patient_risk_scores`, `vital_signs` (que usa la tarjeta de riesgo), `alert_thresholds`, `clinical_reports` e `institution_patient_cases` (pacientes que agrega la institución). `clinical_alerts` existe pero sin las columnas `lat` y `lng`, sin el tipo `sos_manual`, **sin política de INSERT** y **sin disparador hacia `clinical-alert-notify`** (ni existe `notify_edge_function`). Lo vi en la base real el 2026-10-12 | **Sin tocar: son funciones, no un cierre de seguridad, y necesitan tu aprobación.** Efecto hoy: el botón **«SOS Familiar»** de «Salud en vivo» (alcanzable desde el panel de familia) **no puede enviar nada** y, aunque lo enviara, no avisaría por WhatsApp; el check-in/out del profesional falla; la tarjeta de riesgo queda vacía. Lo único que se hizo: el aviso del SOS ya no muestra un error técnico en inglés sino «No se pudo enviar el SOS. Si es una emergencia, llama ya al 123…». Para habilitarlo hay que aplicar con aprobación `20260606220000_sos_familiar_alert.sql` y cablear el aviso (detalle en `docs/PANELES_PREMIUM.md` §4) |
| 107 | **Portal EPS: «0 alertas» y «no se pudieron cargar» donde en realidad el monitoreo clínico no está habilitado.** Con `patient_risk_scores` ausente el portal decía «no se pudieron cargar» (un fallo que no se arregla reintentando) y, con `clinical_alerts` existente pero ilegible para la institución, mostraba **«0 alertas» y «ninguna crítica»**: una calma que nadie había comprobado. Además la suscripción Realtime juntaba las dos tablas en un canal que podía fallar entero por la que no existe, y el encabezado decía «Monitoreo en vivo» | Corregido: `isMissingTable` y `clinicalReadStatus` (`lib/epsMetrics.ts`) distinguen «tabla ausente» de un fallo real (columna, permiso, red); si falta alguna de las dos tablas el portal dice «monitoreo clínico aún no disponible» en las cuatro cifras y en las dos tarjetas, sin cifras en cero; cada suscripción Realtime empieza solo cuando su lectura funcionó; el encabezado dice «Se actualiza en vivo». 11 pruebas nuevas (17 mutantes, todos detectados) y 4 pasos de navegador |
| 108 | **Observación, sin tocar: la institución no puede leer las alertas de sus propios servicios.** La política de lectura de producción admite al paciente, al profesional del servicio y al staff; **quien contrató el servicio (familia o institución) no está**. El portal EPS no podría mostrarlas aunque existieran | Aflojar esto es decisión tuya. Propuesta mínima, con el SQL, en `docs/PANELES_PREMIUM.md` §4 (una política `SELECT` limitada a las reservas de quien consulta) |
| 109 | **Observación, sin tocar: HR y evaluadores leen datos de salud.** `is_staff()` incluye `hr_staff` y `evaluator`: `clinical_alerts_read`/`clinical_alerts_ack`, `vital_signs_readings` y `wearable_connections` (incluido el código de emparejamiento `external_user_id`, con el que se envían lecturas) las abren a ese personal. `care_logs` ya se corrigió con el mismo criterio (`20261010100000`) | Hoy no hay cuentas de esos roles (el único rol asignado en la base real es el del superadmin; ver #112) y las tablas están vacías, así que no hay exposición real. Cambiar `is_staff` por `has_role(..., 'superadmin')` es una línea por política (en `docs/PANELES_PREMIUM.md` §4); no se hizo porque cambia el comportamiento de producción |
| 110 | **Observación, sin tocar: `anon` conserva `ALL` sobre `vital_signs_readings` y `wearable_connections`** (privilegios por defecto de Supabase); solo las protege RLS | `REVOKE ALL … FROM anon` y retirar `TRUNCATE`/`REFERENCES`/`TRIGGER`/`MAINTAIN` a `authenticated`, como se hizo con `clinical_alerts`: queda para tu aprobación porque son dos tablas que no estaban en este hallazgo |
| 111 | **El repositorio tiene dos cadenas de migraciones y producción siguió una sola.** `supabase/migrations/` incluye archivos de junio (`20260606*`) que **nunca se aplicaron** y `drizzle/migrations/` (la que sí llegó) crea versiones distintas y más seguras de las mismas tablas. Producción tampoco registra en `schema_migrations` lo aplicado a mano (la última versión registrada es `20260622163525`) | Advertencia añadida arriba de `20260606100000_clinical_monitoring.sql`; la migración correctiva queda detrás para quien aplique la cadena completa en un entorno nuevo. Conviene decidir cuál es la cadena oficial antes de crear más migraciones. **Actualización 2026-10-13:** el registro de Drizzle de producción (15 filas, SHA-256 del archivo y `when` del diario) coincide al 100 % con el repositorio; se agregó una sonda de solo lectura (`scripts/migration-drift-probe.ts`, `src/lib/migrationProbe.ts`) y una guarda en `bun test` para las seis funciones delegadas al personal. Resultado en producción: octubre 674 de 685 objetos coinciden (las 14 migraciones del 11 al 13 de octubre, al 100 %); en la cadena antigua faltan 86 de 216 objetos del «esqueleto», casi todos del bloque del 5 al 11 de junio. Detalle, pantallas afectadas y decisiones en `docs/MIGRACIONES.md` |
| 112 | **En producción no existe el disparador `on_auth_user_created` de `auth.users`**, el que ejecuta `handle_new_user()` para crear el perfil, asignar el rol y crear el perfil de familia, profesional o institución al registrarse. La función existe; el disparador no (en `auth.users` solo hay los internos de claves foráneas). Cifras de la base real el 2026-10-12: **11 cuentas desde el 5 de octubre, 11 sin fila en `profiles`, 10 sin rol en `user_roles` (las 10 con el rol elegido en el registro guardado solo en los metadatos), 0 `family_profiles`, 0 `institution_profiles` y 0 `subscriptions`**; 3 profesionales tienen `professional_profiles` pero tampoco rol. La pantalla lo disimula (sin filas en `user_roles` usa el rol de los metadatos, o `family`), pero lo que decide la base no: p. ej. `apps_insert_pro` exige `has_role(…, 'professional')`, así que esas cuentas **no pueden postularse** (hay 0 postulaciones), y todo lo que lee `profiles` (nombres, fotos, chat, vistas públicas) no las ve | **Sin tocar: cambia producción y escribe datos de personas, y necesita tu aprobación expresa (tu «aprobar la migración» fue para la de datos clínicos).** Propuesta: recrear el disparador (el SQL ya está en `20260521214319`) y rellenar perfil, rol y perfil por rol de las 10 cuentas con los mismos pasos de `handle_new_user()` (idempotente, `ON CONFLICT DO NOTHING`), con simulacro que se deshace solo antes de aplicar. Hipótesis sin verificar: la base se recreó alrededor del 5 de octubre con el esquema `public` pero sin los disparadores del esquema `auth`; la fecha del primer registro coincide |

Detalle de reglas, permisos y límites en `docs/PANELES_PREMIUM.md`. Verificado con 1 812 pruebas unitarias (65 archivos; las del
lote: profesional 214, institución 376, portal EPS 37), pruebas de mutación de la lógica de institución, EPS y ayudantes
compartidos (0 sobrevivientes al cerrar), Chromium (institución y portal EPS 64/64 pasos de 320 a 1 280 px; profesional 25/25;
familia 27/27 como regresión), renderizado en servidor sin `window` (institución 20/20, profesional 14/14, familia 11/11), la réplica
de PostgreSQL de producción (lazo de cuidado 264, hub de instituciones 252, deriva 37, validación de mercado 57: todas sin fallos,
ya con la migración nueva en la cadena), la suite SQL de datos clínicos (`supabase/e2e/clinical_scope`) y `tsc`/ESLint/Prettier limpios en
lo nuevo (`tsc` solo muestra los 90 errores de módulos que este entorno no tiene instalados, los mismos que antes de los cambios).
No se pudo probar: Realtime real, PostgREST con JWT reales y navegadores móviles reales.

