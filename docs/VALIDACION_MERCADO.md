# Formulario inteligente de validación de mercado (`/validacion`)

> **Registro de usuario y beneficio premium.** Cada formulario lleno llega solo al panel de superadmin
> (`/superadmin/validacion`), donde se tabula en vivo. Al confirmar su contacto, la persona gana **1 mes del plan
> Esencial** (el plan básico de pago).
>
> Estado en la base de Lovable Cloud: la migración `20261011100000_market_validation_v2.sql` **se aplicó en producción el
> 2026-10-09** con autorización expresa (ver §9). Falta publicar la interfaz nueva (Publish → Update en Lovable).
>
> **Capa de inteligencia (2026-10-10):** la pestaña **Hallazgos** del panel lee las respuestas y entrega veredicto,
> temas, contactos prioritarios, segmentos y avisos (§7.1); el antifraude detecta correos temporales y respuestas
> copiadas entre personas (§4). Todo es lógica pura en el código: **no hay migración nueva**.

## 1. Qué había y qué se hizo

El formulario ya existía (`ValidationSurvey`, `/validacion`, `/superadmin/validacion`, tablas `validation_responses` y
`validation_otps`, dos Edge Functions de OTP). Se completó y se endureció en vez de crear otro:

| Antes | Ahora |
|---|---|
| La pantalla no preguntaba **3.1** (¿paga hoy?) ni **3.3** (dónde buscas: la columna `retention_channels` existía sin campo); las alternativas eran un solo texto | Las 4 secciones del formulario, con todas las preguntas y respuestas tal cual (§2) |
| La persona se calificaba sola en 6 factores de 0 a 5 (total sobre 30) | **Señal de demanda** automática de 0 a 100 (§5) |
| El «beneficio» era un texto `MLP-…` que ninguna pantalla canjeaba | Código que nace al verificar el contacto y se **canjea por 1 mes del plan Esencial** (§6) |
| Cualquiera podía insertar filas con `premium_activated = true` y un código a gusto | Solo el servidor escribe; el navegador no tiene privilegios sobre la tabla (§4) |
| El panel de superadmin nunca veía una fila (la única política de lectura era del *service role*) | Lectura por rol (`has_role(..., 'superadmin')`) y Realtime: el panel se tabula solo (§7) |
| OTP en claro, Edge Functions públicas sin límites ni tope de intentos | OTP con hash, vigencia, tope de intentos y límites por respuesta, contacto e IP (§4) |

## 2. Las preguntas

| Sección | Pregunta | Columna (`validation_responses`) |
|---|---|---|
| 1 | Nombre completo* | `full_name` |
| 1 | Perfil de usuario* — Familia / Usuario · IPS / EPS · Profesional de Salud | `profile_type` = `familia` · `ips_eps` · `profesional` |
| 1 | Número de WhatsApp / Correo electrónico* | `whatsapp` o `email` (+ `contact_key` normalizada) |
| 1 | Ciudad (opcional, añadida) | `city` |
| 2.1 | ¿Qué producto o servicio buscas contratar u ofrecer en Humanix? (una sola frase concisa) | `service_offer` |
| 2.2 | ¿Qué problema o punto de dolor específico te resuelve Humanix? | `pain_point` |
| 2.3 | ¿Quiénes enfrentan principalmente esta necesidad? (Público objetivo) | `target_customer` |
| 2.4 | ¿Qué cambia en tu día a día al empezar a utilizar Humanix? | `key_benefit` |
| 3.1 | ¿Actualmente pagas o inviertes en una solución similar? Sí / No / Aún no lo he investigado | `pays_currently` = `yes` · `no` · `not_researched` |
| 3.2 | Mención de hasta 3 alternativas | `alternatives text[]` (y `competitors`, el mismo texto unido, por compatibilidad) |
| 3.3 | ¿Dónde buscas información o inviertes tiempo/dinero habitualmente? | `search_channels text[]` (casillas) + `retention_channels` (texto libre «otro») |
| 4.1 | Disposición a pagar [ ___ % ] | `willingness_pct` (0–100) |
| 4.2 | Comentarios, sugerencias o requerimientos clave | `comments` |
| — | Autorización de tratamiento de datos (Ley 1581 de 2012) | `consent_at`, `consent_version` |

Lo que hace «inteligente» al formulario:

