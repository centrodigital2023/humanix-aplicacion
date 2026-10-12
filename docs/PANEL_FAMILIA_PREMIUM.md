# Panel de familia: funciones inteligentes y premium

> **Qué hay.** Debajo de las acciones rápidas del panel de familia (`/dashboard/familia`) aparece **«Tu centro de cuidado»**:
> un resumen priorizado del día para **todas** las familias y, con el plan **Esencial** (COP 9.000/mes), cuatro herramientas:
> informe de bienestar con resumen para el médico, comparador inteligente de postulaciones, presupuesto de cuidado y
> radar de cobertura.
>
> **Qué no cambió.** Ningún precio (la única familia de pago sigue siendo Esencial), ninguna tabla ni función de la base
> de datos (**no hay migración**), ninguna Edge Function. Todo se calcula en el navegador con datos que la familia ya
> puede leer; nada se envía a una IA ni a terceros. Los pagos siguen ocurriendo solo en la página web: los botones de
> «activar» llevan a `/planes`.

## 1. Qué recibe cada familia

| Herramienta | Sin plan | Con Esencial |
|---|---|---|
| **Tu día, resuelto** (resumen priorizado) | Completo: lo que mueve el mercado y la seguridad nunca se esconde | Además, avisos sacados del informe y del presupuesto |
| **Bienestar** (informe + resumen para el médico) | Vista previa con un dato real de su cuenta («tus 5 servicios de los últimos 30 días ya tienen parte») | Informe de 7, 30 o 90 días |
| **Comparador** de propuestas y postulaciones | Vista previa («tienes 3 opciones por comparar») | Ranking 0–100 explicable, mejor opción y contraoferta |
| **Gasto** (presupuesto) | Vista previa («este mes llevas $450.000») | Proyección, contra el mes pasado, contra tu ciudad |
| **Cobertura** (radar) | Vista previa («tienes 4 horas sin cubrir») | Huecos con urgencia, tarifa, propuestas y a quién avisar |

Las funciones salen de `FEATURE_MIN_PLAN` (`family_wellbeing_report`, `smart_applicant_ranking`, `care_budget_forecast`,
`coverage_radar` → `essential_monthly`). La tarjeta de precios del plan Esencial lo resume en una línea y la tabla
comparativa de `/planes` tiene su fila. El plan se lee siempre de `mp_subscriptions` (solo escribe el webhook de pagos).

## 2. Cómo se calcula cada cosa

Todas las reglas son funciones puras en `src/lib/` con pruebas; nada depende de la pantalla.

### 2.1 «Tu día, resuelto» — `familyBrief.ts`

Orden: **prioridad → hora → regla → id** (estable: el orden de entrada no cambia el resultado). Lo crítico nunca queda
oculto aunque pase del límite de 4 ítems visibles.

| Regla | Prioridad | Cuándo |
|---|---|---|
| `service_alert` | crítica | Turno en curso (propio o del círculo) con alertas en el parte |
| `gap_soon` | crítica · alta · media | Horas de la agenda sin profesional: ≤ 6 h crítica, ≤ 24 h alta, ≤ 72 h media (los huecos lejanos no entran) |
| `proposal_expiring` | alta | Propuesta de un profesional que vence en ≤ 6 h |
| `proposals_waiting` | alta | Demás propuestas pendientes (las propias y las vencidas no cuentan) |
| `applications_waiting` | alta si la más antigua lleva ≥ 24 h; si no, media | Postulaciones sin responder |
| `emergency_contact` | alta si ya hay servicios; si no, media | Falta el contacto de emergencia |
| `profile_incomplete` | media | Perfil incompleto (solo si sí hay contacto de emergencia) |
| `unrated` | media | Servicios terminados en los últimos 14 días sin calificar |
| `save_team` | media | Hay un servicio terminado y el equipo de confianza está vacío |
| `first_request` | media | Cuenta sin actividad: «pide tu primer cuidado» |
| `wellbeing_alerts`, `wellbeing_mood`, `budget_pace` | media · **solo con plan** | ≥ 1 alerta en 7 días · ánimo bajando · gasto ≥ 25 % sobre el mes pasado |
| `service_live`, `service_soon`, `budget_market`, `invite_circle`, `upgrade` | baja | Turno en curso sin alertas · servicio confirmado en ≤ 24 h · se paga ≥ 10 % sobre la mediana · sin círculo · invitación al plan (solo sin plan y con actividad) |

