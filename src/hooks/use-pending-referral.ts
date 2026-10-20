// Aplica el código de referido guardado (enlace ?ref=) en cuanto hay sesión. El servidor usa auth.uid(), así que con
// confirmación por correo el código espera en localStorage hasta que la persona entra (OTP, enlace del correo o Google).
// Se borra con cualquier respuesta del servidor; ante un error de red se reintenta en la próxima sesión.

import { useEffect } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { isFinalApplyResult, normalizeReferralCode, PENDING_REFERRAL_KEY } from "@/lib/referrals";

const sb = supabase as unknown as SupabaseClient;

function readPending(): string | null {
  try {
    return normalizeReferralCode(localStorage.getItem(PENDING_REFERRAL_KEY));
  } catch {
    return null;
  }
}

function clearPending() {
  try {
    localStorage.removeItem(PENDING_REFERRAL_KEY);
  } catch {
    /* sin almacenamiento: nada que borrar */
  }
}

export function usePendingReferral() {
  useEffect(() => {
    let inFlight = false;
    const tryApply = async () => {
      const code = readPending();
      if (!code) {
        clearPending();
        return;
      }
      if (inFlight) return;
      inFlight = true;
      try {
        const { data, error } = await sb.rpc("apply_referral_code", { p_code: code });
        if (!error && isFinalApplyResult(data)) clearPending();
      } finally {
        inFlight = false;
      }
    };

    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) void tryApply();
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) void tryApply();
    });
    return () => sub.subscription.unsubscribe();
  }, []);
}
