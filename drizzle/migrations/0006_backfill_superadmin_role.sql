-- Concede el rol superadmin a la cuenta propietaria si ya existía antes del trigger
-- handle_new_user (que solo asigna el rol en el alta). Idempotente; no toca credenciales.
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'superadmin'::public.app_role
FROM auth.users u
WHERE lower(u.email) = 'josefabian1212@gmail.com'
ON CONFLICT DO NOTHING;