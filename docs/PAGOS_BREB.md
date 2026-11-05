# Pagos con Wompi (cobros en línea y dispersión Bre-B)

Desde el 5 nov 2026 Humanix cobra con **Wompi** (pasarela de Grupo Bancolombia) y paga a los profesionales por **Bre-B**
con la API de Pagos a Terceros de Wompi. Firux se eliminó por completo (cobros, webhook, «Conectar con Firux Pay» y la
dispersión supuesta). Antes, el 3 nov 2026, se había eliminado Mercado Pago.

## Modelo

| Quién | Paga | Comisión |
|---|---|---|
| Familia | $0 · solo el valor del turno | Nunca |
| Profesional | $0 · sin mensualidad | 15 % (0–19 turnos en 30 días), 12 % (20–59), 10 % (60+) |
| Institución 1–9 profesionales | $290.000/mes · $3.480.000 al año, un pago | 12 % al profesional |
| Institución 10+ | $490.000/mes · $5.880.000 al año, un pago | 10 % al profesional |

- Primer turno de cada pareja (quien contrata, profesional): sin comisión hasta $30.000 si quien contrata se registró hace
  90 días o menos.
- Turno mínimo $20.000 (desde el 4 nov 2026; antes $45.000). Formas de pago: `DIGITAL_BREB` (por defecto) o `CASH`.
- Efectivo, tipo InDrive (migración `20261104170000_cash_wallet.sql`): la familia elige «💵 Efectivo · le pagas en mano a
  {nombre} al terminar». La comisión se descuenta de la **billetera** del profesional al terminar el turno.
  - Cupo hasta −$30.000. Por debajo del cupo no recibe turnos nuevos (de ningún tipo).
  - **Comisión apartada:** al aceptar un turno en efectivo su comisión queda apartada hasta que termina o se cancela. Para
    aceptar otro: saldo + cupo − apartado ≥ comisión (`hx_booking_wallet_gate`, bloquea la fila de la billetera). Así varios
    turnos en efectivo aceptados a la vez nunca hunden la billetera bajo el cupo.
  - Si no le alcanza, la solicitud muestra «Recargar $X y aceptar»: recarga en línea y, al confirmarse, acepta sola.
  - La familia ve antes de pedir si ese profesional puede tomar efectivo (`hx_pro_cash_status`, sin exponer saldos):
    `blocked` apaga la opción; `needs_topup` avisa que el profesional debe recargar.
  - `get_my_wallet` devuelve saldo, cupo, apartado, libre y `health` (`ok` | `credit` | `low` | `blocked`; `low` = menos de
    $10.000 libres). Avisos automáticos (`trg_wallet_movement_notify`): casi en el límite (una vez hasta la siguiente
    recarga), bloqueada y desbloqueada.
  - La billetera se recarga con un cobro en línea normal (Wompi) (valores rápidos u otro valor de $2.000 a $12.000.000).

Regla espejo: `src/lib/commissionMatrix.ts` (probada) = `booking_commission_pct` / `hx_first_shift_exempt` en SQL
(migración `20261103160000_breb_wallet_commission.sql`, aplicada en producción el 3 nov 2026 tras simulacro) y
`cashAcceptCheck` / `walletHealth` = `hx_booking_wallet_gate` / `get_my_wallet` (`20261104170000_cash_wallet.sql`, **aún no
aplicada en producción**).

## Flujo

1. **Cobro** (`src/lib/payments.functions.ts` → `charges.server.ts`): `payBooking` (familia, desde que pide el turno hasta
   que termina, sin pagar), `topupWallet` (profesional) y `payInstitutionPlan` (institución). El monto sale de la base.
   Se guarda la fila `payment_charges` y su id es la `reference` del **Web Checkout de Wompi**
   (`https://checkout.wompi.co/p/`), con el monto en centavos y la firma de integridad SHA-256 de
   `{referencia}{centavos}COP{expiración}{WOMPI_INTEGRITY_SECRET}` (nadie puede cambiar el monto en el navegador).
   Vigencia 24 h (`expiration-time`). Si ya hay un cobro pendiente, vigente y sin intento en Wompi, se reutiliza; si la
   persona ya abrió el checkout con esa referencia, se crea otra (Wompi no deja reutilizar referencias).
2. **Pantalla** (`PaySheet`): botón grande «Pagar con Wompi» que abre el checkout. Ahí la persona elige el medio que la
   cuenta de Humanix tenga activo en Wompi (Bre-B si Wompi lo habilita, Nequi, PSE, botón Bancolombia, tarjeta…). Estado
   en vivo por Realtime sobre `payment_charges`.
