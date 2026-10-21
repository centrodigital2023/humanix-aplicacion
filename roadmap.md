# Mercado Pago dentro de Humanix
- [x] Pago de 1 mes en /pagar (Payment Brick): tarjeta, PSE (Bancolombia, Nequi y demás bancos) y Efecty.
- [x] Cobro automático mensual con plan asociado (preapproval_plan + preapproval con card_token_id).
- [x] Webhook público en la app: /api/public/mercadopago/webhook, con verificación de firma (sin nuevas Edge Functions).
- [ ] Secretos en Lovable Cloud: MERCADOPAGO_PUBLIC_KEY, MERCADOPAGO_ACCESS_TOKEN y MERCADOPAGO_WEBHOOK_SECRET; requiere valores de la cuenta de Mercado Pago.
- [ ] Webhook en el panel de Mercado Pago con eventos Pagos y Planes y suscripciones.
- [ ] Primer pago real con PSE y con tarjeta.
