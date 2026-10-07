# Hoja de ruta de funciones premium

Prioridad: primero confiabilidad (P0, en gran parte hecho), después valor inmediato, diferenciación y escala. **Ninguna función premium nueva se implementó en esta entrega**: antes se corrigieron los riesgos reales.

## Ya existe en el código (revisar y reforzar, no reconstruir)
Ofertas y postulaciones (`job_offers`, `applications`), propuestas de horario (`slot_proposals`, `ProposalsInbox`), agenda del profesional, check-in/out (`service_checkins`, `CheckInOut`), calificaciones (`service_ratings`), favoritos/referidos (`ReferralCard`), documentos con vigencia, monitoreo clínico y alertas, mapa en vivo, planes y créditos IA, panel institucional.

## P1 — valor inmediato
1. ~~Recontratación de un clic~~ (hecho: `RehireCard`).
2. ~~Favoritos~~ (hecho: `care_favorites`); falta el círculo de cuidado con familiares.
3. ~~Agenda sin doble reserva~~ (hecho: `guard_booking_integrity`).
4. Contacto protegido por etapas (datos visibles solo tras aprobación).
5. Calificación por dimensiones y bilateral.
6. Reemplazo rápido cuando un profesional cancela.
7. Semáforo de cobertura y vencimiento de documentos para IPS/EPS.
8. Desglose transparente de precio (valor, comisión, total).

## P2 — diferenciación
Matching explicable, agenda predictiva, IA de resumen y filtros, check-in con código, centro de continuidad, panel ejecutivo, pool institucional.

## P3 — condicionado a datos y validación
Predicción de cancelación/demanda, wearables, voz, API institucional, expansión regional.

## Reglas
La IA sugiere, prepara y resume; no diagnostica, no cobra, no cambia contratos ni precios sin confirmación humana.
