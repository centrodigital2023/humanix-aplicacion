# Paneles del profesional y de la institución: funciones inteligentes y premium

> Complemento de `docs/PANEL_FAMILIA_PREMIUM.md`. Con este lote los tres paneles comparten la misma idea: **un resumen
> priorizado del día gratis para todos** (lo que protege a la persona o mueve el mercado nunca se esconde tras un plan) y
> **herramientas de análisis con plan**, siempre con una vista previa que muestra un dato real de la cuenta.
>
> **Qué no cambió.** Ningún precio, ninguna tabla ni función nuevas para las funciones premium (**no llevan migración**), ninguna
> Edge Function. Todo se calcula en el navegador con datos que la propia persona o institución ya puede leer; nada se envía a una
> IA ni a terceros. Los pagos siguen ocurriendo solo en la página web: los botones de «activar» llevan a `/planes`.
> La única migración de este lote es de **cierre de seguridad** de los datos clínicos (`20261012100000_clinical_data_scope.sql`,
> §4): solo aprieta y no añade funciones.

## 1. Principios de diseño (valen para los tres paneles)

| Principio | Cómo se ve |
|---|---|
| **Gratis lo que protege** | «Tu día» (alertas de un servicio, quien no llegó, turnos por quedar sin cubrir, propuestas que vencen) es para todos. El plan solo añade análisis (ingresos, calidad, pronóstico, informe). |
| **Calma, no ansiedad** | Un anillo de calma (0–100), un saludo cálido por hora y una frase de acompañamiento que cambia por día (no parpadea). Máximo 4 acciones visibles; el resto detrás de «Ver N más». Lo crítico nunca queda oculto. |
| **Un dato que falta no es un cero** | Cada lectura que no se pudo cargar llega como `null` y la pantalla dice «todavía no se cargaron estos datos» o «sin datos suficientes». Los porcentajes exigen una muestra mínima. |
| **Rangos, no promesas** | Las proyecciones son un rango (piso y tope) con sus supuestos a la vista; las comparaciones con el mercado piden una muestra mínima. |
| **Guía, no acusación** | Las etiquetas de personas salen de reglas visibles, nunca con pocos datos; una cancelación de motivo desconocido no se le atribuye a nadie. |
| **El color nunca va solo** | Cada estado se dice con palabras («En rojo», «Por mejorar», «Riesgo alto»); las barras y gráficos llevan descripción para lector de pantalla y tabla oculta. |
| **Móvil primero** | Probado de 320 a 1 280 px sin desplazamiento horizontal; la barra inferior se desplaza y deja a la vista la pestaña activa. |
| **Tiempo real sin sondeo** | TanStack Query + Realtime (sin `setInterval` de datos). Mientras se lee el plan no se muestra el candado ni la invitación: quien ya paga no ve «actívalo». |
| **Pagos solo en la web** | Ningún texto habla de pagar por fuera ni por WhatsApp. |

La pieza común es `DayHero` (`src/components/humanix/premium/`) con la lógica de `src/lib/dayHero.ts` (`calmScore`,
`heroTone`, `orderBrief`, `warmGreeting`, `warmLine`). El orden es **prioridad → hora → regla → id** (estable). Las
instituciones se saludan por su **nombre completo** («Buenos días, Clínica del Norte»); las personas, por su primer nombre.

## 2. Panel del profesional (`/dashboard/profesional`)

Inicio estrena **«Tu día»** (`ProHero`) y una pestaña **«Crecer»** (`ProSmartCenter`).

| Herramienta | Sin plan | Esencial (COP 9.000) | Pro (COP 29.000) |
|---|---|---|---|
| **Tu día** | Completo (el aviso de descanso lleva a tu agenda) | Completo (el aviso de descanso abre «Descanso») | Igual |
| **Ingresos reales** (`pro_income_pulse`) | Vista previa con la comisión del mes | Netos por mes, proyección, día más fuerte, familias que vuelven, tarifa contra tu ciudad | Incluido |
| **Descanso** (`pro_rest_guard`) | Vista previa con las horas de la semana | Carga, días seguidos, noches, descansos < 8 h, día libre sugerido | Incluido |
| **Mi semana** (`pro_week_planner`) | Vista previa («3 turnos compatibles») | Vista previa | Combinación de turnos sin cruces, con margen y un día libre |
| **Reputación** (`pro_reputation_lab`) | Vista previa con tu promedio | Vista previa | Promedio, tendencia, dimensiones, consejos, próxima meta |

