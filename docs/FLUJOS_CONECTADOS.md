# Familia ↔ Profesional ↔ EPS/IPS: flujos conectados (octubre de 2026)

Lo que se construyó y se verificó entre el 12 y el 13 de octubre de 2026. Cada afirmación dice cómo se comprobó; lo que **no** se pudo
comprobar está en la sección 8. Detalle de la base de datos en la cabecera de cada migración (`supabase/migrations/2026101*`) y de las
migraciones y sus diferencias con producción en `docs/MIGRACIONES.md`.

## 1. Mapa de flujos

| Flujo                                                                                                                                                                       | Quién lo ve                                                                                    | Backend (función o tabla)                                                                                                    | Pantalla / hook                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Postulaciones a una oferta de la familia, en tarjetas (nombre según plan, foto, especialidad, ciudad, cercanía por rangos, estrellas, Trust Score, RETHUS, valor propuesto) | Familia                                                                                        | `family_applicants()` (por horas), `family_offer_applicants()` (ofertas de trabajo)                                          | `hooks/use-applicants.ts`, panel de familia                               |
| Aceptar, rechazar o contraofertar                                                                                                                                           | Familia, profesional, institución                                                              | `accept_slot_proposal`, `counter_slot_proposal`, `counter_application`, `accept_application`, `decline_application`          | `hub/CounterOfferDialog`, `hub/OfferCounterDialog`, `hub/ApplicantsInbox` |
| Contacto del postulante                                                                                                                                                     | Familia con plan Esencial o superior                                                           | `reveal_applicant_contact()`, `reveal_application_contact()` (cupo diario, auditoría y aviso al profesional)                 | `hooks/use-applicants.ts`                                                 |
| Avisos de ofertas nuevas                                                                                                                                                    | Profesionales publicados, disponibles y cercanos                                               | disparadores `trg_family_needs_notify_pros`, `trg_job_offers_notify_pros` → `hx_notify_nearby_professionals`                 | campana de notificaciones                                                 |
| Ofertas de familias para el profesional (cercanía, mejor pago, estado de la negociación)                                                                                    | Profesional                                                                                    | `list_open_family_offers()` v2, `list_open_family_needs()`, `list_open_institution_offers()`                                 | `hooks/use-family-offers.ts`, `use-opportunity-feed.ts`                   |
| «Mi oferta de servicio»                                                                                                                                                     | La publica el profesional; la ven familias, instituciones y personal                           | `professional_service_offers`, `list_open_service_offers()`                                                                  | `hooks/use-service-offers.ts`                                             |
| Moderación de lo que se publica                                                                                                                                             | Todos                                                                                          | `hx_offer_guard()` en 6 tablas (ver abajo)                                                                                   | espejo en `src/lib/contentModeration.ts`                                  |
| PQRS desde el panel de la familia                                                                                                                                           | Cada cuenta ve las suyas; el superadmin ve todas                                               | `my_pqrs_tickets()`; la lectura directa de la tabla queda solo para el personal                                              | `hooks/use-my-pqrs.ts`                                                    |
| SOS Familiar                                                                                                                                                                | Paciente, círculo de cuidado, profesional con servicio vigente, quien contrató y el superadmin | `clinical_alerts` (`sos_manual`), `my_sos_alerts()`, `hx_can_access_alert()`                                                 | `hooks/use-sos.ts`                                                        |
| Directorio público de profesionales                                                                                                                                         | Todos (el visitante sin sesión ve «Laura P.», sin foto)                                        | `public_professionals(…)`                                                                                                    | `hooks/use-public-professionals.ts`                                       |
| Mapas y contadores en vivo                                                                                                                                                  | Familia, profesional, institución, EPS y visitante                                             | `touch_presence()`, `stop_presence()`, `map_professionals()`, `map_open_demand()`, `map_institutions()`, `get_live_counts()` | `hooks/use-live-map.ts`, `use-presence.ts`                                |
| Trust Score                                                                                                                                                                 | Quien mira a una familia, institución o profesional                                            | `get_trust_score()`, `hx_trust_calc()`                                                                                       | `hooks/use-trust-score.ts`                                                |
| «¿A quién necesitas?» de la institución (con «Médico» y «Otro», moderado)                                                                                                   | Institución                                                                                    | `public_professionals(…)`                                                                                                    | `simple/InstitutionFlow`                                                  |
| Personal de la institución con usuario y contraseña                                                                                                                         | La institución administra; el personal usa los módulos que se le asignan                       | `institution_members`, `hx_acting_institution()`, `my_staff_context()`                                                       | `/acceso-equipo`, `/dashboard/equipo`, pestaña «Personal»                 |

## 2. Reglas por plan en estos flujos

