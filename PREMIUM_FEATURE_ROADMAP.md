# Hoja de ruta de funciones premium

Prioridad: primero confiabilidad (P0, en gran parte hecho), después valor inmediato, diferenciación y escala. **Ninguna función premium nueva se implementó en esta entrega**: antes se corrigieron los riesgos reales.

## Ya existe en el código (revisar y reforzar, no reconstruir)
Ofertas y postulaciones (`job_offers`, `applications`), propuestas de horario (`slot_proposals`, `ProposalsInbox`), agenda del profesional, check-in/out (`service_checkins`, `CheckInOut`), calificaciones (`service_ratings`), favoritos/referidos (`ReferralCard`), documentos con vigencia, monitoreo clínico y alertas, mapa en vivo, planes y créditos IA, panel institucional.

## P1 — valor inmediato
1. ~~Recontratación de un clic~~ (hecho: `RehireCard`).
2. ~~Favoritos~~ (hecho: `care_favorites`); falta el círculo de cuidado con familiares.
3. ~~Agenda sin doble reserva~~ (hecho: `guard_booking_integrity`).
4. ~~Contacto protegido por etapas~~ (hecho para el profesional: dirección y WhatsApp solo con plan de pago + postulación + cupo diario, auditado; falta el equivalente para la familia hacia el profesional).
5. ~~Calificación por dimensiones y bilateral~~ (hecho: `service_rating_dimensions`, formulario y promedios públicos con mínimo de 3).
6. ~~Reemplazo cuando un profesional cancela~~ (hecho: aviso + búsqueda de candidatos libres, favoritos primero + propuesta en un clic).
7. ~~Semáforo de cobertura~~ (hecho en `/dashboard/institucion`); falta vencimiento de documentos.
8. ~~Desglose transparente de precio~~ (hecho en propuestas y en el servicio).
9. ~~Círculo de cuidado con familiares~~ (hecho: invitación por correo, solo lectura de servicios).

## P2 — diferenciación
Matching explicable, agenda predictiva, IA de resumen y filtros, check-in con código, centro de continuidad, panel ejecutivo, pool institucional.

## P3 — condicionado a datos y validación
Predicción de cancelación/demanda, wearables, voz, API institucional, expansión regional.

## Reglas
La IA sugiere, prepara y resume; no diagnostica, no cobra, no cambia contratos ni precios sin confirmación humana.

## Implementado: centro de mando de Marketplace + PQRS
Inspirado en prácticas observadas en plataformas de personal sanitario y mesas de ayuda (la evidencia es mayormente de
proveedores, no de estudios independientes):
- Cobertura por cohorte y tiempos a primera postulación y a cubrir; desequilibrio oferta/demanda por ciudad con umbrales mínimos de muestra.
- Matchmaking explicable con invitación; precio frente al mercado como sugerencia (sin cambiarlo automáticamente).
- Credenciales y riesgo de oferta antes de publicar a profesionales (desintermediación, cobros por adelantado).
- Mesa de ayuda con plazos legales en días hábiles reales, riesgo de incumplimiento explicable, detección de duplicados
  como sugerencia, borradores de respuesta con revisión humana y medición de aceptación, tendencias con detección de picos.
- Señales de seguridad deterministas por encima de la IA.

Siguiente: acuse de recibo por correo con dominio verificado, SLA por cliente/segmento, aprendizaje de umbrales con
histórico propio (modo sombra antes de automatizar), cobros dinámicos solo como sugerencia, y panel público de estado.

## Implementado: hub de oportunidades del profesional
Agenda de familias con turnos (horas contiguas agrupadas), compatibilidad explicada, detección de cruces, neto después de
comisión, negociación acotada (3 rondas, vencimiento, punto medio sugerido, referencia de mercado), reputación agregada de
la familia, desbloqueo auditado de dirección y WhatsApp, alertas en vivo, planificador de ingresos con aportes estimados y
calificación a la familia con comentario privado. Documentación, constantes espejo y límites en
`docs/PROFESIONAL_HUB_OPORTUNIDADES.md`.