- **Los textos se adaptan al perfil** (ejemplos para familia, IPS/EPS o profesional) y cada respuesta abierta tiene una
  pista de claridad en vivo («Un poco más de detalle ayuda: llevas 2 palabras» → «¡Muy claro!»).
- **Reglas cruzadas**: si hoy paga por algo similar debe nombrar al menos una alternativa; en 3.3 se elige un lugar o se
  cuenta cuál. Las alternativas y los lugares tienen sugerencias de un toque.
- **4.1 en lenguaje claro**: campo numérico, deslizador, porcentajes rápidos y una frase («Más o menos 6 de cada 10
  personas pagarían por esto»).
- **Borrador local** de 14 días (sin contacto ni autorización) y prellenado con la sesión (nombre, correo, perfil).
- Una sección a la vez, barra de avance, foco en el primer error, pensado para celular (390 px sin scroll horizontal).

## 3. Flujo de punta a punta

```
Formulario (4 secciones)
   │  submitMarketValidation  (createServerFn público · filtros · service role)
   ▼
Verificación del contacto — código de 6 dígitos por WhatsApp o correo
   │  sendValidationOtp / verifyValidationOtp
   ▼
Resultado: código MLP-XXXXX-XXXXX  (uno por contacto verificado · vigencia 60 días)
   │            └─ si ya tiene sesión: se canjea de inmediato
   ▼
/planes → «¿Tienes un código? Canjea tu 1 mes del plan Esencial»
   │  redeemMarketBenefit (requireSupabaseAuth) → redeem_validation_benefit (RPC)
   ▼
mp_subscriptions: essential_monthly · monto 0 · active · termina en 1 mes   (+ notificación al usuario)
   ▼
/superadmin/validacion — cada fila verificada o no, tabulada en vivo (Realtime)
```

El pago del plan **sigue ocurriendo solo en el checkout web**; el canje no pasa por WhatsApp.

## 4. Seguridad y antiabuso

| Riesgo | Control |
|---|---|
| Insertar filas falsas o activar premium desde el navegador | Sin política `INSERT` ni privilegios para `anon`/`authenticated`: **solo el servidor** (service role, `createServerFn` en `src/lib/marketValidation.functions.ts`) escribe |
| Robots | Campo trampa `website` y filtro de rapidez: el formulario envía cuánto tiempo estuvo abierto (`fillMs`, medido con `performance.now()`, así que **no depende del reloj del dispositivo**); sin ese dato, o con menos de `MIN_FILL_MS` = 8 s, el servidor devuelve un «éxito» falso que no guarda nada. El borrador guarda el tiempo ya invertido para que quien vuelve no sea tomado por un robot |
| Spam y costo de WhatsApp/correo | Envíos por contacto ≤ 3/h (todos) y por IP ≤ 20/h; OTP ≤ 4 por respuesta, ≤ 5/h por contacto y ≤ 20/h por IP; en los límites **por IP solo cuentan los no verificados**, para que una oficina o una red móvil compartida no quede bloqueada por quienes sí verificaron. **Freno global de WhatsApp**: 300 códigos/h no verificados (responde `channel_unavailable` y el correo sigue funcionando). Reenvío cada 30 s. Las llamadas a Meta y a Resend se cortan a los 8 s |
| IP real | `clientIp` (`src/lib/clientIp.ts`, la misma de PQRS y contratos) toma `cf-connecting-ip` (Cloudflare Workers), luego el primer valor de `x-forwarded-for` y por último `x-real-ip`. En la base solo se guarda el *hash* con sal |
| Fuerza bruta del código de 6 dígitos | Vigencia 15 min, 5 intentos con contador atómico (compare-and-swap), comparación en tiempo constante |
| Robo del código en la base | Solo se guarda `sha256(sal:otp:id de la respuesta:código)`; códigos con CSPRNG; la IP se guarda como *hash* |
| Un mismo contacto cobrando varias veces | `contact_key` normalizada (sin `+etiqueta`, puntos de Gmail, `googlemail`) con índice único parcial: un beneficio por contacto verificado y uno por cuenta |
| Respuestas de relleno | Filtro de calidad (texto sin sentido, repetido, copia del ejemplo): rechazo `low_quality` si es grave; la señal de demanda se limita a 20 |
| Correos temporales | `isDisposableEmail` (lista de dominios, incluidos los subdominios): el formulario y el cambio de contacto del servidor responden «Usa tu correo personal: no aceptamos correos temporales» |
| La misma respuesta copiada por varias personas | Al verificar el contacto, el texto se compara con el de las respuestas **verificadas de otros contactos** de las últimas 24 h (similitud de Jaccard ≥ 0,8 en al menos 3 de los 4 textos, de 5 palabras o más). Si coincide: aviso `duplicate_text`, **no se emite código** (estado `review`) y la persona puede pulsar «Reescribir con mis palabras» (vuelve a la sección 2 con lo escrito). La fila queda guardada, pero no cuenta en la lectura (§7.1) |
| Avisar de contactos fuertes sin saturar | Cada contacto verificado con señal ≥ 70 y sin avisos graves crea una notificación `market_hot_lead` para cada superadmin (tope de 30 avisos por hora; es de mejor esfuerzo y nunca rompe la verificación) |
| Doble clic / recarga | Se reutiliza la respuesta de las últimas 24 h del mismo contacto y servicio |
| Privilegios por defecto de Supabase | `REVOKE ALL` a `PUBLIC`/`anon`/`authenticated` y `GRANT` mínimo (`SELECT` a `authenticated` + política de superadmin; todo al service role). `validation_otps` solo para el service role |
| Activar el plan «a mano» | `redeem_validation_benefit` es `SECURITY DEFINER`, solo ejecutable por el service role, tras identificar a la persona en el servidor. El estado del plan se sigue leyendo de `mp_subscriptions` |
| Que quien ya paga pierda dinero | Con un plan de pago activo el canje responde `plan_active` y la persona conserva el código |

