# Pagos con Bre-B (Firux)

Desde el 3 nov 2026 Humanix cobra **solo por Bre-B con Firux**. Se eliminó Mercado Pago (rutas, componentes, webhooks y
lógica). En producción no había suscripciones activas ni pagos aprobados de Mercado Pago.

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
  - Si no le alcanza, la solicitud muestra «Recargar $X y aceptar»: recarga por Bre-B y, al confirmarse, acepta sola.
  - La familia ve antes de pedir si ese profesional puede tomar efectivo (`hx_pro_cash_status`, sin exponer saldos):
    `blocked` apaga la opción; `needs_topup` avisa que el profesional debe recargar.
  - `get_my_wallet` devuelve saldo, cupo, apartado, libre y `health` (`ok` | `credit` | `low` | `blocked`; `low` = menos de
    $10.000 libres). Avisos automáticos (`trg_wallet_movement_notify`): casi en el límite (una vez hasta la siguiente
    recarga), bloqueada y desbloqueada.
  - La billetera se recarga con un cobro Bre-B normal (valores rápidos u otro valor de $2.000 a $12.000.000).

Regla espejo: `src/lib/commissionMatrix.ts` (probada) = `booking_commission_pct` / `hx_first_shift_exempt` en SQL
(migración `20261103160000_breb_wallet_commission.sql`, aplicada en producción el 3 nov 2026 tras simulacro) y
`cashAcceptCheck` / `walletHealth` = `hx_booking_wallet_gate` / `get_my_wallet` (`20261104170000_cash_wallet.sql`, **aún no
aplicada en producción**).

## Flujo

1. **Cobro** (`src/lib/firux.functions.ts` → `firuxCharges.server.ts`): `payBookingWithBreb` (familia, desde que pide el
   turno hasta que termina, sin pagar), `topupWalletWithBreb` (profesional) y `payInstitutionPlanWithBreb` (institución). El monto sale de la base.
   Se guarda la fila `firux_charges` y su id va como `Idempotency-Key`; `external_reference` = id del turno (o del cobro
   para recargas y planes). Pedimos `expires_at` = 24 h porque Firux no avisa cuando un QR vence. Si Firux devuelve el
   mismo cobro pendiente de esa referencia, se reutiliza; un 409 en un turno = ya pagado.
2. **Pantalla** (`BrebPaySheet`): botón grande «Abrir mi banco» (`payment_url`), QR (`qr_emv`) y estado en vivo por
   Realtime sobre `firux_charges`.
3. **Aviso** `POST /api/public/firux/webhook` (`firuxWebhook.ts`): verifica `Firux-Signature` (HMAC-SHA256 de
   `{Firux-Timestamp}.{cuerpo}`, ventana 300 s; probado con el vector oficial), anota el evento en
   `payment_webhook_events` (`provider = 'firux'`, `Firux-Event-Id`) y llama `hx_firux_charge_paid` (solo service_role,
   idempotente): turno → `paid_at` y pago **retenido** (ver abajo); recarga → billetera; plan → `mp_subscriptions` por un año. `webhook.test` y
   `payment.notified` reciben 200 sin mover nada.
4. **Al terminar el turno** (`trg_sb_settle`): efectivo → débito de comisión en la billetera; Bre-B → el pago sigue
   retenido hasta que se libera (abajo) y solo entonces se crea la fila en `payouts` (`needs_key` si el profesional aún
   no guarda su llave, `queued` si ya).

## Pago retenido tipo InDrive (Bre-B)

Migración `20261104180000_breb_escrow.sql`; lógica espejo en `src/lib/escrow.ts` (probada).

1. La familia paga por Bre-B **al pedir el turno** (también puede pagar después, hasta que termine). El dinero queda en la
   cuenta Firux de Humanix: `service_bookings.escrow_status = 'held'`. El profesional ve «🔒 Pago asegurado».
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
   `refunding` + fila en `booking_refunds` por el total pagado. Un segundo QR pagado para el mismo turno también se
   devuelve (`reason = 'duplicate'`). La familia escribe su llave Bre-B en la página del servicio (`client_refund_keys`);
   el equipo envía la devolución desde Firux y la marca en /superadmin/pagos (`hx_mark_refund`) → `refunded`.

Solo el servidor escribe la retención: `guard_service_bookings_financials` protege las columnas nuevas y las funciones
de la familia (SECURITY DEFINER) encienden `hx.escrow` solo dentro de su transacción.

