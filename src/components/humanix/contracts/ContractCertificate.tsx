import { CheckCircle2, Fingerprint, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useContractIntegrity, type ContractDetail } from "@/hooks/use-institution-hub";
import { identityMethodLabel } from "@/lib/contractIdentity";

const EVENT_LABEL: Record<string, string> = {
  created: "Contrato generado al aceptar la postulación",
  conditions_updated: "La institución ajustó las condiciones",
  signed: "Firma registrada",
  activated: "Contrato vigente (ambas firmas)",
  declined: "Contrato rechazado",
  expired: "Plazo de firma vencido",
  shift_completed: "Turno completado",
  shift_cancelled: "Turno cancelado",
};

const ROLE_LABEL: Record<string, string> = {
  institution: "Institución",
  professional: "Profesional",
  system: "Sistema",
};

const fmt = (iso: string) =>
  new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Bogota",
  }).format(new Date(iso));

/**
 * Evidencia del contrato: huella de los términos, firmas con su verificación de identidad y la cadena de
 * eventos. «Verificar integridad» recalcula todo en el servidor y avisa si algo fue alterado.
 */
export function ContractCertificate({ detail }: { detail: ContractDetail }) {
  const integrity = useContractIntegrity(detail.id, true);
  const data = integrity.data;

  return (
    <section className="space-y-3 text-xs" aria-label="Evidencia del contrato">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1.5 text-sm font-semibold">
          <Fingerprint className="h-4 w-4 text-biosensor" aria-hidden /> Evidencia verificable
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void integrity.refetch()}
          disabled={integrity.isFetching}
        >
          {integrity.isFetching ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <ShieldCheck className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          )}
          Verificar integridad
        </Button>
      </div>

      {data && (
        <p
          role="status"
          className={
            data.ok
              ? "flex items-start gap-2 rounded-lg border border-ok/40 bg-ok/5 p-2.5 text-ok"
              : "flex items-start gap-2 rounded-lg border border-sos/40 bg-sos/10 p-2.5 text-sos"
          }
        >
          {data.ok ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          )}
          <span>
            {data.ok
              ? `Íntegro: la huella de los términos, ${data.event_count} eventos y las firmas coinciden con lo registrado.`
              : "Atención: se detectó una alteración en el contrato. Contacta a soporte de inmediato."}
          </span>
        </p>
      )}
      {integrity.error && (
        <p className="text-destructive">
          No se pudo verificar la integridad ahora. Inténtalo de nuevo.
        </p>
      )}

      <dl className="space-y-1 rounded-lg border border-border bg-muted/30 p-2.5">
        <div>
          <dt className="text-muted-foreground">Huella de los términos (SHA-256)</dt>
          <dd className="break-all font-mono text-[11px]">{detail.terms_hash}</dd>
        </div>
        <div className="flex flex-wrap gap-x-6">
          <div>
            <dt className="text-muted-foreground">Plantilla</dt>
            <dd>{detail.template_version}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Versión</dt>
            <dd>{detail.version}</dd>
          </div>
        </div>
      </dl>

      <div className="space-y-2">
        <p className="font-medium">Firmas</p>
        {detail.signatures.length === 0 ? (
          <p className="text-muted-foreground">Aún no hay firmas registradas.</p>
        ) : (
          <ul className="space-y-2">
            {detail.signatures.map((s) => (
              <li key={s.party} className="rounded-lg border border-border p-2.5">
                <p className="font-medium">
                  {s.signer_name} · {s.party === "institution" ? "Institución" : "Profesional"}
                </p>
                <p className="text-muted-foreground">{s.signer_identity}</p>
                <p className="text-muted-foreground">
                  {identityMethodLabel(s.identity_method)} · {fmt(s.signed_at)}
                </p>
                <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                  Firma: {s.signature_hash}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-1.5">
        <p className="font-medium">Cadena de eventos</p>
        <ol className="space-y-1 border-l border-border pl-3">
          {detail.events.map((e) => (
            <li key={e.seq} className="relative">
              <span
                className="absolute -left-[17px] top-1.5 h-2 w-2 rounded-full bg-biosensor"
                aria-hidden
              />
              <p>
                {EVENT_LABEL[e.event] ?? e.event}
                <span className="text-muted-foreground">
                  {" "}
                  · {e.actor_role ? (ROLE_LABEL[e.actor_role] ?? e.actor_role) : "Sistema"} ·{" "}
                  {fmt(e.created_at)}
                </span>
              </p>
              <p className="font-mono text-[10px] text-muted-foreground">
                #{e.seq} · {e.hash.slice(0, 16)}…
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
