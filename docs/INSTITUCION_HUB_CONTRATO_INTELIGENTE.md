# Hub de instituciones, negociación y contrato inteligente

Dónde vive:

- **Profesional** (`/dashboard/profesional` → pestaña **Ofertas** → «EPS, IPS y clínicas»): agenda de turnos de instituciones,
  postulaciones, negociación y contratos.
- **Institución** (`/dashboard/institucion`): **Inicio** (Centro de cobertura, Postulaciones, Contratos, calificaciones
  pendientes) y **Ofertas** (publicar turnos, todas las postulaciones).
- **Reserva** (`/servicio/:id`): dirección del servicio, contacto y contrato inteligente de esa reserva.

Toda la lógica de decisión es pura, explicable y probada (`src/lib/institution*.ts`, `contract*.ts`). Lo que protege datos,
planes y firmas lo decide **el servidor** (migración `20261009100000_institution_hub_smart_contracts.sql` y la función de
servidor `signSmartContract`); la interfaz solo presenta lo que el servidor ya filtró.

## Qué necesidades cubre

El contexto (ver «Lecturas») es de **déficit de personal de enfermería** y **presión financiera de IPS y hospitales**
(cartera, cierres de servicios). No encontré estudios colombianos sobre ausentismo o cobertura de turnos en sí; el diseño
se apoya en esas señales y en lo que ya hacen las plataformas de turnos: cubrir rápido, con talento verificado y sin
costos ocultos.

| Necesidad (por qué importa) | Qué hace Humanix | Dónde |
|---|---|---|
| Cubrir un turno que empieza en horas | **Centro de cobertura**: clasifica cada turno (crítico < 12 h, en riesgo, vigilar), dice por qué y sugiere la siguiente acción: responder postulaciones, marcar urgente, subir el valor (+12 %), invitar al equipo, firmar | `CoverageCenter`, `institutionCoverage.ts` |
| Publicar una semana de turnos sin 40 formularios | Turnos diurnos/nocturnos (19:00→07:00 termina al día siguiente), cupos por turno y **repetir un horario** por días de la semana (hasta 60) | `PublishShiftsDialog`, `institutionShifts.ts` |
| Elegir bien entre postulantes | RETHUS verificado, calificación, servicios, «ya trabajó con ustedes», espera y vencimiento, antes de aceptar | `ApplicantsInbox`, `institutionApplications.ts` |
| Responder a tiempo | Cada postulación muestra cuánto lleva esperando; pasadas 24 h se marca en rojo y la acción sube a «crítica» | `applicationSla` |
| Que el profesional sepa con quién trabaja | Reputación de la institución (estrellas y 4 dimensiones, mínimo 3 calificaciones) | `InstitutionReputationBadge` |
| Negociar el valor sin subastas a la baja | Rango 0,8×–2× lo publicado, máx. 3 rondas, vencimiento, y la institución también puede contraofertar | `OfferCounterDialog` |
| Dejar lo acordado por escrito | **Contrato inteligente**: partes, turnos, horas, valor, condiciones y firma de ambos con identidad validada | `SmartContractDialog` |
| Premiar a quien ya demostró su trabajo | **Invitar al equipo de confianza** (favoritos) con un aviso personal; nunca a quien ya se postuló, una vez por turno | `invite_team_to_offer` |
| Calificar y comentar en ambos sentidos | El profesional califica a la institución (estrellas, dimensiones, comentario); la institución califica al profesional desde el servicio | `RateFamilyDialog`, `PendingRatingsCard` |

## Qué ve cada plan

| | Free | Esencial · Pro · IPS |
|---|---|---|
| Ver turnos de instituciones, puntaje, reputación y verificación (sin dirección ni teléfono) | Sí | Sí |
| Postularse al **valor publicado** | Sí | Sí |
| Proponer **otro valor** / contraofertar | No (el interruptor está bloqueado y el servidor lo rechaza) | Sí (`negotiate_rate`) |
| **Dirección** del servicio | Al ser aceptado (queda en la reserva) | Además, antes de aceptar, tras postularse |
| **Contacto / WhatsApp** | No | Sí, tras postularse (`whatsapp_contact`) |
| Desbloqueos por día (contrapartes distintas) | 0 | 15 (Esencial) · 40 (Pro, IPS) |
| Comisión | 12 % | 0 % |

