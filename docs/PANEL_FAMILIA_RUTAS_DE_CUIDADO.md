# Panel de familia: rutas de cuidado (MLP)

Estado: implementado en la rama `feat/familia-rutas-de-cuidado`. Sin migración, sin Edge Function nueva, sin cambio de precios.

## 1. Idea

Una familia no cuida «en general». Cuida a un adulto mayor, a un niño o una niña, a alguien que sale de una cirugía, a alguien enfermo o a alguien con una condición crónica. El panel reconoce la **ruta** (por lo que la familia ya escribió en `family_needs.care_type`, o por elección manual) y cambia ritmo, preguntas y tono. Es un Producto Mínimo Amable: poco, cuidado, emocional y sin presión.

## 2. Qué hay

| Pieza                                                                                                  | Módulo                                                                                                                                   | Plan                                  |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Ruta de cuidado (5 rutas, sugerida + elegible)                                                         | `src/lib/careJourney.ts`                                                                                                                 | Todas las familias                    |
| Etapa del episodio (p. ej. posoperatorio: primeros días / 2 semanas / recuperación)                    | `careJourney.ts`                                                                                                                         | Todas                                 |
| Días con cuidado (contador que solo suma, hitos 7–365)                                                 | `src/lib/careDays.ts`                                                                                                                    | Todas                                 |
| Qué conviene mirar + «Llama a tu equipo médico el mismo día si…» + 123                                 | `careJourney.ts`                                                                                                                         | Todas                                 |
| Hoja para la cita (cambios, preguntas, qué llevar)                                                     | `src/lib/visitPrep.ts`                                                                                                                   | Todas; usa el informe si es Essential |
| Metas pequeñas de la semana (avance, nunca fracaso)                                                    | `careJourney.ts`                                                                                                                         | Essential (usa partes del turno)      |
| Carta de la semana para compartir con la familia                                                       | `src/lib/weeklyLetter.ts`                                                                                                                | Todas; más datos con partes           |
| Momentos memorables (primer día, hitos, días tranquilos; solo buenos recuerdos) + texto para compartir | `src/lib/careMoments.ts`                                                                                                                 | Todas; más recuerdos con partes       |
| Interfaz                                                                                               | `src/components/humanix/family/CareJourneyCard.tsx` y `CareHelpHomeCard.tsx`, integradas en `FamilySmartCenter.tsx` (`#ruta-de-cuidado`) | —                                     |

Todo se calcula en el cliente con reservas, partes y necesidades que el panel ya carga.

### 2.1 Rituales que unen (rama `feat/familia-mlp-rituales`)

Tarjeta `src/components/humanix/family/CareRitualsCard.tsx`, debajo de «Casa lista y ayuda del círculo» (`#rituales`). Todas las familias; los sellos del pasaporte que salen de los partes usan los partes que ya carga el plan Esencial. Se guarda solo en el navegador (`localStorage`, con `try/catch`); sin migración.

| Pieza                                                             | Rutas                                 | Módulo                      | Inspiración y evidencia                                                                                                                                                                                                              |
| ----------------------------------------------------------------- | ------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Ritual de hoy (cambia cada día, «lo hicimos», invitar al círculo) | Las cinco                             | `src/lib/careRituals.ts`    | Reminiscencia en personas mayores (ensayos con menos síntomas depresivos justo después; poco seguimiento a largo plazo); compañía y conversación diaria (p. ej. ElliQ, resultados reportados por el proveedor, sin método publicado) |
| Plan «cuando… entonces…» (hasta 3)                                | Adulto mayor, posoperatorio, crónicos | `careRituals.ts`            | Intenciones de implementación: mejor adherencia a la medicación en ensayos pequeños con pacientes; listas y recordatorios de apps ERAS (evidencia limitada, mayoría observacional)                                                   |
| Pasaporte de valentía (9 sellos + certificado)                    | Niño o niña                           | `src/lib/courageStamps.ts`  | Programas pediátricos tipo «Beads of Courage» (cada paso del tratamiento es una cuenta que se guarda)                                                                                                                                |
| ¿Y tú, cómo estás? (clima semanal de quien cuida)                 | Las cinco                             | `src/lib/caregiverPulse.ts` | Intervenciones digitales para cuidadores: menos carga y estrés a corto plazo, efecto moderado; largo plazo incierto                                                                                                                  |

Reglas propias:

- **Rituales no clínicos.** Nada de medicamentos, dosis ni ejercicios prescritos; lo que depende del médico lo dice. Prueba automática.
- **Ritual sin racha.** El contador solo suma, solo se marca el día de hoy y un día futuro no cuenta. En enfermedad, tono sobrio: «Un momento juntos», sin números ni signos de celebración.
- **Plan «cuando… entonces…» organiza, no trata.** Las acciones registran u observan lo que el equipo de salud ya indicó. Catálogo cerrado (sin texto libre).
- **Pasaporte del menor.** El certificado no lleva nombre, fechas, cifras ni datos de salud; el único número es la cantidad de sellos. Lo que falta aparece «por descubrir». Sin plan solo cuentan los días con servicio.
- **Clima de quien cuida.** No es una escala clínica ni un tamizaje; es privado del navegador. Con tormenta muestra apoyo y el 123; con tormenta o dos semanas difíciles seguidas propone «Pedir un relevo al círculo» (lleva a `#ayuda-circulo`). No se cita una línea de salud mental específica hasta confirmarla con el equipo clínico.

