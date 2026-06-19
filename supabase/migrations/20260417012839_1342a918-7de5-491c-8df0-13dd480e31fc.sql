-- 1) Staff invitations: drop public token-based SELECT policy
DROP POLICY IF EXISTS invites_select_by_token ON public.staff_invitations;

-- Secure RPC to redeem an invitation by token (returns role/email if valid)
CREATE OR REPLACE FUNCTION public.redeem_staff_invitation(_token text)
RETURNS TABLE(email text, role public.app_role)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT email, role
  FROM public.staff_invitations
  WHERE token = _token
    AND used_at IS NULL
    AND expires_at > now()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.redeem_staff_invitation(text) FROM public;
GRANT EXECUTE ON FUNCTION public.redeem_staff_invitation(text) TO anon, authenticated;

-- 2) Profiles: remove broad authenticated SELECT exposing email/phone
DROP POLICY IF EXISTS profiles_select_safe_authenticated ON public.profiles;
-- profiles_select_self_or_staff already restricts to owner or staff; keep as-is.