|                                                    | Gratis     | Esencial | Pro      | Institución                                                                |
| -------------------------------------------------- | ---------- | -------- | -------- | -------------------------------------------------------------------------- |
| Aceptar y rechazar una propuesta                   | Sí         | Sí       | Sí       | Sí                                                                         |
| **Contraofertar el valor** (familia y profesional) | No         | Sí       | Sí       | Las instituciones negocian sin plan                                        |
| Nombre completo del profesional (familia)          | «Pedro P.» | Completo | Completo | —                                                                          |
| Contacto del postulante (cupo diario por cuenta)   | No         | 15       | 40       | 40                                                                         |
| Personal con usuario propio                        | —          | —        | —        | Hasta 10 personas (feature `multi_user_roles`, plan `institution_monthly`) |

El plan sale siempre de `mp_subscriptions` (`plan_key_for()`, que solo ejecuta el rol de servicio y que solo escribe el webhook de pago).
Los pagos ocurren únicamente en el checkout web: el contacto que se desbloquea es para coordinar, nunca para cobrar.

**Moderación (en el servidor, donde no se puede saltar).** Rechaza lenguaje ofensivo o sexual, venta o alquiler de artículos y, en las
ofertas de familias y de profesionales, todo lo que no mencione salud o cuidado; además bloquea teléfonos, correos, enlaces,
direcciones y datos de pago en textos públicos. Se aplica a `family_needs`, `job_offers` (familia e institución), `availability_slots`,
`professional_profiles.bio`, `profiles.bio` y `professional_service_offers`. Es un filtro de primera línea (lista de palabras), no un
clasificador: no entiende disfraces fuertes y no revisa lo que ya estaba guardado.

## 3. Privacidad: lo que nunca viaja

- **Teléfono, WhatsApp y dirección exacta**: ninguna función de lectura (listados, tarjetas, mapas, directorio) los devuelve. Solo las funciones de
  «revelar contacto» entregan el teléfono, según el plan, con cupo diario, una fila de auditoría y aviso a la otra parte.
- **Coordenadas**: siempre en cuadrícula de ~1 km; la cercanía se muestra por rangos (2, 5, 10, 20, 50 y «más de 50» km). Con kilómetros
  exactos, quien cambie su propia ubicación podría ir acercándose hasta descubrir dónde vive la otra parte.
- **Posición en el mapa**: solo los profesionales que deciden compartirla; las familias y las instituciones cuentan como «en vivo» pero no publican posición.
- **Nombres**: abreviados para el visitante y según plan para la familia.
- **Datos de salud**: el superadmin y las partes del servicio (la persona, su círculo de cuidado, el profesional con servicio vigente y quien
  contrató); RR. HH. y evaluadores quedaron fuera.

## 4. Mapas y contadores en vivo

Contadores reales por rol —**disponible, en vivo, ocupado**— y servicios completados (`get_live_counts()`, que también alimenta
`get_platform_counts()`, antes con ceros fijos). «En vivo» = latido de presencia de los últimos 3 minutos (`hx_presence_ttl()`); «ocupado» = tiene una
reserva vigente o un servicio en curso; «disponible» = publicado, marcado disponible y no ocupado. La familia sigue visible para los profesionales mientras tenga ofertas
abiertas y sale del mapa si apaga «visible en el mapa» o cierra todo.

Actualización sin sondeo: un disparador emite un aviso por el canal privado de difusión (`live_map_ping`, `service_offers_changed`) solo
cuando cambia algo que el mapa ve (no por cada latido) y los clientes vuelven a pedir los datos por las funciones seguras; hay un
refresco de seguridad por tiempo (TTL) por si el aviso no llega.

## 5. Personal de la institución con usuario y contraseña

**Qué es.** La institución (cuenta dueña) crea hasta 10 personas, cada una con su usuario y contraseña y con los módulos que elija. Cada
persona es una cuenta real de Auth **sin ningún rol** en `user_roles`; su pertenencia vive en `institution_members`.

**Módulos de la versión 1**: `ofertas` (publicar turnos, ver y responder postulaciones: aceptar, rechazar y contraofertar, invitar al equipo
de confianza) y `talento` (red de profesionales: contadores, mapa y ofertas de servicio, solo lectura y sin ubicación propia).
**Nunca se delega**: firmar contratos, pagos y billetera, pacientes y monitoreo clínico, perfil y datos legales de la institución, y
administrar al equipo. En el panel del personal, el botón de contrato no existe y una postulación aceptada dice «El contrato lo firma la
cuenta de la institución».

**Cómo funciona.**

