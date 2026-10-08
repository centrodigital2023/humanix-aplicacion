# Panel Marketplace + PQRS (superadmin)

Ruta: `/superadmin/marketplace`. Toda la lógica de cálculo es pura, explicable y está probada
(`src/lib/marketplaceInsights.ts`, `src/lib/pqrsKpis.ts`, `supabase/functions/_shared/pqrsRules.ts`).
Cuando la muestra es insuficiente el panel dice «Datos insuficientes»: nunca muestra ceros ni valores estimados.

## Por qué el panel mostraba «Ofertas (0) · PQRS (0)»
1. **No existía ningún canal de entrada de PQRS.** Nada en la aplicación insertaba en `pqrs_tickets`, y el formulario de
   `/contacto` solo hacía `console.log` y mostraba «enviado»: los mensajes se perdían. Ahora `/contacto` radica de verdad
   (función `pqrs-intake`), entrega un radicado y permite consultar el estado.
2. **Los errores de consulta se ignoraban**, así que un fallo de permisos o de esquema se veía igual que «no hay datos».
   Ahora el panel muestra un aviso con el error y la migración que falta.
3. Puede que simplemente no haya ofertas publicadas todavía; el panel lo explica en un mensaje aparte.

## Pestaña Resumen
- **Qué atender hoy**: recomendaciones priorizadas (crítico, alto, medio, info) a partir de datos reales.
- **Liquidez**: cobertura a 7/14/30 días, mediana hasta la primera postulación y hasta cubrir, postulaciones por oferta,
  ofertas abiertas sin postulantes (+24 h) y postulaciones sin respuesta del contratante (+48 h).
  *Cobertura a N días* = de las ofertas creadas hace N días o más, la proporción que quedó cubierta dentro de ese plazo
  (postulación aceptada u oferta marcada «cubierta»). Tasas con 5+ ofertas; tiempos con 3+ casos.
- **Oferta y demanda por ciudad** (RPC `marketplace_city_balance`): ofertas abiertas ÷ profesionales disponibles.
  Déficit de profesionales si la relación > 1,5; falta de demanda si < 0,34 con 5+ profesionales; menos de 4 datos = «pocos datos».

## Pestaña Ofertas
- **Prioridad de atención**: urgentes sin candidatos > riesgo alto > sin candidatos > riesgo medio > postulantes por aprobar.
- **Precio frente al mercado**: mediana de ofertas comparables (misma modalidad; ciudad y especialidad si hay 3+ pares).
  Por debajo si < −15 %, por encima si > +25 %. Solo informa: no modifica precios.
- **Calidad de la oferta** (0-100): descripción, especialidad, fecha, requisitos, zona, título y valor.
- **Señales de riesgo**: dinero por adelantado, invitación a evitar la plataforma, datos de contacto o enlaces en el texto
  (desintermediación), precio muy bajo/alto, publicaciones idénticas repetidas, mayúsculas, fecha de inicio vencida.
  Los turnos iguales en fechas distintas (publicación masiva de una IPS) **no** se marcan.
- **Matchmaking explicable** (RPC `suggest_professionals_for_offer`): combina similitud semántica (si la oferta tiene
  embedding) con reglas (especialidad 40, zona 25, disponible 10, RETHUS 10, calificación 10). Cada sugerencia lista
  razones y advertencias. **Invitar** envía una notificación interna (máx. 10 por acción, sin repetir la misma oferta y
  máx. 3 invitaciones por profesional cada 24 h) y queda en auditoría.
- **Moderación** (RPC `moderate_offer`): bloquear con motivo (se avisa al autor y se audita), desbloquear y cerrar.
  Las ofertas bloqueadas ya no se ven en `/buscar` (antes solo se ocultaban en la página de detalle).

