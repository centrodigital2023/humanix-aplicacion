# Humanix Care Connect — Documentación de la plataforma

> Generada el 7 de octubre de 2026 a partir de la lectura del código y las migraciones del repositorio.
> **Importante sobre "qué funciona":** este documento distingue tres niveles de evidencia.
> - **Implementado en código**: existe el código y está conectado (ruta, componente, función, tabla).
> - **Verificado aquí**: comprobado por análisis estático o ejecución en este entorno.
> - **Requiere prueba en producción**: depende de Supabase, claves de terceros o despliegue, que este entorno no puede ejecutar.
>
> En este entorno **no se pudieron ejecutar las pruebas ni el build** (ver sección 9). Nada de lo marcado como "funcionando" se probó en un navegador contra la base real.

---

## 1. Qué es

Plataforma colombiana de coordinación de cuidado en casa. Conecta **profesionales de la salud** con **familias** e **instituciones (EPS/IPS)**. Cubre registro y verificación de profesionales, publicación y búsqueda de ofertas, agendamiento y seguimiento del servicio, pagos y suscripciones, monitoreo clínico y de signos vitales, mensajería, y un panel de control para el superadministrador.

## 2. Cómo está construido

| Capa | Tecnología |
|---|---|
| Frontend | TanStack Start + React 19, rutas por archivo (`src/routes`), TypeScript |
| UI | Tailwind CSS 4, shadcn/ui sobre Radix, lucide-react |
| Formularios / datos | react-hook-form + Zod, TanStack Query |
| Backend | Supabase: PostgreSQL, Auth, Realtime, Storage, Edge Functions (Deno) |
| IA | Lovable AI Gateway (modelos Gemini) desde Edge Functions; embeddings propios |
| Pagos | Mercado Pago (suscripciones y paquetes de créditos) |
| Mensajería | WhatsApp Cloud API, Resend (email) |
| Despliegue | Vite + Cloudflare Workers (`wrangler.jsonc`) |
| Móvil | Capacitor (Android/iOS), wearables y notificaciones push |
| Pruebas | Vitest + jsdom |
| Gestor | Bun |

### Cifras del repositorio
- 77 archivos de ruta en `src/routes` (incluye dashboards, páginas SEO por ciudad y panel superadmin).
- 120 componentes de dominio en `src/components/humanix`.
- 13 hooks en `src/hooks`.
- 43 Edge Functions en `supabase/functions` (más `_shared`).
- 102 archivos de migración SQL, que definen unas 82 tablas.
- 3 archivos de prueba unitaria (`planCta`, `planCta.checkout`, `family-journey`).

### Estructura
```
src/routes/            páginas y dashboards (file-based routing; routeTree.gen.ts)
src/components/humanix componentes de negocio
src/components/ui      primitivas shadcn
src/hooks/             auth, plan, realtime, superadmin, presencia, etc.
src/lib/               lógica pura: planes, precios, SEO, IA, geo
src/integrations/      cliente Supabase (navegador y servidor)
supabase/functions/    Edge Functions
supabase/migrations/   esquema, RLS, triggers
```

## 3. Roles y cómo se entra

Los roles viven en `public.user_roles` (enum `app_role`, único por usuario+rol).

| Rol | Entrada | Qué hace |
|---|---|---|
| `professional` | `/dashboard/profesional` | Perfil, documentos, agenda, ofertas, créditos IA |
| `family` | `/dashboard/familia` | Necesidades, búsqueda, contratación, seguimiento |
| `institution` | `/dashboard/institucion` | Ofertas masivas, pacientes, monitoreo clínico, facturación por sede |
| `hr_staff` | `/talento-humano` | Reclutamiento y pool de talento |
| `evaluator` | `/evaluador` | Revisión de documentos y perfiles |
| `superadmin` | `/admin` → `/superadmin` | Control total (ver sección 5) |

Un trigger (`handle_new_user`) crea el perfil y asigna el rol por defecto (`family`) o el elegido al registrarse. El correo propietario recibe `superadmin` al crear la cuenta y, además, la función `verify-admin-access` lo asigna tras validar el código.

## 4. Qué tiene la plataforma (módulos)

### 4.1 Sitio público
Portada, `/sobre`, `/planes`, `/profesionales`, `/buscar`, `/familias`, `/eps-ips`, `/carreras`, `/recursos`, `/prensa`, `/contacto`, `/calculadora`, páginas legales (`/terminos`, `/privacidad`, `/habeas-data`), `/confianza`, `/cumplimiento`, `/tecnologia`, `/cosmos`, `/verificar`. SEO por ciudad (`enfermeria-bogota`, `-medellin`, `-cali`, `-barranquilla`, `-cartagena`, `-bucaramanga`, `-pereira`) y por servicio (cuidado de adulto mayor, paliativo, pediátrico, postoperatorio, auxiliar de enfermería, cuidador a domicilio). `sitemap.xml` generado por ruta.