Pendiente: revisión clínica de los textos de rituales, acciones del plan y respuestas del clima; confirmar con el equipo clínico si se agrega una línea de apoyo en salud mental para Colombia junto al 123.

## 3. Principios de diseño (decisiones firmes)

- **No diagnostica** ni interpreta síntomas, ni sugiere medicamentos o dosis. Solo ordena y sugiere qué comentar con el equipo de salud. Las señales de alarma son texto fijo y siempre llevan el 123.
- **Sin rachas.** «Días con cuidado» no se reinicia; un hueco no resta. Prueba automática contra lenguaje de racha o pérdida.
- **Tono sobrio en la ruta de enfermedad:** sin metas, sin celebraciones, sin emojis.
- **Metas amables:** se muestra avance («2 de 4»), nunca fallo.
- **Niño o niña:** datos de menor de edad (Ley 1581 de 2012, art. 7). La carta jamás lleva su nombre, ni aunque se pida.
- **Carta honesta:** solo hechos (servicios, horas, comidas, ánimo, avisos). Sin valores de signos vitales, sin pagos, sin contacto. Nunca afirma «todo bien». Si no hay nada que contar, no hay carta.
- **Compartir:** WhatsApp solo prepara el mensaje; la familia decide. Los pagos siguen únicamente por checkout web.
- **Recuerdos solo buenos:** nunca se listan días difíciles, avisos ni signos vitales; en tono sobrio solo aparece el comienzo del acompañamiento.
- **Movimiento con cuidado:** las animaciones usan `motion-safe:` y se apagan con «reducir movimiento».
- **Pedir ayuda sin culpa:** el mensaje nombra días reales y una petición clara; nunca regaña, no lleva nombres, pagos ni datos de salud, y solo se prepara (la familia lo envía).
- **Casa lista es logística:** sin medicamentos ni indicaciones clínicas; el texto de cada ítem requiere revisión clínica antes de publicarse.
- **Cierre con cuidado:** que no haya servicios no prueba que la persona se recuperó ni que esté bien. El cierre es opcional, está en condicional («si este capítulo ya terminó»), nunca afirma recuperación y solo existe en posoperatorio y niño o niña. En adulto mayor, enfermedad y crónicos no hay cierre: un hueco de servicios puede significar cosas muy distintas.
- **Viralidad responsable:** la firma «Enviado desde mi panel de Humanix» es discreta y se puede quitar.

## 4. Investigación y nivel de evidencia

Se revisaron tendencias de cuidado familiar (apps de coordinación de cuidadores, monitoreo remoto, hospital en casa, cuidado posoperatorio guiado, gestión de crónicos, diarios compartidos). Conclusión honesta:

- **Evidencia moderada:** planes de alta posoperatorios con etapas claras y señales de alarma; preparación de la cita médica; coordinación compartida entre cuidadores.
- **Evidencia débil o reportada por proveedores:** gamificación, puntajes de bienestar, predicciones con IA. Por eso aquí no hay puntajes, predicciones ni rachas.
- **Descartado por riesgo:** cualquier cosa que parezca diagnóstico, dosificación o «semáforo de salud».

**Evidencia de lo añadido:** la preparación del alta y la coordinación entre cuidadores tienen apoyo moderado en la literatura; las revisiones sobre apoyo a cuidadores señalan que los programas con varios componentes ayudan más que una sola medida, y que los resultados del descanso (respiro) son mixtos. Por eso estas piezas no prometen resultados de salud: facilitan organizarse y pedir ayuda.

## 5. Pendiente antes de publicar

1. **Revisión clínica** de los textos `callSameDay`, `watch` y `visitQuestions` de las cinco rutas.
2. **Confirmación legal** del tratamiento de datos de menores y del aviso `LETTER_SHARE_NOTICE`.
3. Verificación completa en un entorno con dependencias: `tsc`, `eslint`, `vitest` y revisión visual en navegador (en la sesión de desarrollo solo se pudieron correr las pruebas de la lógica pura).

## 6. Hoja de ruta (requiere migración, consentimiento o revisión clínica)

- Tablero de tareas del círculo familiar (quién hace qué): borrador de migración **sin probar** en [`propuestas/care_circle_tasks.sql.md`](./propuestas/care_circle_tasks.sql.md); no está conectado a la interfaz.
- Consentimiento granular por persona para compartir la carta.
- Ruta y contador persistentes en base de datos (hoy la ruta se recuerda en el navegador).
- Registro de ánimo del propio cuidador y descanso del cuidador.
- Resumen para el médico exportable con consentimiento.

## 7. Pruebas

`bun test` / `vitest` sobre `careJourney`, `careDays`, `careMoments`, `weeklyLetter` y `visitPrep` (188 casos, con `careMoments`, `careHomeReady`, `helpRequest` y `careChapter`; más 54 casos de `careRituals`, `courageStamps` y `caregiverPulse`, revisados por mutación manual: 8 de 8 mutantes detectados tras añadir una prueba de frontera): rutas, etapas, metas, umbrales, privacidad, tono, estabilidad del texto. Se verificó además por mutación manual (15 de 16 mutantes detectados; el sobreviviente quedó cubierto con una prueba de frontera).