### 2.1 «Tu día» del profesional — `proBrief.ts`

| Regla | Prioridad | Cuándo |
|---|---|---|
| `service_alert` | crítica | Servicio en curso con alertas en el parte |
| `service_late` | alta | Confirmado y ya pasaron > 15 min (y < 12 h) sin que lo inicie |
| `service_soon` | media · alta | Vas en camino (media) · confirmado que empieza en ≤ 3 h (alta) |
| `proposal_expiring`, `counter_expiring` | alta | Propuesta de una familia que vence en ≤ 6 h · contraoferta de una institución en ≤ 12 h |
| `overlap`, `rest_high` | alta | Servicios que se cruzan · carga alta (≥ 60 h/semana, ≥ 7 días seguidos o ≥ 4 descansos cortos) |
| `proposals_waiting`, `counters_waiting`, `opportunities_excellent`, `unrated`, `verification`, `profile_incomplete`, `rest_watch` | media | Pendientes por responder, turnos excelentes, servicios por calificar (14 días), RETHUS, perfil < 70 %, carga a vigilar |
| `no_rate`, `kudos_new`, `service_live`, `service_next`, `opportunities`, `commission_hint`, `upgrade` | baja | Sin tarifa publicada, «gracias» de la semana, servicio sin alertas, siguiente servicio (≤ 24 h), turnos compatibles, comisión del mes (solo plan gratuito), invitación al plan (≥ 3 servicios y sin plan) |

### 2.2 Ingresos reales — `proEarnings.ts`

- **Ganado** = el neto que guarda el servidor al terminar (`professional_payout`); si falta, total menos comisión; nunca por
  encima de lo pagado. **Acordado** = confirmado, en camino o en curso (las solicitudes pendientes no cuentan).
- **Proyección** = rango: piso = ganado + acordado; tope = si mantiene el ritmo de 4 semanas (≥ 2 servicios).
- **Mejor día de la semana** (≥ 8 servicios en 90 días), **familias que vuelven** (≥ 3 familias en 180 días), **tarifa contra la
  ciudad** (consejo con ≥ 5 servicios), **comisión pagada** (solo el plan gratuito paga).
- Es información, **no asesoría tributaria**: el planificador de ingresos explica los supuestos de los aportes.

### 2.3 Descanso, «Mi semana» y reputación

- **Descanso** — `proWorkload.ts`: referencia de 42 h/semana (a vigilar desde 48, alta desde 60), 5 días seguidos a vigilar
  (alta desde 7), noches de ≥ 4 h, descansos < 8 h entre turnos (a vigilar desde 2, alta desde 4). Solo lo ve la persona.
- **Mi semana** — `proWeekPlan.ts`: 7 días, hasta 12 h por día y 48 h por semana, 60 min de margen entre servicios, al
  menos un día libre y turnos de puntaje ≥ 60; determinista y explicable (cada turno dice por qué entró y cada descarte, por qué
  quedó fuera). **No postula**: la persona lo hace desde el hub de oportunidades.
- **Reputación** — `proReputation.ts`: dimensiones con ≥ 3 calificaciones, tendencia con ≥ 8, consejo bajo 4,5, metas 4,5 ·
  4,7 · 4,8 · 4,9 y «lo que dicen de ti» (solo comentarios positivos y sin datos de contacto).

## 3. Panel de la institución (`/dashboard/institucion`)

Inicio estrena **«Tu día»** (`InstHero`) y la pestaña **Ops** abre con el **Centro de gestión** (`InstSmartCenter`): cinco
herramientas del plan **IPS Mejorado** (COP 299.000/mes, 1 sede incluida), cada una con su función de plan (`inst_cost_intel`,
`inst_quality_compliance`, `inst_team_reliability`, `inst_coverage_forecast`, `inst_executive_report`).