La institución no necesita plan para publicar, aceptar, contraofertar ni firmar. El plan se lee **solo** de
`mp_subscriptions` (lo escribe el webhook de pagos). Los pagos se hacen únicamente en la página web: ningún texto
automático ofrece otra vía y los mensajes con instrucciones de pago se rechazan.

## Flujo de punta a punta (el escenario con dos cuentas)

1. **La institución publica** (`publish_institution_offer`): servicio, valor, turnos y datos privados. La dirección, el
   teléfono y las indicaciones de acceso van a `job_offer_private`; las coordenadas públicas quedan aproximadas (≈ 1 km).
   Los profesionales con una alerta que coincida reciben aviso.
2. **El profesional Free ve el turno sin dirección** (`list_open_institution_offers`) y se postula al valor publicado
   (`apply_to_offer`).
3. **Intenta negociar y el sistema se lo impide**: en pantalla (interruptor bloqueado + «desde el plan Esencial») y en el
   servidor (`applications_guard_insert` rechaza otro valor con `negotiate_rate_requires_plan`, aunque llame a la API).
4. **Pasa a Esencial y contraoferta** (`counter_application`): valor dentro de 0,8×–2×. Mientras la institución no responda
   puede cambiar su propia propuesta sin gastar una ronda.
5. **La institución acepta** (`accept_application`): en una sola operación crea una **reserva por turno con la dirección**,
   bloquea la agenda del profesional, cierra las postulaciones que ya no caben o se cruzan, genera el **contrato inteligente**
   y avisa a ambos.
6. **El profesional desbloquea el contacto** (`reveal_offer_contact`): nombre, WhatsApp, dirección e indicaciones. Queda
   auditado y la institución recibe «X desbloqueó tu contacto».
7. **Ambos firman** el contrato con identidad validada (ver abajo).
8. **Quien publicó ve el aviso** de cada paso (postulación, contraoferta, aceptación, desbloqueo, firma). En ofertas de
   una familia (sin agenda) el horario se define al aceptar y la familia recibe los mismos avisos; no genera contrato
   inteligente (una familia no tiene NIT ni representante legal que validar).

Si un turno se cancela, el cupo se **reabre** y el contrato registra el evento; al completarse el último turno el contrato
pasa a «cumplido».

## Negociación (reglas)

| Regla | Valor |
|---|---|
| Rango de la propuesta | 0,8× a 2× lo publicado, pasos de $500, con piso y techo por modalidad (hora 8 mil–250 mil · turno 40 mil–3 M · mes 500 mil–30 M · paquete 50 mil–50 M) |
| Rondas | Máx. 3 (la 3 es «última oferta»: solo aceptar o rechazar) |
| Vencimiento | 72 h la postulación inicial, 24 h cada contraoferta; nunca después de 1 h antes del primer turno y mínimo 15 min |
| De quién es el turno | Campo `awaiting`: solo quien debe responder puede aceptar o contraofertar |
| Cambiar la propia propuesta | El profesional puede, mientras la institución no responda; no gasta ronda |
| Mensajes | Sin teléfonos, correos, enlaces, direcciones ni datos de pago |

## Contrato inteligente

**Qué contiene.** Al aceptar, el servidor congela los términos (JSON) y calcula su huella SHA-256: partes (institución con
NIT y representante legal; profesional con RETHUS), objeto, turnos con hora y valor, economía (valor acordado, total,
comisión y neto), condiciones (aviso de cancelación, recargo por cancelación tardía de la institución, tolerancia de
llegada, registro de ingreso, bioseguridad, confidencialidad, reemplazo) y marco legal. El texto se genera de forma
**determinista** desde esos términos (plantilla `humanix-shift-v1`, 10 cláusulas) y cada firma guarda la huella del texto
exacto que esa persona vio.

**Cómo se firma — cuatro garantías, verificadas de nuevo en el servidor:**

1. **Identidad verificada** (`contract_signer_readiness`): profesional con RETHUS verificado y cuenta sin bloqueos;
   institución verificada por el equipo, con NIT y representante legal.
2. **Segundo factor reciente**: código de un solo uso al correo de la propia cuenta (Supabase Auth). El token trae la
   marca `amr` (`otp`/`magiclink`) y el servidor exige que tenga **≤ 10 min**; una sesión que quedó abierta no basta.
3. **Aceptación explícita** de cuatro declaraciones (contrato, credenciales, confidencialidad, firma electrónica).
4. **Huella del texto**: el navegador calcula el SHA-256 del texto mostrado y el servidor lo compara con el que renderiza.