### 2.2 Informe de bienestar — `wellbeing.ts`

Usa el parte que escribe el profesional (`care_logs`, que la familia ya lee por RLS). **No diagnostica**: señala lo que
conviene conversar con el médico y repite en cada informe que los rangos son generales para adultos en reposo
(`VITALS_DISCLAIMER`).

- **Servicios:** terminados y en curso del periodo (7, 30 o 90 días); los cancelados no entran.
- **Ánimo:** el último registrado de cada servicio; «positivo» = contento o tranquilo. Tendencia con ≥ 4 servicios: la
  mitad reciente contra la antigua, con frontera de ±0,5 puntos.
- **Signos vitales:** presión (por su sistólica), pulso, temperatura y oxígeno, con los mismos rangos de `careLog`
  (`vitalFlags`: «a vigilar» y «fuera de rango»). Tendencia con ≥ 4 lecturas; cambio mínimo 8 mmHg · 8 lpm · 0,4 °C ·
  2 puntos. Preocupa subir (presión, pulso, temperatura) o bajar (oxígeno). Una lectura fuera de rango de la última
  semana se destaca aunque las siguientes hayan salido bien.
- **Medicamentos:** se avisa un hueco solo si hay ≥ 3 servicios con parte, ≥ 60 % con registro y alguno sin él. El texto
  aclara que «no aparece» no prueba que no se haya dado.
- **Continuidad:** ≥ 70 % de las horas con la misma persona = alta; 40–69 % media; < 40 % baja.
- **Confianza del informe:** baja (< 3 servicios o < 4 datos), alta (≥ 8 servicios y ≥ 12 lecturas), media entre medias.
- **Resumen para el médico** (`doctorSummary`): texto para copiar o descargar (.txt). Lo comparte la familia, no la
  plataforma; **sin nombres de profesionales, direcciones ni valores de pago**.

### 2.3 Comparador inteligente — `applicantRanking.ts` y `applicantSources.ts`

Puntaje de 0 a 100 con seis factores, cada uno con su máximo y su nota (la tarjeta lo muestra en «¿Cómo se calculó?»):

| Factor | Máx. | De dónde sale |
|---|---|---|
| Verificación y confianza | 30 | RETHUS verificado 14 · identidad 4 · puntaje de confianza × 12 |
| Valoración y experiencia | 25 | Calificación **suavizada** (media 4,2 con peso de 3 servicios: una reseña perfecta no le gana a 40 buenas) hasta 15 · años de experiencia hasta 7 · servicios hasta 3 |
| Precio | 20 | Dentro del rango de la ciudad 20 · por debajo 17 · sin referencia 14 · sobre el techo `20 − 40 × exceso`; todo multiplicado por `1 − 1,5 × exceso sobre lo publicado` (mínimo 0,3). Las tarifas por turno o mes no se comparan con el rango por hora |
| Cercanía | 10 | ≤ 2 km 10 · ≤ 5 km 8 · ≤ 10 km 6 · ≤ 20 km 3 · más 1 · desconocida 5 |
| Ya te conoce | 10 | En el equipo de confianza 6 + 2 por servicio juntos (hasta 4) |
| Disponibilidad | 5 | Sí 5 · no 0 · sin dato 2 |

Etiquetas: ≥ 80 «Muy buena opción», ≥ 65 «Buena opción», ≥ 50 «Para considerar», menos «Revisa con cuidado»; con menos del
40 % de los datos del perfil, «Pocos datos» (no se acusa ni se premia lo que se desconoce). **Mejor opción:** la primera, solo
si hay con quién compararla y llega a 65. **Contraoferta sugerida:** el punto medio entre la mediana y el techo del rango, o
entre lo publicado y lo pedido si lo pedido pasa 10 %; nunca más alta que la oferta. El orden es determinista (puntaje,
luego tarifa menor, luego quien llegó primero).

El comparador **no acepta ni rechaza**: «Responder» lleva a la bandeja de propuestas o de postulaciones de siempre.

