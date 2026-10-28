-- ═══════════════════════════════════════════════════════════════════════════════
-- DIRECTORIO DE USUARIOS DEL SUPERADMIN (pedido el 2026-10-28): todos los usuarios registrados, profesionales, familias y
-- EPS/IPS, tienen que aparecer en el panel superadministrador.
--
-- Por qué
--   El panel armaba la lista desde `profiles` + `user_roles` en el navegador. Una cuenta sin fila en `profiles` (registro que
--   falló a medias) no salía, y una cuenta sin rol, o el personal de una EPS/IPS (que nunca recibe rol), salía como «family».
--
-- Qué hace
--   `admin_list_users()` parte de `auth.users`, así que devuelve TODAS las cuentas aunque les falte perfil o rol, y suma lo que
--   el superadmin necesita para revisarlas: roles, datos de profesional, datos de la EPS/IPS, documentos pendientes y si es
--   personal de una institución. Solo responde a superadmin, RR. HH. y evaluadores (`is_staff`); a cualquier otro le da error.
--
-- El panel (src/routes/superadmin.index.tsx) la usa y, si todavía no está aplicada, cae a la consulta anterior.
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE (
  user_id              uuid,
  email                text,
  full_name            text,
  avatar_url           text,
  phone                text,
  city                 text,
  created_at           timestamptz,
  last_sign_in_at      timestamptz,
  email_confirmed      boolean,
  has_profile          boolean,
  roles                text[],
  signup_role          text,
  is_institution_staff boolean,
  staff_institution    text,
  pro_specialty        text,
  pro_published        boolean,
  pro_verified         boolean,
  pro_blocked          boolean,
  pro_verification     text,
  institution_name     text,
  institution_type     text,
  institution_verified boolean,
  pending_documents    integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
#variable_conflict use_column
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Solo el equipo de Humanix puede ver el directorio de usuarios' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    COALESCE(p.email, u.email)::text,
    COALESCE(NULLIF(p.full_name, ''), u.raw_user_meta_data->>'full_name')::text,
    p.avatar_url::text,
    COALESCE(NULLIF(p.phone, ''), NULLIF(u.raw_user_meta_data->>'phone', ''))::text,
    COALESCE(NULLIF(p.city, ''), NULLIF(ip.city, ''), NULLIF(pp.home_city, ''), NULLIF(u.raw_user_meta_data->>'city', ''))::text,
    COALESCE(p.created_at, u.created_at),
    u.last_sign_in_at,
    (u.email_confirmed_at IS NOT NULL),
    (p.user_id IS NOT NULL),
    COALESCE((SELECT array_agg(r.role::text ORDER BY r.role::text) FROM public.user_roles r WHERE r.user_id = u.id),
             ARRAY[]::text[]),
    (u.raw_user_meta_data->>'role')::text,
    (m.member_user_id IS NOT NULL OR COALESCE(u.raw_user_meta_data->>'signup_kind', '') = 'institution_staff'),
    mi.institution_name::text,
    pp.specialty::text,
    pp.published,
    pp.verified,
    pp.blocked,
    pp.verification_status::text,
    ip.institution_name::text,
    ip.institution_type::text,
    ip.verified,
    ((SELECT count(*) FROM public.professional_documents d WHERE d.user_id = u.id AND d.status::text = 'pending')
     + (SELECT count(*) FROM public.institution_documents d WHERE d.user_id = u.id AND d.status::text = 'pending'))::integer
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.user_id = u.id
  LEFT JOIN LATERAL (SELECT * FROM public.professional_profiles x WHERE x.user_id = u.id LIMIT 1) pp ON true
  LEFT JOIN LATERAL (SELECT * FROM public.institution_profiles x WHERE x.user_id = u.id LIMIT 1) ip ON true
  LEFT JOIN LATERAL (SELECT * FROM public.institution_members x WHERE x.member_user_id = u.id LIMIT 1) m ON true
  LEFT JOIN LATERAL (SELECT * FROM public.institution_profiles x WHERE x.user_id = m.institution_id LIMIT 1) mi ON true
  WHERE u.deleted_at IS NULL
  ORDER BY COALESCE(p.created_at, u.created_at) DESC;
END
$fn$;

REVOKE ALL ON FUNCTION public.admin_list_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;