### 4.2 Profesionales
Perfil con extracción de hoja de vida por IA (`cv-extractor`, `onboarding-extractor`), documentos con verificación IA (`document-verifier`), referencias, disponibilidad, agenda (`ProAgendaModule`), sugerencia de tarifas (`rate-suggester`), bio (`bio-summary`), recomendación de ofertas (`match-offers`, `semantic-match`), Trust Score (`profile-validator`, `profile-holistic-validator`, `social-trust-score`, `trust-verdict`), compuerta de publicación (`PublishGate`), créditos IA y suscripción.

### 4.3 Familias
Onboarding asistido por IA (`family-onboarding-ai`), perfil del paciente, calendario de necesidades, asistente de contratación (`hiring-copilot`), mapa de profesionales en vivo, reserva y chat (`BookingChat`, `chat-copilot`), check-in/check-out con geolocalización, bitácora de cuidado (`CareFeed`), botón SOS, valoración por voz (`VoiceRating`, `analyze-rating-voice`).

### 4.4 Instituciones (EPS/IPS)
Publicación masiva de ofertas con requisitos FUID (`EnhancedBulkOffersModule`), pacientes con KPIs (`EnhancedPatientsModule`), agenda de 7 días, monitoreo clínico y alertas (`InstitutionClinicalMonitoring`, `clinical-alert-notify`), signos vitales y wearables (`VitalSignsPanel`, `wearable-ingest`), facturación por sede (`IpsBranchBilling`, `use-institution-billing`), formularios dinámicos, informes con CRM.

### 4.5 Planes y pagos
Catálogo canónico en `src/lib/plans.ts`: **Free** (COP 0), **Esencial** (COP 9.000/mes), **Pro Profesional** (COP 29.000/mes), **IPS Mejorado** (COP 299.000/mes, más sedes/profesionales adicionales y descuento anual del 20%). Compuertas de funcionalidad por plan (`PlanGate`, `use-plan`). Cobro por **Mercado Pago en la página web** (`mp-create-subscription`, `mp-create-credits-checkout`, webhook `mp-webhook`), con retorno en `/pago/exito` y `/pago/fallo`. Paquetes de créditos IA (`TokenPackages`, `WalletPanel`).

### 4.6 IA transversal
Asistente conversacional con streaming (`humanix-assistant`, `HumanixAssistant`), SDK tipado (`src/lib/humanixAi.ts`), embeddings 768-d deterministas (`embed-text`, `embed-profile`, `embed-offer`), generación de imágenes promocionales (`promo-image-gen`), clasificación PQRS, segmentación CRM, recomendador de anuncios, detector de fraude, proxy NASA (`nasa-proxy`).

### 4.7 Comunicación
WhatsApp: webhook entrante con respuesta IA (`whatsapp-webhook`), envío manual desde CRM (`whatsapp-send`), alertas de bitácora (`care-alerts`) y clínicas. Email con Resend (`send-campaign`). OTP del formulario de validación de mercado por WhatsApp o correo (`sendValidationOtp` / `verifyValidationOtp`, funciones de servidor en `src/lib/marketValidation.functions.ts`; las Edge Functions `send-validation-otp` y `verify-validation-otp` se retiraron, ver `docs/VALIDACION_MERCADO.md`). Notificaciones in-app (`NotificationsBell`, tabla `notifications`).

### 4.8 Cumplimiento (FUID / Colombia)
Vigencias: antecedentes 5 años, exámenes médicos 3, referencias laborales 2, certificaciones 5. Re-verificación semanal RETHUS (`rethus-weekly-check`, pensada para cron). Habeas Data (`HabeasDataConsent`). Contratos con firma OTP (`generate-contract`, `ContractSignature`).

## 5. Panel de superadministrador

### Flujo de acceso (aislado del resto de la app)
```
Portada → pie de página "Admin" → /admin
  Fase 1: correo + contraseña (Supabase Auth). Enlace "¿Olvidaste tu contraseña?" → /reset-password
  Fase 2: código de 6 dígitos → Edge Function verify-admin-access
          · identidad tomada del JWT (no del cuerpo)
          · límite de 5 intentos / 15 min (tabla admin_code_attempts)
          · compara con el secret ADMIN_ACCESS_CODE (solo en el servidor)
          · asigna/confirma el rol superadmin al correo propietario (ADMIN_OWNER_EMAIL)
  Fase 3: pantalla de carga → navigate("/superadmin", replace)
/superadmin/*  → hook useSuperadmin: sin sesión o sin rol → /admin (nunca a otros dashboards)
```
No hay credenciales ni código de acceso en el frontend.

