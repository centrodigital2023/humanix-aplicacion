import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  FileSignature,
  Loader2,
  MapPin,
  PenLine,
  Printer,
  Settings2,
  UserRound,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { instKeys, useSmartContract, type ContractDetail } from "@/hooks/use-institution-hub";
import {
  contractStatusLabel,
  isSignableStatus,
  renderContract,
  signatureCountdown,
  type ContractParty,
} from "@/lib/contractTemplate";
import { classifyHubError, formatShiftRange, type ServerError } from "@/lib/opportunities";
import { MODALITY_LABEL } from "@/lib/institutionNegotiation";
import { formatCOP } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { ContractCertificate } from "./ContractCertificate";
import { ContractConditionsForm } from "./ContractConditionsForm";
import { ContractSignFlow } from "./ContractSignFlow";

const sb = supabase as unknown as SupabaseClient;

const STATUS_STYLE: Record<string, string> = {
  pending_signature: "bg-warn/15 text-warn",
  partially_signed: "bg-warn/15 text-warn",
  active: "bg-ok/15 text-ok",
  completed: "bg-ok/15 text-ok",
  declined: "bg-sos/15 text-sos",
  cancelled: "bg-muted text-muted-foreground",
  expired: "bg-muted text-muted-foreground",
};

interface Props {
  contractId: string;
  userId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function partyOf(detail: ContractDetail, userId: string): ContractParty | null {
  if (userId === detail.institution_user_id) return "institution";
  if (userId === detail.professional_id) return "professional";
  return null;
}

function Summary({ detail }: { detail: ContractDetail }) {
  const t = detail.terms;
  if (!t) return null;
  const inst = t.parties.institution;
  const pro = t.parties.professional;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="rounded-lg bg-muted/40 p-3 text-xs">
        <p className="mb-1 flex items-center gap-1.5 font-semibold text-foreground">
          <UserRound className="h-3.5 w-3.5" aria-hidden /> Partes
        </p>
        <p>
          <strong>{inst.name}</strong>
          {inst.nit ? ` · NIT ${inst.nit}` : ""}
          {inst.legal_representative ? ` · Rep. legal: ${inst.legal_representative}` : ""}
        </p>
        <p className="mt-1">
          <strong>{pro.name}</strong>
          {pro.specialty ? ` · ${pro.specialty}` : ""}
          {pro.rethus_number ? ` · RETHUS ${pro.rethus_number}` : ""}
        </p>
      </div>
      <div className="rounded-lg bg-muted/40 p-3 text-xs">
        <p className="mb-1 flex items-center gap-1.5 font-semibold text-foreground">
          <Wallet className="h-3.5 w-3.5" aria-hidden /> Valor
        </p>
        <p>
          {formatCOP(t.economics.agreed_amount)} {MODALITY_LABEL[t.economics.modality]} · Total{" "}
          <strong>{formatCOP(t.economics.total_amount)}</strong>
        </p>
        <p className="mt-1 text-muted-foreground">
          {t.economics.commission_pct > 0
            ? `Comisión Humanix ${t.economics.commission_pct}%: el profesional recibe ≈ ${formatCOP(t.economics.professional_net)}.`
            : "Sin comisión de Humanix: el profesional recibe el total."}
        </p>
      </div>
      <div className="rounded-lg bg-muted/40 p-3 text-xs sm:col-span-2">
        <p className="mb-1 flex items-center gap-1.5 font-semibold text-foreground">
          <MapPin className="h-3.5 w-3.5" aria-hidden /> Servicio
        </p>
        <p>
          {t.object.title}
          {t.object.service_area ? ` · ${t.object.service_area}` : ""}
          {t.object.city ? ` · ${t.object.city}` : ""}
        </p>
        {t.object.address && <p className="text-muted-foreground">{t.object.address}</p>}
      </div>
    </div>
  );
}

