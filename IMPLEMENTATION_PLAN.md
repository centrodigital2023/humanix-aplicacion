# Plan de implementación

## Fase 1 — Estabilización (en curso)
- [x] `humanix-ai-chat` → `humanix-assistant`
- [x] Sin riesgo simulado ni `open_rate` aleatorio
- [x] `mp-webhook` idempotente y trazable
- [x] WhatsApp sin enlaces de pago (`paymentGuard`)
- [x] `bootstrap-superadmin` eliminada
- [x] Logs de ejecución y tarjeta de salud en `/superadmin`
- [ ] Aplicar migraciones y secretos en Supabase (manual)
- [ ] Pruebas con sandbox de Mercado Pago
- [ ] Pruebas automatizadas de RLS
- [ ] `EPSDashboard` con datos reales; retirar `VitalSignsMonitor` simulado
- [ ] Decidir el disparador de `apply-referral-reward`

## Fase 2 — Confianza y operación
Recontratación, favoritos, doble reserva, contacto protegido, calificaciones por dimensiones.

## Fase 3 — IPS/EPS
Cobertura de turnos, reemplazos, documentos con vencimiento, reportes ejecutivos.

## Fase 4 — Inteligencia
Matching explicable, resúmenes, predicción de cobertura.

## Fase 5 — Escala
Multiempresa, API, facturación institucional.

## Cómo verificar
`bun install && bun run test && bun run lint && bun run build` en una máquina con acceso al registro.