Solo el rol de servicio puede registrar firmas (`record_contract_signature`); el cliente no escribe en las tablas del
contrato. Tras la segunda firma el contrato queda **vigente**. La institución puede ajustar condiciones mientras nadie haya
firmado (cada cambio genera versión y huella nuevas y avisa al profesional); cualquiera puede **rechazar** con motivo. Si
no se firma a tiempo (el menor entre 72 h y 30 min antes del primer turno) vence, sin tumbar la reserva.

**Evidencia.** `smart_contract_events` es una cadena de hashes inmutable (creado, condiciones, firmas, activado, turnos);
`verify_contract_integrity` recalcula huella de términos, cadena y firmas en el servidor. La pestaña «Evidencia» lo muestra.

**Marco legal (orientativo).** Ley 527 de 1999 (mensajes de datos y firma electrónica), Decreto 2364 de 2012 (firma
electrónica; la fiabilidad depende de la autenticación y de un método apropiado — compilado en el Decreto 1074 de 2015),
Ley 1581 de 2012 (datos personales), Resolución 3100 de 2019 (habilitación) y Resolución 1995 de 1999 (historia clínica).
Esta es una firma **electrónica simple**, no una firma digital certificada por una entidad de certificación.

> ⚠️ **La plantilla es informativa y debe revisarla un abogado** antes de usarla con instituciones reales. En particular la
> cláusula de naturaleza independiente: si en la práctica hay subordinación, subsiste el riesgo de «contrato realidad».
> Tampoco verifiqué el texto literal del art. 4 del Decreto 2364.

## Privacidad y seguridad (qué cambió y por qué)

- **Se cerró una fuga.** `job_offers.address` era legible por cualquier usuario autenticado y las coordenadas eran exactas.
  Ahora la dirección, el teléfono y las coordenadas exactas viven en `job_offer_private` (solo quien publicó y el equipo); un
  disparador mueve allí lo que escriban los formularios actuales y la oferta queda con dirección vacía y coordenadas a
  2 decimales. El hub nunca los lee.
- **Las postulaciones ya no se pueden forjar.** Antes, cualquier parte podía insertar o editar `applications` por la API
  (valor, estado `accepted`). `applications_guard_insert/update` hacen cumplir: estado inicial, ronda 1, valor publicado,
  plan para negociar, rango, cruces de agenda, turnos con cupo; `accepted` y las contraofertas solo salen de las funciones.
- **Contacto con plan.** `get_booking_contact` entregaba el teléfono del cliente al profesional sin mirar el plan; ahora
  aplica plan, cupo diario y auditoría igual que `reveal_offer_contact`.
- **El flujo de contratos anterior estaba roto e inseguro.** `sign_contract` comparaba MD5 contra un hash SHA-256 con sal que
  no se guardaba (nadie podía firmar) y las políticas dejaban a cada parte editar cualquier columna, incluidas las firmas.
  Se cerró la escritura, `sign_contract` responde que fue reemplazado y la pantalla de la reserva solo consulta los
  contratos antiguos. La Edge Function `generate-contract` sigue desplegada pero la interfaz ya no la usa.
- **Aceptar era un `UPDATE`.** El panel de la institución cambiaba el estado sin crear reserva, turnos, dirección ni
  contrato. Ahora usa `accept_application`.
- **Reservar con `set_offer_reserved` desde el cliente fallaba siempre** (privilegio revocado) y, de funcionar, habría dejado
  al profesional no disponible 15 días solo por postularse. Se eliminó; postular usa `apply_to_offer`.
- **Comentarios privados** (como en el hub de familias): los demás profesionales solo ven promedios (≥ 3).
- Lectores corregidos: `oferta/$offerId` (JSON-LD sin `streetAddress`), `evaluador` (el teléfono sale de
  `job_offer_private`; antes la consulta pedía una columna sin permiso), `offerQuality` (la zona ya no depende de la
  dirección) y los textos «familia» de las calificaciones, ahora neutros.

## Constantes que existen en SQL **y** en TypeScript (cámbialas juntas)

