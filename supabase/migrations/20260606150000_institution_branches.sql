-- ──────────────────────────────────────────────────────────────────────────
-- Plan "IPS Mejorado" — cobro por sucursales (sedes).
-- Modela las sedes de una institución para que el cálculo de facturación
-- (ver src/lib/plans.ts → INSTITUTION_BILLING / calculateInstitutionBilling)
-- tenga una fuente de verdad real en BD en vez de un contador manual.
-- Precio: COP 299.000 base (incluye 1 sede) + COP 50.000 por sede adicional.
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.institution_branches (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  city            TEXT,
  address         TEXT,
  phone           TEXT,
  is_main         BOOLEAN     NOT NULL DEFAULT false,
  status          TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_institution_branches_institution
  ON public.institution_branches (institution_id);

-- Solo una sede principal por institución
CREATE UNIQUE INDEX IF NOT EXISTS uq_institution_branches_main
  ON public.institution_branches (institution_id) WHERE is_main = true;

ALTER TABLE public.institution_branches ENABLE ROW LEVEL SECURITY;

CREATE POLICY branches_owner_all ON public.institution_branches
  FOR ALL USING (institution_id = auth.uid());

CREATE POLICY branches_staff_read ON public.institution_branches
  FOR SELECT USING (public.is_staff(auth.uid()));

DROP TRIGGER IF EXISTS trg_institution_branches_updated_at ON public.institution_branches;
CREATE TRIGGER trg_institution_branches_updated_at
  BEFORE UPDATE ON public.institution_branches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.institution_branches;

-- Crea automáticamente la sede principal cuando una institución completa su perfil
CREATE OR REPLACE FUNCTION public.create_main_branch()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.institution_branches (institution_id, name, city, address, is_main)
  VALUES (NEW.user_id, COALESCE(NEW.institution_name, 'Sede principal'), NEW.city, NEW.address, true)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_institution_profiles_main_branch ON public.institution_profiles;
CREATE TRIGGER trg_institution_profiles_main_branch
  AFTER INSERT ON public.institution_profiles
  FOR EACH ROW EXECUTE FUNCTION public.create_main_branch();

-- Backfill: crear sede principal para instituciones existentes que aún no tengan una
INSERT INTO public.institution_branches (institution_id, name, city, address, is_main)
SELECT ip.user_id, ip.institution_name, ip.city, ip.address, true
FROM public.institution_profiles ip
WHERE NOT EXISTS (
  SELECT 1 FROM public.institution_branches ib WHERE ib.institution_id = ip.user_id
);
