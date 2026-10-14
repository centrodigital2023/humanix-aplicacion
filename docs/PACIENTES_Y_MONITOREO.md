# Pacientes y Monitoreo clínico (paneles de EPS, IPS, clínicas y hospitales)

Estado: construido y verificado **en local el 2026-10-14** (PostgreSQL real, navegador real, render en servidor). Las migraciones se
aplican a producción con el procedimiento de `docs/MIGRACIONES.md` §3; la sección 9 dice qué quedó comprobado y qué no.

## 1. Qué es y por qué se rehízo

Los dos módulos del panel de la institución —**«Pacientes y coordinación de cuidado»** y **«Monitoreo Clínico · Live»**— existían como
pantallas, pero no funcionaban de verdad (revisado el 2026-10-14 contra el código y la base real):

| Antes                                                                                                                              | Ahora                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| «Agregar paciente» guardaba en `institution_patient_cases`, una tabla que **nunca existió** en producción: fallaba                 | Pacientes, casos, notas y tareas en tablas propias (`inst_*`), con RLS y funciones del servidor                            |
| Las notas eran un único texto que se sobrescribía                                                                                  | Notas **inalterables y encadenadas por hash**; se corrigen con una nota nueva y se puede verificar que nada se alteró      |
| El «★ Promedio» era un 4,8 escrito en el código                                                                                    | Se calcula con las valoraciones reales de los casos cerrados; sin valoraciones muestra «—» y «Sin valoraciones aún»        |
| La lista de pacientes en monitoreo vivía en el **navegador** (`localStorage`) y leía `vital_signs_readings`, que solo lee su dueño | Todo en el servidor; la institución ve los signos de **sus** pacientes y de nadie más                                      |
| El «triage» contaba umbrales fijos; las alertas «OK» no se guardaban                                                               | NEWS2 (Royal College of Physicians) calculado **en la base de datos** con cada control; alertas con plazo, historial y SLA |
| Los relojes enviaban con un código de emparejamiento que salía de un hash de **32 bits** (adivinable) y sin freno                  | Código de 122 bits que se muestra una sola vez; la base guarda solo su huella; la ingesta frena a quien falla muchas veces |

## 2. Qué ve la persona

**Pacientes** (`/dashboard/institucion?tab=pacientes`, también en `/dashboard/eps` y en `/dashboard/equipo` para el personal con el módulo)

- Cifras: Pacientes · Activos · Pendientes · Completados · ★ Promedio, todas del servidor (`inst_care_overview`).
- Estado vacío con el texto «Sin pacientes activos — Agrega un paciente manualmente o acepta una postulación para iniciar coordinación» y
  el botón **Crear primer caso** (abre el formulario con el primer caso incluido). Si hay una postulación aceptada sin caso, un aviso
  permite iniciar la coordinación desde ella.
- Formulario único (react-hook-form + Zod): solo el nombre es obligatorio; exige confirmar que la institución cuenta con la
  autorización del paciente o de su acudiente (Ley 1581 de 2012). El documento repetido se rechaza en el servidor y el error sale junto al
  campo.
- Ficha del paciente: resumen (alergias a la vista, contacto de emergencia con «Llamar»), casos (abrir, cerrar con valoración de 1 a 5),
  notas firmadas, tareas, monitoreo y actividad. Alta del paciente. Mensaje para la familia (texto revisado por la persona; el enlace de
  WhatsApp solo lo prepara: **nada se envía solo y nunca se cobra por WhatsApp**).
- Exportar la historia en **FHIR R4** o las notas en CSV (plan IPS Mejorado). Cada exportación deja constancia en la bitácora.

**Monitoreo** (`?tab=monitoreo`)

- Encabezado «Monitoreo Clínico · Live» con «En vivo», «Triage NEWS2» (con su explicación) y «n pacientes · n en línea»; cifras Total ·
  En línea · Alertas · Críticos.
- Estado vacío «Sin pacientes en monitoreo» con **Agregar primer paciente** y un inicio rápido por tipo (Hospitalizado, Remoto,
  Posoperatorio, Crónico, Adulto mayor) que abre el formulario ya con esa modalidad y el monitoreo encendido.
- Tablero por estado (Crítico, Urgente, Atención, Estable, Sin puntaje), búsqueda, filtro por modalidad, «Ronda de signos» (quién tiene
  el control vencido o por vencer), alertas por atender con su plazo, y tarjetas con halo NEWS2 y últimos valores coloreados según los
  puntos que aportan.
