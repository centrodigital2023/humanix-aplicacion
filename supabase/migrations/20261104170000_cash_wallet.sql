-- Efectivo tipo InDrive con billetera Humanix (aprobado por carlos el 4 nov 2026). Va antes de 20261104180000_breb_escrow.sql.
-- Espejo probado en src/lib/commissionMatrix.ts (`cashAcceptCheck`, `walletHealth`). Pesos colombianos enteros. Idempotente.
--
--  1. Turno mínimo $20.000 (antes $45.000).
--  2. Comisión apartada: al aceptar un turno en efectivo su comisión queda «apartada» hasta que se termina o se cancela. Para
--     aceptar otro, saldo + cupo − lo apartado debe cubrir la nueva comisión. Así la billetera nunca cae por debajo del cupo
--     solo con turnos en efectivo, por muchos que acepte a la vez.
--  3. get_my_wallet devuelve también lo apartado y un estado ('ok' | 'low' | 'credit' | 'blocked') para la pantalla.
--  4. hx_pro_cash_status: la familia sabe, antes de pedir, si ese profesional puede tomar el turno en efectivo (sin ver su saldo).
--  5. Avisos automáticos de billetera: cupo casi agotado, bloqueada y desbloqueada tras recargar.
--
-- No cambia hx_booking_settle (la comisión del efectivo se sigue descontando al pasar a «completed»).

-- ─── 1) Mínimo $20.000 ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hx_min_booking_cop()
RETURNS integer LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT 20000; $$;

CREATE OR REPLACE FUNCTION public.hx_booking_commission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_gross integer;
BEGIN
  IF COALESCE(NEW.total_amount, 0) < public.hx_min_booking_cop() THEN
    RAISE EXCEPTION 'El valor mínimo de un turno es %.', public.hx_cop(public.hx_min_booking_cop()) USING ERRCODE = '23514';
  END IF;
  NEW.platform_fee_pct := public.booking_commission_pct(NEW.professional_id, NEW.client_id);
  v_gross := ROUND(NEW.total_amount * NEW.platform_fee_pct / 100.0)::integer;
  NEW.commission_exempt_cop := public.hx_first_shift_exempt(NEW.professional_id, NEW.client_id, v_gross);
  RETURN NEW;
END $$;

-- ─── 2) Comisión apartada ────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS ix_sb_pro_cash_open ON public.service_bookings (professional_id)
  WHERE payment_method = 'CASH' AND status IN ('confirmed', 'accepted', 'in_route', 'in_progress');

-- Comisiones de turnos en efectivo ya aceptados y sin terminar (sin débito aún). p_exclude: el turno que se está aceptando.
CREATE OR REPLACE FUNCTION public.hx_wallet_reserved(p_professional uuid, p_exclude uuid DEFAULT NULL)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(sum(b.platform_fee_amount), 0)::bigint
    FROM public.service_bookings b
   WHERE b.professional_id = p_professional
     AND b.payment_method = 'CASH'
     AND b.status IN ('confirmed', 'accepted', 'in_route', 'in_progress')
     AND COALESCE(b.platform_fee_amount, 0) > 0
     AND (p_exclude IS NULL OR b.id <> p_exclude)
     AND NOT EXISTS (SELECT 1 FROM public.wallet_movements m WHERE m.booking_id = b.id AND m.kind = 'commission_debit');
$$;