## 5. Señal de demanda (0–100)

Se calcula en el servidor al guardar y se recalcula en el panel para filas antiguas (`total_score` ÷ 30 × 100):

| Parte | Máximo | Cómo se obtiene |
|---|---|---|
| Claridad del problema | 25 | palabras en 2.2 (10), 2.3 (8) y 2.4 (7) |
| Gasto actual en algo similar | 20 | 3.1: Sí = 20 · No = 8 · Aún no lo he investigado = 4 |
| Disposición a pagar | 30 | 4.1 proporcional |
| Conoce las alternativas | 15 | 3.2: 1 = 8 · 2 = 12 · 3 = 15 |
| Requisitos concretos | 10 | palabras en 4.2 |

Niveles: **fuerte** ≥ 70 · **media** ≥ 45 · **débil** < 45. Con calidad grave el puntaje no pasa de 20.

## 6. El beneficio

- **Qué**: 1 mes del plan Esencial (`essential_monthly`), sin tarjeta (`BENEFIT` en `src/lib/marketValidation.ts` y la
  RPC; si se cambia, hay que cambiar los dos).
- **Cuándo nace**: al verificar el contacto, no al enviar. Código `MLP-XXXXX-XXXXX` (31 símbolos, sin `I L O 0 1`).
- **Reglas**: uno por contacto verificado y uno por cuenta; vale 60 días; se canjea en `/planes` con sesión (si ya
  la tenía al verificar, se activa solo).
- **Respuestas del canje** (`REDEEM_ERRORS`, en español): `invalid_code`, `not_verified`, `already_redeemed`,
  `expired`, `user_already_rewarded`, `plan_active`, `unauthenticated`.
- **Efecto**: `mp_subscriptions` (único por usuario) recibe `essential_monthly`, monto 0, `COP`, `active`, fin a +1 mes;
  la respuesta queda `redeemed` y el usuario recibe una notificación con enlace a `/planes`.
- Si la persona inicia después un pago real, el checkout reemplaza esa fila (sin prorrateo del mes gratis).

## 7. Panel de superadmin (`/superadmin/validacion`)

Solo con `useSuperadmin` (como el resto de `/superadmin/*`). Datos con TanStack Query + una suscripción Realtime propia
(indicador «En vivo»; si se cae, «Sin conexión en vivo» y el botón Actualizar).

- **Hallazgos** (pestaña inicial): lectura automática y orientativa (§7.1).
- **Indicadores**: respuestas (y % con contacto verificado), señal de demanda media, disposición a pagar (media y
  mediana), % que ya paga por algo similar, beneficios emitidos y canjeados.
- **Resumen**: por perfil (respuestas, %, verificados, señal media, disposición a pagar, ya pagan hoy), tramos de 4.1,
  respuestas por día (14 días, hora de Colombia) y ciudades.