## Pestaña PQRS
- **Plazos**: referencia en días hábiles de Colombia (festivos de la Ley Emiliani y Semana Santa calculados, y probados
  para 2026). Petición 15, consulta 30 (Ley 1755 de 2015, art. 14); reclamo de consumidor 15 (Ley 1480 de 2011, art. 58).
  **Es una referencia operativa, no asesoría jurídica**: el texto de la Ley 1755 habla de «días» y la lectura como
  hábiles proviene de la doctrina; el plazo aplicable depende del tipo de solicitud y del solicitante. Valídalo con tu abogado.
- **Objetivo interno de primera respuesta**: urgente 4 h, alta 24 h, normal 48 h, baja 120 h.
- **Riesgo de incumplimiento (0-100)**: heurística explicable (plazo consumido, primera respuesta, prioridad, sentimiento,
  seguridad, sin asignar). No es un modelo estadístico. La cola ordena **primero las señales de seguridad críticas** y
  después por este puntaje.
- **Señales de seguridad** (red determinista, independiente de la IA, prioriza no omitir casos): autolesión, emergencia
  médica, daño físico, acoso/abuso (críticas); hurto, fraude, pago fuera de la plataforma (revisión). La IA nunca baja la
  prioridad que fija esta red. Un falso positivo solo envía el caso a revisión humana.
- **Clasificación IA**: tema (`facturacion`, `servicio`, `seguridad`…), prioridad, sentimiento y resumen. El texto del
  ticket se trata como dato no confiable (delimitado, con instrucción de ignorar órdenes internas) y la salida se valida
  contra listas cerradas.
- **Borrador de respuesta con IA** (`pqrs-assistant`): una persona siempre lo revisa. Una barrera bloquea cualquier mención
  de medios de pago o enlaces externos. Se mide cuántos borradores se envían sin editar.
- **Relacionados / duplicados**: mismo contacto o texto similar en 14 días. Es solo una sugerencia; la fusión la decide una persona.
- **Tendencias**: categorías con ≥3 casos y el doble que la semana anterior se marcan como pico.
- **Gestión**: asignación, estados, historial inmutable (`pqrs_ticket_events`) y exportación CSV (neutraliza fórmulas de hoja de cálculo).
- **Indicadores**: activos, vencidos, en riesgo, mediana de primera respuesta, % resueltos a tiempo, % de borradores IA sin editar.

## Canal público
- `/contacto` → función `pqrs-intake`: validación estricta, campo trampa para bots, límites por IP y por contacto
  (solo hashes), consentimiento de tratamiento de datos, radicado `PQRS-AAAA-NNNNNN` y fecha límite.
  Si el texto sugiere una emergencia se muestra el aviso de llamar al 123 y se notifica al equipo.
- Consulta de estado por radicado + correo (comparación exacta; la respuesta solo se muestra cuando está resuelto).
- La política que permitía insertar tickets directamente desde el navegador se eliminó: permitía forjar estado,
  prioridad, resolución o asignación y no tenía límite de frecuencia.

## Límites conocidos
- `pqrs_tickets` no se publica por Realtime (contiene datos personales): el panel se refresca cada 60 s, al pulsar
  «Actualizar» y cuando llega una notificación de PQRS prioritario.
- No se envía correo automático al solicitante (acuse de recibo): se evitó para no permitir que el formulario público
  se use para enviar correos a terceros. La respuesta se envía con «Enviar por correo» (abre el cliente de correo del equipo).
- El panel analiza las ofertas de los últimos 90 días y las abiertas (hasta 600) y los 500 tickets más recientes.
- Los tiempos hasta cubrir usan `applications.updated_at` de la postulación aceptada (aproximación del momento de aprobación).
- El matchmaking de reglas no valida disponibilidad horaria exacta ni tarifas por modalidad distinta de «por hora».
- No se probó contra una base de datos real ni en un navegador: la validación fue tipos estrictos, ESLint, parser real de
  PostgreSQL para las migraciones, pruebas unitarias y renderizado en servidor con datos de ejemplo.