| Herramienta | Sin plan | IPS Mejorado |
|---|---|---|
| **Tu día** | Completo (más una invitación honesta al plan con ≥ 3 servicios terminados) | Además, aviso de calidad |
| **Costos** | Vista previa («este mes llevas $1.200.000») | Mes, proyección, costo por hora contra tu ciudad, en qué se va el dinero |
| **Calidad y cumplimiento** | Vista previa («tus 12 servicios ya se pueden medir») | Seis indicadores con meta y servicios por revisar |
| **Equipo** | Vista previa («trabajaste con 3 profesionales») | Fichas, dependencia, equipo quieto, a quién sumar, cómo te ven |
| **Pronóstico** | Vista previa («4 turnos publicados») | 14 días día por día, semanas, patrones que se repiten |
| **Informe** | Vista previa | Informe para la gerencia + CSV de auditoría |

El periodo (30 días, 90 días o el mes pasado completo, en hora de Colombia) es un selector accesible (`aria-pressed`) y no
aplica al pronóstico. La fila de la tabla comparativa de `/planes` y la tarjeta del plan lo resumen.

### 3.1 «Tu día» de la institución — `instBrief.ts`

| Regla | Prioridad | Cuándo |
|---|---|---|
| `service_alert` | crítica | Turno en curso con alertas en el parte |
| `service_no_show` | crítica (> 30 min) · alta | Confirmado y sin iniciar pasada la gracia de 15 min (hasta 12 h) |
| `coverage_critical`, `coverage_high` | crítica · alta | Turnos con cupos libres que empiezan pronto (misma lógica que el centro de cobertura) |
| `service_late_route` | alta (> 30 min) · media | Profesional «en camino» con retraso |
| `applications_waiting` | alta si la más antigua lleva ≥ 24 h; si no, media | Postulaciones sin responder |
| `contracts_unsigned` | alta si hay turno en ≤ 48 h; si no, media | Contratos que esperan tu firma |
| `quality_attention` | media · **solo con plan** | Indicadores de calidad en rojo (dice el más bajo) |
| `unrated`, `profile_incomplete`, `publish_first` | media | Servicios de los últimos 14 días sin calificar · falta NIT o ciudad · «publica tu primer turno» |
| `unverified`, `service_live`, `upgrade` | baja | Sin verificar · turno en curso sin alertas · invitación al plan |

### 3.2 Costos — `instCost.ts` (comparte la cuenta de dinero con familia y profesional: `moneyFlow.ts`)

- **Gastado** = servicios terminados; **acordado** = confirmados, en camino o en curso (las solicitudes pendientes no cuentan).
- **Proyección del mes** = rango (piso: gastado + acordado; tope: si mantiene el ritmo de 4 semanas). 6 meses en la gráfica.
- **Costo por hora** del periodo (ponderado por horas, ≥ 3 servicios) contra el rango de la ciudad (`market_rate_stats`, que exige
  ≥ 5 servicios comparables y **no distingue especialidades**: es una referencia, no un veredicto); si está por encima, estima el
  ahorro mensual de negociar a la mediana.
- **En qué se va**: las 4 ofertas y especialidades que más pesan; «concentración» desde 50 % del gasto. En el informe, el periodo
  anterior solo se compara con porcentaje si tuvo ≥ 3 servicios (sobre uno solo, «+1100 %» no dice nada) y, si no, se cuentan los servicios.
- Avisos: ritmo ≥ 25 % sobre el mes pasado (con base ≥ $500.000), costo por hora ±10 % contra el periodo anterior.

### 3.3 Calidad y cumplimiento — `instQuality.ts` y `instData.ts`

| Indicador | Meta (verde) | Por mejorar | Se mide como |
|---|---|---|---|
| Turnos cumplidos | ≥ 92 % | ≥ 80 % | Terminados ÷ (terminados + cancelados por el profesional + sin iniciar) |
| Llegadas puntuales | ≥ 90 % | ≥ 75 % | Llegadas con ≤ 10 min de retraso |
| Horas registradas | ≥ 95 % | ≥ 85 % | Horas entre inicio y cierre del parte ÷ horas contratadas |
| Servicios documentados | ≥ 90 % | ≥ 70 % | Servicios terminados con parte del turno |
| Con contrato firmado | ≥ 95 % | ≥ 80 % | Servicios de turnos publicados con contrato vigente o terminado |
| Horas con RETHUS verificado | ≥ 98 % | ≥ 85 % | Horas atendidas por personal con RETHUS verificado |

