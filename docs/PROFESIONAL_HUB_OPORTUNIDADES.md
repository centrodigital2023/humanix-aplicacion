# Hub de oportunidades del profesional

Dónde vive: pestaña **Ofertas** del panel del profesional (`/dashboard/profesional`) y la barra «En vivo» de **Inicio**.
Toda la lógica de decisión es pura, explicable y probada (`src/lib/opportunities.ts`, `negotiation.ts`,
`familyReputation.ts`, `proIncome.ts`). Lo que protege datos y planes lo decide **el servidor** (migración
`20261008200000_professional_opportunity_hub.sql`); la interfaz solo presenta lo que el servidor ya filtró.

## Qué necesidades del profesional cubre

| Necesidad (por qué importa) | Qué hace Humanix | Dónde |
|---|---|---|
| Ver qué hay y postularse sin perseguir mensajes | Las familias marcan **horas sueltas**; el hub las une en **turnos** (horas contiguas de una misma familia, máx. 24 h) con ciudad, tipo de cuidado, notas, valor y total | `OpportunityHub`, `ShiftCard` |
| Saber si el turno compensa | Muestra el **neto después de la comisión** (12 % en Free, 0 % en planes de pago) y avisa si queda bajo el salario mínimo por hora | `ShiftCard`, `ApplyDialog` |
| Ver qué tan bien encaja | Puntaje 0-100 **explicado**: ciudad 30 · tipo de cuidado 30 · tarifa 20 · agenda 10 · reputación de la familia 10 | `scoreShift` |
| No cruzar turnos | Detecta cruces con servicios ya confirmados (en pantalla y en el servidor) | `scoreShift`, `apply_to_family_need` |
| Negociar el valor sin subastas a la baja | Contraofertas acotadas (0,8×–2× lo publicado), máx. 3 rondas, vencen, punto medio sugerido y referencia de mercado | `ApplyDialog`, `CounterOfferDialog`, `ProposalsInbox` |
| Seguridad en domicilios | Reputación de la familia (estrellas y 4 dimensiones, mínimo 3 calificaciones); dirección y WhatsApp **solo** con plan de pago + postulación + cupo diario, todo auditado | `FamilyReputationBadge`, `ContactRevealPanel` |
| Enterarse a tiempo | Alertas por ciudad/tipo/valor/urgencia con aviso en vivo; barra «En vivo» con turnos reales (ya no cuenta usuarios registrados) | `AlertsPanel`, `OpportunityPulse` |
| Entender cuánto gana de verdad | Planificador: bruto → comisión → aportes de independiente (estimados) → neto por hora, meta de ingreso y «¿me conviene Esencial?» | `IncomePlanner` |
| Calificar a la familia y comentar | Estrellas + claridad, trato, pago y entorno + comentario, sin salir del panel | `RateFamilyDialog` |

## Qué ve cada plan

| | Free | Esencial · Pro · IPS |
|---|---|---|
| Ver turnos, puntaje, reputación, nombre abreviado («María R.») y ciudad | Sí | Sí |
| Postularse al **valor publicado** | Sí | Sí |
| Proponer **otro valor** / contraofertar | No | Sí (feature `negotiate_rate`) |
| Dirección y WhatsApp de la familia | No | Sí, tras postularse (feature `view_address`/`whatsapp_contact`) |
| Cupo de desbloqueos por día (familias distintas) | 0 | 15 (Esencial) · 40 (Pro, IPS) |
| Comisión | 12 % | 0 % |

La familia nunca necesita plan para negociar. El plan se lee **solo** de `mp_subscriptions` (lo escribe el webhook de pagos).

## Flujo

1. La familia marca horas en su calendario (ahora con **tipo de cuidado** y **nota** opcionales; la nota no admite
   teléfonos, correos ni direcciones).
2. `list_open_family_needs()` devuelve esas horas **sin dirección**, con el nombre abreviado, la ciudad del perfil, las notas
   sin datos de contacto y la reputación agregada de la familia.
3. El profesional se postula con `apply_to_family_need(ids, valor?, mensaje?)`: valida que las horas sean de una sola familia,
   consecutivas, abiertas y sin cruce con una reserva confirmada; guarda el valor publicado (`posted_rate`) como referencia.
4. La familia ve la postulación en su bandeja (`my_slot_proposals`) y puede **aceptar**, **rechazar** o **contraofertar**
   (`counter_slot_proposal`). Cada contraoferta es una fila nueva enlazada a la anterior; la anterior pasa a `countered`.
5. `accept_slot_proposal` crea la reserva (precio y comisión calculados en el servidor, **dirección copiada a la reserva**),
   marca como cubiertas **todas** las horas del turno y cancela las demás postulaciones que quedan dentro del mismo turno.
