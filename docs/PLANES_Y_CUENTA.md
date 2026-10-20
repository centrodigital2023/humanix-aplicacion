# Planes y eliminación de cuenta

> **20 oct 2026: los planes pasan a Suscripciones de Mercado Pago** (`/preapproval`, cobro mensual en COP, sin plan asociado y con `external_reference = sub:<user_id>:<plan>`). Cada cobro aprobado suma un mes con la misma lógica de abajo; `mp_subscriptions.mp_preapproval_id` guarda la suscripción que renueva el plan y se borra al cancelarla (el plan sigue hasta su vencimiento). El webhook atiende `payment`, `subscription_authorized_payment` y `subscription_preapproval`: hay que activar esos eventos en el panel de Mercado Pago → Webhooks con la URL de `mp-webhook`. Lo que sigue describe el pago único anterior.

Estado: rama `fix/planes-y-eliminacion-discreta`. Sin migración, sin Edge Function nueva y sin cambio de precios. Se tocaron solo Edge Functions existentes (`mp-create-subscription`, `mp-webhook`, `delete-account`).

## 1. Cómo se cobra un plan

Cada pago es una preferencia simple de Mercado Pago por **un mes**, siempre en la web. **No hay cobros automáticos.** El webhook de pagos es el único que activa un plan en `mp_subscriptions`. El plan vigente se lee igual en todas partes: estado `active`/`approved` y sin vencer (`get_user_plan()` en SQL, `normalizeSubscription` en `src/lib/plans.ts` y `activePaidPlan` en `planBilling`).

Las reglas viven en un módulo puro compartido, `supabase/functions/_shared/planBilling.ts`, que se reexporta en `src/lib/planBilling.ts` y está probado en `src/lib/planBilling.test.ts`. Una prueba exige que los precios y niveles del servidor coincidan con `PLAN_CATALOG`.

| Situación                      | Antes                                                                                                  | Ahora                                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Pago aprobado                  | Activaba el plan guardado en la fila en ese momento: abrir el pago de IPS y pagar el Esencial daba IPS | Activa el plan **pagado** (fijado por el servidor en la metadata o el ítem) y exige que el monto cubra su precio      |
| Abrir un pago con plan vigente | Pasaba la fila a `pending`: se perdía el plan sin pagar nada                                           | No toca la fila; solo marca «pendiente» a quien no tiene plan                                                         |
| Bajar de plan con uno vigente  | Se permitía y se perdían los días pagados                                                              | El servidor responde 409 `downgrade_while_active`; la interfaz dice hasta cuándo dura el actual                       |
| Renovar antes de tiempo        | El mes nuevo empezaba hoy (se perdían días)                                                            | Se suma un mes **desde el vencimiento**                                                                               |
| Subir de plan                  | Se perdían los días que quedaban                                                                       | Los días restantes se convierten al valor del plan nuevo (p. ej. 20 días de Esencial → 6 días de Pro)                 |
| Pago rechazado o cancelado     | Desactivaba un plan vigente                                                                            | Se ignora si hay un plan vigente                                                                                      |
| Regreso tras pagar             | Desde /planes, todos volvían al panel profesional                                                      | Al panel de su rol (lo decide el servidor con `user_roles`)                                                           |
| Fallo de red al leer el plan   | Se mostraba «Free» y el botón de pagar                                                                 | `usePlan` reintenta, conserva el último plan y expone `error`; no se ofrece pagar                                     |
| Tarjeta del plan               | «Próxima renovación», «Cancelar» y «Reactivar renovación» (sin efecto real)                            | «Vigente hasta…», días que quedan, recordatorio amable en los últimos 5 días y «Renovar 1 mes»; sin botón de cancelar |

Pagar se hace en un solo lugar del cliente: `startCheckout` en `src/lib/checkout.ts`, que usan `/planes`, la franja de planes y la tarjeta de los paneles. Los mensajes no muestran detalles técnicos.

## 2. Eliminar la propia cuenta

- **Discreto en la interfaz.** «Cuenta y privacidad · Eliminar mi cuenta» es una línea sobria al final del panel, en lugar de la tarjeta roja «Zona de peligro». El diálogo es sereno, ofrece «Me quedo» como opción principal y pide escribir «eliminar» (sin importar mayúsculas ni tildes).
- **Discreto con los demás.** No se envía ningún aviso a otras personas. El detalle de lo borrado queda solo en el registro de auditoría; la respuesta al navegador es `{ ok: true }`.
- **Nadie se queda esperando.** Con servicios en camino, en curso, o pendientes o confirmados desde hace menos de 12 horas en adelante, la cuenta no se elimina. Lo revisa la interfaz al abrir el diálogo y **lo exige el servidor** (409 `active_services`). Reglas en `supabase/functions/_shared/accountDeletion.ts`, probadas en `src/lib/accountDeletion.test.ts`.
- Antes, el bloqueo por «pagos pendientes» consultaba `service_bookings.payment_status`, una columna que no existe, así que nunca bloqueaba.

## 3. Pendiente

1. **Migración recomendada (no incluida, requiere revisión):** hoy casi todas las tablas compartidas (`service_bookings`, `care_logs`, contratos, calificaciones) tienen `ON DELETE CASCADE` hacia `auth.users`. Al eliminar una cuenta también desaparece el historial de la otra parte. Lo más respetuoso sería anonimizar (`ON DELETE SET NULL` y «Persona que ya no está en Humanix») en lugar de borrar.
2. El plan IPS se cobra a COP 299.000 fijo en el checkout; el cálculo por sedes (`calculateInstitutionBilling`) aún no se usa al cobrar.
3. Las funciones SQL `cancel_my_subscription` y `resume_my_subscription` quedan sin uso en la interfaz (no hay cobro automático que cancelar).
4. Verificación completa en un entorno con dependencias: `tsc`, `eslint`, `vitest` y revisión visual en navegador. En esta sesión no se pudo instalar dependencias. Se probaron con Bun las reglas puras, que también pasaron una revisión por mutación (9 de 9 mutantes detectados), y se verificaron los tipos de las Edge Functions y de los módulos puros.