- Registrar signos con la **vista previa del NEWS2 en vivo** (en pantallas chicas queda pegada arriba mientras se escribe). El servidor
  recalcula y guarda; la vista previa y la base puntúan igual (mismos vectores de prueba).
- Dispositivos: emparejar, ver su salud (en línea, callado, sin conexión) y revocar. **Relevo de turno** (I-PASS): un borrador por
  paciente con datos reales que la persona corrige; copiar o descargar es libre, guardarlo en la historia es del plan pago.
- Todo se actualiza por Realtime (sin recargar y sin sondeos).

**Experiencia (retención y entusiasmo)**: estados vacíos con ilustración e inicio rápido; brújula del día («Todo al día» o lo que pide
atención); primeros pasos con avance; logros («Primer paciente», «Primer control de signos», «Signos que llegan solos»…) con tarjeta de
celebración y botón para compartir; «Tu semana de cuidado» (cifras reales, **sin nombres ni datos de pacientes**) para copiar,
compartir o descargar como imagen; racha de alertas vistas a tiempo. Respeta «reducir movimiento».

## 3. Datos (migración `20261014100000_institution_care_core.sql`)

| Tabla                  | Qué guarda                                                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `inst_patients`        | Paciente: datos, modalidad, estado (pendiente, activo, en pausa, con alta), monitoreo, escala de saturación, consentimiento                                              |
| `inst_cases`           | Casos de coordinación (con la postulación que los originó, si la hay) y su valoración                                                                                    |
| `inst_notes`           | Notas **inalterables**: cada una lleva el hash de la anterior (cadena por paciente). Tipos: evolución, enfermería, coordinación, familia, incidente, relevo y corrección |
| `inst_tasks`           | Tareas manuales y seguimientos automáticos                                                                                                                               |
| `inst_devices`         | Dispositivos: huella (SHA-256) del código, últimas 4 cifras, estado y última lectura                                                                                     |
| `inst_obs`             | Controles de signos (a mano o de un dispositivo) con el NEWS2 calculado y lo que arrastró de controles anteriores                                                        |
| `inst_alerts`          | Alertas con severidad, plazo, quién las vio y quién las resolvió (y cómo), repeticiones y escalamiento                                                                   |
| `inst_live`            | Último estado conocido de cada paciente monitoreado (lo que pinta el tablero)                                                                                            |
| `inst_events`          | Bitácora de lo que ocurre (altas, notas, exportaciones, relevos…)                                                                                                        |
| `inst_ingest_failures` | Fallos de ingesta de dispositivos por huella de IP (para el freno)                                                                                                       |

**Nadie escribe directo desde la API**: todas las escrituras pasan por funciones `inst_*` (`inst_patient_create`, `inst_vitals_record`,
`inst_alert_ack`, `inst_device_create`, `inst_handoff_commit`…) que comprueban quién llama y de qué institución es. Cada tabla trae sus
`GRANT` y su RLS **en la misma migración** (regla de `AGENTS.md`); la lectura es solo de la propia institución y del personal con el
módulo. Ni siquiera el superadmin lee pacientes por la API.

## 4. Planes (los aplica la base de datos: `hx_inst_care_limits`)

| Límite o función                          | Free | IPS Mejorado |
| ----------------------------------------- | ---- | ------------ |
| Pacientes (no dados de alta)              | 5    | 1.000        |
| En monitoreo                              | 3    | 300          |
| Dispositivos activos                      | 0    | 300          |
| Escalamiento automático de alertas        | No   | Sí           |
| Seguimientos automáticos de cada caso     | No   | Sí           |
| Guardar el relevo de turno en la historia | No   | Sí           |
| Exportar la historia (FHIR y CSV)         | No   | Sí           |

El plan se lee de `mp_subscriptions` (`plan_key_for`), nunca de datos que escriba el cliente. La pantalla muestra el uso («2 de 1.000
pacientes»), avisa antes de llegar al tope y explica con calma lo que pide el plan pago; **no castiga** a quien tiene Free (los pasos de
«primeros pasos» que dependen del plan se ven con candado y no cuentan para el avance). Lo que el plan Free no permite también lo
rechaza el servidor (`patient_limit`, `monitor_limit`, `devices_plan`, `handoff_plan`, `export_plan`), no solo la pantalla. Las
funciones están registradas en `src/lib/plans.ts` y una prueba (`instCarePlan.test.ts`) las compara con los topes reales de la migración.

