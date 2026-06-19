CREATE OR REPLACE FUNCTION public.ad_track(_id uuid, _kind text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _kind NOT IN ('click', 'impression', 'share') THEN
    RAISE EXCEPTION 'invalid kind: %', _kind;
  END IF;

  IF _kind = 'click' THEN
    UPDATE public.ad_banners
      SET clicks = clicks + 1, updated_at = now()
      WHERE id = _id AND active = true;
  ELSIF _kind = 'impression' THEN
    UPDATE public.ad_banners
      SET impressions = impressions + 1, updated_at = now()
      WHERE id = _id AND active = true;
  ELSIF _kind = 'share' THEN
    UPDATE public.ad_banners
      SET shares_count = shares_count + 1, updated_at = now()
      WHERE id = _id AND active = true;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ad_track(uuid, text) TO anon, authenticated;