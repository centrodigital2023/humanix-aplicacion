# Mercado Pago dentro de Humanix
- [x] Pago de 1 mes en /pagar (Payment Brick): tarjeta, PSE (Bancolombia, Nequi y demás bancos) y Efecty.
- [x] Cobro automático mensual con plan asociado (preapproval_plan + preapproval con card_token_id).
- [x] Webhook en la app: /api/mercadopago/webhook (sin Edge Functions).
- [ ] Secretos en Lovable Cloud: MERCADOPAGO_ACCESS_TOKEN y MERCADOPAGO_WEBHOOK_SECRET.
- [ ] Webhook en el panel de Mercado Pago con eventos Pagos y Planes y suscripciones.
- [ ] Primer pago real con PSE y con tarjeta.