Cada indicador exige una **muestra mínima** (5 servicios; 3 para contratos y RETHUS): con menos, dice «sin datos suficientes» y
cuántos faltan, nunca 0 %. Quién canceló **no se guarda** en la base: se infiere por la etiqueta del motivo
(`inferCancelParty`); «Otro motivo» queda «sin dato» y no se le atribuye a nadie. Las horas registradas absurdas (más de 3 veces lo
contratado) se descartan como dato dañado. «Para revisar» lista hasta 5 servicios por categoría con enlace a su detalle. Es una
guía para revisar, no una acusación: menos horas registradas puede ser un cierre anticipado o tardío del parte.

### 3.4 Equipo y marca empleadora — `instTeam.ts` y `instEmployer.ts`

- **Fichas** por profesional (servicios, horas, inversión, puntualidad con ≥ 3 llegadas, cancelaciones, sin iniciar, RETHUS). Etiqueta:
  *Muy confiable* (≥ 3 servicios y ≥ 90 % puntual) · *Confiable* · *Para observar* (1 incidente o < 75 %) · *Para revisar* (≥ 2
  incidentes o < 60 %) · *Sin servicios*. Nunca se juzga con pocos datos.
- **Dependencia**: desde 60 % de las horas en una persona (≥ 24 h y ≥ 3 servicios) hay dependencia; 40–59 % se vigila; con una sola
  persona, «todo el cuidado depende de una sola persona».
- **Equipo de confianza quieto**: sin servicios hace más de 30 días. **A quién sumar**: ≥ 3 servicios en 90 días, sin cancelaciones ni
  sin iniciar y ≥ 90 % puntual (hasta 3; el botón lleva al servicio, donde se guarda como favorito).
- **Cómo te ven los profesionales**: promedio y cuatro dimensiones con ≥ 3 calificaciones (`institution_reputation`), la más fuerte, la
  que más puede mejorar y hasta 2 consejos concretos bajo 4,5. Los comentarios de texto siguen privados.

### 3.5 Pronóstico de cobertura — `instForecast.ts`

14 días día por día (calendario con leyenda **en palabras**, las mismas etiquetas del centro de cobertura: Cubierto · En orden ·
Vigilar · En riesgo · Crítico), cobertura por semana, lo que empieza en menos de 48 h y el **patrón** de horarios que suelen quedar
sin cubrir (≥ 3 turnos vacíos, ≥ 50 % del horario y ≥ 3 semanas distintas en 8 semanas: «los sábados por la noche»). Informa; no
publica ni contacta a nadie: el botón lleva al centro de cobertura.

### 3.6 Informe de gestión y CSV — `instReport.ts`

Frase de apertura, cifras clave, una sección por tema (servicio, inversión, calidad, equipo, próximos 14 días), «para atender» y «lo
que va bien». Se **copia**, se baja en `.txt`, se **imprime o guarda como PDF** desde el navegador (solo sale el informe) y los servicios
del periodo salen en un **CSV para auditoría** (BOM para Excel, separador «;», un renglón por servicio con fecha, profesional, estado,
horas, valor, parte, contrato y RETHUS; una celda queda vacía si el dato no se cargó, nunca «No»).
**El informe no nombra a ningún profesional ni incluye datos de pacientes** (circula fuera de la aplicación); el CSV sí lleva el
profesional, porque una auditoría lo necesita.

## 4. Portal EPS/IPS (`/dashboard/eps`): de cifras inventadas a datos reales

El portal mostraba cifras que no salían de ningún dato. Se reemplazó por lo real, sin tocar la base de datos:

| Antes | Ahora |
|---|---|
| Gráficas de tendencia con `Math.random()` (cambiaban en cada carga) | Servicios terminados y alertas por día (por semana cuando el periodo pasa de 35 días), con descripción accesible; `lib/epsMetrics.ts` |
| «Facturación» = servicios terminados × $85.000 y «+12 %» fijo | **Inversión del periodo** = lo realmente pagado (`buildCostReport`); sin tendencias inventadas |
| «Cumplimiento» por una fórmula arbitraria, reingresos 4,2 % y «3,2 h por visita» fijos, «+3 %»/«-1,2 %» | Quitados. La duración promedio sale de las horas registradas (≥ 3 servicios); el cumplimiento real vive en la pestaña **Cumplimiento** (calidad) |
| Alertas, puntajes de riesgo y registros de entrada de **toda la plataforma** (el filtro `tenant_id` se declaraba y no se aplicaba) | Solo los de **los servicios de la institución** (ids de sus reservas de los últimos 120 días, de a 100) |
| Pacientes de ejemplo («Carlos Rodríguez M.»…) que abrían el monitoreo con el id de la propia institución | Los módulos reales de la institución: **Pacientes** (`EnhancedPatientsModule`) y **Monitoreo** (`InstitutionClinicalMonitoring`) |
| Cumplimiento con porcentajes fijos y sellos «HIPAA/GDPR Ready», «MFA habilitado», «TLS 1.3», «Backups», «ISO 27001» | Indicadores reales de calidad (plan IPS Mejorado) y enlaces a Habeas Data, privacidad y cumplimiento, con el aviso de que el portal **no certifica** por sí solo el cumplimiento normativo |
| «Reportes IA» con fechas de junio de 2026 y botones sin función | El centro de gestión real (costos, calidad, equipo, pronóstico, informe) |

### Qué muestra el portal si el monitoreo clínico no está habilitado

Las cuatro cifras clínicas y las dos tarjetas dependen de dos tablas, `clinical_alerts` y `patient_risk_scores`. Si **falta alguna**
(error `PGRST205` de PostgREST o `42P01` de PostgreSQL; `isMissingTable` en `lib/epsMetrics.ts`), el portal dice **«monitoreo clínico aún
no disponible»** en lugar de «no se pudieron cargar» (que invita a reintentar algo que no se arregla así) o, peor, de «0 alertas»: el
monitoreo se da por habilitado solo cuando existen las dos tablas. Una columna que falta, un permiso negado o un corte de red siguen
siendo un fallo («no se pudieron cargar»). Las suscripciones Realtime empiezan solo cuando su lectura funcionó.

### Datos clínicos: qué hay de verdad en producción (revisado el 2026-10-12; actualizado el 2026-10-13)

> **Actualización 2026-10-13.** Las decisiones pendientes 1 a 5 de más abajo **ya se resolvieron** con `20261012140000`, `20261012150000`,
> `20261012160000` y `20261012170000`, aplicadas en producción con simulacro y verificadas (`docs/FLUJOS_CONECTADOS.md` §6 y `docs/MIGRACIONES.md`).
> La tabla y la lista de abajo conservan el diagnóstico de entonces; el estado actual está en la columna «Hoy».

La versión anterior de este documento decía que la base dejaba leer los datos clínicos de **todos** los pacientes a cualquier institución.
Eso salía de los archivos del repositorio, **no de producción**, y para producción era **incorrecto**:

| Tabla | En producción el 2026-10-12 | Hoy (2026-10-13) |
|---|---|---|
| `clinical_alerts` | Existía (la creó `drizzle/migrations/0007`) y está vacía. Lee el paciente, el profesional del servicio y el staff (`is_staff()` = superadmin, HR y evaluadores). **Sin** política de INSERT, **sin** columnas `lat`/`lng`, **sin** el tipo `sos_manual` y **sin** disparador hacia `clinical-alert-notify` | Lee el superadmin y las partes del servicio (paciente, círculo de cuidado, profesional con servicio vigente y quien contrató: `hx_can_access_alert`). Insertan el propio paciente, quien lo atiende o su círculo (SOS crítico, con guarda anti-abuso). Columnas `lat`, `lng`, `accuracy_m`, `triggered_by`, `inapp_notified`; tipo `sos_manual`; quien atiende solo cambia estado y notas. Avisos dentro de la app; WhatsApp automático sigue sin activarse |
| `patient_risk_scores`, `service_checkins`, `vital_signs`, `alert_thresholds`, `clinical_reports`, `institution_patient_cases`, vista `eps_dashboard_metrics` | **No existen** | Siguen sin existir (ver `docs/MIGRACIONES.md` §5.2) |
| `vital_signs_readings`, `wearable_connections` | Existen y están vacías; políticas por dueño o `is_staff()`; `anon` con `ALL` | Solo dueño, profesional con reserva vigente y superadmin; `anon` sin privilegios; `authenticated` solo con los de datos que ya tenía |