3. **Aviso** `POST /api/public/wompi/webhook` (`wompiWebhook.ts`): verifica la firma del evento (SHA-256 de los valores de
   `signature.properties` + `timestamp` + `WOMPI_EVENTS_SECRET`, en `X-Event-Checksum` y `signature.checksum`), anota el
   evento en `payment_webhook_events` (`provider = 'wompi'`) y aplica `transaction.updated`:
   - `APPROVED` → `hx_charge_paid(cobro, transacción, monto)` (solo service_role, idempotente): turno → `paid_at` y pago
     **retenido** (ver abajo); recarga → billetera; plan → `mp_subscriptions` por un año. Si Wompi cobró menos, queda
     `underpaid`.
   - `DECLINED` / `ERROR` / `VOIDED` → `hx_charge_attempt` marca el cobro `failed` y la pantalla ofrece otro intento.
4. **Regreso** a `/pago/exito?id=<transacción>`: el servidor consulta `GET /v1/transactions/{id}` en Wompi y, si es de un
   cobro de esa persona, lo aplica igual que el aviso (`syncPaymentReturn`). Así no depende solo del webhook.
5. **Al terminar el turno** (`trg_sb_settle`): efectivo → débito de comisión en la billetera; pago en línea → el dinero
   sigue retenido hasta que se libera (abajo) y solo entonces se crea la fila en `payouts` (`needs_key` si el profesional
   aún no guarda su llave, `queued` si ya).

La columna `service_bookings.payment_method` sigue llamándose `DIGITAL_BREB` (= pago en línea) para no tocar datos ni
reglas existentes.

## Pago retenido tipo InDrive (Bre-B)

Migración `20261104180000_breb_escrow.sql`; lógica espejo en `src/lib/escrow.ts` (probada).

1. La familia paga en línea **al pedir el turno** (también puede pagar después, hasta que termine). El dinero queda en la
   cuenta Wompi de Humanix: `service_bookings.escrow_status = 'held'`. El profesional ve «🔒 Pago asegurado».
2. El profesional marca «Terminar turno» (`status = 'completed'`). El pago sigue retenido y se fija `release_due_at` =
   ahora + 24 h. Se avisa a la familia («¿Todo bien con el turno?») y al profesional («pago por liberar»).
3. La familia confirma con **«Sí, liberar el pago»** (`hx_confirm_booking_done`) → `released` → fila en `payouts`. Si la
   familia misma marca el turno como terminado, eso ya cuenta como confirmación.
4. Si no dice nada: recordatorio 3 h antes y **liberación automática a las 24 h** (`hx_escrow_tick`, pg_cron cada 10 min,
   trabajo `hx-escrow-tick`).
5. **«Hubo un problema»** dentro de las 24 h (`hx_report_booking_problem`, 5–500 caracteres) → `disputed`: no se libera
   solo; avisa al profesional y a los superadmin. El equipo decide en **/superadmin/pagos** (`hx_escrow_resolve`):
   liberar al profesional o devolver todo. La familia puede retirar su reclamo con «Ya se resolvió: liberar el pago».
6. **Cancelado con el pago adentro** (por cualquiera de las partes, o si el pago llega después de cancelar) →
   `refunding` + fila en `booking_refunds` por el total pagado. Un segundo pago aprobado para el mismo turno también se
   devuelve (`reason = 'duplicate'`). La familia escribe su llave Bre-B en la página del servicio (`client_refund_keys`);
   el equipo envía la devolución desde el panel de Wompi (Pagos a Terceros, a la llave Bre-B) y la marca en
   /superadmin/pagos (`hx_mark_refund`) → `refunded`. La API de cobros de Wompi solo anula tarjetas, por eso la
   devolución va como pago a la llave de la familia.

Solo el servidor escribe la retención: `guard_service_bookings_financials` protege las columnas nuevas y las funciones
de la familia (SECURITY DEFINER) encienden `hx.escrow` solo dentro de su transacción.

**Decisiones tomadas (cambiar si hace falta):**

- Ventana de revisión 24 h, recordatorio 3 h antes (`hx_escrow_window`, `hx_escrow_reminder_lead`).
- Cancelar con el pago adentro devuelve el **100 %**, cancele quien cancele (sin penalidad por cancelación tardía).
- Un reclamo se decide entero: liberar todo o devolver todo (sin repartos parciales).
- No se bloquea «Voy en camino» si la familia no ha pagado: el profesional ve «La familia aún no ha pagado: espera el
  🔒 antes de salir».
