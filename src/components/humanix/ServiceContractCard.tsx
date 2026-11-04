// «Nuestro acuerdo de cuidado»: la tarjeta del contrato en /servicio/$bookingId para reservas que no tienen contrato
// inteligente. El texto sale de `renderServiceContract` (plantilla versionada); el servidor guarda la aceptación de cada parte
// con hx_accept_service_contract y la devuelve con hx_service_contract_status (migración 20261104200000).
//
// Antes esta tarjeta leía `service_contracts`, una tabla que no existe en producción: la consulta fallaba y la tarjeta
// desaparecía sin decir nada. Ahora siempre muestra algo: cargando, el contrato, o un error amable con «Reintentar».
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CheckCircle2,
  Clock3,
  Download,
  FileHeart,
  Fingerprint,
  HeartHandshake,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { friendlyError } from "@/lib/friendlyError";
import { sha256Hex } from "@/lib/contractTemplate";
import {
  ACCEPT_RESULT_MESSAGE,
  SERVICE_CONTRACT_VERSION,
  bogotaDateTime,
  partyState,
  renderServiceContract,
  type ContractAcceptance,
  type ContractSide,
  type PartyState,
  type ServiceContractBooking,
} from "@/lib/serviceContract";

const sb = supabase as unknown as SupabaseClient;

type Booking = ServiceContractBooking & { status: string };

interface Props {
  booking: Booking;
  side: ContractSide;
  /** Nombre de la otra parte, para hablar en cercano («Ana aún no lo acepta»). */
  peerName?: string;
}

type Load =
  | { kind: "loading" }
  | { kind: "ready"; acceptances: ContractAcceptance[] }
  /** El servidor aún no tiene la función (migración sin aplicar): se puede leer, no aceptar. */
  | { kind: "unavailable" }
  | { kind: "error"; message: string };

function isMissingFunction(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return (
    ["PGRST202", "PGRST205", "42883", "42P01"].includes(err.code ?? "") ||
    /could not find the function|does not exist/i.test(err.message ?? "")
  );
}

export function ServiceContractCard({ booking, side, peerName }: Props) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [open, setOpen] = useState(false);
  const contract = useMemo(() => renderServiceContract(booking), [booking]);

  const refresh = useCallback(async () => {
    setLoad({ kind: "loading" });
    const { data, error } = await sb.rpc("hx_service_contract_status", {
      p_booking_id: booking.id,
    });
    if (error) {
      if (isMissingFunction(error)) setLoad({ kind: "unavailable" });
      else
        setLoad({ kind: "error", message: friendlyError(error, "No pudimos cargar el contrato.") });
      return;
    }
    setLoad({
      kind: "ready",
      acceptances: Array.isArray(data) ? (data as ContractAcceptance[]) : [],
    });
  }, [booking.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const other: ContractSide = side === "client" ? "professional" : "client";
  const acceptances = load.kind === "ready" ? load.acceptances : [];
  const me = partyState(acceptances, side, booking);
  const them = partyState(acceptances, other, booking);
  const both = me.state === "accepted" && them.state === "accepted";
  const cancelled = booking.status === "cancelled";
  const peer =
    (peerName ?? "").trim().split(" ")[0] ||
    (side === "client" ? "El profesional" : "Quien te contrató");

  if (load.kind === "loading") {
    return (
      <Card className="space-y-3 p-5" aria-busy="true" aria-label="Cargando el contrato">
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-8 rounded-full" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-9 w-full rounded-xl" />
      </Card>
    );
  }

  if (load.kind === "error") {
    return (
      <Card className="space-y-3 border-dashed p-5">
        <div className="flex items-center gap-2">
          <FileHeart className="h-5 w-5 text-copper" aria-hidden />
          <h3 className="text-sm font-semibold">Nuestro acuerdo de cuidado</h3>
        </div>
        <p className="text-xs text-muted-foreground" role="alert">
          {load.message} Tu servicio sigue igual; solo no pudimos mostrar el contrato ahora.
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="flex-1" onClick={() => void refresh()}>
            <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden /> Reintentar
          </Button>
          <Button size="sm" variant="ghost" className="flex-1" onClick={() => setOpen(true)}>
            Leer el contrato
          </Button>
        </div>
        <ContractDialog
          open={open}
          onOpenChange={setOpen}
          contract={contract}
          booking={booking}
          canAccept={false}
          blockedNote="Cuando vuelva la conexión podrás aceptarlo aquí."
          myAcceptance={null}
          onAccepted={refresh}
        />
      </Card>
    );
  }

  const unavailable = load.kind === "unavailable";
  const needsMe = !cancelled && !unavailable && me.state !== "accepted";

  return (
    <Card
      className={
        both
          ? "space-y-3 border-biosensor/30 bg-gradient-to-br from-biosensor/10 via-card to-card p-5"
          : "space-y-3 border-copper/25 bg-gradient-to-br from-copper/10 via-card to-card p-5"
      }
    >
      <div className="flex items-start gap-3">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
            both ? "bg-biosensor/15 text-biosensor" : "bg-copper/15 text-copper"
          }`}
          aria-hidden
        >
          {both ? <ShieldCheck className="h-5 w-5" /> : <HeartHandshake className="h-5 w-5" />}
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Nuestro acuerdo de cuidado</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {cancelled
              ? "Este servicio se canceló. El contrato queda aquí para que lo consultes."
              : both
                ? "Los dos aceptaron. Todo queda claro y por escrito. 💚"
                : me.state === "outdated"
                  ? "Cambiaron la fecha, el valor o la forma de pago. Revísalo y acéptalo de nuevo."
                  : me.state === "accepted"
                    ? `Ya lo aceptaste. Falta que ${peer} lo acepte.`
                    : "Lo esencial en 1 minuto: qué se cuida, cuánto cuesta, cómo se paga y qué pasa si se cancela."}
          </p>
        </div>
      </div>

      {!unavailable && (
        <ul className="flex flex-wrap gap-2 text-[11px]">
          <PartyChip label="Tú" state={me.state} />
          <PartyChip label={peer} state={them.state} />
        </ul>
      )}

      {unavailable && (
        <p className="rounded-xl bg-muted/60 px-3 py-2 text-[11px] text-muted-foreground">
          Muy pronto podrás aceptarlo aquí mismo. Mientras tanto, ya puedes leerlo completo.
        </p>
      )}

      <Button
        size="sm"
        variant={needsMe ? "hero" : "outline"}
        className="w-full rounded-xl"
        onClick={() => setOpen(true)}
      >
        {needsMe ? (
          <>
            <Sparkles className="mr-1.5 h-4 w-4" aria-hidden /> Leer y aceptar
          </>
        ) : (
          <>
            <FileHeart className="mr-1.5 h-4 w-4" aria-hidden /> Ver contrato
          </>
        )}
      </Button>

      <ContractDialog
        open={open}
        onOpenChange={setOpen}
        contract={contract}
        booking={booking}
        canAccept={needsMe}
        blockedNote={
          cancelled
            ? "El servicio se canceló: ya no se puede aceptar."
            : unavailable
              ? "Muy pronto podrás aceptarlo aquí mismo."
              : null
        }
        myAcceptance={me.state === "accepted" ? me.acceptance : null}
        onAccepted={refresh}
      />
    </Card>
  );
}

function PartyChip({ label, state }: { label: string; state: PartyState }) {
  const ok = state === "accepted";
  return (
    <li
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium ${
        ok ? "bg-biosensor/15 text-biosensor" : "bg-muted text-muted-foreground"
      }`}
    >
      {ok ? (
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <Clock3 className="h-3.5 w-3.5" aria-hidden />
      )}
      {label}: {ok ? "aceptó" : state === "outdated" ? "debe aceptar de nuevo" : "pendiente"}
    </li>
  );
}

