# Matriz de disparadores backend

Estado verificado leyendo el código, `supabase/config.toml` y `supabase/migrations`. Nada se probó contra el proyecto real de Supabase.

| Función | Cómo se activa | Fuente | Estado | Riesgo | Prueba |
|---|---|---|---|---|---|
| `mp-webhook` | Webhook de Mercado Pago (`notification_url` fijada en cada preferencia) | `mp-create-subscription`, `mp-create-credits-checkout` | Conectado. Se corrigió identidad de usuario, idempotencia y reintentos | Muy alto | Pendiente de prueba con sandbox de Mercado Pago |
| `whatsapp-webhook` | Webhook de Meta | Configuración en Meta (externa) | Conectado. Salida protegida por `paymentGuard` | Alto | `src/lib/paymentGuard.test.ts` |
| `fraud-detector` | Frontend tras subir un documento (`DocumentsManager`); staff puede pasar `user_id` | Código | Conectado. Sin cobro de créditos, limitado a 1 análisis/10 min por usuario | Medio | Pendiente |
| `generate-contract` | Botón "Generar contrato" en la página del servicio (`ServiceContractCard`) | Código | Conectado | Alto | Pendiente |
| `care-alerts` | Trigger SQL `care_logs_alert_webhook` vía `pg_net` | Migración `20261007170000` | Conectado si existe el secreto de Vault `internal_webhook_secret` | Alto | Pendiente |
| `clinical-alert-notify` | Trigger SQL `clinical_alerts_notify_webhook` vía `pg_net` | Migración `20261007170000` | Igual que la anterior | Alto | Pendiente |
| `rethus-weekly-check` | `pg_cron` semanal (lunes 9:00 UTC) | Migración `20261007170000` (corrige URL de otro proyecto) | Conectado si existe el secreto `rethus_cron_secret` | Medio | Pendiente |
| `apply-referral-reward` | Llamada manual de superadmin o interna con `INTERNAL_WEBHOOK_SECRET` | Código | **Huérfana**: ningún proceso la invoca. `mp-webhook` no la llama | Medio | Pendiente |
| `bootstrap-superadmin` | — | — | **Eliminada** | — | — |
| `humanix-ai-chat` | — | — | **No existía**. El módulo de agenda usa `humanix-assistant` | — | — |

## Requisitos para que funcionen
- Secretos de Edge Functions: `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET`, `WHATSAPP_*`, `WHATSAPP_APP_SECRET`, `INTERNAL_WEBHOOK_SECRET`, `RETHUS_CRON_SECRET`, `ADMIN_ACCESS_CODE`, `LOVABLE_API_KEY`.
- Secretos de Vault: `internal_webhook_secret` (mismo valor que `INTERNAL_WEBHOOK_SECRET`) y `rethus_cron_secret`.
- `verify_jwt = false` en `config.toml` para las funciones que reciben llamadas externas (ya agregado).

## Observabilidad
Tabla `function_execution_logs` y tarjeta "Salud de funciones backend" en `/superadmin` (pestaña Operaciones). Instrumentadas: `mp-webhook`, `whatsapp-webhook` (mensajes bloqueados), `fraud-detector`, `generate-contract`. Sin instrumentar: el resto.

## Funciones añadidas (Marketplace + PQRS)

| Función | Cómo se activa | Auth | Estado | Prueba |
|---|---|---|---|---|
| `pqrs-intake` | Formulario público de `/contacto` y consulta de estado | Pública (`verify_jwt=false`); validación, campo trampa, límites por hash | Conectada | Reglas probadas (`pqrsRules.test.ts`); falta prueba contra Supabase |
| `pqrs-assistant` | Botón «Borrador con IA» del panel | JWT + rol staff; 30 borradores/h | Conectada | Barrera de pagos probada (`paymentGuard.test.ts`) |
| `pqrs-classifier` | «Clasificar IA» y «Clasificar pendientes» | JWT + dueño del ticket o staff | Conectada (endurecida) | Piso de seguridad probado |

Tablas nuevas: `pqrs_ticket_events`, `pqrs_intake_attempts`. RPCs nuevas: `marketplace_city_balance`,
`suggest_professionals_for_offer`, `invite_matching_professionals`, `moderate_offer`.
Secrets: `LOVABLE_API_KEY` (ya existente). Opcional: `PQRS_AI_MODEL` (por defecto `google/gemini-2.5-flash`).