function ShiftsTable({ detail }: { detail: ContractDetail }) {
  if (detail.shifts.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-lg border border-border text-xs">
      <table className="w-full">
        <caption className="sr-only">Turnos del contrato</caption>
        <thead className="bg-muted/40 text-left text-muted-foreground">
          <tr>
            <th scope="col" className="p-2 font-medium">
              #
            </th>
            <th scope="col" className="p-2 font-medium">
              Horario
            </th>
            <th scope="col" className="p-2 text-right font-medium">
              Valor
            </th>
            <th scope="col" className="p-2 font-medium">
              Estado
            </th>
          </tr>
        </thead>
        <tbody>
          {detail.shifts.map((s) => (
            <tr key={s.id} className="border-t border-border">
              <td className="p-2">{s.shift_no}</td>
              <td className="p-2">
                <Clock className="mr-1 inline h-3 w-3 text-muted-foreground" aria-hidden />
                {formatShiftRange(s.starts_at, s.ends_at)}
              </td>
              <td className="p-2 text-right tabular-nums">{formatCOP(s.amount)}</td>
              <td className="p-2">
                {s.booking_id ? (
                  <Link
                    to="/servicio/$bookingId"
                    params={{ bookingId: s.booking_id }}
                    className="text-biosensor hover:underline"
                  >
                    {s.status === "scheduled"
                      ? "Programado"
                      : s.status === "completed"
                        ? "Cumplido"
                        : s.status === "cancelled"
                          ? "Cancelado"
                          : s.status}
                  </Link>
                ) : (
                  s.status
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Signatures({ detail }: { detail: ContractDetail }) {
  const rows: Array<{ party: ContractParty; label: string }> = [
    { party: "institution", label: "Institución" },
    { party: "professional", label: "Profesional" },
  ];
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {rows.map(({ party, label }) => {
        const sig = detail.signatures.find((s) => s.party === party);
        return (
          <li
            key={party}
            className={cn(
              "rounded-lg border p-3 text-xs",
              sig ? "border-ok/40 bg-ok/5" : "border-dashed border-border",
            )}
          >
            <p className="flex items-center gap-1.5 font-semibold">
              {sig ? (
                <CheckCircle2 className="h-4 w-4 text-ok" aria-hidden />
              ) : (
                <PenLine className="h-4 w-4 text-muted-foreground" aria-hidden />
              )}
              {label}: {sig ? "firmó" : "pendiente"}
            </p>
            {sig && (
              <p className="mt-0.5 text-muted-foreground">
                {sig.signer_name} ·{" "}
                {new Intl.DateTimeFormat("es-CO", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: "America/Bogota",
                }).format(new Date(sig.signed_at))}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Contrato inteligente de turnos: términos, condiciones, firma con identidad validada y evidencia. */
export function SmartContractDialog({ contractId, userId, open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const query = useSmartContract(contractId, open);
  const detail = query.data;
  const party = detail ? partyOf(detail, userId) : null;
  const rendered = useMemo(() => {
    if (!detail?.terms) return null;
    try {
      return renderContract(detail.terms);
    } catch {
      return null;
    }
  }, [detail?.terms]);
  const [tab, setTab] = useState("resumen");
  const [editing, setEditing] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");

  const decline = useMutation({
    mutationFn: async () => {
      const { error } = await sb.rpc("decline_contract", {
        p_contract_id: contractId,
        p_reason: reason.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Rechazaste el contrato", { description: "La otra parte fue avisada." });
      setDeclining(false);
      void qc.invalidateQueries({ queryKey: ["inst"] });
    },
    onError: (error) => toast.error(classifyHubError(error as ServerError).message),
  });

  const signedByAny = (detail?.signatures.length ?? 0) > 0;
  const canEditConditions =
    party === "institution" &&
    detail?.status === "pending_signature" &&
    !signedByAny &&
    !!detail.terms;
  const countdown =
    detail && isSignableStatus(detail.status)
      ? signatureCountdown(detail.signature_deadline)
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
            <FileSignature className="h-5 w-5 text-biosensor" aria-hidden />
            Contrato inteligente
            {detail && (
              <span className="text-sm font-normal text-muted-foreground">
                {detail.contract_no}
              </span>
            )}
            {detail && (
              <Badge
                className={cn(
                  "border-0 text-[10px]",
                  STATUS_STYLE[detail.status] ?? "bg-muted text-muted-foreground",
                )}
              >
                {contractStatusLabel(detail.status)}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            Acuerdos, turnos, tiempo, valor y condiciones de ambas partes. Se firma aceptando de
            forma explícita y validando la identidad de los dos.
            {countdown && (
              <span className="mt-1 flex items-center gap-1.5 text-warn">
                <CalendarClock className="h-3.5 w-3.5" aria-hidden /> {countdown}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {query.isLoading ? (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : query.error || !detail ? (
          <p className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />
            {query.error
              ? "No pudimos cargar el contrato. Inténtalo de nuevo."
              : "No encontramos este contrato o no eres parte de él."}
          </p>
        ) : !party ? (
          <p className="text-sm text-muted-foreground">No eres parte de este contrato.</p>
        ) : (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="resumen" className="text-xs sm:text-sm">
                Resumen y firma
              </TabsTrigger>
              <TabsTrigger value="texto" className="text-xs sm:text-sm">
                Texto completo
              </TabsTrigger>
              <TabsTrigger value="evidencia" className="text-xs sm:text-sm">
                Evidencia
              </TabsTrigger>
            </TabsList>

            {/* Montado siempre: al ir a leer el texto completo no se pierden el código ni las aceptaciones. */}
            <TabsContent
              value="resumen"
              forceMount
              className="space-y-4 data-[state=inactive]:hidden"
            >
              <Summary detail={detail} />
              <ShiftsTable detail={detail} />
              <Signatures detail={detail} />

              {detail.status === "declined" && (
                <p className="rounded-lg border border-sos/40 bg-sos/10 p-3 text-xs text-sos">
                  Este contrato fue rechazado. Escríbele a la otra parte por el chat de la reserva
                  para aclarar las condiciones; la institución puede ajustar y generar uno nuevo
                  desde una nueva postulación.
                </p>
              )}
              {detail.status === "expired" && (
                <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                  El plazo para firmar venció. La reserva sigue vigente; coordinen por el chat si
                  desean formalizarlo.
                </p>
              )}

              {canEditConditions && (
                <div className="space-y-2 rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 text-sm font-semibold">
                      <Settings2 className="h-4 w-4 text-biosensor" aria-hidden /> Condiciones del
                      servicio
                    </p>
                    {!editing && (
                      <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                        Ajustar
                      </Button>
                    )}
                  </div>
                  {editing && detail.terms ? (
                    <ContractConditionsForm
                      contractId={detail.id}
                      initial={detail.terms.conditions}
                      onSaved={() => setEditing(false)}
                      onCancel={() => setEditing(false)}
                    />
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Aviso para cancelar, tolerancia de llegada, EPP y condiciones adicionales.
                      Puedes ajustarlas hasta que alguien firme; el profesional revisa la versión
                      vigente antes de firmar.
                    </p>
                  )}
                </div>
              )}

              {isSignableStatus(detail.status) && !editing && (
                <div className="space-y-3 rounded-lg border border-biosensor/30 bg-biosensor/5 p-3">
                  <ContractSignFlow
                    key={`${detail.id}:${detail.terms_hash}`}
                    detail={detail}
                    party={party}
                    userId={userId}
                    onSigned={() => void query.refetch()}
                    onReadFullText={() => setTab("texto")}
                  />
                  {!declining ? (
                    <div className="text-center">
                      <button
                        type="button"
                        className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                        onClick={() => setDeclining(true)}
                      >
                        No estoy de acuerdo: rechazar el contrato
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2 rounded-lg border border-border bg-background p-3">
                      <p className="text-xs font-medium">
                        ¿Por qué rechazas el contrato? (opcional)
                      </p>
                      <Textarea
                        rows={2}
                        maxLength={300}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Sin teléfonos, enlaces ni datos de pago. La otra parte recibirá un aviso.
                      </p>
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setDeclining(false)}>
                          Volver
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={decline.isPending}
                          onClick={() => decline.mutate()}
                        >
                          {decline.isPending && (
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                          )}
                          Rechazar contrato
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="texto" className="space-y-3">
              {rendered ? (
                <article
                  className="space-y-3 rounded-lg border border-border bg-card p-4 text-sm"
                  aria-label="Texto del contrato"
                >
                  <header className="space-y-0.5 text-center">
                    <h3 className="font-display text-base font-bold">{rendered.title}</h3>
                    <p className="text-xs text-muted-foreground">
                      {detail.contract_no} · versión {detail.version}
                    </p>
                  </header>
                  <p className="text-xs leading-relaxed">{rendered.preamble}</p>
                  {rendered.clauses.map((c) => (
                    <section key={c.id} className="space-y-1">
                      <h4 className="text-xs font-bold uppercase tracking-wide">
                        {c.number}. {c.title}
                      </h4>
                      {c.paragraphs.map((p, i) => (
                        <p key={i} className="text-xs leading-relaxed text-muted-foreground">
                          {p}
                        </p>
                      ))}
                    </section>
                  ))}
                  <p className="border-t border-border pt-2 text-[11px] text-muted-foreground">
                    {rendered.footer}
                  </p>
                </article>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No podemos mostrar el texto de este contrato con esta versión de la aplicación.
                </p>
              )}
              <div className="flex justify-end">
                <Button size="sm" variant="outline" onClick={() => window.print()}>
                  <Printer className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Imprimir
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="evidencia">
              <ContractCertificate detail={detail} />
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
