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
| `submitPqrs` / `lookupPqrsStatus` (función de servidor, antes `pqrs-intake`) | Formulario público de `/contacto` y consulta de estado | Pública; validación, campo trampa, límites por hash | Conectada | `pqrs.server.test.ts` con base simulada; falta prueba contra Supabase |
| `draftPqrsReply` (función de servidor, antes `pqrs-assistant`) | Botón «Borrador con IA» del panel | JWT + `is_staff`; 30 borradores/h | Conectada | `pqrs.server.test.ts`, `pqrsAi.test.ts`, `paymentGuard.test.ts` |
| `pqrs-classifier` | «Clasificar IA» y «Clasificar pendientes» | JWT + dueño del ticket o staff | Conectada (endurecida) | Piso de seguridad probado |

Tablas nuevas: `pqrs_ticket_events`, `pqrs_intake_attempts`. RPCs nuevas: `marketplace_city_balance`,
`suggest_professionals_for_offer`, `invite_matching_professionals`, `moderate_offer`.
Secrets: `LOVABLE_API_KEY` (ya existente). Opcional: `PQRS_AI_MODEL` (por defecto `google/gemini-2.5-flash`).

> Regla del proyecto: las Edge Functions existentes solo se mantienen; la lógica de servidor nueva usa `createServerFn`
> en `src/lib/*.functions.ts`. `pqrs-intake` y `pqrs-assistant` se habían creado como Edge Functions y se trasladaron
> a funciones de servidor (la configuración `[functions.pqrs-intake]` se retiró de `supabase/config.toml`).

## Hub de oportunidades del profesional (migración `20261008200000`)

| Pieza | Cómo se activa | Auth / permisos | Prueba |
|---|---|---|---|
| RPC `list_open_family_needs` | Pestaña Ofertas | Rol profesional o staff; sin dirección | PostgreSQL real (A1–A15) |
| RPC `apply_to_family_need` | «Postularme» | Rol profesional; valor distinto = plan de pago | PostgreSQL real (B1–B12) |
| RPC `counter_slot_proposal` | «Contraofertar» | Quien recibe la oferta; profesional necesita plan de pago | PostgreSQL real (D1–D14) |
| RPC `accept_slot_proposal` (reemplazada) | «Aceptar» | Quien recibe la oferta | PostgreSQL real (D10–D14) |
| RPC `reveal_opportunity_contact` | «Ver dirección y WhatsApp» | Plan de pago + postulación + cupo diario; auditada | PostgreSQL real (C1–C11) |
| RPC `family_reputation`, `market_rate_stats`, `my_slot_proposals` | Tarjetas y bandeja | Autenticado (reputación: profesional/dueña/staff) | PostgreSQL real (E, M, N) |
| Disparador `slot_proposals_guard_insert/update` | Todo INSERT/UPDATE de propuestas | Impide saltarse plan, rango y estados desde la API | PostgreSQL real (B13–B18) |
| Disparador `notify_slot_proposal_event` | INSERT y cambio de estado | Interno | PostgreSQL real (B2, D3, D5b, D10b) |
| Disparador `notify_opportunity_alerts` | INSERT en `family_needs` | Interno; 1 aviso por alerta y familia cada 6 h | PostgreSQL real (F) |
| Disparador `ping_open_needs` | Cambios en `family_needs` | Canal privado `open_needs_ping`, sin datos | PostgreSQL real (G) |
| Disparador `sanitize_rating_comment` | Calificaciones | Limpia contacto en comentarios | PostgreSQL real (E4) |
| `expire_stale_proposals` | `pg_cron` cada 15 min (si existe) y en cada RPC | Solo service role | PostgreSQL real (D14) |
