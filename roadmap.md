# Mercado Pago dentro de Humanix
- [x] Pago de 1 mes en /pagar (Payment Brick): tarjeta, PSE (Bancolombia, Nequi y demás bancos) y Efecty.
- [x] Cobro automático mensual con plan asociado (preapproval_plan + preapproval con card_token_id).
- [x] Webhook público en la app: /api/public/mercadopago/webhook, con verificación de firma (sin nuevas Edge Functions).
- [x] Claves guardadas de forma segura; cuenta colombiana verificada (HTTP 200).
- [x] Checkout abierto con sesión real; muestra tarjeta, PSE y Efecty sin errores; webhook sin firma rechazado (401); 31 pruebas aprobadas.
- [ ] Publicar la app y configurar https://humanix.lat/api/public/mercadopago/webhook en Mercado Pago con eventos Pagos y Planes y suscripciones (requiere acción del usuario).
- [ ] Primer pago real con PSE y con tarjeta (requiere autorización y datos de pago del usuario; no se realizaron cobros).

# Mapa de profesionales en vivo
- [x] Actualizar ubicación y estado también para visitantes, con avisos sin datos privados y recarga al reconectar.
- [x] Consultar hasta 500 profesionales visibles con ubicación y mantener actualizado el profesional seleccionado.
- [x] Verificar el mapa público y 111 pruebas; conservar privados los perfiles sin publicar.
- [ ] Verificar movimiento real con un profesional publicado que comparta ubicación (actualmente hay un perfil registrado, ninguno publicado; requiere publicación voluntaria).
