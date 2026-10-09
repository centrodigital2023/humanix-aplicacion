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
render en servidor y Chromium (41 pasos). **La migración `20261011100000_market_validation_v2.sql` está pendiente de aplicar
en producción (requiere aprobación).** No se pudo probar: Realtime real, PostgREST con JWT reales, envío real por
WhatsApp/Resend y navegadores móviles reales. Operación pendiente: secretos `WHATSAPP_OTP_TEMPLATE` (plantilla de
autenticación aprobada en Meta; sin ella el mensaje solo llega dentro de la ventana de 24 h) y `RESEND_API_KEY`.
