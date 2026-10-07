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
