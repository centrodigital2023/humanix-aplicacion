# Migraciones: qué hay, qué manda y cómo se comprueba

Estado **verificado contra producción el 2026-10-13**, solo lectura. Todo lo de la sección 5 se puede repetir con la sonda de la
sección 4 (`bun run scripts/migration-drift-probe.ts`).

## 1. En una frase

El repositorio tiene **dos cadenas de migraciones** y producción no ejecuta sola la más larga. Lo que está en `supabase/migrations/`
llega a producción **solo si alguien lo aplica a mano**; por eso existe la sonda: dice, sin escribir nada, si lo que dicen los archivos
es lo que hay en la base.

## 2. Las dos cadenas

|                           | `supabase/migrations/`                                                                | `drizzle/migrations/`                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Archivos                  | 128 (de abril al 13 de octubre de 2026)                                               | 15 (`0000`–`0014`, del 7 al 12 de octubre)                                                                        |
| Quién la escribe          | Nosotros (y Lovable entre abril y junio)                                              | La herramienta de migración de Lovable; `drizzle/schema.ts` queda «auto-generado, no editar»                      |
| Cómo llega a producción   | A mano: simulacro (se deshace solo) → aplicar → verificar                             | La aplica Lovable y la registra en `drizzle.__drizzle_migrations`                                                 |
| Registro en producción    | `supabase_migrations.schema_migrations` tiene **1 fila** (`20260622163525`): no sirve | **15 filas**. `hash` = SHA-256 del `.sql` y `created_at` = `when` del diario; las 15 coinciden con el repositorio |
| Se puede reconstruir solo | No: faltan bloques nunca aplicados y hay versiones distintas de las mismas tablas     | No: parte de un esquema que ya existía (no crea `profiles`, `service_bookings`…)                                  |

Ninguna de las dos basta por sí sola para crear la base desde cero. Lo que manda es **la base de producción**; las cadenas son su
historia.

## 3. Cómo se agrega una migración (regla de trabajo)

1. Se escribe en `supabase/migrations/<AAAAMMDDHHMMSS>_<nombre_en_minusculas>.sql`: idempotente, y con los `GRANT` + RLS de toda tabla
   pública nueva **en el mismo archivo** (regla de `AGENTS.md`).
2. Se prueba en una PostgreSQL desechable con la réplica (`supabase/e2e/*/run.sh`) y, para lógica con riesgo, con pruebas de mutación.
3. `bun test` ejecuta `src/lib/migrationProbe.test.ts`: nombre y versión únicos, y **la guarda de las seis funciones delegadas**
   (ver abajo).
4. En producción: simulacro con la suma de control (`md5`) de cada parte, que termina en `RAISE EXCEPTION 'DRYRUN_OK…'` y no deja
   nada → aplicar → comprobar con la sonda → `git push` a `main` y a la rama de trabajo.
5. **No se edita a mano `drizzle/migrations/` ni `drizzle.__drizzle_migrations`.** Las genera y lee Lovable; un archivo o una fila de
   más puede hacer que su herramienta vuelva a ejecutar una migración ya aplicada, o provocar un conflicto al sincronizar.
6. **No se vuelven a crear con `CREATE OR REPLACE`** `publish_institution_offer`, `accept_application`, `decline_application`,
   `counter_application`, `institution_application_inbox` e `invite_team_to_offer` sin conservar `hx_acting_institution(auth.uid(), …)`.
   La migración `20261013120000` las parcha **en la base**; si una posterior las reescribe con el cuerpo viejo, el personal pierde el
   acceso sin que nadie lo note. La prueba lo impide (se comprobó con un mutante).

## 4. La sonda de deriva

```bash
bun run scripts/migration-drift-probe.ts                   # resumen de lo que se espera (no toca ninguna base)
bun run scripts/migration-drift-probe.ts --sql             # imprime los SELECT de solo lectura
bun run scripts/migration-drift-probe.ts --from 20260601000000 --to 20261007000000 --chunk 150 --sql
bun run scripts/migration-drift-probe.ts --to 20261007000000 --kinds table,function,view,trigger,realtime --sql   # solo el «esqueleto»
```

