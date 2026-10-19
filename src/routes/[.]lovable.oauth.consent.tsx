import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

type OAuthResult = {
  data: {
    redirect_url?: string;
    redirect_to?: string;
    client?: { name?: string; client_name?: string };
    redirect_uri?: string;
    scope?: string;
  } | null;
  error: { message: string } | null;
};
type OAuthApi = {
  getAuthorizationDetails: (id: string) => Promise<OAuthResult>;
  approveAuthorization: (id: string) => Promise<OAuthResult>;
  denyAuthorization: (id: string) => Promise<OAuthResult>;
};
const oauth = () => (supabase.auth as unknown as { oauth: OAuthApi }).oauth;

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  head: () => ({ meta: [{ title: "Conectar asistente · Humanix" }, { name: "robots", content: "noindex" }] }),
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Falta el identificador de autorización.");
    const { data } = await supabase.auth.getSession();
    const next = location.pathname + location.searchStr;
    if (!data.session) throw redirect({ to: "/auth", search: { mode: "signin", redirect: next } });
    return { email: data.session.user.email ?? "" };
  },
  loader: async ({ location }) => {
    const id = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await oauth().getAuthorizationDetails(id);
    if (error) throw new Error(error.message);
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    const { data: s } = await supabase.auth.getSession();
    return { details: data, email: s.session?.user.email ?? "" };
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="min-h-screen flex items-center justify-center p-6 bg-background text-foreground">
      <p className="max-w-md text-center text-sm text-muted-foreground">
        No pudimos cargar esta solicitud de conexión (puede haber expirado):{" "}
        {error instanceof Error ? error.message : String(error)}
      </p>
    </main>
  ),
});

const SCOPE_LABELS: Record<string, string> = {
  openid: "Confirmar tu identidad",
  email: "Compartir tu correo",
  profile: "Compartir tu perfil básico",
};

function Consent() {
  const { details, email } = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const client = details?.client?.name ?? details?.client?.client_name ?? "Un asistente";
  const scopes = (details?.scope ?? "").split(" ").filter(Boolean);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const { data, error } = approve
      ? await oauth().approveAuthorization(authorization_id)
      : await oauth().denyAuthorization(authorization_id);
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("El servidor de autorización no devolvió a dónde volver.");
      return;
    }
    window.location.href = target;
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-background text-foreground">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 space-y-4">
        <ShieldCheck className="h-8 w-8 text-primary" />
        <h1 className="font-display text-xl font-bold">Conectar {client} a Humanix</h1>
        <p className="text-sm text-muted-foreground">
          {client} podrá usar Humanix como tú ({email}): leer tus notificaciones, tus servicios y
          ofertas abiertas.
        </p>
        {details?.redirect_uri && (
          <p className="text-xs text-muted-foreground break-all">Destino: {details.redirect_uri}</p>
        )}
        {scopes.length > 0 && (
          <ul className="text-sm list-disc pl-5">
            {scopes.map((s) => (
              <li key={s}>{SCOPE_LABELS[s] ?? `Permiso adicional: ${s}`}</li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          Esto no salta los permisos ni las reglas de seguridad de Humanix.
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex gap-3">
          <Button disabled={busy} onClick={() => decide(true)} className="flex-1">
            Aprobar
          </Button>
          <Button disabled={busy} variant="outline" onClick={() => decide(false)} className="flex-1">
            Cancelar conexión
          </Button>
        </div>
      </div>
    </main>
  );
}
