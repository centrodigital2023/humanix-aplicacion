import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Loader2,
  Mail,
  Lock,
  User,
  Building2,
  HeartHandshake,
  Stethoscope,
  MapPin,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/humanix/Logo";
import { LocationPicker } from "@/components/humanix/LocationPicker";
import { SocialIcons } from "@/components/humanix/SocialIcons";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { role?: Role; redirect?: string; mode?: "signin" | "signup"; ref?: string } => {
    const r = search.role;
    const role: Role | undefined =
      r === "professional" || r === "family" || r === "institution" ? r : undefined;
    const redirect =
      typeof search.redirect === "string" && search.redirect.startsWith("/")
        ? search.redirect
        : undefined;
    const m = search.mode;
    const mode: "signin" | "signup" | undefined =
      m === "signin" || m === "signup" ? m : undefined;
    const ref = typeof search.ref === "string" && /^[A-Z0-9]{6,12}$/i.test(search.ref)
      ? search.ref.toUpperCase()
      : undefined;
    const out: { role?: Role; redirect?: string; mode?: "signin" | "signup"; ref?: string } = {};
    if (role) out.role = role;
    if (redirect) out.redirect = redirect;
    if (mode) out.mode = mode;
    if (ref) out.ref = ref;
    return out;
  },
  head: () => ({
    meta: [
      { title: "Crear cuenta o iniciar sesión · Humanix" },
      {
        name: "description",
        content: "Accede a Humanix como profesional, familia o institución de salud.",
      },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: AuthPage,
});

type Role = "professional" | "family" | "institution";

const roleConfig: Record<
  Role,
  { label: string; desc: string; icon: typeof Stethoscope; accent: string }
> = {
  professional: {
    label: "Profesional",
    desc: "Enfermero, auxiliar o cuidador",
    icon: Stethoscope,
    accent: "biosensor",
  },
  family: {
    label: "Familia",
    desc: "Busco cuidado para un familiar",
    icon: HeartHandshake,
    accent: "copper",
  },
  institution: {
    label: "IPS / Clínica",
    desc: "Publico ofertas para mi institución",
    icon: Building2,
    accent: "fuchsia-neural",
  },
};

function AuthPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [mode, setMode] = useState<"signin" | "signup">(search.mode ?? "signup");
  // Si vino con ?role=professional desde /profesionales, lo respetamos.
  // Si no vino con rol, ocultamos profesional y dejamos solo family/institution.
  const allowProfessional = search.role === "professional";
  const visibleRoles: Role[] = allowProfessional
    ? (["professional", "family", "institution"] as Role[])
    : (["family", "institution"] as Role[]);
  const [role, setRole] = useState<Role>(search.role ?? "family");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [institutionName, setInstitutionName] = useState("");
  const [loading, setLoading] = useState(false);
  const [coords, setCoords] = useState<{ lat: number | null; lng: number | null }>({
    lat: null,
    lng: null,
  });
  const [address, setAddress] = useState("");

  // Email verification step (after signup). Supabase sends a 6-digit OTP code
  // to the email; we must verify it with `verifyOtp` to activate the account.
  const [needsOtp, setNeedsOtp] = useState(false);
  const [otp, setOtp] = useState("");
  const [resending, setResending] = useState(false);

  // Forgot-password flow: request a reset link to the user's email.
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  // Referral code: from URL param or localStorage
  const [refCode, setRefCode] = useState<string | null>(null);

  // Capture referral code on mount
  useEffect(() => {
    const fromUrl = search.ref;
    if (fromUrl) {
      localStorage.setItem("humanix_ref_code", fromUrl);
      setRefCode(fromUrl);
    } else {
      const stored = localStorage.getItem("humanix_ref_code");
      if (stored) setRefCode(stored);
    }
  }, [search.ref]);

  // Redirect if already logged in
  useEffect(() => {
    const target = search.redirect ?? "/dashboard";
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: target });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      if (session) navigate({ to: target });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate, search.redirect]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}${search.redirect ?? "/dashboard"}`,
            data: {
              full_name: fullName,
              phone,
              city,
              role,
              institution_name: institutionName,
              lat: coords.lat ?? undefined,
              lng: coords.lng ?? undefined,
              address: address || undefined,
            },
          },
        });
        if (error) throw error;

        // Aplicar código de referido si existe (fire-and-forget, sin bloquear el flujo)
        if (refCode && data.user?.id) {
          const _code = refCode;
          const _uid = data.user.id;
          void (async () => {
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              await (supabase as any).rpc("apply_referral_code", { p_code: _code, p_new_user_id: _uid });
              localStorage.removeItem("humanix_ref_code");
            } catch { /* silencio — no bloquear el registro */ }
          })();
        }

        // If Supabase project has "Confirm email" enabled, session will be
        // null and user must verify via the OTP code we just emailed.
        if (!data.session) {
          setNeedsOtp(true);
          toast.success(
            "Te enviamos un código de 6 dígitos a tu email. Ingresa el código para activar tu cuenta.",
          );
        } else {
          toast.success("¡Cuenta creada! Bienvenido a Humanix.");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          // Email-not-confirmed surface → push user into OTP step instead of failing.
          if (/not confirmed|email.*confirm/i.test(error.message)) {
            setNeedsOtp(true);
            toast.info(
              "Tu cuenta aún no está verificada. Te reenviamos el código a tu email.",
            );
            await supabase.auth.resend({ type: "signup", email });
            return;
          }
          throw error;
        }
        toast.success("¡Hola de nuevo!");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Algo salió mal";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.length !== 6) {
      toast.error("El código debe tener 6 dígitos");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email,
        token: otp,
        type: "signup",
      });
      if (error) throw error;
      toast.success("¡Email verificado! Bienvenido a Humanix.");
      // onAuthStateChange will redirect.
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Código inválido o expirado";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const resendCode = async () => {
    if (!email) {
      toast.error("Ingresa tu email primero");
      return;
    }
    setResending(true);
    try {
      const { error } = await supabase.auth.resend({ type: "signup", email });
      if (error) throw error;
      toast.success("Código reenviado. Revisa tu bandeja y la carpeta de spam.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo reenviar";
      toast.error(msg);
    } finally {
      setResending(false);
    }
  };

  const requestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      toast.error("Ingresa tu correo");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setForgotSent(true);
      toast.success("Te enviamos un enlace para restablecer tu contraseña.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo enviar el enlace";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground bg-aurora">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-10">
        <div className="flex items-center justify-between gap-3">
          <Logo />
          <Link to="/" className="text-xs sm:text-sm text-muted-foreground hover:text-foreground whitespace-nowrap">
            ← Inicio
          </Link>
        </div>

        <div className="mt-6 sm:mt-10 grid lg:grid-cols-2 gap-8 lg:gap-10 items-start">
          <div className="hidden lg:block sticky top-10">
            <span className="text-xs uppercase tracking-[0.2em] text-biosensor font-semibold">
              Humanix
            </span>
            <h1 className="mt-3 font-display text-3xl xl:text-4xl font-bold leading-tight text-balance">
              Crea tu cuenta y empieza a conectar{" "}
              <span className="text-gradient-bio">en minutos</span>.
            </h1>
            <p className="mt-4 text-muted-foreground leading-relaxed max-w-md">
              Verificación RETHUS, asistente de IA para tu perfil, ofertas en tiempo real y pagos
              inmediatos. Todo en un solo lugar.
            </p>

            <ul className="mt-8 space-y-3 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <span className="mt-2 h-1.5 w-1.5 rounded-full bg-biosensor" />
                Match con familias y clínicas a menos de 150 ms
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-2 h-1.5 w-1.5 rounded-full bg-copper" />
                Trust Score y reputación verificable
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-2 h-1.5 w-1.5 rounded-full bg-fuchsia-neural" />
                Cobros inmediatos en Nequi, PSE y RappiPay (próximamente)
              </li>
            </ul>
          </div>

          <div className="rounded-2xl sm:rounded-3xl border border-border bg-card/95 backdrop-blur-xl shadow-[var(--shadow-elegant)] p-5 sm:p-8">
            {forgotMode ? (
              <div>
                <div className="mb-6 text-center">
                  <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-copper/10 text-copper mb-3">
                    <Lock className="h-7 w-7" />
                  </div>
                  <h2 className="font-display text-2xl font-bold">
                    {forgotSent ? "Revisa tu correo" : "Recuperar contraseña"}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    {forgotSent
                      ? "Te enviamos un enlace seguro para escribir tu nueva contraseña. El enlace expira en 1 hora."
                      : "Ingresa tu correo y te enviaremos un enlace para crear una nueva contraseña."}
                  </p>
                </div>
                {forgotSent ? (
                  <div className="space-y-4">
                    <div className="rounded-xl border border-border bg-muted/40 p-4 text-center">
                      <p className="text-sm font-semibold">{email}</p>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        ¿No llegó? Revisa la carpeta de spam o vuelve a intentarlo.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={() => setForgotSent(false)}
                    >
                      Reenviar a otro correo
                    </Button>
                    <button
                      type="button"
                      onClick={() => {
                        setForgotMode(false);
                        setForgotSent(false);
                      }}
                      className="w-full text-sm text-muted-foreground hover:text-foreground underline underline-offset-2"
                    >
                      ← Volver a iniciar sesión
                    </button>
                  </div>
                ) : (
                  <form onSubmit={requestReset} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="forgot-email">Correo</Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="forgot-email"
                          type="email"
                          autoComplete="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          required
                          className="pl-9"
                          placeholder="tu@email.com"
                          autoFocus
                        />
                      </div>
                    </div>
                    <Button
                      type="submit"
                      variant="hero"
                      size="lg"
                      className="w-full"
                      disabled={loading}
                    >
                      {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Enviar enlace de recuperación
                    </Button>
                    <button
                      type="button"
                      onClick={() => setForgotMode(false)}
                      className="w-full text-sm text-muted-foreground hover:text-foreground underline underline-offset-2"
                    >
                      ← Volver a iniciar sesión
                    </button>
                  </form>
                )}
              </div>
            ) : needsOtp ? (              <div>
                <div className="mb-6 text-center">
                  <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-biosensor/10 text-biosensor mb-3">
                    <ShieldCheck className="h-7 w-7" />
                  </div>
                  <h2 className="font-display text-2xl font-bold">Verifica tu email</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Te enviamos un código de 6 dígitos a{" "}
                    <span className="font-semibold text-foreground">{email}</span>. Ingresa el
                    código para activar tu cuenta.
                  </p>
                </div>
                <form onSubmit={verifyOtp} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="otp">Código de verificación</Label>
                    <Input
                      id="otp"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]*"
                      maxLength={6}
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      required
                      placeholder="123456"
                      className="text-center text-2xl font-mono tracking-[0.6em] h-14"
                      autoFocus
                    />
                  </div>
                  <Button
                    type="submit"
                    variant="hero"
                    size="lg"
                    className="w-full"
                    disabled={loading || otp.length !== 6}
                  >
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Activar cuenta
                  </Button>
                </form>
                <div className="mt-5 pt-5 border-t border-border/60 space-y-2 text-center">
                  <p className="text-xs text-muted-foreground">
                    ¿No llegó el código? Revisa la carpeta de spam.
                  </p>
                  <button
                    type="button"
                    onClick={resendCode}
                    disabled={resending}
                    className="text-sm font-semibold text-foreground hover:text-biosensor underline underline-offset-2 disabled:opacity-50"
                  >
                    {resending ? "Reenviando…" : "Reenviar código"}
                  </button>
                  <div>
                    <button
                      type="button"
                      onClick={() => {
                        setNeedsOtp(false);
                        setOtp("");
                      }}
                      className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                    >
                      ← Cambiar email
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
            <div className="mb-6 text-center">
              <h2 className="font-display text-2xl font-bold">
                {mode === "signup" ? "Crea tu cuenta" : "Bienvenido de nuevo"}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {mode === "signup"
                  ? "Regístrate gratis en menos de 1 minuto"
                  : "Ingresa con tu correo y contraseña"}
              </p>
            </div>
            <div
              role="tablist"
              aria-label="Elige entre crear cuenta o iniciar sesión"
              className="flex items-center gap-1 rounded-xl bg-muted p-1 mb-6"
            >
              <button
                role="tab"
                aria-selected={mode === "signup"}
                onClick={() => setMode("signup")}
                className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition ${
                  mode === "signup"
                    ? "bg-foreground text-background shadow"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Crear cuenta
              </button>
              <button
                role="tab"
                aria-selected={mode === "signin"}
                onClick={() => setMode("signin")}
                className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition ${
                  mode === "signin"
                    ? "bg-foreground text-background shadow"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Iniciar sesión
              </button>
            </div>

            {mode === "signup" && (
              <div className="mb-5">
                <Label className="mb-2 block">¿Cómo te identificas?</Label>
                <div
                  className={`grid gap-2 ${visibleRoles.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}
                >
                  {visibleRoles.map((r) => {
                    const c = roleConfig[r];
                    const Icon = c.icon;
                    const active = role === r;
                    return (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setRole(r)}
                        className={`p-3 rounded-xl border text-left transition ${
                          active
                            ? "border-foreground bg-foreground/5"
                            : "border-border hover:border-foreground/30"
                        }`}
                      >
                        <Icon className={`h-4 w-4 text-${c.accent}`} />
                        <p className="mt-2 text-xs font-semibold">{c.label}</p>
                        <p className="text-[10px] text-muted-foreground leading-tight">{c.desc}</p>
                      </button>
                    );
                  })}
                </div>
                {!allowProfessional && (
                  <p className="text-[11px] text-muted-foreground mt-2">
                    ¿Eres profesional de la salud?{" "}
                    <Link to="/profesionales" className="underline hover:text-foreground">
                      Empieza por aquí
                    </Link>
                    .
                  </p>
                )}
              </div>
            )}

            <form onSubmit={submit} className="space-y-4">
              {mode === "signup" && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="fullName">Nombre completo</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="fullName"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        required
                        className="pl-9"
                        placeholder="María García"
                      />
                    </div>
                  </div>
                  {role === "institution" && (
                    <div className="space-y-1.5">
                      <Label htmlFor="institutionName">Nombre de la institución</Label>
                      <div className="relative">
                        <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="institutionName"
                          value={institutionName}
                          onChange={(e) => setInstitutionName(e.target.value)}
                          required
                          className="pl-9"
                          placeholder="Clínica Reina Sofía"
                        />
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="phone">Teléfono</Label>
                      <Input
                        id="phone"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="3001234567"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="city">Ciudad</Label>
                      <Input
                        id="city"
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                        placeholder="Bogotá"
                      />
                    </div>
                  </div>

                  {/* Ubicación principal de servicio — tarjeta interactiva pequeña
                      que se marca automáticamente con el GPS del dispositivo. */}
                  <div className="rounded-xl border border-border bg-card/60 p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5 text-biosensor" />
                          Ubicación principal de servicio
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          Se marca automáticamente con tu dispositivo. Puedes ajustar tocando el
                          mapa o activar seguimiento en tiempo real.
                        </p>
                      </div>
                    </div>
                    <LocationPicker
                      lat={coords.lat}
                      lng={coords.lng}
                      defaultCity={city || "Bogotá"}
                      height={160}
                      onChange={(lat, lng, addr) => {
                        setCoords({ lat, lng });
                        if (addr && !address) setAddress(addr);
                      }}
                    />
                  </div>
                </>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="email">Correo</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="pl-9"
                    placeholder="tu@email.com"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">Contraseña</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    autoComplete={mode === "signin" ? "current-password" : "new-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    className="pl-9"
                    placeholder="Mínimo 8 caracteres"
                  />
                </div>
                {mode === "signin" && (
                  <div className="text-right">
                    <button
                      type="button"
                      onClick={() => setForgotMode(true)}
                      className="text-xs text-muted-foreground hover:text-biosensor underline underline-offset-2"
                    >
                      ¿Olvidaste tu contraseña?
                    </button>
                  </div>
                )}
              </div>

              <Button type="submit" variant="hero" size="lg" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {mode === "signup" ? "Crear cuenta" : "Iniciar sesión"}
              </Button>
            </form>

            <div className="mt-5 pt-5 border-t border-border/60 text-center">
              {mode === "signup" ? (
                <p className="text-sm text-muted-foreground">
                  ¿Ya tienes cuenta?{" "}
                  <button
                    type="button"
                    onClick={() => setMode("signin")}
                    className="font-semibold text-foreground hover:text-biosensor underline underline-offset-2"
                  >
                    Inicia sesión
                  </button>
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  ¿Aún no tienes cuenta?{" "}
                  <button
                    type="button"
                    onClick={() => setMode("signup")}
                    className="font-semibold text-foreground hover:text-biosensor underline underline-offset-2"
                  >
                    Créala gratis
                  </button>
                </p>
              )}
            </div>

            <p className="mt-4 text-xs text-muted-foreground text-center">
              Al continuar aceptas los términos, política de privacidad y tratamiento de datos
              personales (Habeas Data) de Humanix.
            </p>

            <div className="mt-6 pt-4 border-t border-border">
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70 text-center mb-3">
                Conéctate con Humanix
              </p>
              <div className="flex justify-center">
                <SocialIcons size="sm" />
              </div>
            </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
