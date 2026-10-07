// Página de acceso exclusiva para administradores.
// Flujo de 3 fases: credenciales → código de acceso → superadmin panel.
// El código nunca se valida en el frontend; va al edge function verify-admin-access.
import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2, Lock, Mail, ShieldCheck, Eye, EyeOff, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { name: "robots", content: "noindex,nofollow,noarchive" },
      { title: "Acceso restringido" },
    ],
  }),
  component: AdminLogin,
});

type Phase = "credentials" | "code" | "loading";

function AdminLogin() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [codeDigits, setCodeDigits] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const codeRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Si ya tiene sesión de superadmin activa, ir directo al panel.
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      const { data: roleRow } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", data.session.user.id)
        .eq("role", "superadmin")
        .maybeSingle();
      if (roleRow) navigate({ to: "/superadmin", replace: true });
    });
  }, [navigate]);

  // ── Fase 1: credenciales ─────────────────────────────────────────────────
  const submitCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { data, error: authErr } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (authErr || !data.session) {
        setError("Correo o contraseña incorrectos.");
        return;
      }
      // Verificar que tenga rol superadmin antes de mostrar el campo de código.
      const { data: roleRow } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", data.session.user.id)
        .eq("role", "superadmin")
        .maybeSingle();
      if (!roleRow) {
        await supabase.auth.signOut();
        setError("Esta cuenta no tiene permisos de administrador.");
        return;
      }
      setUserId(data.session.user.id);
      setPhase("code");
      setTimeout(() => codeRefs.current[0]?.focus(), 120);
    } catch {
      setError("Error de conexión. Intenta otra vez.");
    } finally {
      setBusy(false);
    }
  };

  // ── Fase 2: código de acceso ─────────────────────────────────────────────
  const verifyCode = async (digits: string[]) => {
    const code = digits.join("");
    if (code.length !== 6 || !userId) return;
    setBusy(true);
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke(
        "verify-admin-access",
        { body: { code, user_id: userId } },
      );
      if (fnErr || !data?.ok) {
        setError(data?.error ?? "Código incorrecto.");
        if (typeof data?.remaining_attempts === "number") setRemaining(data.remaining_attempts);
        setCodeDigits(["", "", "", "", "", ""]);
        setTimeout(() => codeRefs.current[0]?.focus(), 80);
        return;
      }
      setPhase("loading");
      await new Promise((r) => setTimeout(r, 600));
      navigate({ to: "/superadmin", replace: true });
    } catch {
      setError("Error de verificación. Intenta otra vez.");
    } finally {
      setBusy(false);
    }
  };

  const handleDigit = (idx: number, val: string) => {
    if (!/^\d*$/.test(val)) return;
    const digit = val.slice(-1);
    const next = codeDigits.map((d, i) => (i === idx ? digit : d));
    setCodeDigits(next);
    if (digit && idx < 5) codeRefs.current[idx + 1]?.focus();
    if (next.every((d) => d !== "")) verifyCode(next);
  };

  const handleKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !codeDigits[idx] && idx > 0) {
      const next = codeDigits.map((d, i) => (i === idx - 1 ? "" : d));
      setCodeDigits(next);
      codeRefs.current[idx - 1]?.focus();
    } else if (e.key === "ArrowLeft" && idx > 0) codeRefs.current[idx - 1]?.focus();
    else if (e.key === "ArrowRight" && idx < 5) codeRefs.current[idx + 1]?.focus();
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (text.length >= 4) {
      const next = Array.from({ length: 6 }, (_, i) => text[i] ?? "");
      setCodeDigits(next);
      const last = Math.min(text.length - 1, 5);
      codeRefs.current[last]?.focus();
      if (text.length === 6) verifyCode(next);
    }
  };

  // ── Loading splash ───────────────────────────────────────────────────────
  if (phase === "loading") {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#030712] gap-4">
        <div className="relative">
          <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-violet-600 to-fuchsia-600 flex items-center justify-center shadow-2xl shadow-violet-900/60">
            <ShieldCheck className="h-8 w-8 text-white" aria-hidden="true" />
          </div>
          <span className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-emerald-500 border-2 border-[#030712] animate-pulse" />
        </div>
        <p className="text-sm font-semibold text-white/60 tracking-widest uppercase">Acceso verificado</p>
        <Loader2 className="h-5 w-5 animate-spin text-violet-400 mt-1" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-auto bg-[#030712] px-4 py-10">
      {/* Glow fondo */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 h-[600px] w-[600px] rounded-full bg-violet-700/20 blur-[120px]" />
        <div className="absolute top-1/2 right-0 h-64 w-64 rounded-full bg-fuchsia-700/15 blur-[80px]" />
      </div>

      <div className="relative w-full max-w-sm">
        {/* Logo / marca */}
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-gradient-to-br from-violet-600 to-fuchsia-600 shadow-2xl shadow-violet-900/60 mb-4">
            <ShieldCheck className="h-7 w-7 text-white" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-bold text-white tracking-tight">Panel de Administración</h1>
          <p className="mt-1 text-xs text-white/40 tracking-wide uppercase">Humanix · Acceso restringido</p>
        </div>

        {/* Card */}
        <div className="rounded-3xl border border-white/[0.08] bg-white/[0.04] p-8 shadow-2xl backdrop-blur-xl">

          {/* ── FASE 1: credenciales ── */}
          {phase === "credentials" && (
            <form onSubmit={submitCredentials} className="space-y-5" noValidate>
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-white/50 uppercase tracking-wider">
                  Correo electrónico
                </label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" aria-hidden="true" />
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@humanix.lat"
                    className="w-full rounded-xl border border-white/10 bg-white/[0.06] pl-10 pr-4 py-3 text-sm text-white placeholder:text-white/20 outline-none focus:border-violet-500/60 focus:ring-1 focus:ring-violet-500/40 transition"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold text-white/50 uppercase tracking-wider">
                  Contraseña
                </label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" aria-hidden="true" />
                  <input
                    type={showPw ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-xl border border-white/10 bg-white/[0.06] pl-10 pr-10 py-3 text-sm text-white placeholder:text-white/20 outline-none focus:border-violet-500/60 focus:ring-1 focus:ring-violet-500/40 transition"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPw((p) => !p)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition"
                    aria-label={showPw ? "Ocultar contraseña" : "Mostrar contraseña"}
                  >
                    {showPw ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                  </button>
                </div>
              </div>

              {error && (
                <p role="alert" className="text-xs font-semibold text-red-400 bg-red-500/10 rounded-lg px-3 py-2 border border-red-500/20">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={busy || !email || !password}
                className="w-full rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 py-3 text-sm font-bold text-white shadow-lg shadow-violet-900/40 transition hover:opacity-90 active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Ingresar →"}
              </button>
            </form>
          )}

          {/* ── FASE 2: código de acceso ── */}
          {phase === "code" && (
            <div className="space-y-6">
              <div className="text-center">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-500/10 border border-violet-500/20 mb-3">
                  <Lock className="h-5 w-5 text-violet-400" aria-hidden="true" />
                </div>
                <p className="text-base font-bold text-white">Código de acceso</p>
                <p className="mt-1 text-xs text-white/40">Ingresa el código de 6 dígitos para confirmar.</p>
              </div>

              <div
                className="flex justify-center gap-2"
                onPaste={handlePaste}
                role="group"
                aria-label="Código de administrador"
              >
                {codeDigits.map((digit, idx) => (
                  <input
                    key={idx}
                    ref={(el) => { codeRefs.current[idx] = el; }}
                    type="tel"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleDigit(idx, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(idx, e)}
                    disabled={busy}
                    aria-label={`Dígito ${idx + 1}`}
                    className={`h-13 w-11 rounded-xl border text-center text-xl font-bold outline-none transition disabled:opacity-50 ${
                      digit
                        ? "border-violet-500/60 bg-violet-500/10 text-violet-300"
                        : "border-white/10 bg-white/[0.04] text-white focus:border-violet-500/50 focus:bg-violet-500/5"
                    }`}
                    style={{ height: "52px" }}
                  />
                ))}
              </div>

              {busy && (
                <div className="flex justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-violet-400" aria-hidden="true" />
                </div>
              )}

              {error && (
                <p role="alert" className="text-xs font-semibold text-red-400 bg-red-500/10 rounded-lg px-3 py-2 border border-red-500/20 text-center">
                  {error}
                  {remaining !== null && remaining > 0 && (
                    <span className="block mt-0.5 text-white/30">{remaining} intento{remaining === 1 ? "" : "s"} restante{remaining === 1 ? "" : "s"}</span>
                  )}
                </p>
              )}

              <button
                type="button"
                onClick={() => {
                  supabase.auth.signOut();
                  setPhase("credentials");
                  setCodeDigits(["", "", "", "", "", ""]);
                  setError(null);
                  setUserId(null);
                }}
                className="flex w-full items-center justify-center gap-1.5 text-xs text-white/30 hover:text-white/60 transition"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                Volver a credenciales
              </button>
            </div>
          )}
        </div>

        {/* Pie discreto */}
        <p className="mt-6 text-center text-[10px] text-white/15 tracking-widest uppercase select-none">
          Humanix · Sistema de gestión interno
        </p>
      </div>
    </div>
  );
}
