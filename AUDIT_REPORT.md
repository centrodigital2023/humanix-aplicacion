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
