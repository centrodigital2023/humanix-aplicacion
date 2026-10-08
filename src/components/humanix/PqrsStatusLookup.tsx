import { useState } from "react";
import { Loader2, Search } from "lucide-react";
import { formatLongDate } from "@/lib/formatDate";
import { lookupPqrsStatus } from "@/lib/pqrs.functions";

const STATUS_LABEL: Record<string, string> = {
  open: "Recibida",
  in_progress: "En trámite",
  resolved: "Resuelta",
  closed: "Cerrada",
};

interface Result {
  found: boolean;
  status?: string;
  due_at?: string | null;
  resolved_at?: string | null;
  resolution?: string | null;
}

const inputClass =
  "w-full px-4 py-2 rounded-lg border border-input bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-biosensor";

export function PqrsStatusLookup() {
  const [radicado, setRadicado] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const data = await lookupPqrsStatus({
        data: { radicado: radicado.trim(), email: email.trim() },
      });
      if (!data.ok) throw new Error(data.error);
      setResult(data as Result);
    } catch {
      setError(
        "No pudimos consultar el estado. Revisa el radicado (PQRS-AAAA-000000) y tu correo, e inténtalo de nuevo.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-3xl border border-border bg-card p-6 sm:p-8">
      <h2 className="text-xl font-bold text-foreground">Consultar el estado de una solicitud</h2>
      <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <div>
          <label htmlFor="status-radicado" className="sr-only">
            Número de radicado
          </label>
          <input
            id="status-radicado"
            required
            value={radicado}
            onChange={(e) => setRadicado(e.target.value)}
            placeholder="PQRS-2026-000123"
            className={`${inputClass} font-mono uppercase`}
            maxLength={20}
          />
        </div>
        <div>
          <label htmlFor="status-email" className="sr-only">
            Correo con el que radicaste
          </label>
          <input
            id="status-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@email.com"
            className={inputClass}
            maxLength={254}
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="px-5 py-2 bg-biosensor text-white rounded-lg font-medium hover:bg-biosensor/90 transition-colors disabled:opacity-60 inline-flex items-center justify-center gap-2"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Search className="h-4 w-4" aria-hidden="true" />
          )}
          Consultar
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {result && (
        <div
          className="mt-4 rounded-xl border border-border bg-background p-4 text-sm"
          role="status"
        >
          {!result.found ? (
            <p>No encontramos una solicitud con ese radicado y correo. Verifica los datos.</p>
          ) : (
            <div className="space-y-2">
              <p>
                Estado: <strong>{STATUS_LABEL[result.status ?? ""] ?? result.status}</strong>
              </p>
              {result.due_at && !result.resolved_at && (
                <p className="text-muted-foreground">
                  Respuesta prevista a más tardar el {formatLongDate(result.due_at)}.
                </p>
              )}
              {result.resolved_at && (
                <p className="text-muted-foreground">
                  Resuelta el {formatLongDate(result.resolved_at)}.
                </p>
              )}
              {result.resolution && (
                <div className="rounded-lg bg-muted/40 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Respuesta
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">{result.resolution}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
