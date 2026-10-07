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