**Decisiones tomadas (cambiar si hace falta):**

- Ventana de revisión 24 h, recordatorio 3 h antes (`hx_escrow_window`, `hx_escrow_reminder_lead`).
- Cancelar con el pago adentro devuelve el **100 %**, cancele quien cancele (sin penalidad por cancelación tardía).
- Un reclamo se decide entero: liberar todo o devolver todo (sin repartos parciales).
- Con el pago retenido, **los turnos no se cobran por «Conectar con Firux Pay»** aunque el flag esté encendido (el dinero
  le llegaría al profesional antes de terminar). `ChargeDeps.holdBookings = false` vuelve al cobro conectado.
- No se bloquea «Voy en camino» si la familia no ha pagado: el profesional ve «La familia aún no ha pagado: espera el
  🔒 antes de salir».
- Turnos pagados antes de la migración: los terminados quedan `released` (`release_reason = 'legacy'`), los abiertos
  `held`.

## Pago al profesional

**Hoy (con la llave de Humanix):** el dinero de los turnos llega a la cuenta Firux de Humanix. La cola `payouts` + la
llave Bre-B del profesional (`professional_payout_keys`, tarjeta «Tu llave Bre-B») dicen cuánto y a quién pagar; el
equipo dispersa desde el panel de Firux (la API de Firux no mueve dinero ni hace dispersiones).
Con la dispersión automática (abajo) esto pasa solo; a mano queda como respaldo. El equipo trabaja la cola en **/superadmin/pagos** (solo staff): ve cuánto pagar, a qué llave y a quién, copia la
llave, paga en Firux y marca «Enviado» con la referencia de Firux, o «Falló» con el motivo (`hx_mark_payout`, avisa
al profesional). Cuando el profesional guarda o corrige su llave, sus pagos `needs_key`/`failed` pasan solos a
`queued` con la llave nueva (`trg_payout_key_sync`). Ambos en la migración `20261104160000_breb_payouts_ops.sql`
(**aún no aplicada en producción**; sin ella la página carga la cola pero no puede marcar pagos).

**Próximo — «Conectar con Firux Pay»** (en pruebas en Firux): cada profesional tiene su propia cuenta Firux y acepta la
comisión de Humanix una vez; Humanix crea el cobro del turno *a nombre del profesional* con la comisión incluida, la
plata le llega directo al profesional y la comisión a Humanix. Humanix no dispersa nada y la cola `payouts` deja de
hacer falta para los turnos digitales.
Costos informados por Firux: cuenta de Humanix en el plan Cobros Empresa (desde $150.000 + IVA al mes); el profesional
no paga plan, solo 1 % + IVA por cobro (mínimo $500).

### «Conectar con Firux Pay»: preparado, apagado

Ya está en el código, detrás de `FIRUX_CONNECT_ENABLED` (apagado si no existe):

- Migración `20261104140000_firux_connect.sql` (**aún no aplicada en producción**): tabla
  `professional_firux_connections` (cuenta Firux del profesional, estado `pending`/`active`/`revoked`, versión y fecha
  de la comisión aceptada, hash del `state` de un solo uso; la escribe solo el servidor), columnas `route`,
  `firux_account_id` y `application_fee_cop` en `firux_charges`, `hx_queue_payout` que salta los turnos cobrados por la
  cuenta del profesional y el aviso «El pago llegó a tu cuenta Firux» en `hx_firux_charge_paid`.
- Regla (`src/lib/firuxConnect.ts`, probada): con el flag encendido, un turno `DIGITAL_BREB` cuyo profesional tiene
  conexión `active` y la comisión vigente (`FIRUX_CONNECT_TERMS_VERSION`) aceptada se cobra a nombre de su cuenta con
  `application_fee` = `service_bookings.platform_fee_amount` (ya trae la exención del primer turno). Recargas y planes
  siempre van por la llave de Humanix.
- **Respaldo:** si el flag está apagado, la conexión no sirve, no se puede leer o no hay credencial, el turno se cobra
  como hoy y el pago sigue por `payouts` + llave Bre-B. Con el flag apagado el código no toca las columnas nuevas, así
  que se puede publicar antes de aplicar la migración.