### Contenido de `/superadmin` (Control Center)
Puntaje de salud de la plataforma, 8 KPIs animados, pestañas **Overview / Usuarios / Operaciones / Comunicaciones**, emergencias activas (botón de pánico) con resolución, alertas de IA por voz, auditoría reciente, accesos rápidos, lista de usuarios con eliminación (`delete-account`), distribución por rol, invitaciones de staff, notificaciones a usuarios, cambio de contraseña, suscripciones Realtime a emergencias, valoraciones, auditoría, fraude, perfiles y roles.

Subrutas: `fraude`, `auditoria`, `publicidad`, `marketing`, `crm`, `marketplace`, `resenas`, `testimonios`, `validacion`, `activar`.

`/superadmin/validacion` tabula en vivo el formulario de validación de mercado y su pestaña inicial **Hallazgos** entrega, de forma automática, el veredicto (con criterios visibles y margen de error), los temas de dolor, los contactos a priorizar con mensaje sugerido (nunca habla de pagos), los segmentos y un resumen para compartir; además avisa por notificación de cada contacto fuerte recién verificado. Reglas y límites en `docs/VALIDACION_MERCADO.md` (§7.1).

## 6. Base de datos
~82 tablas definidas por migraciones. Las más usadas por el frontend: `professional_profiles`, `job_offers`, `profiles`, `service_bookings`, `professional_documents`, `applications`, `family_profiles`, `institution_profiles`, `availability_slots`, `ad_banners`, `user_roles`, `slot_proposals`, `wearable_connections`, `vital_signs_readings`, `crm_contacts`, `service_ratings`, `service_checkins`, `family_needs`, `crm_campaigns`, `messages`, además de vistas públicas seguras (`public_professionals_safe`, `public_institutions_safe`, `public_family_map_safe`). Las políticas RLS están en las migraciones; hay funciones auxiliares como `has_role`.

## 7. Edge Functions (43)

| Función | Para qué | Llamada desde |
|---|---|---|
| `verify-admin-access` | Valida código admin | `/admin` |
| `bootstrap-superadmin` | Asigna primer superadmin (requiere `SUPERADMIN_BOOTSTRAP_SECRET`) | `/superadmin/activar` |
| `delete-account`, `delete-professional` | Borrado propio / por staff | Panel, Zona de peligro |
| `humanix-assistant` | Chat IA con streaming | Asistente |
| `cv-extractor`, `onboarding-extractor`, `family-onboarding-ai` | Extracción con IA | Onboardings |
| `document-verifier` | Verifica documentos con IA | Documentos |
| `profile-validator`, `profile-holistic-validator`, `social-trust-score`, `trust-verdict` | Confianza y publicación | Perfil |
| `rate-suggester`, `bio-summary`, `match-offers`, `semantic-match`, `embed-*` | Tarifas, bio, emparejamiento | Profesional / ofertas |
| `hiring-copilot`, `chat-copilot` | Copilotos de contratación y chat | Familia / IPS |
| `analyze-rating-voice` | Transcribe y clasifica valoración por voz | Valoraciones |
| `mp-create-subscription`, `mp-create-credits-checkout`, `mp-webhook` | Pagos Mercado Pago | Planes / créditos |
| `apply-referral-reward` | Recompensa por referido | Interna (webhook) |
| `send-campaign`, `crm-segment-ai`, `ad-recommender`, `pqrs-classifier`, `promo-image-gen` | CRM, marketing, publicidad | Superadmin |
| `whatsapp-webhook`, `whatsapp-send`, `care-alerts`, `clinical-alert-notify` | WhatsApp y alertas | Webhooks / CRM |
| `generate-contract` | Contrato y OTP de firma | Interna |
| `fraud-detector`, `rethus-weekly-check` | Antifraude y RETHUS | Internas / cron |
| `wearable-ingest`, `nasa-proxy` | Wearables y datos NASA | App móvil / sitio |

**Secrets que usan:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LOVABLE_API_KEY`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET`, `RESEND_API_KEY`, `INTERNAL_WEBHOOK_SECRET`, `WEARABLE_INGEST_SECRET`, `RETHUS_CRON_SECRET`, `SUPERADMIN_BOOTSTRAP_SECRET`, `NASA_API_KEY`, `ADMIN_ACCESS_CODE`, `ADMIN_OWNER_EMAIL`.

