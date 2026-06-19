-- =========================================================================
-- Plan logic unified: a single source of truth for "what plan is each user on"
-- and helpers to check tier access from SQL policies or edge functions.
--
-- Plans & tiers (higher = more features):
--   free            -> 0
--   essential       -> 1   (essential_monthly)
--   pro             -> 2   (pro_monthly)
--   institution     -> 3   (institution_monthly)
-- =========================================================================

-- 1. Tier enum (stringly ordered using rank function, not PG enum ordering,
--    so we can add tiers later without ALTER TYPE headaches).
CREATE OR REPLACE FUNCTION public.plan_tier_rank(_plan text)
RETURNS integer
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT CASE lower(coalesce(_plan,''))
    WHEN 'essential_monthly'  THEN 1
    WHEN 'essential'          THEN 1
    WHEN 'pro_monthly'        THEN 2
    WHEN 'pro'                THEN 2
    WHEN 'institution_monthly' THEN 3
    WHEN 'institution'        THEN 3
    ELSE 0 -- free / unknown
  END;
$$;

-- 2. cancel_at_period_end so users can downgrade themselves to free at the
--    end of the current billing period without losing what they paid for.
ALTER TABLE public.mp_subscriptions
  ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

-- 3. Resolve the *effective* plan for a user right now.
--    Honours:
--      - mp_subscriptions.status IN ('active','approved') AND
--        (current_period_end IS NULL OR current_period_end > now())
--      - cancel_at_period_end respected after period end
CREATE OR REPLACE FUNCTION public.get_user_plan(_user_id uuid)
RETURNS text
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT plan
      FROM public.mp_subscriptions
      WHERE user_id = _user_id
        AND status IN ('active','approved')
        AND (current_period_end IS NULL OR current_period_end > now())
      ORDER BY updated_at DESC
      LIMIT 1
    ),
    'free'
  );
$$;

-- 4. Boolean gate: does this user have at least the given tier?
CREATE OR REPLACE FUNCTION public.has_plan(_user_id uuid, _min_plan text)
RETURNS boolean
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.plan_tier_rank(public.get_user_plan(_user_id))
       >= public.plan_tier_rank(_min_plan);
$$;

-- 5. User-facing view: plan + days remaining + status (ready to read from RLS).
CREATE OR REPLACE VIEW public.user_plans AS
SELECT
  u.id                                   AS user_id,
  public.get_user_plan(u.id)             AS plan,
  public.plan_tier_rank(public.get_user_plan(u.id)) AS tier,
  s.status,
  s.amount,
  s.currency,
  s.current_period_end,
  s.cancel_at_period_end,
  s.next_payment_at
FROM auth.users u
LEFT JOIN public.mp_subscriptions s ON s.user_id = u.id;

GRANT SELECT ON public.user_plans TO authenticated, anon;

-- 6. RPC: self-service cancel at period end. Keeps benefits until
--    current_period_end; webhook on next period will flip to free naturally.
CREATE OR REPLACE FUNCTION public.cancel_my_subscription()
RETURNS public.mp_subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.mp_subscriptions;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  UPDATE public.mp_subscriptions
     SET cancel_at_period_end = true,
         cancelled_at = now(),
         updated_at = now()
   WHERE user_id = v_uid
   RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'no_subscription';
  END IF;

  -- Drop an in-app notification so the UI reacts in realtime.
  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (
    v_uid,
    'subscription_cancelled',
    'Cancelación programada',
    'Tu plan seguirá activo hasta el final del período vigente. Luego pasarás a Free.',
    '/planes'
  );

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_my_subscription() TO authenticated;

-- 7. RPC: undo cancellation before period ends.
CREATE OR REPLACE FUNCTION public.resume_my_subscription()
RETURNS public.mp_subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.mp_subscriptions;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  UPDATE public.mp_subscriptions
     SET cancel_at_period_end = false,
         cancelled_at = NULL,
         updated_at = now()
   WHERE user_id = v_uid
   RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'no_subscription';
  END IF;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resume_my_subscription() TO authenticated;

-- 8. Realtime: watch mp_subscriptions so the UI knows when MP webhook flips
--    status to active without needing a reload.
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.mp_subscriptions;
  EXCEPTION WHEN duplicate_object OR others THEN
    -- already in publication, ignore
    NULL;
  END;
END $$;