-- Al aceptar: bloqueo si el saldo está por debajo del cupo; en efectivo, saldo + cupo − apartado debe cubrir la comisión.
-- Bloquea la fila de la billetera para que dos aceptaciones a la vez no usen el mismo cupo.
CREATE OR REPLACE FUNCTION public.hx_booking_wallet_gate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_balance bigint; v_limit bigint; v_reserved bigint; v_free bigint; v_fee bigint; v_self boolean;
BEGIN
  IF NEW.status <> 'confirmed' OR (TG_OP = 'UPDATE' AND OLD.status = 'confirmed') THEN RETURN NEW; END IF;
  IF auth.uid() IS NOT NULL AND public.is_staff(auth.uid()) THEN RETURN NEW; END IF;
  INSERT INTO public.wallets (professional_id) VALUES (NEW.professional_id) ON CONFLICT (professional_id) DO NOTHING;
  SELECT w.balance_cop, w.credit_limit_cop INTO v_balance, v_limit
    FROM public.wallets w WHERE w.professional_id = NEW.professional_id FOR UPDATE;
  v_self := auth.uid() = NEW.professional_id;
  IF v_balance < v_limit THEN
    RAISE EXCEPTION '%', CASE WHEN v_self
      THEN format('Tu billetera está por debajo del cupo de %s. Recárgala para volver a recibir turnos.', public.hx_cop(-v_limit))
      ELSE 'Este profesional no puede recibir turnos nuevos por ahora. Elige a otra persona o inténtalo más tarde.' END
      USING ERRCODE = 'P0001', HINT = 'wallet_blocked';
  END IF;
  v_fee := COALESCE(NEW.platform_fee_amount, 0);
  IF NEW.payment_method = 'CASH' AND v_fee > 0 THEN
    v_reserved := public.hx_wallet_reserved(NEW.professional_id, NEW.id);
    v_free := v_balance - v_limit - v_reserved;
    IF v_free < v_fee THEN
      RAISE EXCEPTION '%', CASE WHEN v_self
        THEN format('Para aceptar este turno en efectivo necesitas %s más en tu billetera Humanix%s. Recárgala en segundos con Bre-B.',
                    public.hx_cop(v_fee - GREATEST(v_free, 0)),
                    CASE WHEN v_reserved > 0 THEN format(' (ya tienes %s apartados para otros turnos en efectivo)', public.hx_cop(v_reserved)) ELSE '' END)
        ELSE 'Este profesional necesita recargar su billetera para aceptar un turno en efectivo. Puedes pagar por Bre-B o elegir a otra persona.' END
        USING ERRCODE = 'P0001', HINT = 'wallet_insufficient';
    END IF;
  END IF;
  RETURN NEW;
END $$;
-- El disparador trg_sb_wallet_gate (20261103160000) sigue igual: BEFORE INSERT OR UPDATE OF status.

-- ─── 3) get_my_wallet con lo apartado y un estado ────────────────────────────

-- Umbral de «cupo casi agotado»: menos de $10.000 libres.
CREATE OR REPLACE FUNCTION public.hx_wallet_low_cop()
RETURNS bigint LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT 10000::bigint; $$;

DROP FUNCTION IF EXISTS public.get_my_wallet();
CREATE FUNCTION public.get_my_wallet()
RETURNS TABLE (balance_cop bigint, credit_limit_cop bigint, available_cop bigint, blocked boolean, completed_30d integer,
               commission_pct numeric, reserved_cop bigint, free_cop bigint, health text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (SELECT auth.uid() AS uid),
  w AS (
    SELECT me.uid, COALESCE(w.balance_cop, 0) AS bal, COALESCE(w.credit_limit_cop, -30000) AS lim,
           public.hx_wallet_reserved(me.uid, NULL) AS res
      FROM me LEFT JOIN public.wallets w ON w.professional_id = me.uid
     WHERE me.uid IS NOT NULL
  )
  SELECT w.bal, w.lim, w.bal - w.lim, w.bal < w.lim,
         public.hx_pro_completed_30d(w.uid), public.booking_commission_pct(w.uid, NULL),
         w.res, GREATEST(w.bal - w.lim - w.res, 0),
         CASE
           WHEN w.bal < w.lim THEN 'blocked'
           WHEN w.bal - w.lim - w.res < public.hx_wallet_low_cop() THEN 'low'
           WHEN w.bal < 0 THEN 'credit'
           ELSE 'ok'
         END
    FROM w;
$$;

-- ─── 4) ¿Este profesional puede tomar el turno en efectivo? (para la familia) ─

