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

## 2. Pendiente: requiere cambios en la base de producción (con aprobación)

1. **Comisión real.** `service_bookings.platform_fee_pct` vale 0 por defecto y el navegador no lo envía, así que **ningún servicio registra comisión**, ni siquiera con profesionales Free. La función `platform_commission_pct(profesional)` existe pero nada la usa al crear un servicio. Propuesta: un trigger `BEFORE INSERT` que fije `platform_fee_pct := platform_commission_pct(NEW.professional_id)` y `total_amount := round(hourly_rate × duration_hours)`, antes de `trg_sb_compute_fee`.
2. **Créditos IA a medio desplegar.** Existen `grant_ai_credits` (idempotente por `mp_payment_id`), el catálogo y las tablas, pero faltan `consume_ai_credits` y `get_total_ai_credits_balance`. Sin ellas, las sugerencias de IA del chat (`chat-copilot`) fallan para todos, y los créditos comprados no se pueden gastar.
3. **Otras tablas o funciones que el código usa y no existen:** `health_compliance`, `patient_risk_scores`, `vital_signs`, `service_checkins`, `service_contracts`, `rethus_checks`, `alert_thresholds`, `flag_rating`, `respond_to_rating`. No tocan pagos, pero esas tarjetas fallan.
4. **Referidos** (`referrals`, `apply_referral_code`, `get_or_create_referral_code`). Además, el diseño del repositorio tiene fallas que habría que corregir antes de aplicarlo:
   - un mismo código solo sirve para una persona;
   - `apply_referral_code` acepta cualquier id de usuario en lugar de `auth.uid()`;
   - quien refiere puede editar sus propias filas;
   - `apply-referral-reward` extiende la tabla vieja `subscriptions` en lugar de `mp_subscriptions`.

## 3. Lo que está bien en producción

- `mp_subscriptions`, `mp_payments` y `payment_webhook_events`: RLS de solo lectura para la persona dueña (y el personal autorizado); nadie puede escribir su propio plan desde el navegador.
- `plan_key_for` y `platform_commission_pct` usan la misma regla de plan vigente que la interfaz.
- `guard_service_bookings_financials` impide cambiar precios, comisión o partes de un servicio después de creado.
- `grant_ai_credits` es idempotente: índice único sobre `mp_payment_id`.
- Firma HMAC del webhook, consulta directa a Mercado Pago e idempotencia por evento.
