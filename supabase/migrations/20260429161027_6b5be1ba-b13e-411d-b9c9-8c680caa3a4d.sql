-- Revoke direct EXECUTE from anon/authenticated on internal SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.log_audit(text, text, text, text, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.redeem_staff_invitation(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.staff_get_profile(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_expired_reservations() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_offer_reserved(uuid, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.assign_free_subscription() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bump_conversation_last_message() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.compute_platform_fee() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_conversation_on_accept() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_pro_avg_rating() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM anon, authenticated;