- _Acceso:_ `/acceso-equipo` con usuario y contraseña (correo sintético interno `<usuario>@staff.humanix.lat`, que nunca se muestra); el
  mensaje de error es el mismo para «no existe» y «contraseña incorrecta». Una persona suspendida o quitada vuelve a esa pantalla con la explicación.
- _Creación y gestión (solo la cuenta de la institución, con el plan IPS Mejorado vigente para crear):_ `createServerFn` en
  `src/lib/institutionMembers.functions.ts` (crear, editar, suspender o reactivar, reiniciar contraseña, quitar). Suspender también
  bloquea el inicio de sesión; quitar elimina la cuenta. La contraseña se muestra **una sola vez** (no se guarda ni se registra).
  Contraseña: 10 a 72 bytes, letras y números, sin espacios, sin el usuario, sin claves comunes; el botón «Generar» da una de 14 caracteres.
- _Datos:_ seis funciones (`publish_institution_offer`, `accept_application`, `decline_application`, `counter_application`,
  `institution_application_inbox`, `invite_team_to_offer`) usan `hx_acting_institution(auth.uid(), módulo)` en lugar de `auth.uid()`: devuelve
  la institución solo si la persona está activa, tiene el módulo, la dueña conserva el rol y el plan sigue vigente. Lectura de solo
  consulta (RLS) sobre `job_offers`, `job_offer_shifts` y `applications`; el personal **no** lee `institution_profiles` (recibe lo que
  necesita por `my_staff_context()`).
- _Auditoría:_ `institution_member_actions` registra quién publicó, aceptó, rechazó o contraofertó. Los eventos de `application_events`
  siguen mostrando a la institución como actor; quién fue lo dice la tabla de auditoría.
- _En vivo:_ ambas tablas están en `supabase_realtime`; la pantalla se actualiza cuando suspenden a alguien, le cambian módulos o la
  institución pierde el plan.

**Cómo se verificó.** Suite SQL `supabase/e2e/institution_members` (164 comprobaciones, con pruebas de mutación: todos los mutantes
mueren), simulacros en producción (95/95 y 21/21) antes de aplicar, pruebas de servidor con base simulada, y el navegador simulado: acceso
7/7, panel del equipo 16/16 (incluye que el contrato nunca se muestra, aceptar y rechazar llaman a las funciones de la institución,
suspendida y retirada se cierran) y gestión de la dueña 19/19, además de 375 px sin desbordes y consola limpia.

## 6. Bitácora de producción (12 y 13 de octubre de 2026)

Cada migración se aplicó con simulacro (que se deshace solo, con suma de control de cada parte) y se comprobó después en solo lectura.
La sonda de `docs/MIGRACIONES.md` confirmó el 13 de octubre que las 14 migraciones del 11 al 13 de octubre coinciden al 100 %.

| Migración                                                                  | Qué cambió                                                                                                                                                                                                           |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261012100000_clinical_data_scope`                                       | Lectura de datos clínicos «por servicio»                                                                                                                                                                             |
| `20261012140000_restore_signup_trigger`                                    | **Se restauró el disparador de registro** (`on_auth_user_created`): desde el 5 de octubre las cuentas nuevas quedaban sin perfil y sin rol, y por eso no salían en los mapas ni podían postularse                    |
| `20261012150000_health_data_access`                                        | RR. HH. y evaluadores fuera de los datos de salud; la institución y la familia leen las alertas de SUS servicios; `anon` sin privilegios sobre signos vitales y dispositivos; las alertas ya no se pueden reescribir |
| `20261012160000_sos_familiar` y `…170000_sos_feed`                         | SOS Familiar de punta a punta (antes el botón no podía guardar la alerta) y lista de alertas para quien las atiende                                                                                                  |
| `20261012180000_offer_moderation`                                          | Moderación en el servidor                                                                                                                                                                                            |
| `20261012190000_offer_alerts_and_plans`                                    | Avisos, negociación por plan, tarjetas de postulantes, contacto y Trust Score                                                                                                                                        |
| `20261012200000_pqrs_my_tickets`                                           | Cada cuenta ve sus PQRS sin el triaje interno                                                                                                                                                                        |
| `20261012210000_live_map`                                                  | Presencia y mapas en vivo                                                                                                                                                                                            |
| `20261013100000_public_professionals`                                      | Directorio público: el buscador, el perfil y los flujos guiados volvían a salir vacíos para todo el que no fuera personal                                                                                            |
| `20261013110000_professional_panel`                                        | «Mi oferta de servicio» y negociación visible                                                                                                                                                                        |
| `20261013120000_institution_members` y `…130000_institution_staff_context` | Personal de la institución                                                                                                                                                                                           |

**Depuración de datos.** Al restaurar el registro se eliminaron datos de prueba huérfanos (cuentas sin perfil y lo que colgaba de ellas):
12 necesidades de familia, 41 horarios, 3 filas del libro de créditos IA, 1 embedding, 1 validación, 2 consentimientos, 1 oferta, 3 perfiles
profesionales y 14 necesidades sin dueña. Quedaron la cuenta del superadmin y un profesional real que se registró después, ya con perfil y rol.

## 7. Verificación

| Qué                                                                  | Resultado                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun test`                                                           | 2 298 pruebas, 0 fallos (81 archivos)                                                                                                                                                                                                                                   |
| Suites SQL sobre la réplica de producción                            | 11 suites, 0 fallos (1 661 comprobaciones; 252 son la regresión del hub repetida dentro de `care_loop`): `institution_members`, `care_loop`, `clinical_scope`, `health_access`, `institution_hub`, `livemap`, `offers`, `pqrs_owner`, `pro_panel`, `public_pros`, `sos` |
| Navegador (Chromium con base simulada; 375–1 280 px, consola limpia) | mapas 24/24, institución 65/65, ofertas 64/64 (4 corredores), app 27/27, profesional 25/25, familia 27/27, personal 23/23 (acceso y panel), gestión de la dueña 19/19                                                                                                   |
| Render en servidor (`renderToString` sin `window`)                   | `/acceso-equipo`, `/dashboard/equipo`, `StaffManager` y `CredentialsDialog`: sin errores                                                                                                                                                                                |
| Producción frente al repositorio                                     | 674 de 685 objetos de octubre coinciden; las 14 migraciones del 11 al 13 de octubre, al 100 % (ver `docs/MIGRACIONES.md`)                                                                                                                                               |
| Calidad estática                                                     | Prettier limpio; ESLint sin avisos nuevos; `tsc` sin errores nuevos                                                                                                                                                                                                     |

