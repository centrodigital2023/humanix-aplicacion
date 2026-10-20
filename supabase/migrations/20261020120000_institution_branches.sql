-- Sedes de la institución (plan IPS Mejorado): habilita `IpsBranchBilling` en producción. Reemplaza
-- 20260606150000_institution_branches.sql, que nunca se aplicó y tenía estas fallas:
--   1. Cualquier cuenta (también una familia) podía crear «sedes» a su nombre.
--   2. Desde el navegador se podía marcar cualquier sede como principal, borrar la principal o mover una sede a otra cuenta.
--   3. Sin GRANT/REVOKE (anon heredaba acceso), sin límite de longitud ni de cantidad, y `ALTER PUBLICATION` no idempotente.
-- Cómo queda: cada institución ve y administra sus sedes; la principal la crea la base (al crear el perfil de la institución
-- y, para las que ya existen, en esta misma migración) y no se puede borrar ni cambiar desde el navegador; el personal lee
-- todo. Idempotente.

CREATE TABLE IF NOT EXISTS public.institution_branches (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name           text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  city           text        CHECK (city IS NULL OR length(city) <= 80),
  address        text        CHECK (address IS NULL OR length(address) <= 200),
  phone          text        CHECK (phone IS NULL OR length(phone) <= 30),
  is_main        boolean     NOT NULL DEFAULT false,
  status         text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_institution_branches_institution ON public.institution_branches (institution_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_institution_branches_main ON public.institution_branches (institution_id) WHERE is_main;

ALTER TABLE public.institution_branches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.institution_branches FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.institution_branches TO authenticated;
GRANT ALL ON public.institution_branches TO service_role;

DROP POLICY IF EXISTS branches_owner_all ON public.institution_branches;
DROP POLICY IF EXISTS branches_staff_read ON public.institution_branches;
DROP POLICY IF EXISTS branches_read ON public.institution_branches;
CREATE POLICY branches_read ON public.institution_branches FOR SELECT TO authenticated
  USING (institution_id = auth.uid() OR public.is_staff(auth.uid()));
DROP POLICY IF EXISTS branches_insert_own ON public.institution_branches;
CREATE POLICY branches_insert_own ON public.institution_branches FOR INSERT TO authenticated
  WITH CHECK (institution_id = auth.uid() AND public.has_role(auth.uid(), 'institution'::public.app_role));
DROP POLICY IF EXISTS branches_update_own ON public.institution_branches;
CREATE POLICY branches_update_own ON public.institution_branches FOR UPDATE TO authenticated
  USING (institution_id = auth.uid()) WITH CHECK (institution_id = auth.uid());
DROP POLICY IF EXISTS branches_delete_own ON public.institution_branches;
CREATE POLICY branches_delete_own ON public.institution_branches FOR DELETE TO authenticated
  USING (institution_id = auth.uid() AND NOT is_main);

-- Desde el navegador: no se marca ni se desmarca la principal, no se cambia de dueño y hay un tope de 200 sedes.
CREATE OR REPLACE FUNCTION public.guard_institution_branches()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR coalesce(auth.jwt() ->> 'role', '') = 'service_role' THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.is_main := false;
    NEW.created_at := now();
    IF (SELECT count(*) FROM public.institution_branches WHERE institution_id = NEW.institution_id) >= 200 THEN
      RAISE EXCEPTION 'Llegaste al máximo de 200 sedes' USING ERRCODE = '54000';
    END IF;
  ELSE
    NEW.institution_id := OLD.institution_id;
    NEW.is_main        := OLD.is_main;
    NEW.created_at     := OLD.created_at;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_institution_branches() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_institution_branches_updated_at ON public.institution_branches;
DROP TRIGGER IF EXISTS trg_guard_institution_branches ON public.institution_branches;
CREATE TRIGGER trg_guard_institution_branches
  BEFORE INSERT OR UPDATE ON public.institution_branches
  FOR EACH ROW EXECUTE FUNCTION public.guard_institution_branches();

-- Sede principal automática al crear el perfil de una institución.
CREATE OR REPLACE FUNCTION public.create_main_branch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.institution_branches WHERE institution_id = NEW.user_id AND is_main) THEN
    INSERT INTO public.institution_branches (institution_id, name, city, address, is_main)
    VALUES (NEW.user_id, left(COALESCE(NULLIF(btrim(NEW.institution_name), ''), 'Sede principal'), 120),
            left(NEW.city, 80), left(NEW.address, 200), true)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.create_main_branch() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_institution_profiles_main_branch ON public.institution_profiles;
CREATE TRIGGER trg_institution_profiles_main_branch
  AFTER INSERT ON public.institution_profiles
  FOR EACH ROW EXECUTE FUNCTION public.create_main_branch();

-- Instituciones que ya existen: su sede principal (una sola vez).
INSERT INTO public.institution_branches (institution_id, name, city, address, is_main)
SELECT DISTINCT ON (ip.user_id) ip.user_id, left(COALESCE(NULLIF(btrim(ip.institution_name), ''), 'Sede principal'), 120),
       left(ip.city, 80), left(ip.address, 200), true
  FROM public.institution_profiles ip
 WHERE NOT EXISTS (SELECT 1 FROM public.institution_branches ib WHERE ib.institution_id = ip.user_id AND ib.is_main)
   AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = ip.user_id)
 ORDER BY ip.user_id, ip.created_at;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                 WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'institution_branches') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.institution_branches;
  END IF;
END $$;