- Turnos pagados antes de la migración: los terminados quedan `released` (`release_reason = 'legacy'`), los abiertos
  `held`.

## Pago al profesional, reparto y conciliación (migración 20261105200000)

La migración `20261105200000_wompi_payments.sql` reemplaza a `20261105100000_split_dispersion_ledger.sql` y a
`20261104140000_firux_connect.sql` (ninguna se aplicó en producción). Renombra `firux_charges` → `payment_charges`
(`provider` = `firux` en las filas viejas, `wompi` en las nuevas; `firux_id` → `provider_tx_id`, `payment_url` →
`checkout_url`, sin `qr_emv`), `service_bookings.firux_charge_id` → `charge_id`, y cambia `hx_firux_charge_paid` por
`hx_charge_paid` + `hx_charge_attempt`. Los nombres son neutros para no repetir esto si se cambia de pasarela. Probada en
Postgres 16 local sobre 160000 + 150000 + 170000 + 180000 con un cobro Firux viejo ya pagado (sigue retenido y se libera
bien), cobro Wompi, pago doble devuelto, recarga, dispersión con reintento y aviso; idempotente (se puede correr dos veces).

1. **Reparto por transacción** (`payment_splits`): al confirmarse el pago del turno se fija `gross_cop` (lo que pagó la
   familia), `platform_fee_cop` (`service_bookings.platform_fee_amount`, con la matriz 15/12/10 %, planes y exención del
   primer turno) y `professional_cop`. Una fila por turno; siempre cuadra.
2. **Libro de partida doble** (`ledger_entries`), escrito solo por triggers, con `ref` única:

   | Evento | Desde → hacia |
   | --- | --- |
   | Familia paga el turno | external → escrow |
   | Se libera (confirmó, 24 h o el equipo) | escrow → platform (comisión) y escrow → professional (neto) |
   | Dispersión aceptada por Wompi | professional → in_transit |
   | Wompi confirma que llegó | in_transit → external |
   | Wompi la rechaza | in_transit → professional (vuelve al saldo) |
   | Pago manual marcado en el panel | professional → external |
   | Devolución a la familia | escrow → external |
   | Recarga de billetera | external → wallet |
   | Comisión de turno en efectivo | wallet → platform |
   | Plan institucional | external → platform |

3. **Dispersión automática por Bre-B con Wompi** (apagada hasta encenderla). Wompi **sí** tiene API para pagar a terceros
   por Bre-B (docs.wompi.co → Pagos a terceros → Dispersión BRE-B), así que la cola deja de ser manual:
   - Al liberarse un pago, `hx_queue_payout` deja la fila en `payouts` (`queued`) y `trg_payout_kick` despierta
     `POST /api/public/wompi/dispatch` con pg_net; el reloj `hx-dispersion-tick` (pg_cron, cada minuto) es el respaldo.
   - El despachador reclama lotes de 50 (`hx_claim_payouts`, trae nombre y correo del profesional, que Wompi exige) y
     envía cada pago como un lote propio de una transacción: `POST {base}/payouts` con `x-api-key`,
     `user-principal-id` e `idempotency-key`; cuerpo `{ reference, accountId, paymentType: "PROVIDERS", transactions:
     [{ key, amount (centavos), name, email, reference: <id del pago> }] }`.
   - Llave de idempotencia = id del pago + huella de la llave Bre-B + `idem_gen`. Tras una caída de red o un 5xx se
     reintenta con la **misma** llave (Wompi responde 409 `EXC_032` si ya la tiene y no paga dos veces). Cuando Wompi
     dice con certeza que no pagó (400, transacción rechazada, sin saldo `EXC_008`, 401/403/429, lote `REJECTED`),
     `idem_gen` sube y el siguiente intento lleva otra llave.
   - Reintentos con espera de 1 min, 5 min, 30 min y 2 h; al 5.º intento queda `failed`. 401/403 o sin saldo detienen el
     lote. Llave rechazada → `failed` y aviso al profesional; al corregir su llave vuelve sola a la cola.
   - Avisos firmados en `POST /api/public/wompi/payouts-webhook` (secreto propio `WOMPI_PAYOUTS_EVENTS_SECRET`):
     `transaction.updated` (`APPROVED` → pagado; `FAILED`/`REJECTED`/`CANCELLED` → fallido) y `payout.updated`
     (`TOTAL_PAYMENT` → pagado; `REJECTED` → vuelve a la cola). Se cruzan por el id del lote en Wompi
     (`payouts.provider_payout_id`) o por la referencia del lote, que empieza con el id del pago (`hx_payout_webhook`).
   - El pago manual desde **/superadmin/pagos** sigue funcionando como respaldo (`hx_mark_payout`, cambio de llave con
     `trg_payout_key_sync`).
