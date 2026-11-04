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
- Turno mínimo $45.000. Formas de pago: `DIGITAL_BREB` (por defecto) o `CASH`.
- Efectivo: la comisión se descuenta de la **billetera** del profesional al terminar el turno. Cupo hasta −$30.000; para
  aceptar un turno en efectivo, saldo + cupo debe cubrir la comisión; por debajo de −$30.000 no recibe turnos nuevos. La
  billetera se recarga con un cobro Bre-B normal.

Regla espejo: `src/lib/commissionMatrix.ts` (probada) = `booking_commission_pct` / `hx_first_shift_exempt` en SQL
(migración `20261103160000_breb_wallet_commission.sql`, aplicada en producción el 3 nov 2026 tras simulacro).

## Flujo

1. **Cobro** (`src/lib/firux.functions.ts` → `firuxCharges.server.ts`): `payBookingWithBreb` (familia, turno aceptado,
   sin pagar), `topupWalletWithBreb` (profesional) y `payInstitutionPlanWithBreb` (institución). El monto sale de la base.
   Se guarda la fila `firux_charges` y su id va como `Idempotency-Key`; `external_reference` = id del turno (o del cobro
   para recargas y planes). Pedimos `expires_at` = 24 h porque Firux no avisa cuando un QR vence. Si Firux devuelve el
   mismo cobro pendiente de esa referencia, se reutiliza; un 409 en un turno = ya pagado.
2. **Pantalla** (`BrebPaySheet`): botón grande «Abrir mi banco» (`payment_url`), QR (`qr_emv`) y estado en vivo por
   Realtime sobre `firux_charges`.
3. **Aviso** `POST /api/public/firux/webhook` (`firuxWebhook.ts`): verifica `Firux-Signature` (HMAC-SHA256 de
   `{Firux-Timestamp}.{cuerpo}`, ventana 300 s; probado con el vector oficial), anota el evento en
   `payment_webhook_events` (`provider = 'firux'`, `Firux-Event-Id`) y llama `hx_firux_charge_paid` (solo service_role,
   idempotente): turno → `paid_at`; recarga → billetera; plan → `mp_subscriptions` por un año. `webhook.test` y
   `payment.notified` reciben 200 sin mover nada.
4. **Al terminar el turno** (`trg_sb_settle`): efectivo → débito de comisión en la billetera; Bre-B pagado → fila en
   `payouts` (`needs_key` si el profesional aún no guarda su llave, `queued` si ya).

## Pago al profesional

**Hoy (con la llave de Humanix):** el dinero de los turnos llega a la cuenta Firux de Humanix. La cola `payouts` + la
llave Bre-B del profesional (`professional_payout_keys`, tarjeta «Tu llave Bre-B») dicen cuánto y a quién pagar; el
equipo dispersa desde el panel de Firux (la API de Firux no mueve dinero ni hace dispersiones).

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

## Configuración pendiente

- Secretos en Lovable Cloud: `FIRUX_API_KEY` (`firux_test_…` para pruebas, `firux_live_…` en producción) y
  `FIRUX_WEBHOOK_SECRET` (`whsec_…`). Se crean en Firux → Ajustes → Conexiones API y se muestran una sola vez.
- URL del webhook en Firux: `https://humanix.lat/api/public/firux/webhook`.
- Prueba: crear un cobro desde la app y simularlo con `POST /v1/charges/{id}/simulate_payment` (solo llaves de prueba).
