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
- ~~Pendiente: `job_offers.address`/`contact_phone` legibles por la API~~ → cerrado en la migración `20261009100000`
  (ver abajo). Sigue pendiente revisar que ninguna otra tabla con direcciones conserve políticas permisivas antiguas.

## Hub de instituciones y contrato inteligente
- **Dirección y teléfono fuera de la oferta:** `job_offer_private` (RLS: autor y staff). Un disparador traslada lo que escriban
  los formularios actuales; la oferta queda con dirección vacía y coordenadas a 2 decimales. La dirección llega al profesional
  al ser aceptado (reserva) o, con plan de pago, tras postularse (`reveal_offer_contact`).
- **Postulaciones con integridad en el servidor:** `applications_guard_insert/update` impiden forjar valor, estado o ronda;
  `accepted` y las contraofertas solo salen de `accept_application` / `counter_application`.
- **`get_booking_contact` con plan, cupo y auditoría** (antes entregaba el teléfono a cualquier profesional de la reserva).
- **Contratos:** flujo anterior cerrado (`sign_contract` retirado; políticas de escritura eliminadas). El contrato inteligente
  solo registra firmas con `record_contract_signature` (service role) tras: identidad verificada (RETHUS / NIT +
  representante legal), código de correo ≤ 10 min (`amr` del token, verificado en el servidor), aceptación explícita y huella
  del texto. Tablas del contrato sin INSERT/UPDATE/DELETE para `authenticated`; eventos y firmas inmutables con cadena de hashes.
  La IP se guarda solo como huella con sal secreta.
- **Mensajes** de postulación/contraoferta/publicación sin teléfonos, correos, enlaces, direcciones ni instrucciones de pago.
- **Realtime:** canal privado `open_needs_ping` sin datos; `smart_contracts` y `job_offer_shifts` con RLS.
- Tablas nuevas con GRANT + RLS en la misma migración; `anon` sin acceso. Auditoría automática en la suite de PostgreSQL (14.x).
- Pendiente: probar el flujo con dos cuentas reales en Supabase, configurar SMTP propio y la plantilla del correo con
  `{{ .Token }}`, y revisión jurídica de la plantilla del contrato.

## Lazo de cuidado
- **`care_logs` blindada:** la migración original del repositorio permitía insertar partes en una reserva ajena (la política solo
  comprobaba `professional_id = auth.uid()`); la de producción ya exigía ser el profesional de la reserva, pero sin servicio en
  curso ni tope. Ahora solo el profesional de la reserva, con el servicio en curso, tope de 200 por turno; solo-agregar (sin
  UPDATE/DELETE); `anon` sin acceso; llegada y salida las genera el sistema.
- **Datos de salud, mínimo privilegio:** el parte lo leen el cliente, el profesional, los miembros **aceptados** del círculo y
  `superadmin`. HR y evaluadores **no** (en producción la política `care_logs_read` usaba `is_staff()` y los dejaba leer; la
  cadena la reemplaza). `get_care_summary` no existía en producción y se crea ya con comprobación de quién llama.
- **Texto limpio sin bloquear emergencias:** sin teléfonos, correos, enlaces ni instrucciones de pago; las alertas nunca se
  rechazan por contenido. Fotos de pacientes descartadas hasta tener un flujo de consentimiento (Ley 1581).
- **Gracias y trayectoria sin autodeclarar:** solo `send_kudos()` escribe (`care_kudos` sin INSERT/UPDATE/DELETE para
  `authenticated`); las cifras salen de servicios completados; lo público es agregado y sin identidades.
- **Pagos solo en la web:** los textos de gracias, invitaciones y de compartir no contienen datos de pago; la historia exportable
  excluye importes, teléfonos y direcciones y neutraliza fórmulas de Excel.
- **Plan de pago desde `mp_subscriptions`** (`care_history_report`); el cliente no puede declararlo.
- **Permisos por defecto de Supabase:** toda tabla, secuencia o función nueva hereda `ALL` para `anon` y `authenticated`. Las 16
  tablas nuevas hacen REVOKE explícito y GRANT mínimo (`20261010120000_new_tables_least_privilege.sql` y las propias migraciones);
  el simulacro y la prueba de humo en producción comprobaron que `anon` no tiene ningún privilegio sobre ellas.
- **Realtime:** la publicación `supabase_realtime` estaba vacía en Lovable Cloud; la migración `20261010110000` publicó las 14
  tablas que escuchan las pantallas (respeta RLS; aplicada el 2026-10-09). Pendiente de decisión: `realtime.messages` tiene RLS
  sin políticas, así que los canales privados (`open_needs_ping`) no pueden funcionar hasta definir políticas.
- **Chat y contacto:** `conversations.updated_at` faltaba en producción (ningún mensaje se enviaba); se restablecen
  `get_or_create_booking_conversation` (sin sesión no abre el chat; solo las partes) y `booking_contact_reveals` (auditoría; los
  usuarios solo leen lo propio).
- Pendiente: el círculo puede leer el importe de la reserva por API (la política es por filas; la interfaz lo oculta); las tablas
  que ya existían conservan `ALL` para `anon`/`authenticated` (revisar una a una); la política `pro_select_published_public`
  expone a `anon` todas las columnas de los profesionales publicados; migraciones antiguas sin aplicar en producción; probar con
  dos cuentas reales (Realtime, JWT, correos).
