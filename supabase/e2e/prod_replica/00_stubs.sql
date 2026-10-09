-- Réplica de la porción de esquema de producción (Lovable Cloud) que usan las migraciones recientes.
-- Solo estructura: sin datos. Extraída de la base real el 2026-10-09 (tablas, restricciones, políticas, disparadores,
-- funciones y privilegios por defecto). SOLO para pruebas locales en un PostgreSQL desechable.
--
-- 00: roles, esquemas auxiliares y privilegios por defecto idénticos a los de Supabase.
\set ON_ERROR_STOP on

DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS realtime;
GRANT USAGE ON SCHEMA public, auth, realtime, extensions TO anon, authenticated, service_role;

-- Privilegios por defecto de Supabase en el esquema public: todo objeto nuevo nace con acceso completo para
-- anon, authenticated y service_role (se comprobó con pg_default_acl). Por eso cada migración debe REVOKE explícito.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;

CREATE TABLE public._realtime_log (id bigserial PRIMARY KEY, payload jsonb, event text, topic text, private boolean);
CREATE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean DEFAULT true)
RETURNS void LANGUAGE sql AS
$$ INSERT INTO public._realtime_log(payload, event, topic, private) VALUES ($1, $2, $3, $4) $$;
CREATE TABLE realtime.messages (id bigserial PRIMARY KEY, topic text, extension text, payload jsonb, private boolean);
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('realtime.topic', true), '') $$;

-- En producción la publicación existe y está vacía.
CREATE PUBLICATION supabase_realtime;
