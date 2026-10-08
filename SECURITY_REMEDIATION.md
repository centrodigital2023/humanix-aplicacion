# Remediación de seguridad

## Hecho
- Acceso admin: identidad desde el JWT, código solo en el servidor (`ADMIN_ACCESS_CODE`), 5 intentos por 15 min, rol asignado solo al correo propietario.
- `bootstrap-superadmin` eliminada. No quedan vías de creación de superadmin salvo: asignación al correo propietario tras validar el código, y la política de invitación del panel.
- Pagos: firma HMAC verificada, pago consultado en Mercado Pago, idempotencia, errores visibles, logs sin payloads.
- WhatsApp: salida filtrada contra instrucciones/URLs de pago.
- `function_execution_logs` y `payment_webhook_events`: RLS activa, lectura solo superadmin.

## Acciones manuales
1. Rotar `ADMIN_ACCESS_CODE`, `SUPERADMIN_BOOTSTRAP_SECRET` (revocar) y la contraseña del administrador: aparecieron en conversaciones.
2. Crear secretos de Vault `internal_webhook_secret` y `rethus_cron_secret`.
3. Confirmar `MERCADOPAGO_WEBHOOK_SECRET` y que la URL de notificación del panel de Mercado Pago coincida con el proyecto actual.
4. Aplicar las migraciones `20261007160000` a `20261007180000`.
5. Revisar en Meta que `WHATSAPP_APP_SECRET` esté configurado (validación de firma).

## Pendiente
- Revisar RLS con pruebas automatizadas (familias no ven datos de otras familias; profesionales no ven pacientes no asignados; IPS solo sus sedes).
- Pruebas de `mp-webhook` con sandbox.
- Rate limiting en `humanix-assistant`.

## PQRS y Marketplace
- Eliminadas las políticas de INSERT directo en `pqrs_tickets` (anónima y autenticada): el único camino es la función de servidor `submitPqrs`.
- Límites de frecuencia por IP (5 radicaciones/h, 20 consultas/h) y por contacto (3/h) almacenando solo hashes SHA-256 con sal secreta.
- Consulta de estado con comparación exacta de correo en código (nunca `ILIKE` con datos del usuario: `%` sería un comodín).
- Texto de tickets tratado como no confiable en los prompts; salidas de IA validadas contra listas cerradas; borradores sin medios de pago ni enlaces externos.
- Exportación CSV con neutralización de fórmulas (`=`, `+`, `-`, `@`).
- Ofertas bloqueadas ocultas por RLS; bloqueo con motivo, aviso al autor y auditoría.
- Invitaciones a profesionales: sin repetir por oferta y con tope diario por persona.
- Pendiente: acuse de recibo por correo (omitido a propósito para evitar abuso del formulario público); política de retención de `pqrs_tickets` y `pqrs_intake_attempts`.

## Hub de oportunidades del profesional
- **Fuga cerrada:** cualquier usuario autenticado podía leer `family_needs` con dirección y notas de menores y adultos
  mayores (política `family_needs_select_authenticated` nunca retirada, más `fn_select_open_for_pros`). Ahora solo la
  familia dueña y el staff leen la tabla; los profesionales usan `list_open_family_needs()` (sin dirección, nombre
  abreviado, notas sin datos de contacto).
- **Propuestas con integridad en el servidor:** antes las partes podían insertar/editar `slot_proposals` por la API con
  cualquier valor o estado. Ahora lo impiden los disparadores `slot_proposals_guard_insert/update`.
- **Dirección y WhatsApp** solo con plan de pago vigente (`mp_subscriptions`), postulación activa y cupo diario; cada
  desbloqueo queda auditado y la familia recibe aviso.
- **Mensajes y comentarios** sin teléfonos, correos, enlaces, direcciones ni instrucciones de pago (los pagos solo en la
  web). Comentarios de calificaciones visibles solo para la persona calificada y el staff.
- **Sin Edge Functions nuevas:** `pqrs-intake`/`pqrs-assistant` pasaron a `createServerFn`.
- Pendiente: `job_offers.address`/`contact_phone` siguen legibles por la API para usuarios autenticados (requiere tabla
  privada); revisar con pruebas automatizadas que ninguna otra tabla con direcciones tenga políticas permisivas antiguas.
