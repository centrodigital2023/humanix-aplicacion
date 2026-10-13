-- ═══════════════════════════════════════════════════════════════════════════════
-- PERSONAL DE LA INSTITUCIÓN · contexto de la persona (2026-10-13), a mínimo privilegio.
--
-- Corrige y completa 20261013120000_institution_members.sql, ya aplicada:
--   1) La política `inst_member_select` dejaba al personal leer la FILA entera de `institution_profiles` (RLS es por fila, no por
--      columna): NIT, representante legal, dirección… Lo que la pantalla necesita es el nombre y la ciudad. Se retira la política y
--      esos dos datos salen de `my_staff_context()`.
--   2) `my_staff_context()`: lo único que la persona del equipo necesita saber de sí misma y de su institución (nombre y ciudad, sus
--      módulos, si está activa y si el plan que habilita al equipo sigue vigente). Una sola llamada, sin leer tablas ajenas.
--   3) `last_seen_at`: «Último acceso» en la lista de personal de la institución (se actualiza como mucho cada 10 minutos).
--   4) `institution_members` e `institution_member_actions` entran en la publicación de Realtime: la institución ve en vivo cuándo
--      entra alguien y qué hace, y la persona suspendida se entera al instante. Realtime respeta RLS (dueña y propia persona).
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1) El personal ya no lee el perfil de la institución ────────────────────────
DROP POLICY IF EXISTS inst_member_select ON public.institution_profiles;

-- ── 2) Último acceso ────────────────────────────────────────────────────────────
ALTER TABLE public.institution_members ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

-- ── 3) Contexto de la persona del equipo ────────────────────────────────────────
-- Solo devuelve la fila de quien llama (nunca la de otra persona). Una persona suspendida SÍ recibe su fila (para poder avisarle),
-- pero sin ningún dato de la institución más allá de su nombre.
CREATE OR REPLACE FUNCTION public.my_staff_context()
RETURNS TABLE (
  member_id uuid, institution_id uuid, institution_name text, institution_city text,
  username text, display_name text, job_title text, modules text[], status text, plan_active boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;

  -- Último acceso: como mucho una vez cada 10 minutos y solo de quien está activa.
  UPDATE public.institution_members m
     SET last_seen_at = now()
   WHERE m.member_user_id = v_uid AND m.status = 'active'
     AND (m.last_seen_at IS NULL OR m.last_seen_at < now() - interval '10 minutes');

  RETURN QUERY
  SELECT m.id, m.institution_id,
         COALESCE(NULLIF(btrim(ip.institution_name), ''), 'Tu institución'),
         CASE WHEN m.status = 'active' THEN ip.city END,
         m.username, m.display_name, m.job_title, m.modules, m.status,
         (m.status = 'active'
          AND public.plan_key_for(m.institution_id) = 'institution_monthly'
          AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = m.institution_id AND ur.role = 'institution'::public.app_role))
    FROM public.institution_members m
    LEFT JOIN public.institution_profiles ip ON ip.user_id = m.institution_id
   WHERE m.member_user_id = v_uid;
END
$fn$;

REVOKE ALL ON FUNCTION public.my_staff_context() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_staff_context() TO authenticated, service_role;

-- ── 4) Realtime ─────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'No existe la publicación supabase_realtime: nada que publicar';
    RETURN;
  END IF;
  FOREACH t IN ARRAY ARRAY['institution_members', 'institution_member_actions'] LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NULL THEN
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_publication_tables
                WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      CONTINUE;
    END IF;
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'No se pudo publicar public.%: %', t, SQLERRM;
    END;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