function ContractDialog({
  open,
  onOpenChange,
  contract,
  booking,
  canAccept,
  blockedNote,
  myAcceptance,
  onAccepted,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  contract: ReturnType<typeof renderServiceContract>;
  booking: Booking;
  canAccept: boolean;
  blockedNote: string | null;
  myAcceptance: ContractAcceptance | null;
  onAccepted: () => Promise<void> | void;
}) {
  const [agree, setAgree] = useState(false);
  const [health, setHealth] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hash, setHash] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void sha256Hex(contract.text).then((h) => active && setHash(h));
    return () => {
      active = false;
    };
  }, [contract.text]);

  const accept = async () => {
    if (!agree || !health) {
      toast.error(ACCEPT_RESULT_MESSAGE.consent_required);
      return;
    }
    if (!hash) return;
    setBusy(true);
    const { data, error } = await sb.rpc("hx_accept_service_contract", {
      p_booking_id: booking.id,
      p_version: SERVICE_CONTRACT_VERSION,
      p_text_sha256: hash,
      p_consents: ["contract", "health_data"],
      p_user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 300) : null,
    });
    setBusy(false);
    if (error) {
      toast.error(
        isMissingFunction(error)
          ? "Muy pronto podrás aceptarlo aquí mismo."
          : friendlyError(error, "No pudimos guardar tu aceptación. Inténtalo de nuevo."),
      );
      return;
    }
    const result = String((data as { result?: string } | null)?.result ?? "");
    const msg =
      ACCEPT_RESULT_MESSAGE[result] ?? "No pudimos guardar tu aceptación. Inténtalo de nuevo.";
    if (result === "accepted" || result === "already_accepted") {
      toast.success(msg);
      onOpenChange(false);
      await onAccepted();
    } else {
      toast.error(msg);
    }
  };

  const download = () => {
    const extra = myAcceptance
      ? `\n\nREGISTRO DE TU ACEPTACIÓN\nFecha y hora: ${bogotaDateTime(myAcceptance.accepted_at)} (hora de Colombia)\nVersión: ${myAcceptance.terms_version}\nHuella SHA-256: ${myAcceptance.text_sha256}\n`
      : `\n\nHuella SHA-256 de este texto: ${hash ?? ""}\n`;
    const blob = new Blob([contract.text + extra], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `contrato-humanix-${booking.id.slice(0, 8)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] max-w-xl flex-col gap-0 overflow-hidden p-0 sm:rounded-3xl">
        <DialogHeader className="space-y-1 border-b bg-gradient-to-br from-copper/10 via-background to-biosensor/10 px-5 pb-4 pt-5 text-left">
          <div className="flex items-center gap-2 text-copper">
            <HeartHandshake className="h-5 w-5" aria-hidden />
            <span className="text-[11px] font-semibold uppercase tracking-wide">
              Nuestro acuerdo de cuidado
            </span>
          </div>
          <DialogTitle className="text-lg">{contract.title}</DialogTitle>
          <DialogDescription className="text-xs">
            Escrito en palabras sencillas y según la ley colombiana. Versión {contract.version}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <section aria-labelledby="hx-essentials" className="rounded-2xl bg-biosensor/5 p-4">
            <h4 id="hx-essentials" className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
              <Sparkles className="h-4 w-4 text-biosensor" aria-hidden /> Lo esencial
            </h4>
            <ul className="space-y-1.5 text-[13px] leading-relaxed">
              {contract.essentials.map((e) => (
                <li key={e.id} className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-biosensor" aria-hidden />
                  <span>{e.text}</span>
                </li>
              ))}
            </ul>
          </section>

          <p className="text-xs leading-relaxed text-muted-foreground">{contract.preamble}</p>

          <Accordion type="multiple" className="rounded-2xl border">
            {contract.clauses.map((c) => (
              <AccordionItem key={c.id} value={c.id} className="px-4 last:border-b-0">
                <AccordionTrigger className="py-3 text-left hover:no-underline">
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[13px] font-semibold">
                      {c.number}. {c.title}
                    </span>
                    <span className="text-[11px] font-normal text-muted-foreground">
                      {c.simple}
                    </span>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="space-y-2 text-[13px] leading-relaxed text-foreground/90">
                  {c.paragraphs.map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>

          <p className="text-xs text-muted-foreground">{contract.closing}</p>

          {myAcceptance && (
            <div className="rounded-2xl border border-biosensor/30 bg-biosensor/5 p-4 text-xs">
              <p className="flex items-center gap-1.5 font-semibold text-biosensor">
                <ShieldCheck className="h-4 w-4" aria-hidden /> Aceptaste este contrato
              </p>
              <p className="mt-1 text-muted-foreground">
                {bogotaDateTime(myAcceptance.accepted_at)} (hora de Colombia) · versión{" "}
                {myAcceptance.terms_version}
              </p>
              <p className="mt-1 flex items-center gap-1 break-all font-mono text-[10px] text-muted-foreground">
                <Fingerprint className="h-3 w-3 shrink-0" aria-hidden /> {myAcceptance.text_sha256}
              </p>
            </div>
          )}
        </div>

        <div className="space-y-3 border-t bg-background px-5 py-4">
          {canAccept ? (
            <>
              <label className="flex cursor-pointer items-start gap-2.5 text-xs leading-relaxed">
                <Checkbox
                  checked={agree}
                  onCheckedChange={(v) => setAgree(v === true)}
                  className="mt-0.5"
                />
                <span>
                  Leí el contrato, lo entiendo y lo acepto. Sé que aceptarlo aquí tiene la misma
                  validez que firmarlo en papel (Ley 527 de 1999).
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2.5 text-xs leading-relaxed">
                <Checkbox
                  checked={health}
                  onCheckedChange={(v) => setHealth(v === true)}
                  className="mt-0.5"
                />
                <span>
                  Autorizo de forma expresa que los datos de salud necesarios se compartan entre las
                  partes solo para este cuidado (Ley 1581 de 2012).
                </span>
              </label>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={download}
                  aria-label="Descargar una copia"
                >
                  <Download className="h-4 w-4" aria-hidden />
                </Button>
                <Button
                  variant="hero"
                  className="flex-1 rounded-xl"
                  disabled={!agree || !health || busy || !hash}
                  onClick={() => void accept()}
                >
                  {busy ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <HeartHandshake className="mr-1.5 h-4 w-4" aria-hidden />
                  )}
                  Acepto el acuerdo
                </Button>
              </div>
              <p className="text-center text-[10px] text-muted-foreground">
                Guardamos quién acepta, cuándo, la versión y la huella del texto como prueba.
              </p>
            </>
          ) : (
            <div className="flex items-center gap-2">
              {blockedNote && <p className="flex-1 text-xs text-muted-foreground">{blockedNote}</p>}
              <Button
                variant="outline"
                size="sm"
                className={blockedNote ? "" : "w-full"}
                onClick={download}
              >
                <Download className="mr-1.5 h-4 w-4" aria-hidden /> Descargar copia
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
