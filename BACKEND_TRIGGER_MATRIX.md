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

## Hub de instituciones y contrato inteligente (migración `20261009100000`)

| Pieza | Cómo se activa | Auth / permisos | Prueba |
|---|---|---|---|
| RPC `publish_institution_offer` | «Publicar turnos» | Rol institución o staff; valida valor, turnos (1–60, ≤ 24 h), contenido | PostgreSQL real (1) |
| RPC `list_open_institution_offers` | Agenda «EPS, IPS y clínicas» | Profesional o staff; sin dirección ni teléfono | PostgreSQL real (1, 2) |
| RPC `apply_to_offer` | «Enviar postulación» | Profesional; otro valor = plan de pago | PostgreSQL real (2, 3, 10b) |
| RPC `counter_application` | «Contraofertar» / cambiar propuesta | Quien debe responder; profesional necesita plan | PostgreSQL real (3, 7) |
| RPC `accept_application` | «Aceptar» (ambas partes) | Quien debe responder; crea reservas, contrato y avisos | PostgreSQL real (4, 10, 10b) |
| RPC `decline_application` | «Rechazar» / «Retirar» | Las dos partes | PostgreSQL real (10b) |
| RPC `reveal_offer_contact` | «Desbloquear contacto» | Plan de pago + postulación + cupo diario; auditada | PostgreSQL real (5, 6) |
| RPC `get_booking_contact` (reemplazada) | «WhatsApp» en la reserva | Partes de la reserva; profesional con plan y cupo | PostgreSQL real (6, 10b) |
| RPC `my_offer_applications`, `institution_application_inbox`, `market_supply_snapshot`, `institution_reputation` | Paneles | Cada parte ve lo suyo; muestras mínimas (5 / 3) | PostgreSQL real (12, 13) |
| RPC `update_contract_conditions`, `decline_contract`, `contract_signer_readiness`, `verify_contract_integrity`, `my_smart_contracts` | Contrato | Solo las partes | PostgreSQL real (8) |
| RPC `invite_team_to_offer` | «Invitar a mi equipo» | Autor de la oferta; solo favoritos, una vez por turno | PostgreSQL real (15) |
| `signSmartContract` (función de servidor) | «Firmar contrato» | JWT (`requireSupabaseAuth`) + identidad + código ≤ 10 min + huella | `contracts.server.test.ts` (base simulada) |
| `record_contract_signature` | Solo desde `signSmartContract` | Solo service role | PostgreSQL real (8, 14) |
| Disparador `job_offers_capture_private` | INSERT/UPDATE de dirección, teléfono o coordenadas | Interno | PostgreSQL real (1) |
| Disparadores `applications_guard_insert/update` | Todo INSERT/UPDATE de postulaciones | Impiden forjar valor, estado y ronda | PostgreSQL real (2, 7, 10b) |
| Disparadores `trg_applications_after_insert/after_status` | Cambios de postulación | Historial (`application_events`) y avisos | PostgreSQL real (2–4) |
| Disparador `bookings_sync_offer_and_contract` | Cambio de estado de la reserva | Reabre cupo, avisa y completa el contrato | PostgreSQL real (11) |
| Disparadores del contrato (`guard`, cadena de eventos, inmutabilidad) | Todo cambio en contrato, firmas y eventos | Interno | PostgreSQL real (8, 14) |
| `ping_open_offers` (turnos y ofertas) | Cambios en `job_offers` / `job_offer_shifts` | Canal privado `open_needs_ping`, sin datos | PostgreSQL real |
| `expire_stale_applications`, `expire_stale_contracts` | `pg_cron` cada 15 / 30 min (si existe) y en cada RPC | Solo service role | PostgreSQL real (7, 8) |

Secrets: `SUPABASE_SERVICE_ROLE_KEY` (función de servidor). Correo de Supabase Auth con `{{ .Token }}` para el código de firma.
La Edge Function `generate-contract` queda desplegada pero sin uso desde la interfaz.

## Lazo de cuidado (migraciones `20261010100000` y `20261010110000`)

| Pieza | Cómo se activa | Auth / permisos | Prueba |
|---|---|---|---|
| Disparador `trg_care_logs_guard` | Todo INSERT en `care_logs` | Interno: fija `professional_id`, exige servicio en curso del profesional de la reserva, tope 200, sin contacto ni pagos (las alertas nunca se bloquean), descarta fotos | PostgreSQL real (2) |
| Disparador `trg_care_logs_after_insert` | Registro con `is_alert` | Interno: aviso inmediato a quien contrató y a su círculo | PostgreSQL real (2) |
| Disparador `trg_booking_care_events` | Reserva pasa a `in_progress` / `completed` | Interno: llegada y salida automáticas, avisos y hito de trayectoria; idempotente | PostgreSQL real (1, 4) |
| Disparador `trg_plan_b_after_cancel` | Reserva cancelada | Interno: si cancela el profesional y la reserva viene de una oferta, invita a los favoritos del autor | PostgreSQL real (7b, 8) |
| `notify_booking_cancelled` (reemplazada) | Cancelación | Interno: aviso que dice cuántos del equipo de confianza están libres | PostgreSQL real (7) |
| Política `care_logs_professional_insert` / `care_logs_circle_read` | INSERT / SELECT en `care_logs` | Solo el profesional de la reserva escribe; leen cliente, profesional, círculo aceptado y superadmin | PostgreSQL real (2, 3) |
| RPC `get_care_summary` (endurecida), `care_report` | Pantalla del servicio | Autenticado + `care_can_view` (antes: cualquiera con el id) | PostgreSQL real (3) |
| RPC `my_active_services` | Tablero de cada rol | Cliente, profesional o círculo; solo lo propio | PostgreSQL real (3b) |
| RPC `send_kudos`, `my_received_kudos`, `kudos_allowed_kinds` | «Gracias» | Participante de un servicio completado; lista cerrada por rol; uno por servicio | PostgreSQL real (5) |
| RPC `professional_kudos_summary`, `professional_public_stats` | Perfil público | Público (anon) pero solo agregados, sin identidades | PostgreSQL real (5, 6) |
| RPC `my_career_stats` | Trayectoria del profesional | Autenticado; servicios completados | PostgreSQL real (6) |
| RPC `my_trusted_team`, `invite_team_to_offer` (misma firma) | Equipo de confianza | Autenticado; solo favoritos, una vez por turno | PostgreSQL real (7, 8) |
| RPC `care_history_report` | «Descargar historia» | Plan de pago (`mp_subscriptions`); solo servicios propios | PostgreSQL real (9) |
| Ayudantes `care_can_view`, `care_watchers`, `party_display_name`, `career_stats_core`, `trusted_team_free_count`, `invite_team_core` | Internos | Solo service role / disparadores | PostgreSQL real (10) |
| Publicación `supabase_realtime` (14 tablas) | Migración `20261010110000` | Realtime respeta RLS | PostgreSQL real (11) |

Secrets: ninguno nuevo. Sin Edge Functions nuevas.