- **Mercado y competencia**: 3.1 por perfil, alternativas más mencionadas (los nombres parecidos se unen: «whatsapp» y
  «grupos de WhatsApp») y dónde buscan.
- **Dolor y requisitos**: palabras que más se repiten y los comentarios recientes.
- **Respuestas**: tabla con búsqueda y filtros (perfil, contacto, señal), detalle completo con las preguntas
  numeradas y **exportación a Excel** (CSV con BOM, `;` como separador y celdas neutralizadas contra fórmulas).
- Estados: cargando, error de lectura, sin datos. Carga hasta 5 000 respuestas (si hay más, el panel avisa que muestra
  las más recientes); con más habría que agregar en servidor.
- En «Respuestas», una fila con aviso de calidad lleva un triángulo (con el motivo para lector de pantalla) y el detalle
  lista los avisos.

### 7.1 Hallazgos: lectura automática (orientativa)

Funciones puras de `src/lib/marketInsights.ts` (pruebas en `marketInsights.test.ts`) sobre las mismas filas del panel en
vivo; no hay tablas ni migración nuevas. La interfaz es `InsightsTab.tsx`.

**Qué filas cuentan.** Las que tienen un aviso grave (`gibberish`, `repeated_text`, `example_copy`, `duplicate_text`)
**siguen guardadas y visibles en «Respuestas»**, pero no entran al veredicto, la madurez de la muestra, los temas, los
segmentos, los hallazgos ni la lista de contacto (una granja de respuestas «perfectas» no puede inflar la lectura). El
aviso «poco esfuerzo» (`low_effort`) no excluye, solo resta puntos al contacto. El embudo, la tendencia y el bloque de
calidad sí cuentan todo lo recibido, porque son operativos.

| Bloque | Qué entrega | Regla |
|---|---|---|
| **Veredicto** | «Mercado validado», «Prometedor», «Señal débil» o «Datos insuficientes», con cada criterio marcado «cumple / no cumple / sin datos» | Criterios: señal de demanda media ≥ 55 · mediana de disposición a pagar ≥ 40 % · ya pagan por algo similar ≥ 25 % · contactos verificados ≥ 50 %. Necesita **30 respuestas** y 3 criterios evaluables; cumple todos → validado; falla uno → prometedor; más → débil. Siempre aclara que es una señal, no una garantía |
| **Qué conviene hacer** | Hallazgos en lenguaje claro con gravedad (riesgo · atención · bien · dato) y una acción concreta | Muestra pequeña, perfil más y menos fuerte, disposición a pagar, presupuesto, competencia (alternativas más citadas), canales, temas, embudo (verificación, canje, códigos por vencer), calidad, tendencia de 7 días contra los 7 anteriores, contactos listos y respuestas excluidas |
| **¿Ya son suficientes?** | Madurez de la muestra por perfil y total, con **margen de error** (intervalo de Wilson al 95 %) | Meta de 30 respuestas por perfil y 100 en total (±10 puntos exige 97); estados «Muy pocas · En camino · Suficientes» |
| **Embudo** | Respuestas → contacto verificado → con código → mes Esencial canjeado | Porcentajes enteros; cuenta los códigos vigentes sin canjear y los que vencen en 7 días |
| **Temas** | Los temas que aparecen, de más a menos frecuente, con su porcentaje, la cuenta por perfil y una cita de la respuesta con más señal | 10 temas posibles, con léxicos en español sobre «dolor», «beneficio» y «comentarios»: confianza y verificación · turnos y reemplazos · urgencia · precio · pagos y cobros · calidad · seguimiento y tranquilidad · contratos y formalidad · cobertura · difícil encontrar y comparar. Insensible a tildes y mayúsculas |
| **Contactar primero** | Hasta 10 contactos **verificados** con puntaje 0–100, por qué, etapa y un mensaje sugerido por WhatsApp (o correo) | Puntaje = señal × 0,55 + disposición a pagar × 0,15 + ya paga hoy +10 + institución +10 (profesional +4) + requisitos concretos +5 + reciente (≤ 3 días +5, ≤ 7 días +2) − 15 si hay «poco esfuerzo». **Los mensajes nunca hablan de pagos** (los pagos son solo en el checkout web). Se exporta a Excel (CSV neutralizado) |
| **Dónde está la oportunidad** | Perfil × ciudad con al menos 2 respuestas | 60 % señal · 25 % disposición a pagar · 15 % ya pagan |
| **Resumen para compartir** | Texto listo para copiar (botón «Copiar resumen») | Respuestas y señal media, lectura, respuestas excluidas, perfiles, disposición a pagar, alternativas, dolores principales, embudo y contactos listos; termina aclarando que es una lectura automática y orientativa |

