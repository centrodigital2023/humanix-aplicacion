# Verificación ReTHUS con Verifik — esquema real y plan ajustado

## 1. Perfil del profesional
- La tabla es `professional_profiles` (no `health_professionals`). Columnas: `id`, `user_id`, `rethus_number`, `rethus_verified`, `verified`, `trust_score`, `published`, etc.
- **No hay nombre completo en esta tabla.** El nombre está en `profiles.full_name` (se une por `user_id`). La cédula no se guarda en ninguna columna.
- Política UPDATE del dueño: `pro_update_self` con USING `auth.uid() = user_id` y **sin WITH CHECK**. Además, staff tiene `pro_staff_all`.
- Triggers: `guard_professional_publish` (bloquea `published`). Ninguno protege `rethus_verified`, `verified`, `trust_score` ni `avg_rating`.

## 2. Roles
- `user_roles(user_id, role app_role)`, único por user+rol. Roles: professional, family, institution, superadmin, hr_staff, evaluator.
- Admin: `has_role(uid,'superadmin')`. Staff (superadmin, hr_staff, evaluator): `is_staff(uid)`. Ambas son SECURITY DEFINER.

## 3. Suscripciones y pagos
- Fuente real: `mp_subscriptions` (user_id, plan, status, current_period_end, next_payment_at) y `mp_payments` (user_id, mp_payment_id, amount, status, paid_at). También existe `subscriptions` (heredada: plan free/pro/…).
- `mp-webhook` firma HMAC, consulta el pago a Mercado Pago y escribe `mp_payments` y `mp_subscriptions` con la llave de servicio.
- Cliente: en `mp_subscriptions` solo lectura (bien). **En `mp_payments` existe `mpp_insert_self`**: el cliente puede insertar su propia fila con `status='approved'`. Hoy no se puede confiar en `mp_payments` desde el cliente.
- Plan activo = `mp_subscriptions.status IN ('active','approved') AND (current_period_end IS NULL OR > now())`, misma regla que `platform_commission_pct`.

## 4. Funciones y secrets existentes
- Relacionadas: `rethus-weekly-check` (usa IA sobre el PDF ReTHUS), `document-verifier`, `trust-verdict`, `social-trust-score`, `verify-validation-otp`. No hay biometría ni Verifik.
- `rethus-weekly-check` usa `rethus_verified_at` y la tabla `rethus_checks`, **que no existen**. Hoy fallaría.
- Secrets configurados: ADMIN_ACCESS_CODE, ADMIN_ACCESS_CONTRASENA, LOVABLE_API_KEY, MERCADOPAGO_ACCESS_TOKEN, MERCADOPAGO_WEBHOOK_SECRET, WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN, WHATSAPP_BUSINESS_ACCOUNT_ID, NASA_API_KEY, más los internos del backend. Faltan: VERIFIK_TOKEN, DOCUMENT_HASH_KEY, WHATSAPP_APP_SECRET, INTERNAL_WEBHOOK_SECRET, RETHUS_CRON_SECRET, RESEND_API_KEY.

## Diferencias con lo que suponías
| Suposición | Real |
|---|---|
| health_professionals | professional_profiles |
| full_name en el perfil | profiles.full_name |
| un solo estado de plan | mp_subscriptions (vigente) + subscriptions (heredada) |
| rethus_checked_at | no existe; ya hay `rethus_verified` (bool) |

## Riesgos
1. **Escalada en el perfil:** sin WITH CHECK ni trigger, el profesional puede hoy ponerse `rethus_verified=true`, `verified=true` o subir `trust_score`. El trigger nuevo debe cubrir también esas columnas, no solo `verification_status` y `rethus_checked_at`.
2. **Pago falsificable:** `mpp_insert_self` permite insertar pagos aprobados. La función debe validar solo con `mp_subscriptions`, y conviene quitar esa política.
3. **Dos fuentes de verdad:** `rethus_verified` (existente, usada por el sitio y `get_platform_counts`) y `verification_status` (nueva). Hay que sincronizarlas en el servidor.
4. **Cron roto:** `rethus-weekly-check` depende de objetos inexistentes. Hay que decidir si lo reemplaza Verifik.
5. **Ley 1581:** guardar el consentimiento con fecha y versión en `user_consents`, que ya existe, además de `data_consent_at`. No guardar la respuesta cruda de Verifik con datos personales.
6. **Límite 3/24 h:** contar en `professional_verifications`, que solo escribe service_role, para que el cliente no lo pueda reiniciar.

## Plan ajustado
1. Migración: en `professional_profiles` agregar `data_consent_at`, `verification_status` (default 'unverified') y `rethus_checked_at`. Agregar un trigger BEFORE UPDATE que, para quien no sea staff ni service_role, conserve `verification_status`, `rethus_checked_at`, `rethus_verified`, `verified`, `trust_score`, `avg_rating` y `total_jobs`. Agregar WITH CHECK a `pro_update_self`.
2. Tabla `professional_verifications` (user_id, provider, document_hash, result, status, created_at): GRANT SELECT a authenticated, ALL a service_role, RLS de lectura para el dueño o superadmin, sin políticas de escritura.
3. Quitar `mpp_insert_self` de `mp_payments`.
4. Función `verify-rethus`: identidad desde el JWT, consentimiento registrado, plan activo según `mp_subscriptions`, límite 3/24 h, HMAC-SHA256 del documento con DOCUMENT_HASH_KEY, llamada a Verifik y comparación con `profiles.full_name`. Luego escribe la verificación, `verification_status`, `rethus_checked_at` y `rethus_verified`.
5. Pedir VERIFIK_TOKEN y DOCUMENT_HASH_KEY por el formulario seguro.
6. Pruebas Vitest de la lógica pura: normalización de nombres y conteo del límite.

Quedo atento a tu plan escrito para contrastarlo con esto.
