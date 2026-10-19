# Verificación de pagos y funciones contra producción (15 oct 2026)

Se comparó el código con la **base de producción real**, en solo lectura y con `query_database` de Lovable. Según `docs/MIGRACIONES.md`, las migraciones de `supabase/migrations/` no se aplican solas. Al momento de la revisión, producción tenía **0 pagos, 0 suscripciones y 0 compras de créditos**, así que ninguna falla afectó dinero real.

## 1. Corregido en el código (esta rama)

| #   | Falla                                                                                                                                          | Efecto                                                                                                                     | Corrección                                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | `mp_subscriptions` en producción **no tiene** `cancel_at_period_end`; el webhook escribía esa columna al activar un plan                       | **Ningún plan pagado se habría activado**: PostgREST responde 400, el webhook 500 y Mercado Pago reintenta sin fin         | `planBilling` solo escribe columnas que existen (hay una prueba que lo exige)                        |
| 2   | `usePlan` pedía esa columna explícitamente (cambio del 15 oct)                                                                                 | La lectura del plan fallaba para todos                                                                                     | Vuelve a `select("*")`                                                                               |
| 3   | El mismo pago llega varias veces (pendiente → aprobado) y `mp_payments` tiene `mp_payment_id` único                                            | El segundo aviso chocaba (409) y el webhook fallaba en cada reintento                                                      | `?on_conflict=mp_payment_id`                                                                         |
| 4   | Avisos `merchant_order` se consultaban como si fueran pagos                                                                                    | 404 → 502 → reintentos sin fin                                                                                             | Solo se procesan avisos de pagos                                                                     |
| 5   | Pago aprobado con otra moneda o monto 0 lanzaba una excepción                                                                                  | 500 y reintentos sin fin                                                                                                   | Se registra como rechazado (200)                                                                     |
| 6   | Créditos IA: no se comprobaba que el monto cubriera el precio del paquete                                                                      | Riesgo de acreditar de más                                                                                                 | El checkout guarda `price_cop` y el webhook lo exige (`creditsGrantFromPayment`, probado)            |
| 7   | La reserva mostraba «Comisión Humanix (3 %)» y el perfil público «3 % / 97 %»                                                                  | Contradice la regla real: 12 % al profesional en Free y 0 % con plan de pago                                               | La reserva usa `PriceBreakdownCard` (lee `platform_commission_pct`); el perfil explica la regla real |
| 8   | Saldo de créditos IA: `get_total_ai_credits_balance` no existe en producción                                                                   | El saldo no se mostraba                                                                                                    | Se calcula con los paquetes propios (`ai_credit_topups`), lógica pura y probada                      |
| 9   | Billetera (`wallet_*`, `payout_requests`, `request_payout`), sedes (`institution_branches`) y referidos (`referrals`) no existen en producción | Tarjetas con saldo en cero, botones de retiro o de agregar sede que fallan, y promesas de «1 mes gratis» que no se cumplen | Las tarjetas se ocultan cuando su backend no existe                                                  |

## 2. Aplicado en producción el 15 oct 2026 (aprobado)

Migración `20261015150000_commission_and_ai_credits.sql`. Antes de aplicarla se probó en un Postgres local con las definiciones reales de producción (15 de 15 escenarios), se corrió dos veces para confirmar que es idempotente, y se hizo un simulacro en producción que terminó con `RAISE` (se comprobó que no quedó nada). Después se aplicó y se verificó.

1. **Comisión real.** Antes, `service_bookings.platform_fee_pct` valía 0 por defecto y el navegador no lo enviaba, así que ningún servicio registraba comisión. Ahora el trigger `trg_sb_a_commission` (`BEFORE INSERT`) fija `platform_fee_pct := platform_commission_pct(profesional)`: 12 % si el profesional está en Free o con el plan vencido, 0 % con un plan de pago. Ignora lo que mande el navegador. Corre después de `trg_guard_booking_integrity` y antes de `trg_sb_compute_fee`, que calcula la comisión y el neto. Para revertirlo: `DROP TRIGGER trg_sb_a_commission ON public.service_bookings;`.
   - Queda igual: `total_amount` lo sigue enviando quien reserva; `guard_service_bookings_financials` impide cambiarlo después.
2. **Créditos IA completos.** Funciones nuevas: `consume_ai_credits`, `get_ai_credits_balance`, `get_total_ai_credits_balance` y `ai_credits_monthly_allowance`, con cupo de 30 / 150 / 400 / 2000 según el plan.
   - El consumo usa primero el cupo del mes (en hora de Colombia) y luego los paquetes comprados, empezando por el que vence antes. Es atómico: si no alcanza, no se descuenta nada y se responde `ai_credits_exhausted`.
   - Nadie puede leer el saldo de otra persona, salvo el personal autorizado.
   - El navegador no puede consumir créditos ni escribir en `ai_credits_ledger`: se quitó la política `aic_insert_self`, porque todas las funciones escriben con la clave del servidor.
   - Ya no se admiten consumos de cero o negativos (restricción `ai_credits_ledger_positive`; las 4 filas existentes cumplían).
   - Verificado en producción, con reversión: un usuario Free con 8 créditos usados ve 22 disponibles, y al consumir 1 le quedan 21.
   - Con esto vuelve a funcionar `chat-copilot` y se pueden gastar los créditos comprados.

## 3. Pendiente: requiere cambios en la base de producción (con aprobación)