Siguiente: avisos informativos por WhatsApp Business (nunca pagos), mediación de disputas, vencimiento de documentos como
requisito para postularse, matching semántico en el hub, tabla privada para direcciones de `job_offers` y verificación
cruzada de turnos recurrentes (contratos semanales) con renovación en un clic.

## Implementado: hub de instituciones, negociación y contrato inteligente
Agenda de turnos de EPS, IPS, clínicas, hospitales y geriátricos para el profesional (sin dirección; compatibilidad
explicada; reputación de la institución), postulación y negociación acotada (también la institución contraoferta),
desbloqueo auditado de dirección y WhatsApp con plan de pago, **centro de cobertura** para la institución (riesgo por turno,
siguiente mejor acción con su motivo, SLA de respuesta), publicación de turnos con repetición por días y turnos de noche,
**invitar al equipo de confianza**, calificación y comentario en ambos sentidos y **contrato inteligente** con identidad
validada de las dos partes (RETHUS / NIT + representante legal), código al correo, aceptación explícita, huella del texto y
cadena de evidencia verificable. Documentación en `docs/INSTITUCION_HUB_CONTRATO_INTELIGENTE.md`.

Siguiente (por valor y esfuerzo): agradecimientos y reconocimientos tras un turno cumplido, metas y rachas de turnos
cumplidos, tarjeta verificada compartible con enlace de referido, reemplazo automático cuando un profesional cancela
(sugerir a favoritos disponibles), recibo/factura electrónica por turno cumplido, firma digital certificada como opción,
poderes de firma por sede, avisos informativos por WhatsApp Business (nunca pagos) y renovación de contratos recurrentes
en un clic.

## Implementado: lazo de cuidado (familia ↔ profesional ↔ institución)
Producto mínimo **amable**: el parte del turno en vivo une a los tres actores. La familia ve cómo va su ser querido «en palabras»
(resumen, semáforo, ánimo, signos vitales con su rango, alertas), recibe aviso al comenzar y al terminar y puede invitar a un
**círculo de cuidado** en solo lectura. El profesional registra en un toque (atajos, ánimo, signos vitales), cierra el turno con
una nota cálida y construye una **trayectoria** verificable (nivel, sellos, racha, familias que vuelven) con pasaporte
imprimible (Pro). La institución ve los turnos en vivo con alertas primero, un parte auditable y un **plan B automático** que
invita a su equipo de confianza cuando el profesional cancela. «Gracias» en ambos sentidos con reconocimientos de una lista
cerrada (separados de las calificaciones) y bucles virales sin datos de salud, nombres ni pagos. Historia de cuidado exportable
a Excel (Esencial). Se corrigió además la bitácora original (inserciones falsificables, resumen abierto a cualquiera,
compositor sin montar). Documentación en `docs/LAZO_DE_CUIDADO.md`; suite en `supabase/e2e/care_loop/`.

Aplicado en la base de producción el 2026-10-09 (8 migraciones, con simulacro previo y prueba de humo revertida). Al contrastar
con la estructura real se corrigieron además tres fallos que ya afectaban a los usuarios: el **chat no enviaba mensajes**, la
tarjeta **«Contactar» fallaba** y **HR/evaluadores podían leer los partes de salud**. La nueva interfaz llega a los usuarios al
**publicar** el sitio en Lovable (acción aparte).

Siguiente (por valor y esfuerzo): avisos informativos por WhatsApp Business (nunca pagos), fotos del parte con consentimiento
explícito (Ley 1581), umbrales de signos vitales por paciente, resumen semanal para la familia y el círculo, informe mensual
para la EPS/IPS (cumplimiento + alertas), calificación de la experiencia del círculo y reemplazo asistido con un clic desde
el equipo de confianza.