- Flujo: tarjeta «Recibe tus pagos directo con Firux Pay» en el panel del profesional (acepta la comisión) →
  `startFiruxConnect` → Firux → `/firux/conectado?code&state` → `completeFiruxConnect` → `active`. «Desconectar» deja
  `revoked`.

**Suposiciones sobre la API (Firux no la ha publicado; corregir en un solo lugar cuando salga):**

| Qué | Suposición | Dónde se cambia |
| --- | --- | --- |
| Crear cobro a nombre del profesional | Misma llave de Humanix + encabezado `Firux-Account: <cuenta>` | `firuxCreateCharge` en `firuxCharges.server.ts` |
| Comisión de Humanix en el cobro | Campo `application_fee` (COP enteros) en `POST /v1/charges` | `issue` en `firuxCharges.server.ts` |
| Conectar la cuenta | Flujo tipo OAuth: `https://pay.firux.co/connect/authorize?client_id&redirect_uri&state&response_type=code` | `buildFiruxConnectUrl` en `firuxConnectApi.ts` |
| Canjear el código | `POST /v1/connect/token` → `{ account_id }` | `exchangeFiruxConnectCode` en `firuxConnectApi.ts` |
| Avisos de cobros conectados | Llegan al mismo webhook, con la misma firma y `charge.paid` | `firuxWebhook.ts` (sin cambios) |
| Desconectar | Solo en Humanix (no se llama a Firux) | `disconnect` en `firuxConnect.server.ts` |

Si Firux termina usando un token por profesional en vez del encabezado, `ChargeDeps.connect.firuxFor(accountId)` puede
devolver un cobrador con ese token sin tocar la lógica.

Para encenderlo: aplicar la migración, configurar `FIRUX_CONNECT_CLIENT_ID` y (opcional) `FIRUX_CONNECT_REDIRECT_URI`
(por defecto `https://humanix.lat/firux/conectado`), y poner `FIRUX_CONNECT_ENABLED=true`.

## Reparto, dispersión automática y conciliación (migración 20261105100000)

Cada pago que entra de una familia se reparte en esa misma transacción y, al liberarse, sale solo a la llave Bre-B del
profesional. Humanix se queda con la comisión de la matriz (15 / 12 / 10 %, planes institucionales y la exención del
primer turno, sin cambios). Lógica en `src/lib/dispersion.ts`, `dispersion.server.ts` y `reconciliation.ts` (probadas).

1. **Reparto por transacción** (`payment_splits`): cuando Firux confirma el pago del turno se fija el reparto de ese
   cobro: `gross_cop` = lo que pagó la familia, `platform_fee_cop` = `service_bookings.platform_fee_amount`,
   `professional_cop` = el resto. Una fila por turno; la suma siempre cuadra (restricción en la tabla).
2. **Libro de partida doble** (`ledger_entries`): cada fila mueve plata de una cuenta a otra, así el libro siempre suma
   cero. Lo escriben solo triggers, con una `ref` única (un aviso repetido no anota dos veces).

   | Evento | Desde → hacia |
   | --- | --- |
   | Familia paga el turno | external → escrow |
   | Se libera (confirmó, 24 h o el equipo) | escrow → platform (comisión) y escrow → professional (neto) |
   | Dispersión aceptada por Firux | professional → in_transit |
   | Firux confirma que llegó | in_transit → external |
   | Firux la rechaza | in_transit → professional (vuelve al saldo) |
   | Pago manual marcado en el panel | professional → external |
   | Devolución a la familia | escrow → external |
   | Recarga de billetera | external → wallet |
   | Comisión de turno en efectivo | wallet → platform |
   | Plan institucional | external → platform |

   Lo existente entra al libro una vez al aplicar la migración (relleno idempotente).