| Regla | SQL | TypeScript |
|---|---|---|
| Rango 0,8×–2×, pasos de $500, piso y techo por modalidad | `offer_band_min/max` | `offerBand`, `MODALITY_BOUNDS` (`institutionNegotiation.ts`) |
| Valor por turno/hora/mes en cada reserva | `accept_application` | `perShiftTotal`, `contractTotal` |
| Vencimiento 72 h / 24 h / ≥ 15 min / ≤ turno − 1 h | `applications_guard_insert`, `counter_application` | `applicationExpiry` |
| Máx. 3 rondas | `counter_application` | `MAX_ROUNDS` (`negotiation.ts`) |
| Texto del contrato y huella | `contract_*` (hash de `terms`) | `renderContract`, `contractBodyHash` (`contractTemplate.ts`) |
| Segundo factor ≤ 10 min | `signSmartContract` (`contracts.server.ts`) | `STEP_UP_MAX_AGE_SECONDS` (`contractIdentity.ts`) |
| Reglas de publicación (1–60 turnos, ≤ 24 h, 1–50 cupos) | `publish_institution_offer` | `institutionShifts.ts` |
| Cupo diario de desbloqueos | `reveal_daily_quota` | `REVEAL_DAILY_QUOTA` |

La banda de negociación tiene una **tabla de referencia compartida** (`supabase/e2e/institution_hub/band_golden.csv`, 144 casos) que verifican la prueba de TypeScript y la suite de PostgreSQL: si cambias una constante en un solo lado, una de las dos falla.

## Operación

1. Aplicar `20261009100000_institution_hub_smart_contracts.sql` y **regenerar los tipos de Supabase** (el código usa un
   cliente sin tipar para lo nuevo).
2. **Correo del código de firma** (Supabase Auth → Email Templates → *Magic Link*): la plantilla debe incluir
   `{{ .Token }}` (el código) además del enlace; fija la longitud en 6 y una vigencia de al menos 10 minutos. Con el SMTP
   integrado de Supabase el límite de correos por hora es muy bajo: configura un SMTP propio antes de usarlo en producción.
3. **Secretos del servidor:** `SUPABASE_SERVICE_ROLE_KEY` (la usa `signSmartContract`, también como sal para guardar la IP
   solo como huella).
4. **Vencimientos:** `pg_cron` ejecuta `expire_stale_applications()` cada 15 min y `expire_stale_contracts()` cada 30 min si
   la extensión existe; si no, el vencimiento se aplica igual al aceptar/contraofertar/firmar.
5. **En vivo:** el servidor emite «hay cambios» (sin datos) por el canal privado `open_needs_ping` (eventos `changed` y
   `offers_changed`); `smart_contracts` y `job_offer_shifts` entran a la publicación de Realtime (RLS limita a cada parte).
6. La **suite de PostgreSQL** está en `supabase/e2e/institution_hub/` (solo para una base desechable).

## Qué se verificó (y qué no)

- 397 pruebas unitarias (Vitest) de lógica pura, plantilla del contrato, identidad, cobertura, turnos y la función de servidor
  de firma con base simulada.
- **252 comprobaciones contra PostgreSQL 16 real** (`supabase/e2e/institution_hub/`): el escenario exacto de dos cuentas
  (Free no negocia → Esencial contraoferta → la institución acepta → reserva con dirección → desbloqueo → aviso), versión
  familia sin agenda, rondas y vencimiento, contrato (firmas, huella, cadena de eventos, alteración detectada), flujo anterior
  cerrado, cancelación y reapertura de cupo, reputación, bandejas, equipo de confianza y auditoría de permisos (RLS activo,
  nada ejecutable por `anon`, tablas del contrato sin escritura de `authenticated`).
- 13 pruebas de humo de renderizado en servidor (incluye que el HTML del plan Free **no** contiene direcciones ni teléfonos).
- **37 pasos en un Chromium real** (Playwright, con Supabase simulado): 28 de componentes (publicar turnos con
  validaciones, turno de noche y repetir horario; postularse como Free y como Esencial; aceptar con y sin agenda;
  contraofertar; rechazar; firmar con código — identidad, código, aceptaciones y huella igual al SHA-256 del texto; invitar al
  equipo) y 9 de **rutas completas** (el panel de la institución recién registrada y con actividad; el del profesional con las
  dos agendas, postulaciones y contratos), todos sin errores de JavaScript ni advertencias de React. Capturas a 390 px y
  1100 px sin desbordes. Esta revisión encontró dos defectos reales que ya están corregidos: al ir a leer el texto completo se
  perdían el código y las aceptaciones, y un `<div>` dentro de un `<p>` en la lista de contratos (rompe la hidratación en SSR).