### 2.4 Presupuesto de cuidado — `careBudget.ts`

- **Gastado** = servicios terminados; **programado** = confirmados, en camino o en curso. Las solicitudes **pendientes**
  (que el profesional aún no confirmó) no se cuentan como plata segura.
- **Proyección del mes** = un **rango**: piso = gastado + programado; tope = si se mantiene el ritmo de las últimas 4
  semanas (necesita ≥ 2 servicios). Nunca baja del piso.
- **Contra el mes pasado**, hasta el mismo día del mes (no contra el mes completo).
- **Costo por hora**: promedio ponderado por horas de los últimos 90 días (≥ 3 servicios) frente al rango de la ciudad
  (`market_rate_stats`, que exige ≥ 5 servicios comparables); si está por encima, estima el ahorro mensual de negociar a la
  mediana.
- **Cancelaciones** (≥ 5 servicios, aviso desde 25 %) y horas por semana (últimas 4 contra las 4 anteriores).
- Meses y días son de Colombia (UTC-5); el mes cambia a las 05:00 UTC.

### 2.5 Radar de cobertura — `coverageRadar.ts`

- Mira la agenda (`family_needs`) los próximos **14 días**; une horas seguidas en turnos de hasta 24 h (misma función que
  usa el hub de los profesionales).
- **Urgencia** del hueco: ≤ 6 h crítica, ≤ 24 h alta, ≤ 72 h media, más lejos baja (fronteras exactas probadas).
- **Cobertura de 7 días** = horas con profesional ÷ horas marcadas (recorta lo que cae fuera de la ventana).
- **Tarifa**: si la publicada está por debajo del rango de la ciudad, sugiere la mediana; cuenta las propuestas vigentes de
  profesionales para cada hueco y avisa cuando lleva ≥ 12 h publicado sin propuestas.
- **Equipo**: quién está disponible, con quien más ha trabajado primero. No contacta a nadie: lleva al perfil.

## 3. Datos, permisos y privacidad

| Dato | Tabla o función | Quién lo ve | ¿Se lee sin plan? |
|---|---|---|---|
| Reservas de la familia | `service_bookings` (RLS: `client_id`) | La propia familia | Sí (alimenta el resumen y los datos de las vistas previas) |
| Agenda | `family_needs` | La propia familia | Sí (huecos del resumen) |
| Propuestas | RPC `my_slot_proposals` | La propia familia | Sí (comparte caché con la bandeja) |
| Parte del turno | `care_logs` (RLS: profesional, cliente y superadmin) | La propia familia | **No**: solo con plan |
| Perfil público de candidatos | vista `public_professionals_safe` | Cualquier sesión | **No**: solo con plan |
| Rango de tarifas | RPC `market_rate_stats` | Cualquier sesión | **No**: solo con plan |
| Equipo, servicios en curso | RPC `my_trusted_team`, `my_active_services` | La propia familia | Sí |

- **La puerta es de interfaz**, no de servidor: son cuentas sobre datos que la familia ya puede leer (la historia exportable,
  que sí cuesta, sigue validando el plan en SQL). Un navegador manipulado no obtendría nada que la familia no pueda ver ya;
  lo que cuesta dinero a Humanix (IA, mensajes) no forma parte de este lote.
- Los datos de salud **no salen del navegador** para calcular el informe. El resumen para el médico lo copia o descarga
  la persona; avisa que contiene datos de salud (Ley 1581 de 2012: dato sensible) y que se comparta solo con quien ella decida.
- Sin plan se evita pedir lo que no se va a mostrar (partes, mercado, perfiles): lo verifica la prueba de navegador.
- Mientras se lee el plan no se muestra el candado ni la invitación: quien ya paga no ve el aviso de «actívalo».
- Ningún texto de este panel habla de pagos por WhatsApp; los botones de activar llevan a `/planes`.

## 4. Dónde está el código