Pruebas de propiedades con filas aleatorias y hostiles, de semilla fija (400 filas × 5 semillas para la tabulación, los
filtros y la exportación; 350 × 4 para el motor de inteligencia): nada lanza, los puntajes quedan en 0–100, las listas
salen ordenadas, el embudo es monótono (verificados ≤ respuestas, canjeados ≤ con código), los hallazgos traen texto,
ids únicos y orden por gravedad, ningún texto generado contiene `undefined`, `NaN` ni `[object`, y ninguna celda de los
CSV empieza por `=`, `+`, `-`, `@`, tabulador o retorno de carro.

## 8. Operación

| Qué | Dónde | Nota |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Secretos del entorno | Escribe respuestas y es la sal de los *hash* |
| `RESEND_API_KEY` | Secretos | Código por correo (remitente «Humanix <noreply@humanix.lat>») |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | Secretos | Código por WhatsApp |
| `WHATSAPP_OTP_TEMPLATE` | Secretos | Nombre de una plantilla **de autenticación aprobada** en Meta (parámetro del cuerpo y del botón = el código). Sin ella el mensaje es de texto libre y **solo llega dentro de la ventana de 24 h de WhatsApp**: una persona nueva casi nunca la tiene, así que en la práctica hay que crear la plantilla (o confiar en el correo) |
| Edge Functions `send-validation-otp` y `verify-validation-otp` | Retiradas del repositorio y de `supabase/config.toml` | **Si siguen desplegadas en Lovable Cloud, hay que borrarlas del despliegue**: eran públicas y sin límites |

Si ningún canal puede enviar el código, la persona puede cambiar de contacto en el mismo paso; si no hay ninguno, sus
respuestas quedan guardadas (sin verificar) y no se emite beneficio.

## 9. Migración y estado en la base

`supabase/migrations/20261011100000_market_validation_v2.sql` (idempotente, sin perder datos):

1. Columnas del formulario nuevo, restricciones (`NOT VALID` donde puede haber filas antiguas) e índices.
2. Cierre de la tabla al navegador: se eliminan `public_insert` y `service_full`; se crea la política de lectura de superadmin.
3. `validation_otps`: `code_hash`, `ip_hash`, `code` opcional.
4. `redeem_validation_benefit(p_user uuid, p_code text) RETURNS jsonb`.
5. `validation_responses` entra en la publicación `supabase_realtime`.

**Aplicada en producción el 2026-10-09**, con este método: (1) la estructura real se replicó en local y la migración se
probó entera; (2) **simulacro** en producción: la migración (con una guarda que compara el md5 del texto con el del
archivo del repositorio) + una prueba de humo de 28 comprobaciones con el superadmin real + huellas md5 de la estructura,
todo en una sola transacción que termina en `RAISE EXCEPTION` (se deshace sola; se comprobó que no dejó rastro);
(3) **aplicación** del mismo texto; (4) comprobación posterior: las **11 huellas** (columnas, políticas, restricciones,
índices, privilegios de tablas y de la función, Realtime, RLS, disparadores) son idénticas a las de la réplica, la
publicación `supabase_realtime` pasó de 14 a **15 tablas**, y una prueba de humo posterior (28/28) se revirtió sin dejar
datos (0 filas, 0 suscripciones, 0 notificaciones de prueba).

Pendiente de tu lado: **Publish → Update** en Lovable (la versión antigua publicada insertaba desde el navegador y ya no
puede, porque la tabla se cerró; el formulario nuevo sí) → configurar secretos/plantilla → retirar las Edge Functions
antiguas.

## 10. Verificación