- Tipado estricto (`tsc`) sin errores nuevos y ESLint sin hallazgos en archivos nuevos.
- **No** probado: contra un proyecto Supabase/Lovable real, entrega real del correo con el código, Realtime, ni el panel
  completo en el navegador (las rutas no se montaron; sí los componentes). El esquema de apoyo de la suite de PostgreSQL
  aproxima producción: repite el escenario con dos cuentas reales antes de abrir al público.

## Decisiones a confirmar y límites conocidos

- **¿Puede firmar una institución sin verificar?** Hoy no: exige verificación del equipo, NIT y representante legal. Es
  estricto a propósito; si el negocio prefiere firmar con NIT sin verificación, es una condición de
  `contract_signer_readiness`.
- **Desbloquear contacto exige postularse antes** (igual que en familias) y los cupos 15/40 son una propuesta.
- **Teléfono del profesional:** el nuevo buzón de la institución ya no muestra el WhatsApp del postulante antes de aceptar
  (antes un botón «WA» lo exponía); lo ve en la reserva. Si el negocio quiere el contacto previo, es una decisión de
  privacidad, no técnica.
- **Contratos solo para instituciones.** Las ofertas de familias no generan contrato inteligente.
- **Coordenadas aproximadas** a 2 decimales: el mapa muestra la zona, no la puerta. Confirma que el nivel de precisión sirve.
- Dos cuentas de la misma institución (varios representantes) y poderes de firma por sede no están modelados.
- Con menos de 5 profesionales disponibles no se publica la cifra; con menos de 3 calificaciones no hay promedios.
- La plantilla **no** cubre régimen laboral (contrato de trabajo) ni dotación; es prestación de servicios por turnos.
- Pendiente: avisos por WhatsApp Business (solo informativos), recibo/factura electrónica por turno cumplido, firma
  digital certificada como opción, reemplazo automático cuando un profesional cancela (hay búsqueda manual en el panel de
  la familia), agradecimientos/reconocimientos y metas de turnos cumplidos.

## Lecturas que informaron el diseño

- Escasez de enfermería en Colombia: [Vanguardia (2026)](https://www.vanguardia.com/entretenimiento/salud/2026/05/21/enfermeria-en-colombia-por-que-hay-deficit-critico-de-profesionales-y-como-enfrentarlo/), [Consultorsalud](https://consultorsalud.com/escasez-personal-enfermeria-crisis/) y [Universidad del Rosario](https://urosario.edu.co/noticias/personal-de-enfermeria-y-medicina-presenta-inadecuadas-condiciones-laborales-segun-estudio). Las cifras difieren entre fuentes.
- Presión financiera de IPS y hospitales: [cartera de las IPS (La República/ANDI)](https://www.larepublica.co/economia/andi-alerto-que-cartera-de-las-ips-aumento-de-2-8-billones-en-2022-a-5-7-billones-en-2025-4282262), [mora de EPS (Consultorsalud)](https://consultorsalud.com/cartera-mora-eps-38-billones-hospitales-ips/), [EPS intervenidas (Vanguardia)](https://www.vanguardia.com/colombia/2026/05/11/contraloria-alerta-por-deterioro-de-eps-intervenidas-la-situacion-es-critica/) y [contingencia por cierre de servicios en Bogotá (RCN)](https://www.noticiasrcn.com/salud-y-bienestar/bogota-activa-plan-de-contingencia-ante-cierre-de-servicios-en-algunas-ips-por-falta-de-pagos-1018904).
- Plataformas de turnos y sus riesgos: [«Uber for Nursing» (Roosevelt Institute)](https://rooseveltinstitute.org/wp-content/uploads/2024/12/RI_Uber-for-Nursing_Brief_202412.pdf), [pago rápido y flexibilidad (Staffing Industry Analysts)](https://www.staffingindustry.com/news/global-daily-news/flexibility-beats-pay-as-a-top-2025-nurse-satisfaction-driver); de ahí el rango acotado, el neto siempre visible y que la institución también negocie.
- Firma electrónica: [Decreto 2364 de 2012](https://relatoria.colombiacompra.gov.co/normativa/decreto-2364-de-2012/) (reglamenta el art. 7 de la Ley 527 de 1999) y [Ley 1581 de 2012](https://relatoria.colombiacompra.gov.co/normativa/ley-1581-de-2012/?print=pdf).
