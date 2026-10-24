-- Esquema mínimo con la forma de producción (solo lo que toca la migración 20261024100000).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE PUBLICATION supabase_realtime;

CREATE TYPE public.app_role AS ENUM ('superadmin', 'family', 'professional', 'institution');
CREATE TABLE public.user_roles (user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text);
CREATE TABLE public.institution_profiles (user_id uuid PRIMARY KEY, institution_name text);
CREATE TABLE public.care_circle_members (
  owner_id uuid, member_id uuid, status text, can_view_services boolean
);
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL, type text NOT NULL, title text NOT NULL, body text, link text, meta jsonb,
  read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.service_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL, professional_id uuid NOT NULL, status text NOT NULL DEFAULT 'pending',
  scheduled_at timestamptz NOT NULL DEFAULT now(), duration_hours integer NOT NULL DEFAULT 1,
  total_amount integer NOT NULL, payment_mode text NOT NULL DEFAULT 'direct_to_professional'
);
CREATE TABLE public.care_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), booking_id uuid);
CREATE TABLE public.job_offers (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.job_offer_shifts (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
-- Ya publicada en producción: la migración no debe fallar al encontrarla.
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- Funciones de producción (copias de 20261009100000 y 20261010100000).
CREATE FUNCTION public.hx_cop(p_amount numeric) RETURNS text LANGUAGE sql IMMUTABLE
AS $$ SELECT '$' || replace(to_char(round(COALESCE(p_amount, 0)), 'FM999,999,999,999'), ',', '.') $$;
CREATE FUNCTION public.hx_notify(p_user uuid, p_type text, p_title text, p_body text, p_link text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_user IS NULL THEN RETURN; END IF;
  INSERT INTO public.notifications (user_id, type, title, body, link) VALUES (p_user, p_type, p_title, p_body, p_link);
END $$;
CREATE FUNCTION public.party_display_name(p_user uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT NULLIF(btrim(ip.institution_name), '') FROM public.institution_profiles ip WHERE ip.user_id = p_user),
    (SELECT split_part(pr.full_name, ' ', 1) || ' ' || left(split_part(pr.full_name, ' ', 2), 1) || '.'
       FROM public.profiles pr WHERE pr.user_id = p_user),
    'Alguien de Humanix')
$$;
CREATE FUNCTION public.care_watchers(p_client uuid) RETURNS TABLE (watcher_id uuid, is_owner boolean)
LANGUAGE sql STABLE AS $$
  SELECT p_client, true
  UNION
  SELECT m.member_id, false FROM public.care_circle_members m
   WHERE m.owner_id = p_client AND m.status = 'accepted' AND m.can_view_services
     AND m.member_id IS NOT NULL AND m.member_id <> p_client
$$;