## 8. Estado: qué está implementado y qué funciona

### 8.1 Verificado en este entorno (análisis estático)
- Todas las funciones que el frontend invoca existen en `supabase/functions`, **salvo una** (ver 8.3).
- Las rutas `superadmin.activar` y `dashboard.institucion.onboarding` están registradas en `routeTree.gen.ts`.
- El flujo `/admin` → `/superadmin` está conectado de punta a punta en código: el footer apunta a `/admin`, la verificación es del lado del servidor, `useSuperadmin` solo redirige a `/admin`, y no hay credenciales en el frontend.
- Las rutas y archivos modificados en esta sesión (`admin.tsx`, `superadmin.index.tsx`) no producen errores de tipos.

### 8.2 Implementado en código; requiere prueba en producción
Todo lo demás de las secciones 4 a 7: registro y roles, dashboards, ofertas, reservas, mapas, IA, pagos, WhatsApp, email, wearables, alertas clínicas y panel superadmin. Existen y están cableados, pero dependen de Supabase desplegado, de los secrets de la sección 7 y de servicios externos (Mercado Pago, WhatsApp Cloud API, Resend, Lovable AI). **No se ejecutó ninguno contra los servicios reales.**

Para que el acceso de administrador funcione hay que, además: desplegar `verify-admin-access`, definir `ADMIN_ACCESS_CODE`, y aplicar la migración `admin_code_attempts`.

### 8.3 Problemas detectados
1. **`humanix-ai-chat` no existe.** `src/components/humanix/ProAgendaModule.tsx:327` invoca una función que no está en `supabase/functions`. Esa característica del módulo de agenda fallará hasta que se cree o se apunte a `humanix-assistant`.
2. **Datos simulados.**
   - `PatientRiskCard.tsx:241` usa una puntuación de riesgo simulada cuando la función no responde ("Edge function may not exist yet").
   - `EnhancedReportsWithCRMModule.tsx:319` genera `open_rate` con `Math.random()`.
   Ambos muestran números que no son reales.
3. **Funciones sin llamada desde el frontend:** `apply-referral-reward`, `care-alerts`, `clinical-alert-notify`, `fraud-detector`, `generate-contract`, `mp-webhook`, `rethus-weekly-check`. Algunas son legítimas (webhooks y cron), pero requieren que esos disparadores estén configurados en Supabase. Si no lo están, esas funciones nunca se ejecutan: `fraud-detector` y `generate-contract` en particular no tienen disparador visible en el código.
4. **Regla de pagos por WhatsApp.** Los pagos se hacen en la web. Los enlaces de WhatsApp encontrados son de soporte (`pago.fallo.tsx`) y de consulta del Plan Institución (`planes.tsx:651`); ninguno cobra. Conviene revisar el segundo y las respuestas automáticas de `whatsapp-webhook` para asegurar que nunca envíen enlaces de pago.
5. **`bootstrap-superadmin`** sigue activa como segunda vía para crear superadmin; está protegida por `SUPERADMIN_BOOTSTRAP_SECRET`. Si no se usa, conviene retirarla.
6. **`vitest.config.ts`** carga el paquete `vitest`, que no está instalado en este entorno (ver sección 9).

## 9. Pruebas y build
- Existen 3 archivos de prueba (precios y planes, recorrido familiar). Son pruebas de lógica pura.
- **No se pudieron ejecutar aquí.** `bun install` falla con 403: el lockfile apunta a un registro privado de Lovable inaccesible desde este entorno. Por eso `vitest`, `html-to-image`, `jszip`, `react-qr-code` y `@lovable.dev/vite-tanstack-config` no están instalados, y `tsc` reporta 18 errores, todos de módulos o tipos faltantes (no de código propio). Tampoco se pudo correr `vite build`.
- Para confirmar el estado real hay que ejecutar en una máquina con acceso al registro: `bun install && bun run test && bun run lint && bun run build`.

## 10. Cómo verificar que todo funciona (lista de comprobación)
1. `bun install && bun run test && bun run build` sin errores.
2. Supabase: migraciones aplicadas; secrets de la sección 7 cargados; funciones desplegadas.
3. Disparadores configurados: webhook de Mercado Pago, Database Webhooks para `care_logs` y `clinical_alerts`, cron de `rethus-weekly-check`, webhook de WhatsApp.
4. Acceso admin: footer "Admin" → correo y contraseña → código → `/superadmin`.
5. Crear una cuenta de cada rol y recorrer su dashboard.
6. Pago de prueba de suscripción en Mercado Pago (sandbox) hasta `/pago/exito`.
7. Corregir los puntos 1 y 2 de la sección 8.3.