## 5. NEWS2, alertas y escalamiento

- **NEWS2** (Royal College of Physicians, 2017) con sus siete parámetros: respiración, saturación (escala 1; la escala 2 solo por
  indicación médica y exige escribir cuál), oxígeno suplementario, presión sistólica, pulso, conciencia (AVPU) y temperatura. Lo que no se
  midió en esa ronda se completa con lo último conocido de las **últimas 12 horas** (y se dice cuáles valores se arrastraron). Apoyo a la
  decisión clínica: **no es un diagnóstico**; no aplica a menores de 16 años ni al embarazo (la pantalla lo indica y el control se guarda
  igual). Se llama «Triage NEWS2» —no «Triage IA»— porque es una regla publicada, no inteligencia artificial.
- **Alertas** que se abren solas: riesgo clínico alto (NEWS2 ≥ 7), medio, un parámetro en 3 puntos, empeoramiento rápido y posible caída.
  Se deduplican, se resuelven solas cuando el puntaje se normaliza y tienen **plazo para verlas**: crítica 10 min, urgente 30 min,
  atención 2 h. «Ya la vi» y «Resolver» dejan escrito quién y cómo.
- **Escalamiento** (plan IPS Mejorado): con `pg_cron` (producción lo tiene) cada minuto se vuelve a avisar al equipo de las alertas
  urgentes o críticas que nadie vio a tiempo. Sin `pg_cron` se revisa al entrar un control o un dato de dispositivo y cuando la pantalla
  lo pide.
- **Tendencia**: un salto reciente pesa más que una mejora lejana (de 2 a 14 se dice «Empeorando (+12 desde el control anterior)», aunque
  hace horas hubiera 19).

## 6. Dispositivos

- El código de emparejamiento es `hx_` + 32 hexadecimales (**122 bits**). Se muestra **una sola vez** (el diálogo no se cierra por
  accidente con el código a la vista); en la base solo queda su huella SHA-256 y las últimas 4 cifras.
- `inst_device_ingest(código, lectura)` se puede llamar **sin sesión** (un reloj no tiene cuenta). Defensas: el código debe tener el
  formato exacto; **20 fallos en 10 minutos desde la misma huella de IP** y se frena (`rate_limited`); una lectura por minuto por
  dispositivo (las caídas pasan); valores imposibles se descartan sin perder los demás; un dispositivo revocado deja de enviar de
  inmediato y no se reactiva.
- La telemetría de dispositivos se purga a los **30 días** (cada noche con `pg_cron`, y de forma oportunista sin él).
- `20261014110000_wearable_ingest_throttle.sql` le pone el mismo freno a `wearable_ingest_by_pairing_code` (el flujo anterior del reloj
  Samsung, que usaba un código de 32 bits adivinable); `SamsungHealthCard` genera ahora códigos de 12 caracteres de un alfabeto de 32 (**60 bits**, con números aleatorios del navegador) en lugar de los de 32 bits (`src/lib/pairingCode.ts`).

## 7. Exportación FHIR R4

Paquete `collection` con `Patient`, `Condition`, `AllergyIntolerance`, `EpisodeOfCare` (casos), `Observation` (signos vitales) y
`ClinicalImpression` (notas, con su número, tipo y firma encadenada; el paquete lleva la firma de la última nota para comprobar que no
se alteraron). Códigos **LOINC** solo los de la especificación de signos vitales de HL7 (8867-4, 9279-1, 8310-5, 2708-6, 59408-5,
85354-9 con 8480-6 y 8462-4) y 72514-3 para el dolor; unidades UCUM. Lo que no tiene código estándar seguro (conciencia AVPU, oxígeno
suplementario, caída, puntaje NEWS2) usa un sistema de códigos propio bajo `https://humanix.lat/fhir/…`: **no se inventan códigos
LOINC**. No se declara `meta.profile` (no se afirma conformidad con un perfil que no se validó).

## 8. Personal de la institución

Los módulos `pacientes` y `monitoreo` se suman a los que el dueño puede dar a su equipo (`hx_staff_modules`). Quién puede qué (probado
contra la base real):

