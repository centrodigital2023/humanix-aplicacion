-- Ajuste de permisos de Bre-B tras revisar producción contra 20261103160000_breb_wallet_commission.sql.
--
-- 1. professional_payout_keys: la tabla nació con los privilegios por defecto, y en producción `authenticated` conserva
--    TRUNCATE, REFERENCES y TRIGGER (la migración solo concedió SELECT/INSERT/UPDATE/DELETE sin revocar antes).
--    TRUNCATE no pasa por RLS: se quita. Las llaves Bre-B son datos de pago de cada profesional.
-- 2. hx_first_shift_exempt: la app no la llama desde el navegador (la usa el disparador hx_booking_commission, que es
--    SECURITY DEFINER). Abierta a `authenticated`, permitía preguntar por cualquier par de ids si quien contrata se
--    registró hace menos de 90 días y si ya terminó un turno con ese profesional. Queda solo para service_role.
--
-- Idempotente: se puede correr más de una vez.

REVOKE ALL ON public.professional_payout_keys FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.professional_payout_keys TO authenticated;
GRANT ALL ON public.professional_payout_keys TO service_role;

REVOKE ALL ON FUNCTION public.hx_first_shift_exempt(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hx_first_shift_exempt(uuid, uuid, integer) TO service_role;
