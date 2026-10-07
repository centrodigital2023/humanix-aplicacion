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