6. Con plan de pago y postulación vigente, `reveal_opportunity_contact(id)` devuelve nombre, dirección y WhatsApp. Queda
   registrado en `opportunity_contact_reveals` y la familia recibe un aviso («X desbloqueó tu contacto»).

## Privacidad y seguridad (qué cambió y por qué)

- **Se cerró una fuga.** Sobrevivía una política antigua (`family_needs_select_authenticated`) que dejaba a *cualquier* usuario
  autenticado leer todas las necesidades abiertas con **dirección y notas**; además `fn_select_open_for_pros` la daba a todo
  profesional. Ahora solo la familia dueña y el staff leen `family_needs`; el resto usa las funciones de arriba.
- **El plan y los límites ya no dependen de la interfaz.** Hasta hoy cualquiera de las dos partes podía insertar o editar
  `slot_proposals` por la API con el valor y el estado que quisiera (incluido `accepted`). Los disparadores
  `slot_proposals_guard_insert/update` hacen cumplir: ronda 1 al insertar, estado inicial `pending`, sin duplicados, rango
  de valor, plan de pago para negociar, y que `accepted`/`countered` solo salgan de las funciones. Quien recibe puede
  rechazar; quien envía puede retirar; nada más.
- **Los mensajes no sacan la conversación de la plataforma.** Postulación, contraoferta, notas y comentarios rechazan (o
  limpian, en el caso de las calificaciones) teléfonos, correos, enlaces, direcciones e **instrucciones de pago**. Los pagos
  se hacen únicamente en la página web; ningún texto automático menciona otra vía.
- **Comentarios privados.** El comentario de una calificación lo ven la persona calificada y el staff. Los demás
  profesionales solo ven promedios (≥ 3 calificaciones) para no exponer a las familias ni crear incentivos de represalia.
- **Auditoría.** Desbloqueos (quién, a quién, plan, día), vencimientos y cambios de estado quedan en tablas con RLS.
- **Nombres de la bandeja.** `ProposalsInbox` buscaba nombres con `profiles.id` en vez de `profiles.user_id` y por eso nunca
  los mostraba; ahora los resuelve `my_slot_proposals` (el profesional ve a la familia abreviada).

## Constantes que existen en SQL **y** en TypeScript (cámbialas juntas)

| Regla | SQL | TypeScript |
|---|---|---|
| Rango de valor 0,8×–2×, pasos de $500, piso $8.000, techo $250.000 | `rate_band_min/max` | `rateBand` (`negotiation.ts`) |
| Cupo diario de desbloqueos | `reveal_daily_quota` | `REVEAL_DAILY_QUOTA` (`opportunities.ts`) |
| Redacción de contacto/direcciones | `redact_contact_info` | `REDACTIONS` (`opportunities.ts`) |
| Mensajes prohibidos (contacto + pagos) | `message_has_forbidden_content` | `checkOutgoingMessage` |
| Vencimiento: 72 h postulación, 24 h contraoferta, ≥ 15 min | `apply_to_family_need`, `counter_slot_proposal` | `expiryFor` |
| Máx. 3 rondas | `counter_slot_proposal` | `MAX_ROUNDS` |
| Nombre abreviado | `short_display_name` | `displayName` |
| Alertas (ciudad, tipo, valor, urgencia) | `notify_opportunity_alerts` | `alertMatchesShift` |

Las pruebas de TypeScript y las de PostgreSQL usan los **mismos casos** de redacción y rango para detectar desvíos.

## Operación

1. Aplicar `20261008200000_professional_opportunity_hub.sql` y `20261008210000_pqrs_table_grants.sql`; luego regenerar los
   tipos de Supabase (el código usa un cliente sin tipar para lo nuevo).
2. **En vivo:** el servidor emite «hay cambios» (sin datos) por el canal **privado** `open_needs_ping`; la migración crea la
   política sobre `realtime.messages` si existe. Si Realtime Authorization no estuviera activo, el hub igual carga al abrirse
   y al volver a la pestaña.
3. **Vencimientos:** `pg_cron` ejecuta `expire_stale_proposals()` cada 15 min si la extensión está disponible; si no, el
   vencimiento se aplica igual al aceptar/contraofertar y la interfaz muestra «Venció» al instante.
4. **PQRS sin Edge Functions nuevas:** `pqrs-intake` y `pqrs-assistant` se reemplazaron por funciones de servidor
   (`src/lib/pqrs.functions.ts`); necesitan `SUPABASE_SERVICE_ROLE_KEY` y `LOVABLE_API_KEY` como secretos del servidor.
5. `AppQueryProvider` (TanStack Query) se montó en la raíz: el proyecto declaraba usarlo pero no había proveedor.

## Qué se verificó (y qué no)