3. **Dispersión automática** (apagada hasta encenderla): al liberarse un pago, `hx_queue_payout` deja la fila en
   `payouts` (`queued`) y el trigger `trg_payout_kick` despierta al despachador `POST /api/public/firux/dispatch` con
   pg_net (en el mismo segundo). Un reloj `hx-dispersion-tick` (pg_cron, cada minuto) es el respaldo. El despachador
   reclama lotes de 50 (`hx_claim_payouts`, `FOR UPDATE SKIP LOCKED`), los envía a Firux 5 en paralelo y anota cada
   resultado (`hx_payout_result`). Estados: `queued → sending → sent → paid`.
   - Error pasajero (red, 5xx, 429, credencial): vuelve a la cola con espera de 1 min, 5 min, 30 min y 2 h; al 5.º
     intento queda `failed`. Un 401/403 detiene el lote (nunca se culpa la llave del profesional por un error nuestro).
   - Rechazo (llave inválida): `failed` y aviso al profesional; al corregir su llave vuelve sola a la cola.
   - `Idempotency-Key` = id del pago + huella de la llave de destino: un reintento nunca paga dos veces. Un pago que
     quedó `sending` más de 10 min (servidor caído) vuelve a la cola con la misma llave.
   - El aviso firmado `payout.paid` / `payout.failed` llega al mismo webhook (`hx_payout_webhook`).
   - El pago manual desde /superadmin/pagos sigue funcionando (respaldo); no deja marcar un pago mientras se envía.
4. **Saldos por profesional**: tarjeta «Tus pagos» en el panel del profesional (`get_my_earnings`): retenido, por
   llegar (por dispersar + en camino) y recibido (30 días y total), más la comisión de Humanix de los últimos 30 días.
   Se actualiza sola.
5. **Conciliación** en /superadmin/pagos (`hx_reconciliation`, solo staff): recaudado y comisión de 30 días, lo que
   debe haber en la cuenta Firux según el libro (retenido + por dispersar + en camino + comisión + billeteras) para
   compararlo con el saldo real, saldo de cada profesional, libro en CSV (31 días) y la lista de diferencias: cobro
   pagado fuera del libro, monto cobrado distinto, turno cerrado con plata retenida, saldo distinto a la cola, en camino
   distinto a lo enviado, billetera distinta, dispersión sin confirmar hace más de 1 h. Botón «Dispersar ahora».

**Suposiciones sobre la API de dispersiones (Firux no la ha publicado; corregir en un solo lugar):**

| Qué | Suposición | Dónde se cambia |
| --- | --- | --- |
| Crear dispersión | `POST /v1/payouts` con la llave de Humanix: `{ amount, currency: "COP", external_reference: <id del pago>, description, destination: { type: "breb_key", key_type, key } }` + `Idempotency-Key` | `buildPayoutBody` (`dispersion.ts`), `firuxSendPayout` (`dispersion.server.ts`) |
| Respuesta | `{ id, status: pending \| processing \| paid \| failed, failure_reason? }`; 409 con `id` = ya la tiene | `classifyPayoutResponse` |
| Tipos de llave | `phone`, `document`, `email`, `alias` (los mismos de Humanix) | `KEY_TYPE` en `dispersion.ts` |
| Aviso | `payout.paid` / `payout.failed` (también `payout.succeeded` / `payout.returned`) con `data.id` y `external_reference`, misma firma | `parsePayoutEvent` |
| Lote masivo | Un `POST` por pago en paralelo (si Firux publica un endpoint de lote, se cambia en `runDispersion`) | `dispersion.server.ts` |

**Para encenderla:**

1. Aplicar la migración `20261105100000_split_dispersion_ledger.sql` (si se aplica 20261104160000 después, volver a
   aplicar esta, que trae la versión nueva de `hx_mark_payout` y del cambio de llave).
2. En Lovable Cloud: `FIRUX_PAYOUTS_ENABLED=true` y `FIRUX_DISPATCH_SECRET` (un valor largo al azar).
3. En la base: `UPDATE hx_dispersion_config SET enabled = true, dispatch_url = 'https://humanix.lat/api/public/firux/dispatch', secret = '<el mismo FIRUX_DISPATCH_SECRET>';`
4. En Firux: confirmar que la cuenta tiene dispersiones habilitadas y saldo, y que el webhook envía los avisos `payout.*`.

Sin el paso 2 nada sale solo: los pagos liberados siguen en la cola y el equipo los paga a mano como hoy.

## Configuración pendiente

- Secretos en Lovable Cloud: `FIRUX_API_KEY` (`firux_test_…` para pruebas, `firux_live_…` en producción) y
  `FIRUX_WEBHOOK_SECRET` (`whsec_…`). Se crean en Firux → Ajustes → Conexiones API y se muestran una sola vez.
- URL del webhook en Firux: `https://humanix.lat/api/public/firux/webhook`.
- Prueba: crear un cobro desde la app y simularlo con `POST /v1/charges/{id}/simulate_payment` (solo llaves de prueba).

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