**Qué se hizo.** `supabase/migrations/20261012100000_clinical_data_scope.sql` reemplaza las políticas «por rol» de los archivos
del repositorio por reglas «por servicio» (el paciente, el profesional del servicio, quien contrató, el superadmin), pone la vista
en `security_invoker`, retira privilegios que nadie usa y **falla sin cambiar nada** si encuentra una política «por rol» que no
conoce. Donde la tabla no existe no hace nada, y una política que ya es estrecha no se toca: **nunca añade lectores**. Probada
sobre la réplica de producción y la cadena del repositorio (`supabase/e2e/clinical_scope`). **Aplicada en producción el 2026-10-12**
tras dos simulacros que se deshicieron solos; su efecto real fue quitar de `clinical_alerts` los privilegios de `anon` y
`TRUNCATE`/`REFERENCES`/`TRIGGER`/`MAINTAIN` de `authenticated`. **Ninguna política cambió** (la huella de las políticas de todo el
esquema `public` fue idéntica antes y después). Un archivo viejo (`20260606100000_clinical_monitoring.sql`) lleva ahora una
advertencia: si alguien lo aplica en un entorno nuevo debe aplicar después esta migración.

**Decisiones que quedaban pendientes el 2026-10-12** (todas se resolvieron después; se conserva el razonamiento original):

1. ✅ **Resuelto (`20261012150000`).** **¿Que quien contrató el servicio lea sus alertas?** Hoy ni la familia ni la institución pueden leer las alertas de sus propios
   servicios (la política de lectura no las incluye), así que el portal EPS no podría mostrarlas aunque existieran. Propuesta mínima
   (política adicional; las permisivas se suman):

   ```sql
   CREATE POLICY clinical_alerts_read_contractor ON public.clinical_alerts FOR SELECT TO authenticated
     USING (EXISTS (SELECT 1 FROM public.service_bookings sb
                    WHERE sb.id = clinical_alerts.booking_id AND sb.client_id = auth.uid()));
   ```

   El portal sigue diciendo «aún no disponible» hasta que además exista `patient_risk_scores` (se exigen las dos tablas, ver arriba).
2. ✅ **Resuelto (`20261012150000`).** **¿HR y evaluadores fuera de los datos de salud?** `is_staff()` los incluye en `clinical_alerts_read`/`_ack`, `vital_signs_readings`
   y `wearable_connections` (con el código de emparejamiento). `care_logs` ya se corrigió con este criterio. Hoy no hay cuentas de esos
   roles. Por política, cambiar `is_staff(auth.uid())` por `public.has_role(auth.uid(), 'superadmin'::public.app_role)`.
3. ✅ **Resuelto (`20261012160000` y `20261012170000`); queda sin activar el WhatsApp automático.** **SOS Familiar.** El botón de «Salud en vivo» no puede enviar nada en producción: faltan las columnas `lat`/`lng`, el tipo
   `sos_manual` y la política de inserción del propio paciente (`20260606220000_sos_familiar_alert.sql`), el disparador y la función de
   aviso hacia `clinical-alert-notify` (`20261007170000_wire_webhooks_and_fix_cron.sql`) y los secretos de WhatsApp del servidor. Mientras
   tanto el botón dice que no se pudo enviar y manda a llamar al **123**. Lo mismo ocurre con el check-in/out del profesional
   (`service_checkins`), la tarjeta de riesgo (`patient_risk_scores`, `vital_signs`) y los pacientes que agrega la institución
   (`institution_patient_cases`): sus tablas no existen.
4. ✅ **Resuelto (`20261012150000`).** **`anon` conservaba `ALL` sobre `vital_signs_readings` y `wearable_connections`** (privilegios por defecto; solo las protege RLS):
   `REVOKE ALL ON public.vital_signs_readings, public.wearable_connections FROM anon;` y lo mismo que se hizo con `clinical_alerts` para
   `authenticated`.
5. ✅ **Resuelto (`20261012140000`).** **El registro de usuarios** (`on_auth_user_created`, que crea perfil y rol) **no existía en producción**: ver `AUDIT_REPORT.md` #112.

