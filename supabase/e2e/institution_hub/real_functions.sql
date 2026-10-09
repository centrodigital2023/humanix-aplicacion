CREATE OR REPLACE FUNCTION public.platform_commission_pct(p_user_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_plan   TEXT;
  v_status TEXT;
  v_period_end TIMESTAMPTZ;
BEGIN
  SELECT plan, status, current_period_end
    INTO v_plan, v_status, v_period_end
  FROM public.mp_subscriptions
  WHERE user_id = p_user_id;

  IF v_plan IS NOT NULL
     AND v_status IN ('active', 'approved')
     AND (v_period_end IS NULL OR v_period_end > now())
     AND v_plan IN ('essential_monthly', 'pro_monthly', 'institution_monthly')
  THEN
    RETURN 0; -- no_commission: incluido desde el plan Esencial
  END IF;

  RETURN 12; -- comisión estándar para profesionales en plan Free
END;
$$;

CREATE OR REPLACE FUNCTION public.city_key(p_city text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT btrim(regexp_replace(
    btrim(regexp_replace(
      lower(translate(coalesce(p_city, ''), 'áéíóúüÁÉÍÓÚÜñÑ', 'aeiouuAEIOUUnN')),
      '[^a-z0-9]+', ' ', 'g'
    )),
    '( d c| dc| distrito capital)$', '', 'g'
  ));
$$;
