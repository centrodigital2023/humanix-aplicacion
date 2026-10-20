# Verificación de la plataforma completa (19 oct 2026)

Esta revisión cubrió las 79 pantallas, los 284 componentes y las 40 funciones de servidor, y comparó el código con la base de producción. Tuvo dos pasadas:

1. **Que funcione:** pruebas, enlaces y piezas que el código usa y la base no tiene.
2. **Que sea adorable (MLP):** cómo le habla la plataforma a la persona cuando algo falla, confirmaciones y accesibilidad.

## 1. Que funcione

| Revisión | Resultado |
| --- | --- |
| Pruebas automáticas | **3 079 de 3 079 pasan.** Las 62 «fallas» anteriores eran del entorno de revisión (un sustituto de `zod`); con `zod` 4 real no queda ninguna |
| Enlaces entre pantallas | 76 destinos distintos en el código y 1 roto: `/politica-privacidad` (onboarding de institución y página EPS/IPS) → **corregido a `/privacidad`**. Los enlaces que escribe la base en las notificaciones apuntan todos a rutas reales |
| Tablas y funciones que el código usa | 101 tablas y 82 funciones revisadas; faltan 15 tablas y 6 funciones en producción (abajo) |

### Piezas sin respaldo en producción

| Pieza | Dónde se ve | Estado |
| --- | --- | --- |
| `health_compliance` | Panel del profesional (vacunas, cursos, póliza) | **Corregido:** la tarjeta se oculta en vez de ofrecer guardar fechas que fallaban |
| `patient_risk_scores`, `vital_signs` | Monitoreo (riesgo del paciente) | **Corregido:** la tarjeta se oculta en vez de ofrecer un cálculo que fallaba |
| `service_contracts`, depósito `documents` | Página del servicio | Ya se ocultaba solo |
| `public_stats` | Portal EPS | Ya tenía respaldo |
| `referrals` y sus 2 funciones | Invitar a un amigo | Ya se ocultaba (15 oct) |
| `wallet_*`, `payout_requests`, `request_payout`, `get_or_create_wallet` | Billetera | Ya se ocultaba (15 oct) |
| `institution_branches` | Facturación por sede | Ya se ocultaba (15 oct) |
| `service_checkins`, depósito `evidence`; `flag_rating`, `respond_to_rating` | `CheckInOut` y `RatingCard` | **Retirados (20 oct):** no se usaban en ninguna pantalla |
| `alert_thresholds`, `rethus_checks` | Funciones de servidor `clinical-alert-notify` y `rethus-weekly-check` | No las llama ningún disparador ni tarea programada |

## 2. Que sea adorable

| Problema | Antes | Ahora |
| --- | --- | --- |
| Mensajes técnicos a las personas | 131 avisos mostraban el texto crudo de la base o de la red («relation … does not exist», «new row violates row-level security», «Failed to fetch») | `friendlyError` traduce cada tipo de fallo a una frase cálida y útil (sin conexión, sesión cerrada, sin permiso, ya registrado, función no disponible, archivo grande…). Los mensajes que escribimos en español para personas pasan tal cual. 18 pruebas |
| Entrar y registrarse | Supabase respondía en inglés («Invalid login credentials», «User already registered») | `friendlyAuthError`: «El correo o la contraseña no coinciden», «Ya existe una cuenta con este correo»… |
| Pantalla de error general | En inglés: «Something went wrong», «Try again», «Go home» | En español y cálida: «Algo se nos enredó por un momento. No es tu culpa y tus datos están a salvo», con botones para reintentar, ir al inicio y escribir a soporte |
| Página no encontrada | Solo «Volver al inicio» | «Ir a mi panel», «Buscar cuidado» y «Volver al inicio» |
| Confirmaciones | Ventana gris del navegador (`confirm`) al borrar documentos o referencias, cerrar ofertas, borrar sedes y en PQRS | Diálogo con el diseño de Humanix (`ConfirmHost` + `confirmAction`): título claro, qué pasará y botón rojo si se borra algo |
| Mensajes fríos | «Error cargando…», «Error eliminando…» (13) | «No pudimos … Inténtalo de nuevo.» |
| Onboarding de familia | Un campo faltante mostraba solo su nombre («Teléfono de emergencia») | «Nos falta un dato para seguir: Teléfono de emergencia» |
| Accesibilidad | 2 botones de solo ícono sin nombre para lectores de pantalla | Con nombre («Quitar esta fila») |

## Pendiente

- Probar cada recorrido en un navegador real con cuentas de prueba de cada rol: este entorno no puede ejecutar la aplicación completa.
- Decidir si se habilitan en la base las piezas ocultas (cumplimiento de salud, riesgo del paciente, billetera, referidos, sedes) o si se retiran del código.
- Las confirmaciones nativas que quedan están solo en el panel interno del superadministrador.