## 5. Datos, permisos y límites de lectura

| Dato | Tabla o función | ¿Se lee sin plan? |
|---|---|---|
| Reservas | `service_bookings` (RLS: `client_id` / `professional_id`) | Sí (alimenta «Tu día» y las vistas previas). Se leen hasta **800** reservas de los últimos **200 días**; si se llega al tope, el centro lo avisa |
| Parte del turno | `care_logs` | **No**. Hasta 3 000 registros de los 150 servicios terminados más recientes (100 días) |
| Contratos | `smart_contract_shifts` + `smart_contracts` | **No** |
| Perfil público de profesionales | vistas `public_profiles_safe`, `public_professionals_safe` | **No** |
| Ofertas propias | `job_offers` (RLS: `posted_by`) | Cobertura sí; «en qué se va» no |
| Mercado y reputación | RPC `market_rate_stats`, `institution_reputation` | **No** |
| Servicios en curso, bandeja, contratos, equipo | RPC `my_active_services`, `institution_application_inbox`, `my_smart_contracts`, `my_trusted_team` | Sí |
| Alertas y riesgo (portal EPS) | `clinical_alerts`, `patient_risk_scores` por `booking_id` | Sí (es el resumen del portal). **Hoy en producción**: `patient_risk_scores` no existe y la institución no puede leer las alertas de sus servicios; el portal dice «monitoreo clínico aún no disponible» |

La puerta de los planes es **de interfaz**: son cuentas sobre datos que la persona o institución ya puede leer. Sin plan se evita
pedir lo que no se va a mostrar (lo verifica la prueba de navegador).

**Límites que conviene conocer**

- Una institución con **cientos de profesionales distintos** en 200 días puede exceder el largo de la dirección al pedir sus perfiles
  públicos: nombres y RETHUS quedan «sin datos» (no se inventan). Con más de 800 reservas, los meses más antiguos del gasto pueden
  quedar incompletos (hay aviso). El resumen del portal EPS usa los 300 servicios más recientes.
- El historial del pronóstico solo conoce las ofertas abiertas o cubiertas: un horario repetido sin cubrir es una pista, no una certeza.
- El monitoreo de pacientes que la institución agrega por QR o por id se guarda en su navegador y no tiene servicio asociado: aparece
  en **Monitoreo**, no en el resumen.
- «Guardar como PDF» usa la impresión del navegador; no hay generación de PDF en el servidor.
- No se pudo probar fuera de producción: Realtime real, PostgREST con JWT reales y navegadores móviles reales.

## 6. Dónde está el código

| Qué | Dónde |
|---|---|
| Lógica pura (con pruebas colocadas) | Profesional: `proBrief`, `proEarnings`, `proWorkload`, `proWeekPlan`, `proReputation` · Institución: `instData`, `instBrief`, `instCost`, `instQuality`, `instTeam`, `instEmployer`, `instForecast`, `instReport` · EPS: `epsMetrics` · Compartido: `dayHero`, `intelShared` (periodos, horas con coma, `chunk`), `moneyFlow`, `serviceCancel` (`inferCancelParty`), `institutionCoverage` (`buildCoverageInputs`) |
| Datos de prueba | `src/lib/intel.fixture.ts`, `instIntel.fixture.ts` |
| Plan | `src/lib/plans.ts` (4 funciones de profesional + 5 de institución), `src/routes/planes.tsx`, `proPremium.test.ts`, `institutionPremium.test.ts` |
| Datos (TanStack Query + Realtime, sin sondeo) | `src/hooks/use-pro-intel.ts`, `use-inst-intel.ts`, `use-eps-intel.ts`, `use-now.ts` |
| Interfaz (shadcn + tokens semánticos + lucide) | `src/components/humanix/pro/`, `src/components/humanix/institution/` (`InstHero`, `InstBriefCard`, `InstSmartCenter`, `CostCard`, `QualityCard`, `TeamCard`, `ForecastCard`, `ReportCard`, `EpsCompliance`), `src/components/humanix/premium/` (`DayHero`, `StatTile`, `MonthBars`, `BarSeries`, `InsightList`, `PremiumPreview`, `download.ts`), `EPSDashboard.tsx` |
| Datos clínicos (seguridad) | `supabase/migrations/20261012100000_clinical_data_scope.sql` (aplicada), pruebas en `supabase/e2e/clinical_scope/` (`run.sh`: réplica de producción; escenarios A cadena del repositorio, B base sin tablas, C como producción hoy) |
| Integración | `dashboard.profesional.tsx` (pestaña «Crecer»), `dashboard.institucion.tsx` (héroe, anclas `cobertura`, `turnos-en-vivo`, `postulaciones`, `contratos`, `calificar`, `centro-gestion`; barra inferior desplazable), `dashboard.eps.tsx` |