1. **Otras tablas o funciones que el código usa y no existen:** `health_compliance`, `patient_risk_scores`, `vital_signs`, `service_checkins`, `service_contracts`, `rethus_checks`, `alert_thresholds`, `flag_rating`, `respond_to_rating`. No tocan pagos, pero esas tarjetas fallan.
2. **Referidos** (`referrals`, `apply_referral_code`, `get_or_create_referral_code`). Además, el diseño del repositorio tiene fallas que habría que corregir antes de aplicarlo:
   - un mismo código solo sirve para una persona;
   - `apply_referral_code` acepta cualquier id de usuario en lugar de `auth.uid()`;
   - quien refiere puede editar sus propias filas;
   - `apply-referral-reward` extiende la tabla vieja `subscriptions` en lugar de `mp_subscriptions`.

## 4. Lo que está bien en producción

- `mp_subscriptions`, `mp_payments` y `payment_webhook_events`: RLS de solo lectura para la persona dueña (y el personal autorizado); nadie puede escribir su propio plan desde el navegador.
- `plan_key_for` y `platform_commission_pct` usan la misma regla de plan vigente que la interfaz.
- `guard_service_bookings_financials` impide cambiar precios, comisión o partes de un servicio después de creado.
- `grant_ai_credits` es idempotente: índice único sobre `mp_payment_id`.
- Firma HMAC del webhook, consulta directa a Mercado Pago e idempotencia por evento.

## 5. Verificación de punta a punta de Mercado Pago (19 oct 2026)

El recorrido completo es este: checkout, Mercado Pago, aviso al webhook, activación del plan o de los créditos y regreso a Humanix.

### Corregido (`bd879d8`)

| #   | Falla                                                                                                     | Efecto                                                                                                    | Corrección                                                                                                                                     |
| --- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `/pago/exito` anunciaba «¡Pago exitoso! Tu suscripción está activa» solo por la URL                      | Cualquiera que abriera la dirección lo veía; quien pagaba lo veía aunque el plan aún no estuviera activo | El servidor consulta el pago en Mercado Pago (`confirmMercadoPagoPayment`) y la página muestra el resultado real                              |
| 2   | Redirección abierta en `/pago/exito`: `from` aceptaba cualquier valor, incluido `javascript:`             | Un enlace de Humanix podía llevar a otro sitio o ejecutar código                                          | `safeReturnPath`: solo paneles y rutas internas conocidas                                                                                      |
| 3   | La activación dependía solo del webhook                                                                   | Si el aviso no llegaba (secreto mal configurado, caída), la persona pagaba y no recibía nada              | Al volver del checkout el servidor aplica el pago con la misma lógica del webhook (`_shared/mpPayment.ts`)                                     |
| 4   | Dos avisos simultáneos del mismo pago se procesaban los dos                                               | Una renovación podía sumar dos meses por un solo pago                                                     | Reclamo atómico de `mp_payments.paid_at` (`PATCH … paid_at=is.null`); se libera si la activación falla. Probado con dos conexiones en Postgres |
| 5   | `mp_payments.status` es un enum sin `charged_back`, `in_mediation` ni `authorized`                        | Un contracargo o una mediación rompían el registro (400 → 500) y Mercado Pago reintentaba sin fin         | `dbPaymentStatus` guarda el equivalente; el estado original queda en `raw_payload`                                                             |
| 6   | Sin `MERCADOPAGO_ACCESS_TOKEN` o `MERCADOPAGO_WEBHOOK_SECRET`, el webhook respondía 500 sin dejar rastro  | Una configuración incompleta era invisible                                                                | Queda en `function_execution_logs` (`missing_access_token` / `missing_webhook_secret`)                                                        |

Hay 28 pruebas nuevas (`mpPayment.test.ts`, `paymentReturn.test.ts`). Cada una de las 5 salvaguardas se rompió a propósito y una prueba lo detectó.

### Estado de producción observado

- `mp-create-subscription` funciona: el 19 oct a las 11:42 (Bogotá) se creó una orden del plan Pro (fue una prueba y no se pagó). La fila «pendiente» solo se escribe después de que Mercado Pago acepta la orden, así que el token de acceso está configurado y es válido.
- No hay ningún registro de `mp-webhook` en `function_execution_logs` ni eventos en `payment_webhook_events`: Mercado Pago no ha llamado al webhook. Esto es normal si ese pago no se completó.
- El catálogo `ai_credit_packs_catalog` estaba **vacío**, así que no se podían comprar créditos. **Se cargó el 19 oct (aprobado)** con los 4 paquetes de `20261007000000_ai_credits_topups.sql`, tras un simulacro. `grant_ai_credits` se probó en producción con un pago ficticio y se revirtió: acredita 330 créditos, y un segundo aviso del mismo pago da `unique_violation` (409), que el código trata como «ya acreditado».
- humanix.lat sirve la aplicación, que es adonde vuelven las URLs de regreso.

### Pendiente

1. **Desplegar** `mp-webhook` y **publicar** la aplicación para que estos cambios lleguen a producción.
2. **Comprobar el secreto del webhook:** el panel de Mercado Pago, en *Tus integraciones → Webhooks*, debe tener la URL `…/functions/v1/mp-webhook`, el evento «Pagos» y la misma clave secreta que `MERCADOPAGO_WEBHOOK_SECRET`.
3. **Pago real de prueba** (el plan Esencial, $9.000) para cerrar el recorrido con dinero real.
4. **Decisión de negocio:** ante un reembolso o un contracargo de un plan, el plan no se retira solo; hoy queda registrado para revisión.