| Qué | Resultado |
|---|---|
| Pruebas unitarias del módulo: `marketValidation.test.ts` 69 · `marketValidation.server.test.ts` 60 · `marketValidation.invariants.test.ts` 32 · `marketInsights.test.ts` 86 · `clientIp.test.ts` 3 | 250 del módulo; **783 / 783** en toda la plataforma (37 archivos) |
| PostgreSQL 16 sobre la réplica de producción (`HX_SCENARIO=market`, `supabase/e2e/market_validation/scenario.sql`) | **57 / 57** (privilegios, RLS, restricciones, canje, Realtime, segunda ejecución idempotente) |
| Regresión de la réplica (`HX_SCENARIO=both`) | lazo de cuidado 264 · hubs 252 · deriva 37 · mercado 57, todas sin fallos |
| Producción (2026-10-09) | simulacro 28/28 → aplicación → 11/11 huellas iguales a la réplica → prueba de humo posterior 28/28 revertida |
| Chromium (formulario, OTP, resultado, canje en Planes, panel y Hallazgos, 390 px) | **53 / 53** pasos, sin errores de consola inesperados |
| Renderizado en servidor sin `window` (formulario, canje, pestaña Hallazgos vacía, con datos aleatorios hostiles y con todas las respuestas marcadas) | 11 / 11 |
| ESLint y Prettier en archivos nuevos y tocados | limpios |
| Revisión independiente del código (segunda lectura) | 10 hallazgos: 9 corregidos con prueba y 1 aceptado como límite (§11) |

Lo que la verificación de navegador encontró y se corrigió: el error de la regla cruzada no se quitaba al corregirlo, el
botón «Enviar» se salía de la tarjeta en 390 px, el deslizador no tenía nombre accesible, el detalle del panel mostraba
las claves internas de los lugares, y quien volvía a un borrador y enviaba rápido era tomado por un robot (y perdía
sus respuestas).

La auditoría posterior (2026-10-10) encontró y corrigió: la IP del cliente se podía falsear con `x-forwarded-for` (ahora
manda `cf-connecting-ip`), el filtro de rapidez dependía del reloj del dispositivo (ahora es una duración medida con
`performance.now()` y es obligatoria), los límites por IP bloqueaban a oficinas y redes móviles compartidas (ahora solo
cuentan los no verificados), la serie diaria del panel usaba UTC en vez de la hora de Colombia y rompía con fechas
corruptas, quien recibía el aviso de «respuesta parecida» perdía el borrador, las llamadas a WhatsApp/Resend podían
colgarse sin límite, y un freno global pensado para WhatsApp también bloqueaba el correo.

**No se pudo probar aquí**: Realtime real, PostgREST con JWT reales, envío real por WhatsApp/Resend, navegadores
móviles reales.

## 11. Límites y decisiones

- Los 6 factores de autoevaluación 0–5 se quitaron del formulario (las columnas `score_*` y `total_score` se conservan para las filas existentes).
- La ciudad y la casilla de autorización son adiciones al formulario pedido (la segunda exigida por la Ley 1581).
- El canje exige cuenta: sin ella el código se guarda en el dispositivo y se canjea al iniciar sesión.
- El panel tabula en el navegador con funciones puras probadas (`tabulate`, `filterRows`, `responsesToCsv`).
- **Los hallazgos son orientativos**: léxicos de palabras en español (sin IA), márgenes de error amplios con pocas
  respuestas y criterios fijos en `TARGETS`. Una señal favorable no sustituye ventas reales.
- **Detección de respuestas copiadas = heurística**: depende del orden (la primera persona conserva el código y las
  siguientes quedan en revisión), compara solo las últimas 24 h y 300 filas, y dos envíos casi simultáneos podrían pasar
  los dos (el costo máximo es un mes Esencial). No sustituye la revisión humana.
- `fillMs` lo declara el navegador: un robot que lo falsee pasa el filtro de rapidez, pero sigue limitado por contacto,
  IP y verificación del código.
- Realtime, WhatsApp y Resend reales no se pueden probar fuera de producción; el comportamiento de los límites se
  verificó con bases y proveedores simulados.
- Cambiar preguntas, límites o recompensa: `src/lib/marketValidation.ts` (textos, esquema, constantes) y, para la
  recompensa o los topes de envío, también la RPC / `LIMITS_SERVER` de `marketValidation.server.ts`.

## 12. Cómo probarlo

```bash
bun run test src/lib/marketValidation.test.ts src/lib/marketValidation.server.test.ts \
  src/lib/marketValidation.invariants.test.ts src/lib/marketInsights.test.ts src/lib/clientIp.test.ts
# PostgreSQL DESECHABLE (nunca Supabase / Lovable Cloud):
HX_TEST_CONFIRM=desechable PGHOST=localhost PGPORT=5432 PGUSER=postgres HX_SCENARIO=market \
  supabase/e2e/prod_replica/run.sh
```
