-- ═══════════════════════════════════════════════════════════════════════════════
-- TRUST SCORE COMPLETO PARA LOS TRES ROLES (pedido el 2026-10-25): familias, profesionales y EPS/IPS.
--
-- Pedido
--   • Que el puntaje de confianza de la familia funcione completo: cada componente se calcula de verdad y la familia sabe qué le
--     falta (sobre todo en «Identidad entregada»).
--   • El mismo puntaje, con el mismo desglose, en el panel del profesional y en el de la EPS/IPS.
--
-- Qué cambia en `hx_trust_calc` (reemplaza la de 20261012190000; misma firma, así que las listas que ya la usan no cambian)
--   1. PROFESIONALES: ya no devuelven el número de la validación con IA (lo escribía el propio cliente y era nulo hasta validar).
--      Ahora salen con la misma fórmula que familias e instituciones:
--        30 + estrellas de familias e instituciones (0–35, desde 3) + servicios completados (0–15, tope 10)
--        + identidad y credenciales (0–15) + antigüedad (0–5, tope 12 meses) − alertas de fraude sin resolver (tope 50).
--      Identidad y credenciales: cédula cargada en Documentos (5) + RETHUS verificado (5) + perfil validado (5: verificado por
--      Humanix o pre-aprobado por la validación con IA). El número de la validación con IA sigue en el desglose (`ai_validation`).
--   2. LOS TRES ROLES: el desglose trae `identity_parts`, qué pieza de la identidad está entregada y cuál falta, para que la
--      tarjeta «Tu Trust Score» diga exactamente qué completar:
--        familia      → habeas, id_number, id_document
--        institución  → verified, nit, chamber
--        profesional  → id_document, rethus, validated
--
-- Espejo en `src/lib/trustScore.ts` (`computePartyTrust`) y pruebas en `src/lib/trustScore.test.ts`. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.hx_trust_calc(p_user uuid, p_kind text DEFAULT NULL)
RETURNS TABLE (
  kind text, score integer, level text, enough_data boolean, ratings_count integer, stars_avg numeric,
  completed_services integer, verified boolean, source text, components jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
#variable_conflict use_column
DECLARE
  v_kind     text := p_kind;
  v_n        integer := 0;
  v_avg      numeric;
  v_done     integer := 0;
  v_enough   boolean;
  v_rating   integer := 0;
  v_services integer := 0;
  v_ident    integer := 0;
  v_senior   integer := 0;
  v_flags    integer := 0;
  v_verified boolean := false;
  v_since    timestamptz;
  v_ai       integer;
  v_parts    jsonb := '{}'::jsonb;
  v_a        boolean := false;
  v_b        boolean := false;
  v_c        boolean := false;
  v_score    integer;
  v_extra    jsonb := '{}'::jsonb;
BEGIN
  IF p_user IS NULL THEN
    RETURN;
  END IF;
  IF v_kind IS NULL THEN
    v_kind := CASE WHEN public.has_role(p_user, 'professional'::public.app_role) THEN 'professional'
                   WHEN public.has_role(p_user, 'institution'::public.app_role) THEN 'institution'
                   WHEN public.has_role(p_user, 'family'::public.app_role) THEN 'family' END;
  END IF;
  IF v_kind IS NULL OR v_kind NOT IN ('professional', 'institution', 'family') THEN
    RETURN;
  END IF;

  SELECT count(*)::integer, round(avg(sr.stars)::numeric, 2) INTO v_n, v_avg
    FROM public.service_ratings sr WHERE sr.rated_id = p_user;
  SELECT count(*)::integer INTO v_done
    FROM public.service_bookings b
   WHERE b.status = 'completed'
     AND (CASE WHEN v_kind = 'professional' THEN b.professional_id ELSE b.client_id END) = p_user;
  v_enough := v_n >= 3 OR v_done >= 3;

  IF v_kind = 'family' THEN
    SELECT fp.created_at,
           COALESCE(fp.habeas_data_accepted, false),
           NULLIF(btrim(COALESCE(fp.id_number, '')), '') IS NOT NULL,
           NULLIF(btrim(COALESCE(fp.id_doc_url, '')), '') IS NOT NULL
      INTO v_since, v_a, v_b, v_c FROM public.family_profiles fp WHERE fp.user_id = p_user;
    v_a := COALESCE(v_a, false); v_b := COALESCE(v_b, false); v_c := COALESCE(v_c, false);
    v_ident := (CASE WHEN v_a THEN 5 ELSE 0 END) + (CASE WHEN v_b THEN 5 ELSE 0 END) + (CASE WHEN v_c THEN 5 ELSE 0 END);
    v_verified := v_b AND v_c;
    v_parts := jsonb_build_object('habeas', v_a, 'id_number', v_b, 'id_document', v_c);
  ELSIF v_kind = 'institution' THEN
    SELECT ip.created_at,
           COALESCE(ip.verified, false),
           NULLIF(btrim(COALESCE(ip.nit, '')), '') IS NOT NULL,
           NULLIF(btrim(COALESCE(ip.chamber_of_commerce_number, '')), '') IS NOT NULL
      INTO v_since, v_a, v_b, v_c FROM public.institution_profiles ip WHERE ip.user_id = p_user;
    v_a := COALESCE(v_a, false); v_b := COALESCE(v_b, false); v_c := COALESCE(v_c, false);
    v_ident := (CASE WHEN v_a THEN 9 ELSE 0 END) + (CASE WHEN v_b THEN 3 ELSE 0 END) + (CASE WHEN v_c THEN 3 ELSE 0 END);
    v_verified := v_a;
    v_parts := jsonb_build_object('verified', v_a, 'nit', v_b, 'chamber', v_c);
  ELSE
    -- Profesional: cédula cargada (y no rechazada), RETHUS verificado, perfil validado.
    SELECT pp.created_at,
           EXISTS (SELECT 1 FROM public.professional_documents d
                    WHERE d.user_id = p_user AND d.doc_type::text = 'id_document' AND d.status::text <> 'rejected'),
           COALESCE(pp.rethus_verified, false),
           COALESCE(pp.verified, false) OR pp.verification_status = 'verified' OR COALESCE(pp.ai_preapproved, false),
           NULLIF(pp.trust_score, 0),
           COALESCE(pp.rethus_verified, false) OR pp.verification_status = 'verified'
      INTO v_since, v_a, v_b, v_c, v_ai, v_verified FROM public.professional_profiles pp WHERE pp.user_id = p_user;
    v_a := COALESCE(v_a, false); v_b := COALESCE(v_b, false); v_c := COALESCE(v_c, false);
    v_ident := (CASE WHEN v_a THEN 5 ELSE 0 END) + (CASE WHEN v_b THEN 5 ELSE 0 END) + (CASE WHEN v_c THEN 5 ELSE 0 END);
    v_parts := jsonb_build_object('id_document', v_a, 'rethus', v_b, 'validated', v_c);
    v_extra := jsonb_build_object('ai_validation', v_ai);
  END IF;
  v_ident := COALESCE(v_ident, 0);
  v_verified := COALESCE(v_verified, false);

  v_rating := CASE WHEN v_n >= 3 THEN round((v_avg - 1) / 4 * 35)::integer ELSE 0 END;
  v_services := round(LEAST(v_done, 10) * 1.5)::integer;
  v_senior := CASE WHEN v_since IS NULL THEN 0
                   ELSE round(LEAST(GREATEST(extract(epoch FROM (now() - v_since)) / 2592000.0, 0), 12) / 12 * 5)::integer END;

  -- Alertas de fraude sin resolver: restan sin decir el motivo (la tabla puede no existir en una base nueva).
  BEGIN
    SELECT COALESCE(sum(CASE ff.severity::text WHEN 'low' THEN 3 WHEN 'medium' THEN 8 WHEN 'high' THEN 20 ELSE 35 END), 0)::integer
      INTO v_flags FROM public.fraud_flags ff WHERE ff.user_id = p_user AND NOT COALESCE(ff.resolved, false);
  EXCEPTION WHEN undefined_table THEN
    v_flags := 0;
  END;
  v_flags := LEAST(COALESCE(v_flags, 0), 50);

  v_score := GREATEST(0, LEAST(100, 30 + v_rating + v_services + v_ident + v_senior - v_flags));
  RETURN QUERY SELECT v_kind, v_score, public.hx_trust_level(v_score), v_enough, v_n,
                      CASE WHEN v_n >= 3 THEN v_avg END, v_done, v_verified, 'platform'::text,
                      jsonb_build_object('base', 30, 'ratings', v_rating, 'services', v_services, 'identity', v_ident,
                                         'seniority', v_senior, 'adjustments', -v_flags, 'identity_parts', v_parts)
                      || v_extra;
END
$fn$;

REVOKE ALL ON FUNCTION public.hx_trust_calc(uuid, text) FROM PUBLIC, anon, authenticated;
