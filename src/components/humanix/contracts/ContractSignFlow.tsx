import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Loader2,
  Mail,
  PenLine,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { instKeys, useSignerReadiness, type ContractDetail } from "@/hooks/use-institution-hub";
import {
  acceptanceItems,
  canSignNow,
  contractBodyHash,
  missingAcceptances,
  type ContractParty,
} from "@/lib/contractTemplate";
import {
  decodeJwtClaims,
  describeReadiness,
  fixableItems,
  maskEmail,
  normalizeOtp,
  stepUpFromClaims,
  stepUpSecondsLeft,
  type StepUp,
} from "@/lib/contractIdentity";
import { signSmartContract } from "@/lib/contracts.functions";

interface Props {
  detail: ContractDetail;
  party: ContractParty;
  userId: string;
  onSigned: () => void;
  /** Lleva a la pestaña con el texto completo del contrato (opcional). */
  onReadFullText?: () => void;
}

const RESEND_SECONDS = 45;

/**
 * Firma del contrato inteligente en cuatro garantías: identidad verificada (RETHUS / NIT), código de un
 * solo uso enviado al correo de la cuenta, aceptación explícita de cada declaración y huella del texto
 * exacto que la persona vio. El servidor vuelve a verificar todo antes de registrar la firma.
 */
