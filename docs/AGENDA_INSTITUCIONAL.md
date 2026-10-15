# Agenda institucional · próximos 7 días

Estado: rama `feat/agenda-institucional`. Sin migración, sin Edge Function nueva y sin cambio de precios. Lógica pura en `src/lib/instAgenda.ts` (probada en `instAgenda.test.ts`), interfaz en `src/components/humanix/EnhancedAgendaModule.tsx` (pestaña «Agenda» del panel de la institución).

## Qué estaba mal

- **Contadores siempre en cero:** todos los turnos se marcaban «programados» y solo se cargaban los futuros, así que «Completados» y «No-show» nunca subían.
- **Acciones que no hacían nada:** cambiar el estado era una simulación («En producción: actualizar en BD») y «Guardar» de las alertas no guardaba nada.
- **Datos falsos o expuestos:** cada turno mostraba «$0», y el detalle mostraba el teléfono personal del profesional.
- **Días en la hora del navegador** en lugar de la de Colombia.
- El archivo tenía `@ts-nocheck` y colores fijos fuera de los tokens.

## Qué hace ahora

Lee los servicios reales de la institución con actualización en vivo (`useInstBookings`), los turnos publicados (`useCoverageOffers`), los títulos de las ofertas y los nombres de los profesionales. Todo se cuenta en días de Colombia.

| Función                                           | Plan         | Regla                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Semana de 7 días con el estado real de cada turno | Todas        | Estado de la base de datos; «Sin iniciar» si un turno confirmado pasó 2 h sin llegada ni inicio; «Sin cerrar» si sigue en curso 12 h después de su fin                                                                                                                                                                                 |
| Contadores                                        | Todas        | Totales (sin cancelados), programados, en curso, completados, sin iniciar y posiciones sin cubrir                                                                                                                                                                                                                                      |
| Alertas explicadas, de la más grave a la más leve | Todas        | Sin iniciar (crítica); empieza en ≤ 60 min y nadie va en camino; sin confirmar a ≤ 24 h; posiciones sin cubrir (urgente a ≤ 48 h); sin cerrar                                                                                                                                                                                          |
| Recordatorio                                      | Todas        | Solo se prepara en WhatsApp (sin número, sin pagos, solo el primer nombre); para turnos confirmados o sin confirmar de las próximas 48 h                                                                                                                                                                                               |
| Riesgo de inasistencia por profesional            | IPS Mejorado | Historial de 60 días con la institución. Riesgo: algún turno sin iniciar o 2 cancelaciones con menos de 12 h de aviso. Observación: 1 cancelación tardía o puntualidad < 70 % (con ≥ 3 llegadas). Confiable: ≥ 3 turnos cumplidos sin problemas. Primer turno: sin historial. Las cancelaciones de la institución no cuentan en contra |
| Utilización de 30 días                            | IPS Mejorado | Cumplimiento, inasistencias, horas registradas frente a contratadas (solo con ambos datos), puntualidad (≥ 3 registros) y día con más turnos cumplidos. Sin datos se muestra «—», nunca un cero inventado                                                                                                                              |
| Exportar CSV e iCal                               | IPS Mejorado | Sin teléfonos ni direcciones. El CSV neutraliza fórmulas (`=`, `+`, `-`, `@`); el iCal va en UTC e incluye solo los turnos activos                                                                                                                                                                                                     |

La nueva función de plan es `inst_agenda_insights` (plan IPS Mejorado). Está registrada en `PLAN_CATALOG` y en `FEATURE_MIN_PLAN`, y aparece en la tarjeta de precios. Sin el plan se muestra qué incluye y un dato real de la cuenta, con un enlace a /planes.

Los cambios de estado de un servicio siguen haciéndose en su página (`/servicio/$bookingId`), donde viven las reglas reales de la máquina de estados.

## Pruebas

32 casos en `src/lib/instAgenda.test.ts`: zona horaria, estados, contadores, cada alerta y sus umbrales, orden, confiabilidad, utilización, CSV, iCal y recordatorio. Además pasaron una revisión por mutación: 13 de 13 errores introducidos a propósito fueron detectados, después de añadir tres pruebas de frontera.

## Pendiente

- Verificación completa en un entorno con dependencias (`tsc`, `eslint`, `vitest`) y revisión en el navegador real. En esta sesión el registro de paquetes estaba bloqueado.
- `AgendaModule` en `InstitutionModules.tsx` es una versión anterior que no se usa en ninguna pantalla; se puede borrar.