`CareCompassCard` y `careCompass.ts` quedaron sin uso (el héroe de «Tu día» los sustituye en los tres paneles): se pueden borrar con su
prueba.

## 7. Verificación

| Qué | Resultado |
|---|---|
| Pruebas unitarias | Profesional **214** (6 archivos) · institución **376** (9 archivos) · portal EPS **37** · compartidas (héroe, periodos, cancelación, cobertura) **134**; **1 812 / 1 812** en toda la plataforma (65 archivos) |
| Pruebas de mutación (cambios deliberados de umbrales, reglas y formatos) | Profesional, institución, EPS y ayudantes compartidos; en institución, EPS y ayudantes, **0 sobrevivientes** al cerrar. Los huecos que aparecieron se cubrieron con pruebas o simplificando código redundante |
| Chromium real (datos simulados; 320, 360, 390, 430, 768, 1 000 y 1 280 px) | Institución y portal EPS **64 / 64** pasos (incluye la tabla ausente, el fallo real y las suscripciones Realtime); profesional **25 / 25**; familia **27 / 27** (regresión tras tocar los componentes compartidos) |
| Renderizado en servidor sin `window` | Institución **20 / 20** · profesional **14 / 14** · familia **11 / 11** |
| PostgreSQL 16 con la estructura real de producción (`supabase/e2e/clinical_scope`) | Escenario A (cadena del repositorio, antes y después, idempotencia) **59 / 59** · B (sin tablas) **7 / 7** · C (como producción hoy) **22 / 22** · política «por rol» desconocida (3 roles) falla sin cambiar nada · **23 mutantes de SQL, todos detectados**. La réplica completa con la migración en la cadena: lazo de cuidado 264 / 264, hub de instituciones 252 / 252, deriva 37 / 37, validación de mercado 57 / 57 |
| `tsc`, ESLint y Prettier en los archivos nuevos y tocados | Limpios (quedan 2 avisos previos de `react-hooks/exhaustive-deps` en `dashboard.institucion.tsx`) |

La prueba de navegador cubre, entre otras cosas: el orden y el texto de «Tu día», que sin plan **no se lean** el parte, los contratos, los
perfiles ni el mercado, cifras revisadas a mano (gasto, proyección, 86 % de turnos cumplidos, 62 % con contrato…), cambio de periodo,
copiar y descargar el informe y el CSV, imprimir (solo el informe), Realtime, escenarios vacíos y con lecturas caídas, y que **el alcance
del portal EPS excluya los datos de otra institución**.

## 8. Cómo probarlo

```bash
bun run test src/lib/proBrief.test.ts src/lib/proEarnings.test.ts src/lib/proWorkload.test.ts \
  src/lib/proWeekPlan.test.ts src/lib/proReputation.test.ts src/lib/proPremium.test.ts \
  src/lib/instData.test.ts src/lib/instBrief.test.ts src/lib/instCost.test.ts src/lib/instQuality.test.ts \
  src/lib/instTeam.test.ts src/lib/instEmployer.test.ts src/lib/instForecast.test.ts src/lib/instReport.test.ts \
  src/lib/institutionPremium.test.ts src/lib/epsMetrics.test.ts src/lib/dayHero.test.ts src/lib/intelShared.test.ts
```

La migración de datos clínicos, sobre una base **desechable** (borra y crea bases `hx_clin_*`; nunca contra Lovable Cloud):

```bash
HX_TEST_CONFIRM=desechable PGHOST=localhost PGPORT=5432 PGUSER=postgres supabase/e2e/clinical_scope/run.sh
```