| Acción                                                                                                   | Módulo Pacientes            | Módulo Monitoreo            |
| -------------------------------------------------------------------------------------------------------- | --------------------------- | --------------------------- |
| Registrar un paciente                                                                                    | Sí (y abrir su primer caso) | Sí (y ponerlo en monitoreo) |
| Editar sus datos, pausar o reactivar, dar de alta, abrir, editar, cerrar y valorar casos                 | Sí                          | —                           |
| Notas (y verificar su cadena), tareas, escala de saturación, relevo de turno, exportar la historia       | Sí                          | Sí                          |
| Poner o quitar del monitoreo, registrar signos, ver y resolver alertas, emparejar y revocar dispositivos | —                           | Sí                          |

El personal entra con usuario y contraseña a `/dashboard/equipo`; ve solo las pestañas de sus módulos. Un módulo sin acceso devuelve
`forbidden` desde el servidor aunque se intente saltar la pantalla (comprobado: Monitoreo no abre casos ni da altas; Pacientes no
registra signos ni cambia el monitoreo). Que Monitoreo pueda escribir notas es deliberado: enfermería documenta lo que observa.

## 9. Cómo se verificó y qué falta

| Qué                                                                                                                                                          | Resultado                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pruebas unitarias del módulo (`news2`, `instCare`, `instMonitoring`, `instHandoff`, `instFhir`, `instCelebrate`, `instForms`, `pairingCode`, `instCarePlan`) | 373 pruebas; el repositorio completo: 2.673, 0 fallos                                                                                                                                                  |
| Suite SQL (`supabase/e2e/institution_care/run.sh`) sobre la réplica de producción                                                                            | 447 comprobaciones, 0 fallos (más pruebas de mutación del SQL; los dos mutantes equivalentes que sobreviven se explican abajo)                                                                         |
| Navegador real contra PostgreSQL real (RLS, permisos por columna y funciones reales)                                                                         | Pacientes: 14 pasos de punta a punta. Monitoreo: 16 pasos (vacío → alta → signos → NEWS2 → alerta → reloj sin sesión → relevo → plan Free → personal por módulo → 375/768/1280 px → fallos de lectura) |
| Render en servidor (sin `window`)                                                                                                                            | 16 comprobaciones; ninguna salida con `undefined`, `NaN` ni `[object]`                                                                                                                                 |

**Lo que no se pudo verificar o no está hecho (dicho sin adornos):**

- La exportación FHIR **no se validó con el validador oficial de HL7**; sigue la especificación de signos vitales pero no afirma
  conformidad con ningún perfil.
- Los hitos («Primer paciente», etc.) se recuerdan **en el navegador** (`localStorage`): en otro navegador se parte de cero sin
  celebrar lo anterior. La **racha** mide el tiempo en que se vio cada alerta, no el desenlace clínico.
- No hay (todavía) un flujo para que la persona vincule su cuenta de Humanix y dé su autorización dentro de la app: hoy es la
  confirmación de la institución, con constancia de quién la dio.
- NEWS2 no sustituye el criterio clínico; no cubre menores de 16 años ni el embarazo.
- El envío a la familia solo **prepara** el mensaje y el enlace de WhatsApp; no hay envío automático.
- Los dispositivos se conectan con el código y el ejemplo de `curl`; no hay (aún) integraciones por proveedor.
- Mutantes de SQL que sobreviven por ser equivalentes (cambian el texto pero no el comportamiento): M36 y M151.
- La réplica local no tiene las tablas de wearables de producción; la suite crea esas tablas de prueba. En producción están vacías (no
  hay códigos débiles que rotar).

## 10. Referencias de diseño

- NEWS2: Royal College of Physicians, _National Early Warning Score (NEWS) 2_, 2017.
- Relevo de turno: esquema **I-PASS** (Starmer y cols., _N Engl J Med_ 2014): gravedad, resumen, acciones, situación y síntesis por quien
  recibe. Es un borrador que la persona corrige; no reemplaza el criterio de quien entrega ni de quien recibe.
- Interoperabilidad: HL7 FHIR R4, LOINC y UCUM (sección 7).
- Datos personales y de salud: Ley 1581 de 2012 (los datos de salud son sensibles): consentimiento confirmado y con constancia,
  exportaciones registradas, lectura solo de la propia institución.
- Patrón de «hospital en casa» y monitoreo remoto de pacientes: se tomó como idea de producto (signos desde el domicilio, alertas con
  plazo, coordinación del caso). No se citan cifras de eficacia porque no se midieron aquí.
