import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Loader2, Lock, ShieldCheck, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/humanix/Logo";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Restablecer contraseña · Humanix" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [validLink, setValidLink] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  // Supabase recovery links open this page with a session already established
  // (onAuthStateChange emits PASSWORD_RECOVERY). Newer links use ?code=... that
  // the client exchanges automatically via detectSessionInUrl.
  useEffect(() => {
    let recoveryFired = false;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        recoveryFired = true;
        setValidLink(true);
        setReady(true);
      } else if (event === "SIGNED_IN" && session) {
        // After exchanging the recovery code, session exists. Only treat as
        // valid recovery if URL hints suggest it (hash/type/code present).
        const url = new URL(window.location.href);
        const hasHint =
          url.searchParams.has("code") ||
          url.hash.includes("type=recovery") ||
          url.hash.includes("access_token");
        if (hasHint) {
          setValidLink(true);
          setReady(true);
        }
      }
    });

    // Fallback: if nothing fires within 1.5s, check current session.
    const t = setTimeout(async () => {
      if (recoveryFired) return;
      const { data } = await supabase.auth.getSession();
      setValidLink(Boolean(data.session));
      setReady(true);
    }, 1500);

    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(t);
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("La contraseña debe tener al menos 8 caracteres");
      return;
    }
    if (password !== confirm) {
      toast.error("Las contraseñas no coinciden");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
      toast.success("Contraseña actualizada. Ya puedes iniciar sesión.");
      setTimeout(() => {
        supabase.auth.signOut().finally(() => navigate({ to: "/auth", search: { mode: "signin" } }));
      }, 1500);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo actualizar");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground bg-aurora">
      <div className="mx-auto max-w-md px-4 sm:px-6 py-10">
        <div className="flex items-center justify-between">
          <Logo />
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
            ← Volver al inicio
          </Link>
        </div>

        <div className="mt-10 rounded-3xl border border-border bg-card/95 backdrop-blur-xl shadow-[var(--shadow-elegant)] p-6 sm:p-8">
          <div className="mb-6 text-center">
            <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-biosensor/10 text-biosensor mb-3">
              {done ? <CheckCircle2 className="h-7 w-7" /> : <ShieldCheck className="h-7 w-7" />}
            </div>
            <h1 className="font-display text-2xl font-bold">
              {done ? "¡Contraseña actualizada!" : "Nueva contraseña"}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {done
                ? "Te estamos redirigiendo para que inicies sesión."
                : "Escribe tu nueva contraseña. Se aplicará de inmediato en todos tus dispositivos."}
            </p>
          </div>

          {!ready ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin inline mr-2" />
              Validando enlace…
            </div>
          ) : !validLink ? (
            <div className="space-y-4 text-center">
              <p className="text-sm text-muted-foreground">
                El enlace de recuperación es inválido o ha expirado. Solicita uno nuevo desde la
                pantalla de inicio de sesión.
              </p>
              <Button asChild variant="hero" size="lg" className="w-full">
                <Link to="/auth" search={{ mode: "signin" }}>
                  Solicitar enlace nuevamente
                </Link>
              </Button>
            </div>
          ) : done ? (
            <Button asChild variant="hero" size="lg" className="w-full">
              <Link to="/auth" search={{ mode: "signin" }}>
                Ir a iniciar sesión
              </Link>
            </Button>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="password">Nueva contraseña</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    className="pl-9"
                    placeholder="Mínimo 8 caracteres"
                    autoFocus
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm">Confirmar contraseña</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="confirm"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    minLength={8}
                    className="pl-9"
                    placeholder="Repite la contraseña"
                  />
                </div>
              </div>
              <Button type="submit" variant="hero" size="lg" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Actualizar contraseña
              </Button>
              <p className="text-[11px] text-muted-foreground text-center">
                Al guardar se cerrarán las sesiones activas por seguridad.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