export function ContractSignFlow({ detail, party, userId, onSigned, onReadFullText }: Props) {
  const qc = useQueryClient();
  const terms = detail.terms;
  const readiness = useSignerReadiness(detail.id, userId, true);
  const items = useMemo(() => acceptanceItems(party), [party]);
  const [accepted, setAccepted] = useState<string[]>([]);
  const [bodyHash, setBodyHash] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [stepUp, setStepUp] = useState<StepUp | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [codeSentAt, setCodeSentAt] = useState<number | null>(null);
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gate = canSignNow({
    status: detail.status,
    deadline: detail.signature_deadline,
    iSigned: detail.signatures.some((s) => s.signer_id === userId),
    now,
  });

  const refreshSession = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    setEmail(data.session?.user.email ?? null);
    setStepUp(stepUpFromClaims(decodeJwtClaims(data.session?.access_token), Date.now()));
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    let cancelled = false;
    if (!terms) {
      setBodyHash(null);
      return;
    }
    contractBodyHash(terms)
      .then((h) => !cancelled && setBodyHash(h))
      .catch(() => !cancelled && setBodyHash(null));
    return () => {
      cancelled = true;
    };
  }, [terms]);

  // Reloj para la vigencia del código y la espera para reenviarlo.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const secondsLeft = stepUpSecondsLeft(stepUp, now);
  const stepUpValid = secondsLeft > 0;
  const resendIn = codeSentAt
    ? Math.max(0, RESEND_SECONDS - Math.floor((now - codeSentAt) / 1000))
    : 0;

  const sendCode = async () => {
    if (!email) {
      setError("No encontramos el correo de tu cuenta. Cierra sesión y vuelve a entrar.");
      return;
    }
    setSending(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: window.location.href },
    });
    setSending(false);
    if (err) {
      setError(`No pudimos enviar el código: ${err.message}`);
      return;
    }
    setCodeSentAt(Date.now());
    setCode("");
    toast.success(`Te enviamos un código a ${maskEmail(email)}`);
  };

  const verifyCode = async () => {
    const token = normalizeOtp(code);
    if (!token || !email) {
      setError("Escribe el código que llegó a tu correo (solo números).");
      return;
    }
    setVerifying(true);
    setError(null);
    const { error: err } = await supabase.auth.verifyOtp({ email, token, type: "email" });
    setVerifying(false);
    if (err) {
      setError("El código no es correcto o ya venció. Pide uno nuevo.");
      return;
    }
    await refreshSession();
    setCode("");
    toast.success("Verificación lista: ya puedes firmar");
  };

  const sign = async () => {
    if (!terms || !bodyHash) return;
    setSigning(true);
    setError(null);
    try {
      const result = await signSmartContract({
        data: { contractId: detail.id, termsHash: detail.terms_hash, bodyHash, accepted },
      });
      if (!result.ok) {
        setError(result.message);
        if (result.code === "terms_changed" || result.code === "body_mismatch") {
          setAccepted([]);
          void qc.invalidateQueries({ queryKey: instKeys.contract(detail.id) });
        }
        if (result.code === "step_up_required") void refreshSession();
        return;
      }
      toast.success(
        result.fullySigned
          ? "¡Contrato firmado por ambas partes! Ya está vigente."
          : "Tu firma quedó registrada. Falta la firma de la otra parte.",
      );
      void qc.invalidateQueries({ queryKey: ["inst"] });
      onSigned();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No se pudo registrar la firma. Inténtalo de nuevo.",
      );
    } finally {
      setSigning(false);
    }
  };

  if (!gate.ok) {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden /> {gate.reason}
      </p>
    );
  }
  if (!terms) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" aria-hidden />
        <AlertTitle>No podemos mostrar este contrato</AlertTitle>
        <AlertDescription>
          La plantilla del contrato no es compatible con esta versión de la aplicación. Actualiza la
          página o contacta a soporte.
        </AlertDescription>
      </Alert>
    );
  }

  const checks = readiness.data ? describeReadiness(readiness.data) : [];
  const fixes = readiness.data ? fixableItems(readiness.data) : [];
  const identityOk = readiness.data?.ready === true;
  const missing = missingAcceptances(terms.required_clauses, accepted);
  const canSign = identityOk && stepUpValid && missing.length === 0 && !!bodyHash && !signing;

  return (
    <section className="space-y-4" aria-label="Firmar el contrato">
      <div className="space-y-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-biosensor/15 text-[11px] text-biosensor">
            1
          </span>
          Tu identidad
        </h3>
        {readiness.isLoading ? (
          <p className="text-xs text-muted-foreground">Verificando tu identidad…</p>
        ) : readiness.error ? (
          <p className="text-xs text-destructive">
            No pudimos consultar tus verificaciones. Inténtalo de nuevo.
          </p>
        ) : (
          <ul className="space-y-1 text-xs">
            {checks
              .filter((c) => c.id !== "contract_open" && c.id !== "not_signed_yet")
              .map((c) => (
                <li key={c.id} className="flex items-start gap-1.5">
                  {c.ok ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" aria-hidden />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" aria-hidden />
                  )}
                  <span className={c.ok ? "" : "text-foreground"}>
                    {c.label}
                    {!c.ok && c.fix && (
                      <>
                        {" — "}
                        <span className="text-muted-foreground">{c.fix}</span>
                      </>
                    )}
                  </span>
                </li>
              ))}
          </ul>
        )}
        {fixes.some((f) => f.href) && (
          <div className="flex flex-wrap gap-2">
            {fixes
              .filter((f) => f.href)
              .slice(0, 1)
              .map((f) => (
                <Button key={f.id} asChild size="sm" variant="outline">
                  <Link to={f.href as "/dashboard"}>Resolver ahora</Link>
                </Button>
              ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-biosensor/15 text-[11px] text-biosensor">
            2
          </span>
          Código de verificación
        </h3>
        {stepUpValid ? (
          <p className="flex items-center gap-2 rounded-lg border border-ok/40 bg-ok/5 p-2.5 text-xs text-ok">
            <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden />
            Verificación lista. Es válida {Math.max(1, Math.ceil(secondsLeft / 60))} min más.
          </p>
        ) : (
          <div className="space-y-2 rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground">
              Para firmar confirmamos que eres tú: te enviamos un código de un solo uso a{" "}
              <strong className="text-foreground">{maskEmail(email)}</strong>. Si el correo trae un
              enlace en lugar de un código, ábrelo en este mismo navegador.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void sendCode()}
                disabled={sending || resendIn > 0 || !email}
              >
                {sending ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Mail className="mr-1.5 h-4 w-4" aria-hidden />
                )}
                {codeSentAt
                  ? resendIn > 0
                    ? `Reenviar en ${resendIn} s`
                    : "Reenviar código"
                  : "Enviar código"}
              </Button>
              {codeSentAt && (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="contract-otp" className="text-xs">
                      Código recibido
                    </Label>
                    <Input
                      id="contract-otp"
                      className="h-9 w-36 text-center tracking-widest"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={8}
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/[^\d\s]/g, ""))}
                      placeholder="000000"
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={() => void verifyCode()}
                    disabled={verifying || !normalizeOtp(code)}
                  >
                    {verifying ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <KeyRound className="mr-1.5 h-4 w-4" aria-hidden />
                    )}
                    Verificar
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-biosensor/15 text-[11px] text-biosensor">
            3
          </span>
          Declaraciones
        </h3>
        {onReadFullText && (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            onClick={onReadFullText}
          >
            Leer el contrato completo antes de firmar
          </Button>
        )}
        <ul className="space-y-2">
          {items.map((item) => {
            const id = `accept-${item.id}`;
            const required = terms.required_clauses.includes(item.id);
            return (
              <li key={item.id} className="flex items-start gap-2 text-xs">
                <Checkbox
                  id={id}
                  checked={accepted.includes(item.id)}
                  onCheckedChange={(c) =>
                    setAccepted((cur) =>
                      c === true
                        ? [...new Set([...cur, item.id])]
                        : cur.filter((x) => x !== item.id),
                    )
                  }
                  className="mt-0.5"
                />
                <Label htmlFor={id} className="cursor-pointer text-xs font-normal leading-snug">
                  {item.label}
                  {!required && <span className="text-muted-foreground"> (opcional)</span>}
                </Label>
              </li>
            );
          })}
        </ul>
      </div>

      {error && (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {error}
        </p>
      )}

      <div className="space-y-1.5">
        <Button variant="hero" className="w-full" disabled={!canSign} onClick={() => void sign()}>
          {signing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <PenLine className="mr-2 h-4 w-4" aria-hidden />
          )}
          Firmar contrato
        </Button>
        {!canSign && !signing && (
          <p className="text-center text-[11px] text-muted-foreground">
            {!identityOk
              ? "Completa las verificaciones de identidad para poder firmar."
              : !stepUpValid
                ? "Confirma el código de verificación."
                : missing.length > 0
                  ? "Acepta todas las declaraciones."
                  : "Preparando el documento…"}
          </p>
        )}
        <p className="text-center text-[11px] text-muted-foreground">
          Firma electrónica con validez legal en Colombia (Ley 527 de 1999 y Decreto 2364 de 2012).
          Queda registrada la huella del documento, la fecha y hora y tu verificación.
        </p>
      </div>
    </section>
  );
}
