// Página de activación del primer superadmin.
// Solo funciona si no existe ningún superadmin en la plataforma.
// Requiere: sesión activa + secreto de bootstrap configurado en Supabase env.
import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/humanix/Logo";
import { supabase } from "@/integrations/supabase/client";
import { useAppUser } from "@/hooks/use-app-user";
import { toast } from "sonner";

export const Route = createFileRoute("/superadmin/activar")({
  head: () => ({ meta: [{ title: "Activar Superadmin · Humanix" }, { name: "robots", content: "noindex,nofollow" }] }),
  component: ActivarSuperadmin,
});

function ActivarSuperadmin() {
  const { user, loading } = useAppUser({ requireAuth: true, allow: undefined });
  const navigate = useNavigate();
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const activate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!secret.trim()) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("bootstrap-superadmin", {
        body: { secret: secret.trim() },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setDone(true);
      toast.success("¡Superadmin activado! Redirigiendo al panel…");
      setTimeout(() => navigate({ to: "/superadmin" }), 1500);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo activar");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-5 text-center">
        <ShieldCheck className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">Inicia sesión primero para activar el panel.</p>
        <Button onClick={() => navigate({ to: "/auth" })}>Iniciar sesión</Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-5">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-2">
          <Logo />
          <h1 className="font-display text-2xl font-bold mt-4">Activar Superadmin</h1>
          <p className="text-sm text-muted-foreground">
            Introduce el secreto de bootstrap configurado en Supabase para activar el panel de
            administración.
          </p>
        </div>

        {done ? (
          <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/30 p-6 text-center space-y-2">
            <ShieldCheck className="h-10 w-10 text-emerald-500 mx-auto" />
            <p className="font-semibold">¡Panel activado!</p>
            <p className="text-sm text-muted-foreground">Redirigiendo…</p>
          </div>
        ) : (
          <form onSubmit={activate} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="secret">Secreto de activación</Label>
              <div className="relative">
                <KeyRound className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="secret"
                  type="password"
                  className="pl-9"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder="••••••••••••"
                  autoFocus
                  required
                />
              </div>
            </div>

            <div className="rounded-xl bg-muted/40 border border-border px-4 py-3 text-xs text-muted-foreground space-y-1">
              <p><span className="font-semibold text-foreground">Sesión activa:</span> {user.email}</p>
              <p>Solo funciona si no existe ningún superadmin en la plataforma.</p>
            </div>

            <Button type="submit" variant="hero" className="w-full gap-2" disabled={busy || !secret}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Activar panel de administración
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