| Qué | Dónde |
|---|---|
| Lógica pura (con pruebas colocadas) | `src/lib/familyBrief.ts`, `wellbeing.ts`, `applicantRanking.ts`, `applicantSources.ts`, `careBudget.ts`, `coverageRadar.ts`, `familySnapshot.ts`, `intelShared.ts` |
| Datos de prueba compartidos | `src/lib/familyIntel.fixture.ts` |
| Plan | `src/lib/plans.ts` (4 funciones nuevas), `src/routes/planes.tsx` (fila en la comparativa), `src/lib/familyPremium.test.ts` |
| Datos (TanStack Query + Realtime, sin sondeo) | `src/hooks/use-family-intel.ts` |
| Interfaz (shadcn + tokens semánticos + lucide) | `src/components/humanix/family/` (`FamilySmartCenter`, `FamilyBriefCard`, `WellbeingReportCard`, `ApplicantsRankingCard`, `CareBudgetCard`, `CoverageRadarCard`, `PremiumPreview`, `InsightList`, `Sparkline`) |
| Integración | `src/routes/dashboard.familia.tsx` (el centro va tras las acciones rápidas; ids de sección para los botones del resumen: `agenda`, `propuestas`, `calificar`, `equipo`, `circulo`, `postulaciones`) |

## 5. Verificación

| Qué | Resultado |
|---|---|
| Pruebas unitarias nuevas (9 archivos) | **274**; **1 057 / 1 057** en toda la plataforma |
| Pruebas de mutación de la lógica (≈ 60 cambios deliberados de umbrales y reglas) | todas las mutaciones se detectan; los huecos que aparecieron (frontera de «empeora», 50 % de medicamentos, un solo valor a vigilar, 40 % sin parte, 70 % de buen ánimo, 8 servicios para confianza alta, registros del sistema, contraoferta con un rango sin ancho, día 14 del mes pasado) se cubrieron con pruebas nuevas |
| Chromium real (datos simulados; 1 000 px y 390 px) | **27 / 27** pasos: resumen, vista previa sin plan, las 4 herramientas, periodos, copiar y descargar el resumen, botones que bajan a cada sección (incluso dentro de bloques plegados), Realtime (parte nuevo y propuesta nueva), cuenta vacía, consulta caída, nombres accesibles, sin desborde, consola limpia |
| Renderizado en servidor sin `window` | 11 / 11 |
| `tsc`, ESLint y Prettier en archivos nuevos y tocados | limpios (los errores de formato previos de `plans.ts`, `planes.tsx` y `dashboard.familia.tsx` no se tocaron) |

## 6. Límites y decisiones

- Los rangos de signos vitales son **generales**; cada paciente puede tener metas distintas (por ejemplo EPOC). El informe
  dice «a vigilar», no «anormal», y remite siempre al médico tratante.
- El informe usa hasta 1 000 registros de los 100 servicios más recientes de 90 días; si se llega al tope, lo avisa.
- «Con parte» cuenta lo que el profesional registró: si no usa la bitácora, el informe no puede saber cómo estuvo el turno
  (y lo dice).
- El ranking es una ayuda para decidir, no una garantía: usa solo lo que muestra el perfil público y lo que ya pasó con la
  familia. Un perfil con pocos datos se marca «Pocos datos» en lugar de acusarlo.
- La proyección de gasto es un rango y sus supuestos están a la vista.
- No hay metas de gasto guardadas (exigirían una columna nueva y su migración): se dejó fuera para no tocar la base.
- Realtime y navegadores móviles reales no se pueden probar fuera de producción.

**Observaciones fuera de alcance (no se tocaron):** la función de plan `whatsapp_contact` está declarada pero ninguna pantalla la
consulta (el botón de WhatsApp de las postulaciones depende solo de que el teléfono sea legible); y el manejador de Realtime
de postulaciones del panel llama a otros `setState` y a un aviso dentro de una función de actualización, lo que puede
duplicar el aviso «Nueva postulación» en modo estricto. Ambos merecen una decisión aparte.

## 7. Cómo probarlo

```bash
bun run test src/lib/familyBrief.test.ts src/lib/wellbeing.test.ts src/lib/applicantRanking.test.ts \
  src/lib/applicantSources.test.ts src/lib/careBudget.test.ts src/lib/coverageRadar.test.ts \
  src/lib/familySnapshot.test.ts src/lib/intelShared.test.ts src/lib/familyPremium.test.ts
```