- 225 pruebas unitarias (Vitest) de lógica pura y de las funciones de servidor con base de datos simulada.
- 146 comprobaciones contra **PostgreSQL 16 real** en dos variantes del esquema (estado como texto con `CHECK` y como
  `enum`), incluyendo RLS con roles reales, intentos de saltarse el servidor por la API, cupos, negociación completa,
  idempotencia (aplicar la migración dos veces) y ejecución en una sola transacción.
- 18 pruebas de humo de renderizado en servidor (incluye que el HTML del plan Free **no** contiene direcciones).
- Tipado estricto de las funciones de borde que se mantienen.
- **No** probado: contra un proyecto Supabase real, Realtime ni el navegador. Revisa la primera postulación y el primer
  desbloqueo de punta a punta con dos cuentas reales.

## Decisiones a confirmar y límites conocidos

- **Desbloquear exige postularse antes** (`v_require_application` en `reveal_opportunity_contact`): evita que un plan de pago
  sirva para recolectar contactos sin intención de trabajar. Si el negocio prefiere desbloquear sin postularse, es una sola
  constante.
- Los cupos (15/40) son una propuesta; ajústalos con datos reales.
- `job_offers.address`/`contact_phone` siguen siendo legibles por la API para usuarios autenticados (comparten rol con los
  autores): el hub no los usa, pero cerrarlo del todo requiere moverlos a una tabla privada.
- El planificador de ingresos es una **estimación** con las reglas de 2026 (base 40 %, mínimo 1 SMMLV, salud 12,5 %, pensión
  16 %, ARL por clase, solidaridad desde 4 SMMLV). Los porcentajes pueden cambiar por decreto, la reforma pensional puede
  modificarlos y no incluye renta ni costos presuntos (Decreto 379 de 2026). Muestra siempre sus supuestos y un descargo.
- Con menos de 5 servicios en una ciudad no se muestra «rango de mercado»; con menos de 3 calificaciones no se muestran
  promedios de la familia.
- `family_needs` no tiene ciudad propia: se toma del perfil de la familia.
- Pendiente: avisos por WhatsApp Business (solo informativos, nunca pagos), mediación de disputas, vencimiento de documentos
  del profesional como requisito para postularse y matching semántico en el hub.

## Lecturas que informaron el diseño

- [Qué quieren los cuidadores (encuesta a 8.200, HHAeXchange)](https://www.hhaexchange.com/blog/what-caregivers-really-want-in-insights-from-8200-caregivers) — flexibilidad, pago y herramientas móviles.
- [«Uber for Nursing» (Roosevelt Institute, 2024)](https://rooseveltinstitute.org/wp-content/uploads/2024/12/RI_Uber-for-Nursing_Brief_202412.pdf) — riesgos de las apps de turnos: pago opaco y presión a la baja; de ahí el rango acotado y el neto siempre visible.
- [La flexibilidad compite con el pago (Staffing Industry Analysts, 2025)](https://www.staffingindustry.com/news/global-daily-news/flexibility-beats-pay-as-a-top-2025-nurse-satisfaction-driver) y [el pago rápido como retención](https://www.staffingindustry.com/editorial/staffing-stream/quick-pay-can-keep-more-nursing-professionals-healthcare-staffing).
- [Seguridad personal de quienes trabajan en domicilios (LeadingAge)](https://leadingage.org/hcbs-workers-concerned-about-their-personal-safety-report/) — reputación de la familia y datos de ubicación por etapas.
- [Condiciones laborales del personal de enfermería en Colombia (Universidad del Rosario)](https://urosario.edu.co/noticias/personal-de-enfermeria-y-medicina-presenta-inadecuadas-condiciones-laborales-segun-estudio) y [cobertura de La FM](https://www.lafm.com.co/economia/las-duras-condiciones-laborales-de-las-enfermeras-segun-estudio).
- [Seguridad social del independiente en 2026 (ColombiaMove)](https://colombiamove.com/blog/como-pagar-seguridad-social-independiente-colombia-2026/), [cifras 2026 (El Universal)](https://www.eluniversal.com.co/colombia/2026/01/05/salario-minimo-2026-cuanto-pagaran-los-trabajadores-independientes-por-seguridad-social-en-colombia/), [ARL para independientes](https://colombiatramita.co/salud/arl-independientes/) y [presunción de costos y Decreto 379 de 2026 (INCP)](https://incp.org.co/agendatributariaincp/actualidad/2026/08/presuncion-de-costos-para-independientes-lo-que-cambio-con-el-decreto-379-de-2026-y-como-se-aplica-en-renta/).
- Patrones de ofertas y contraofertas con vencimiento y límite de rondas: [Sharetribe](https://www.sharetribe.com/changelog/offer-updates/) y [eBay «Mejor oferta»](https://www.frooition.com/blog/ebay-best-offer-how-it-works/).