Lee los archivos, pliega las migraciones en orden (lo que un `DROP` posterior elimina se espera **ausente**) y genera uno o varios
`SELECT` que devuelven una fila JSON `{ revisados, faltan, detalle }`. Se pegan en el editor SQL de la base (o en
`query_database`). `faltan: 0` significa que esa parte coincide.

Entiende las sentencias de primer nivel: tablas, columnas (de `CREATE TABLE` y de `ALTER TABLE … ADD/DROP/RENAME COLUMN`), vistas,
funciones (distingue sobrecargas por número de argumentos), políticas, disparadores, índices y `ALTER PUBLICATION supabase_realtime`.
**No ve**: SQL dinámico y bloques `DO $$ … $$` (por ejemplo, las publicaciones de Realtime hechas dentro de un bloque), el cuerpo de las
funciones, los privilegios (`GRANT`) ni los datos. Por eso la sonda **complementa** —no reemplaza— la verificación posterior de cada
migración.

Se validó en dos sentidos: en una base local reproduce lo aplicado (0 falsos positivos en 455 objetos presentes) y detecta lo que
falta; y en producción coincide con lo verificado a mano.

## 5. Estado verificado en producción (2026-10-13)

### 5.1 Octubre (33 archivos, 685 objetos): coinciden 674

- **Las 14 migraciones del 11 al 13 de octubre (172 objetos) coinciden al 100 %**, incluidas las del personal de la institución.
- Las 11 diferencias son todas de migraciones del **7 de octubre** y tienen explicación:

| Migración                                    | Qué no está en producción                                                                             | Por qué y qué efecto tiene                                                                                                                                                                                                                                                                   |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261007000000_ai_credits_topups`           | Vista `ai_credits_balance_view`, función `get_total_ai_credits_balance` y 5 políticas con otro nombre | Las dos tablas ya las había creado Lovable (`drizzle 0007`) con otras políticas (`packs_public_read`, `packs_superadmin_manage`, `topups_read_own`). `use-ai-credits.tsx` y `whatsapp-webhook` llaman a la función que no existe: el saldo no se muestra. Sin filas (0 paquetes, 0 recargas) |
| `20261007100000_whatsapp_conversation_state` | Columnas `wa_state` y `wa_state_updated_at` de `whatsapp_contacts`                                    | `whatsapp-webhook` las lee y escribe; con tráfico real fallaría. WhatsApp automático no está en marcha. Es aditiva y de bajo riesgo: aplicarla al activar WhatsApp                                                                                                                           |
| `20261007170000_wire_webhooks_and_fix_cron`  | Función `trg_care_logs_alert` y disparador `care_logs_alert_webhook`                                  | Lo reemplazó `care_logs_after_insert` (`20261010100000`), que avisa dentro de la app a quien vigila el servicio. `BACKEND_TRIGGER_MATRIX.md` dice «Conectado» porque se escribió leyendo el código, no producción: ningún disparador llama hoy a `care-alerts`                               |

### 5.2 Cadena antigua (abril → 6 de octubre): coinciden 130 de 216 objetos del «esqueleto»

El esqueleto son tablas, funciones, vistas, disparadores y Realtime (no columnas, índices ni políticas). **Faltan 86 y se concentran en el
bloque del 5 al 11 de junio**, que el hallazgo #111 de la auditoría ya señalaba como «nunca aplicado». Esto es lo que el código **sí usa**
hoy y no existe en producción:

| Pantalla o función (dónde)                                                                        | Qué le falta a producción                                                                                                                             | Qué se ve hoy                                                                          |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Cancelar o reactivar la suscripción (`MercadoPagoSubscription`; paneles de familia y profesional) | RPC `cancel_my_subscription` y `resume_my_subscription`, y las columnas `cancel_at_period_end` y `cancelled_at` de `mp_subscriptions`                 | El botón da error. Hoy hay 0 suscripciones, pero **debe resolverse antes de cobrar**   |
| Créditos IA (`AiCreditsBalance`; institución y profesional) y copiloto de chat (`chat-copilot`)   | `get_ai_credits_balance`, `ai_credits_monthly_allowance`, `consume_ai_credits` (`20260606170000`)                                                     | La tarjeta no aparece y **el copiloto de chat falla** (`consume_ai_credits` no existe) |
| Billetera y retiros (`WalletPanel`; institución y profesional)                                    | `wallet_accounts`, `wallet_transactions`, `payout_requests`, `get_or_create_wallet`, `request_payout`, `record_wallet_transaction` (`20260606140000`) | Vacío o con error                                                                      |
| Invitar a un amigo (`ReferralCard`, `InviteFriendInline`; código al registrarse en `auth.tsx`)    | `referrals`, `get_or_create_referral_code`, `apply_referral_code` (`20260606000001`)                                                                  | Sin código de invitación                                                               |
| Cumplimiento de salud (`HealthComplianceCard`; profesional)                                       | `health_compliance`                                                                                                                                   | Vacío                                                                                  |
| Sedes y facturación IPS (`IpsBranchBilling`; institución)                                         | `institution_branches`                                                                                                                                | Vacío                                                                                  |
| Casos de pacientes (`EnhancedPatientsModule`; institución y EPS)                                  | `institution_patient_cases`                                                                                                                           | Sin casos                                                                              |
| Monitoreo (`PatientRiskCard`; `dashboard.monitoreo`)                                              | `patient_risk_scores`, `vital_signs`, `service_checkins` (ya documentado en #106 y #107)                                                              | El portal EPS lo dice «aún no habilitado»                                              |
| Contrato de servicio (`ServiceContractCard` en `/servicio/$bookingId`; `generate-contract`)       | `service_contracts`                                                                                                                                   | No genera el contrato                                                                  |
| Estadísticas públicas (`usePublicStats`)                                                          | Vista `public_stats`                                                                                                                                  | Contadores en 0 (existen `get_platform_counts` y `get_live_counts`)                    |
| Verificación semanal de RETHUS (`rethus-weekly-check`)                                            | `rethus_checks`                                                                                                                                       | La función falla; la verificación vigente es `verifyRethus` (una vez por profesional)  |

`RatingCard` (`respond_to_rating`, `flag_rating`) y `CheckInOut` (`service_checkins`) no están montados en ninguna pantalla.

**Realtime.** El código se suscribe (`postgres_changes`) a 38 tablas; **20 no están en la publicación `supabase_realtime` de producción**
y esas suscripciones nunca reciben eventos: `ad_banners`, `ai_credit_topups`, `ai_credits_ledger`, `audit_log`, `community_testimonials`,
`crm_campaigns`, `crm_contacts`, `crm_tasks`, `family_documents`, `family_profiles`, `fraud_flags`, `health_compliance`,
`institution_branches`, `payout_requests`, `professional_profiles`, `profiles`, `user_roles`, `vital_signs_readings`, `wallet_accounts`,
`wallet_transactions`, `whatsapp_contacts` y `whatsapp_messages`. Las tablas de los paneles de familia, profesional e institución
(ofertas, postulaciones, propuestas, contratos, personal, servicios, notificaciones) **sí están publicadas**; el mapa en vivo y «Mi oferta
de servicio» no dependen de la publicación: usan el canal privado de difusión (`hx_ping_map`, `hx_ping_service_offers`). No se agregaron
las demás tablas: añadir tablas sensibles a la publicación es una decisión de seguridad (Realtime respeta RLS, pero conviene revisar
cada política antes).

## 6. Decisiones pendientes

1. **Cuál es la cadena oficial.** Recomendación: mantener `supabase/migrations/` como fuente y aplicar a mano con simulacro y sonda
   (lo que se ha hecho), y no tocar `drizzle/`. Alternativa: pedirle a Lovable que adopte las migraciones con su herramienta, pero cada
   una debería pasar antes por una revisión de seguridad.
2. **Qué hacer con el backend de junio que nunca llegó.** Para cada fila de 5.2: aplicarlo (con revisión y una versión segura),
   reemplazarlo o quitar la pantalla. Lo más urgente: cancelar suscripción (antes de cobrar) y `consume_ai_credits` (el copiloto falla).
   Ojo: `get_ai_credits_balance` de la migración de junio no comprueba quién la llama (cualquiera podría consultar el saldo de otra
   persona); hay que corregirlo antes de aplicarla tal cual.
3. **WhatsApp:** al activarlo, aplicar `20261007100000` (columnas `wa_state`) y definir `get_total_ai_credits_balance`.
