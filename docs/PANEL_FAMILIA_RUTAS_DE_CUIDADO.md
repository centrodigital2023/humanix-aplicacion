# Panel de familia: rutas de cuidado (MLP)

Estado: implementado en la rama `feat/familia-rutas-de-cuidado`. Sin migración, sin Edge Function nueva, sin cambio de precios.

## 1. Idea

Una familia no cuida «en general». Cuida a un adulto mayor, a un niño o una niña, a alguien que sale de una cirugía, a alguien enfermo o a alguien con una condición crónica. El panel reconoce la **ruta** (por lo que la familia ya escribió en `family_needs.care_type`, o por elección manual) y cambia ritmo, preguntas y tono. Es un Producto Mínimo Amable: poco, cuidado, emocional y sin presión.

## 2. Qué hay

| Pieza                                                                                                  | Módulo                                                                                                         | Plan                                  |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Ruta de cuidado (5 rutas, sugerida + elegible)                                                         | `src/lib/careJourney.ts`                                                                                       | Todas las familias                    |
| Etapa del episodio (p. ej. posoperatorio: primeros días / 2 semanas / recuperación)                    | `careJourney.ts`                                                                                               | Todas                                 |
| Días con cuidado (contador que solo suma, hitos 7–365)                                                 | `src/lib/careDays.ts`                                                                                          | Todas                                 |
| Qué conviene mirar + «Llama a tu equipo médico el mismo día si…» + 123                                 | `careJourney.ts`                                                                                               | Todas                                 |
| Hoja para la cita (cambios, preguntas, qué llevar)                                                     | `src/lib/visitPrep.ts`                                                                                         | Todas; usa el informe si es Essential |
| Metas pequeñas de la semana (avance, nunca fracaso)                                                    | `careJourney.ts`                                                                                               | Essential (usa partes del turno)      |
| Carta de la semana para compartir con la familia                                                       | `src/lib/weeklyLetter.ts`                                                                                      | Todas; más datos con partes           |
| Momentos memorables (primer día, hitos, días tranquilos; solo buenos recuerdos) + texto para compartir | `src/lib/careMoments.ts`                                                                                       | Todas; más recuerdos con partes       |
| Interfaz                                                                                               | `src/components/humanix/family/CareJourneyCard.tsx`, integrada en `FamilySmartCenter.tsx` (`#ruta-de-cuidado`) | —                                     |

Todo se calcula en el cliente con reservas, partes y necesidades que el panel ya carga.

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
- **Viralidad responsable:** la firma «Enviado desde mi panel de Humanix» es discreta y se puede quitar.

## 4. Investigación y nivel de evidencia

Se revisaron tendencias de cuidado familiar (apps de coordinación de cuidadores, monitoreo remoto, hospital en casa, cuidado posoperatorio guiado, gestión de crónicos, diarios compartidos). Conclusión honesta:

- **Evidencia moderada:** planes de alta posoperatorios con etapas claras y señales de alarma; preparación de la cita médica; coordinación compartida entre cuidadores.
- **Evidencia débil o reportada por proveedores:** gamificación, puntajes de bienestar, predicciones con IA. Por eso aquí no hay puntajes, predicciones ni rachas.
- **Descartado por riesgo:** cualquier cosa que parezca diagnóstico, dosificación o «semáforo de salud».

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

`bun test` / `vitest` sobre `careJourney`, `careDays`, `careMoments`, `weeklyLetter` y `visitPrep` (126 casos, con `careMoments`): rutas, etapas, metas, umbrales, privacidad, tono, estabilidad del texto. Se verificó además por mutación manual (15 de 16 mutantes detectados; el sobreviviente quedó cubierto con una prueba de frontera).