4. **Saldos por profesional**: tarjeta «Tus pagos» (`get_my_earnings`): retenido, por llegar, recibido y comisión de 30 días.
5. **Conciliación** en /superadmin/pagos (`hx_reconciliation`, solo staff): lo que debe haber en la cuenta Wompi según el
   libro, saldos por profesional, libro en CSV y diferencias. Botón «Dispersar ahora».

**Para encender la dispersión automática:**

1. Aplicar `20261105200000_wompi_payments.sql`.
2. En Wompi: activar Pagos a Terceros y Bre-B en la cuenta, tener saldo en la cuenta de origen, y registrar la URL de
   eventos `https://humanix.lat/api/public/wompi/payouts-webhook`.
3. En Lovable Cloud: `WOMPI_PAYOUTS_API_KEY`, `WOMPI_PAYOUTS_USER_ID`, `WOMPI_PAYOUTS_ACCOUNT_ID` (de `GET /accounts`),
   `WOMPI_PAYOUTS_EVENTS_SECRET`, `WOMPI_DISPATCH_SECRET` (valor largo al azar), `WOMPI_PAYOUTS_ENV=sandbox` para probar,
   y `WOMPI_PAYOUTS_ENABLED=true`.
4. En la base: `UPDATE hx_dispersion_config SET enabled = true, dispatch_url = 'https://humanix.lat/api/public/wompi/dispatch', secret = '<WOMPI_DISPATCH_SECRET>';`

Sin el paso 3 nada sale solo: los pagos liberados siguen en la cola y el equipo los paga a mano desde Wompi.

## Configuración pendiente (cobros)

- Secretos en Lovable Cloud: `WOMPI_PUBLIC_KEY` (`pub_test_…` en Sandbox, `pub_prod_…` en Producción),
  `WOMPI_INTEGRITY_SECRET` y `WOMPI_EVENTS_SECRET` (Wompi → Desarrolladores → Secretos para integración técnica).
  Opcional `WOMPI_REDIRECT_URL` (por defecto `https://humanix.lat/pago/exito`).
- URL de eventos en Wompi: `https://humanix.lat/api/public/wompi/webhook` (una para Sandbox y otra para Producción).
- En el panel de Wompi, dejar activos los medios de pago que se quieran ofrecer. **Por confirmar con Wompi:** si la
  cuenta puede recibir pagos **por Bre-B** en el checkout (la documentación pública lista tarjeta, Nequi, PSE, botón y QR
  Bancolombia, corresponsal y Puntos Colombia; Bre-B aparece solo para dispersar).
- Prueba en Sandbox: pagar desde la app con los datos de prueba de Wompi y ver el turno pasar a «🔒 Pago asegurado».

## Acciones del servicio y pagos (migración 20261104190000)

Pantalla `/servicio/$bookingId` (la abren la familia, la EPS/IPS y el profesional). Reglas en `src/lib/serviceActions.ts`.

| Acción | Quién | Cuándo | Qué pasa con el dinero |
| --- | --- | --- | --- |
| Cancelar / Rechazar | ambas partes | Pedido, Aceptado, En camino | Bre-B retenido → devolución completa automática (`trg_sb_escrow`, `booking_refunds`). Bre-B sin pagar → nada. Efectivo → la comisión apartada se libera sola (`hx_wallet_reserved` solo cuenta turnos abiertos). |
| Confirmar que terminó | familia / EPS | Cuidando | Bre-B → libera el pago retenido. Efectivo → la comisión se descuenta de la billetera. |
| Reprogramar | ambas partes | Pedido, Aceptado | Ninguno: cambia solo la hora (`hx_request_reschedule`, `hx_answer_reschedule`). |
| Reportar un problema | ambas partes | Aceptado → Cuidando (y 72 h tras terminar) | Ninguno: radicado PQRS ligado al turno (`hx_report_service_issue`). El reclamo del pago retenido tras terminar es `hx_report_booking_problem` (tarjeta de pago). |
| Escribir | ambas partes | desde Aceptado | — |

Ya «Cuidando» no se cancela desde la app (`trg_guard_cancel_in_progress`, el equipo sí puede): se reporta y el equipo decide con `hx_escrow_resolve`.
