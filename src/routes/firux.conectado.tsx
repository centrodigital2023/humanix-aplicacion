// Regreso desde Firux después de «Conectar con Firux Pay». El servidor valida el `state` de un solo uso y canjea el
// `code` (`completeFiruxConnect`); esta página solo muestra el resultado y lleva al panel.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/humanix/Navbar";
import { supabase } from "@/integrations/supabase/client";
import { completeFiruxConnect } from "@/lib/firux.functions";
import { buildSeo } from "@/lib/seo";

export const Route = createFileRoute("/firux/conectado")({
  validateSearch: (s: Record<string, unknown>) => ({
    code: typeof s.code === "string" ? s.code : "",
    state: typeof s.state === "string" ? s.state : "",
  }),
  head: () =>
    buildSeo({
      noindex: true,
      title: "Conectar con Firux Pay · Humanix",
      path: "/firux/conectado",
      description: "Confirmamos la conexión de tu cuenta Firux.",
    }),
  component: FiruxConectado,
});

type View = { kind: "checking" } | { kind: "ok" } | { kind: "error"; message: string };

function FiruxConectado() {
  const { code, state } = Route.useSearch();
  const [view, setView] = useState<View>({ kind: "checking" });
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    void (async () => {
      if (!code || !state) {
        setView({
          kind: "error",
          message: "Firux no devolvió los datos de la conexión. Vuelve a intentarlo.",
        });
        return;
      }
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setView({
          kind: "error",
          message: "Inicia sesión y vuelve a conectar tu cuenta desde tu panel.",
        });
        return;
      }
      const r = await completeFiruxConnect({ data: { code, state } }).catch(() => null);
      setView(
        r?.ok
          ? { kind: "ok" }
          : { kind: "error", message: r?.message ?? "No pudimos confirmar la conexión." },
      );
    })();
  }, [code, state]);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="mx-auto max-w-lg space-y-4 px-4 py-16 text-center">
        {view.kind === "checking" && (
          <>
            <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary" aria-hidden="true" />
            <h1 className="text-2xl font-bold">Confirmando tu cuenta Firux…</h1>
          </>
        )}
        {view.kind === "ok" && (
          <>
            <CheckCircle2 className="mx-auto h-10 w-10 text-biosensor" aria-hidden="true" />
            <h1 className="text-2xl font-bold">¡Firux Pay conectado!</h1>
            <p className="text-muted-foreground">
              Desde ahora, cuando una familia pague por Bre-B, la plata te llega directo a tu cuenta
              Firux.
            </p>
          </>
        )}
        {view.kind === "error" && (
          <>
            <AlertCircle className="mx-auto h-10 w-10 text-destructive" aria-hidden="true" />
            <h1 className="text-2xl font-bold">No pudimos conectar tu cuenta</h1>
            <p className="text-muted-foreground">{view.message}</p>
          </>
        )}
        {view.kind !== "checking" && (
          <Button asChild>
            <Link to="/dashboard/profesional">Ir a mi panel</Link>
          </Button>
        )}
      </main>
    </div>
  );
}