-- 'ok' | 'needs_topup' (no le alcanza hoy: puede recargar y aceptar) | 'blocked' (no recibe turnos nuevos) | 'too_low' (bajo el mínimo).
-- No expone saldos. Calcula la comisión igual que el disparador, con quien pregunta como contratante.
CREATE OR REPLACE FUNCTION public.hx_pro_cash_status(p_professional uuid, p_total integer)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_bal bigint; v_lim bigint; v_pct numeric; v_gross integer; v_fee integer;
BEGIN
  IF p_professional IS NULL THEN RETURN 'ok'; END IF;
  IF COALESCE(p_total, 0) < public.hx_min_booking_cop() THEN RETURN 'too_low'; END IF;
  SELECT COALESCE(w.balance_cop, 0), COALESCE(w.credit_limit_cop, -30000) INTO v_bal, v_lim
    FROM (SELECT 1) x LEFT JOIN public.wallets w ON w.professional_id = p_professional;
  IF v_bal < v_lim THEN RETURN 'blocked'; END IF;
  v_pct := public.booking_commission_pct(p_professional, auth.uid());
  v_gross := ROUND(p_total * v_pct / 100.0)::integer;
  v_fee := GREATEST(v_gross - public.hx_first_shift_exempt(p_professional, auth.uid(), v_gross), 0);
  IF v_bal - v_lim - public.hx_wallet_reserved(p_professional, NULL) < v_fee THEN RETURN 'needs_topup'; END IF;
  RETURN 'ok';
END $$;

-- ─── 5) Avisos de billetera ──────────────────────────────────────────────────

-- Solo avisa al cruzar un umbral (no en cada movimiento): bloqueo, desbloqueo y «casi en el límite» (este último, una vez
-- hasta la siguiente recarga). Lo libre descuenta lo apartado para otros turnos en efectivo.
CREATE OR REPLACE FUNCTION public.hx_wallet_movement_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_lim bigint; v_before bigint; v_after bigint; v_res bigint; v_free_after bigint;
BEGIN
  SELECT COALESCE(credit_limit_cop, -30000) INTO v_lim FROM public.wallets WHERE professional_id = NEW.professional_id;
  v_lim := COALESCE(v_lim, -30000);
  v_after := NEW.balance_after;
  v_before := NEW.balance_after - NEW.amount_cop;
  v_res := public.hx_wallet_reserved(NEW.professional_id, NEW.booking_id);
  v_free_after := v_after - v_lim - v_res;

  IF v_after < v_lim AND v_before >= v_lim THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (NEW.professional_id, 'wallet_blocked', '🔒 Tu billetera pasó el cupo',
            format('Debes %s. Recarga %s con Bre-B para volver a recibir turnos.', public.hx_cop(-v_after), public.hx_cop(v_lim - v_after)),
            '/dashboard/profesional#billetera');
  ELSIF v_before < v_lim AND v_after >= v_lim THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (NEW.professional_id, 'wallet_unblocked', '🔓 Billetera al día',
            'Ya puedes volver a recibir turnos, también en efectivo.', '/dashboard/profesional#billetera');
  ELSIF NEW.amount_cop < 0 AND v_free_after < public.hx_wallet_low_cop()
        -- Una sola vez por «racha»: no se repite hasta que haya una recarga después del último aviso.
        AND NOT EXISTS (
          SELECT 1 FROM public.notifications n
           WHERE n.user_id = NEW.professional_id AND n.type = 'wallet_low'
             AND n.created_at >= COALESCE((SELECT max(m.created_at) FROM public.wallet_movements m
                                            WHERE m.professional_id = NEW.professional_id AND m.kind = 'topup'), '-infinity'::timestamptz)
        ) THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (NEW.professional_id, 'wallet_low', '⚠️ Tu billetera está casi en el límite',
            format('Te quedan %s para comisiones de turnos en efectivo. Recarga con Bre-B para seguir aceptándolos.',
                   public.hx_cop(GREATEST(v_free_after, 0))),
            '/dashboard/profesional#billetera');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_wallet_movement_notify ON public.wallet_movements;
CREATE TRIGGER trg_wallet_movement_notify AFTER INSERT ON public.wallet_movements
  FOR EACH ROW EXECUTE FUNCTION public.hx_wallet_movement_notify();

-- ─── 6) Permisos ─────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.hx_wallet_reserved(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hx_wallet_movement_notify() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hx_booking_wallet_gate() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hx_booking_commission() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_wallet() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hx_pro_cash_status(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hx_wallet_reserved(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_my_wallet() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hx_pro_cash_status(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hx_min_booking_cop() TO anon, authenticated, service_role;