## 8. Límites conocidos y decisiones pendientes

**No se pudo comprobar aquí (hacerlo tras publicar):**

- Que Auth acepte crear cuentas con el correo sintético `@staff.humanix.lat` (`email_confirm: true`): el entorno de pruebas no habla con el Auth real.
  Prueba mínima: crear una persona, entrar por `/acceso-equipo`, suspenderla y comprobar que no puede entrar.
- La entrega real de Realtime para las tablas nuevas (están en la publicación; la pantalla además se refresca al volver a la pestaña).
- El render completo con el servidor real de TanStack Start (falta el paquete privado de Lovable en este entorno; se probó con `renderToString`).

**Por diseño o decisión previa:**

- Contraofertar exige el plan Esencial en ambos lados; aceptar y rechazar son gratis.
- La «dirección» del postulante que ve la familia es ciudad + rango de cercanía, nunca la dirección.
- La moderación no se aplica al contacto de las ofertas de institución (solo lenguaje ofensivo y venta).
- El Trust Score del profesional es el puntaje guardado de la validación con IA («Sin validar» si no existe); nadie lo escribe desde el cliente.
- WhatsApp automático no está en marcha: faltan `pg_net`, el secreto de Vault y los secretos de la función (`clinical-alert-notify`).
- Los importes de oferta se limitan en el cliente y, en el servidor, entre 1.000 y 20.000.000 de pesos.
- `is_staff()` sigue incluyendo a RR. HH. y evaluadores para PQRS y otras tablas no clínicas.

**Pendiente de decidir o de seguridad:**

- `pro_select_published_public` (política de `professional_profiles`) deja leer **todas las columnas** del perfil publicado a cualquiera, incluidas
  coordenadas exactas heredadas. Ahora que todos los lectores usan `public_professionals()`, conviene cerrarla (queda anotado en `AUDIT_REPORT.md` #63).
- `anon` y `authenticated` conservan privilegios amplios de tabla heredados de Supabase en muchas tablas; solo las protege RLS. Se retiraron
  en las tablas tocadas (signos vitales, dispositivos, PQRS, ubicaciones) y en las nuevas.
- **Backend de junio que nunca llegó a producción** (cancelar suscripción, créditos IA y copiloto de chat, billetera, invitaciones,
  sedes, casos de pacientes…): lista completa y decisiones en `docs/MIGRACIONES.md` §5.2 y §6.
- Los contadores en vivo dependen del aviso de difusión más un refresco por tiempo; si el aviso no llega, pueden tardar hasta ese tiempo.
- ESLint conserva 3 errores `any` previos (`use-app-user.tsx`, `auth.tsx`) y 2 avisos de dependencias de hooks en `dashboard.institucion.tsx`;
  `tsc` conserva los errores de módulos ausentes en este entorno (vitest, `@lovable.dev`, etc.).
