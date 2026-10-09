// Verificación del contacto con un código de 6 dígitos (WhatsApp o correo).
// El código se envía solo al abrir este paso; la persona puede corregir su contacto si no le llega.
import { useCallback, useEffect, useRef, useState } from "react";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { Loader2, Mail, MessageCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import {
  sendValidationOtp,
  verifyValidationOtp,
  type VerifyOtpResult,
} from "@/lib/marketValidation.functions";
import { normalizeContact, type ContactKind } from "@/lib/marketValidation";

export type VerifiedResult = Extract<VerifyOtpResult, { ok: true }>;

interface Props {
  responseId: string;
  initial: { kind: ContactKind; masked: string };
  onVerified: (result: VerifiedResult) => void;
  /** Volver al formulario (por ejemplo, si la solicitud venció). */
  onRestart: () => void;
}

const CHANNEL_NAME: Record<ContactKind, string> = { whatsapp: "WhatsApp", email: "correo" };

export function ValidationOtpStep({ responseId, initial, onVerified, onRestart }: Props) {
  const [channel, setChannel] = useState<ContactKind>(initial.kind);
  const [masked, setMasked] = useState(initial.masked);
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [code, setCode] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [changing, setChanging] = useState(false);
  const [newContact, setNewContact] = useState("");
  const [expired, setExpired] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const send = useCallback(
    async (contact?: string) => {
      setSending(true);
      setMessage(null);
      setCode("");
      setExpired(false);
      try {
        const res = await sendValidationOtp({
          data: { responseId, ...(contact ? { contact } : {}) },
        });
        if (res.ok) {
          setChannel(res.channel);
          setMasked(res.masked);
          setSent(true);
          setChanging(false);
          setCooldown(res.resendInSeconds);
          return;
        }
        switch (res.error) {
          case "rate_limited":
            setCooldown((c) => (c > 0 ? c : 20));
            setMessage({ tone: "info", text: "Espera unos segundos antes de pedir otro código." });
            break;
          case "channel_unavailable":
          case "send_failed":
            setChanging(true);
            setMessage({
              tone: "error",
              text: `No pudimos enviar el código por ${CHANNEL_NAME[channel]} en este momento. Prueba con otro contacto (por ejemplo, tu correo) o inténtalo en unos minutos.`,
            });
            break;
          case "already_verified": {
            // Recargó la página: el servidor devuelve el estado del beneficio sin pedir otro código.
            const v = await verifyValidationOtp({ data: { responseId, code: "000000" } });
            if (v.ok) onVerified(v);
            break;
          }
          case "not_found":
            setMessage({
              tone: "error",
              text: "Esta solicitud venció. Vuelve a enviar el formulario.",
            });
            setExpired(true);
            break;
          case "validation":
            setMessage({
              tone: "error",
              text: "Revisa tu contacto: escribe un celular colombiano de 10 dígitos o un correo válido.",
            });
            break;
          default:
            setMessage({
              tone: "error",
              text: "No pudimos enviar el código. Inténtalo de nuevo en un momento.",
            });
        }
      } catch {
        setMessage({ tone: "error", text: "Error de conexión. Inténtalo de nuevo." });
      } finally {
        setSending(false);
      }
    },
    [responseId, channel, onVerified],
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void send();
  }, [send]);

  const verify = async (value: string) => {
    if (value.length !== 6 || verifying) return;
    setVerifying(true);
    setMessage(null);
    try {
      const res = await verifyValidationOtp({ data: { responseId, code: value } });
      if (res.ok) {
        onVerified(res);
        return;
      }
      setCode("");
      switch (res.error) {
        case "invalid_code":
          setMessage({
            tone: "error",
            text:
              typeof res.remaining === "number"
                ? `Código incorrecto. Te quedan ${res.remaining} intento${res.remaining === 1 ? "" : "s"}.`
                : "Código incorrecto. Inténtalo de nuevo.",
          });
          break;
        case "expired":
          setMessage({ tone: "error", text: "Ese código venció. Pide uno nuevo." });
          break;
        case "too_many_attempts":
          setMessage({
            tone: "error",
            text: "Demasiados intentos con ese código. Pide uno nuevo.",
          });
          break;
        case "no_code":
          setMessage({ tone: "error", text: "Primero pide el código." });
          break;
        case "not_found":
          setMessage({
            tone: "error",
            text: "Esta solicitud venció. Vuelve a enviar el formulario.",
          });
          setExpired(true);
          break;
        default:
          setMessage({
            tone: "error",
            text: "No pudimos verificar el código. Inténtalo de nuevo.",
          });
      }
    } catch {
      setMessage({ tone: "error", text: "Error de conexión. Inténtalo de nuevo." });
    } finally {
      setVerifying(false);
    }
  };

  const Icon = channel === "whatsapp" ? MessageCircle : Mail;
  const newContactKind = normalizeContact(newContact)?.kind;

  return (
    <div className="space-y-6">
      <div className="text-center">
        <ShieldCheck className="mx-auto h-12 w-12 text-trust" aria-hidden="true" />
        <h2 className="mt-2 font-display text-2xl font-bold">Confirma tu contacto</h2>
        <p className="mt-1 text-base text-muted-foreground">
          Con este código verificamos que eres tú y te entregamos tu beneficio.
        </p>
      </div>

      {sent && (
        <div
          className="flex items-center gap-3 rounded-2xl bg-ok/10 p-4 ring-1 ring-ok/30"
          role="status"
        >
          <Icon className="h-6 w-6 shrink-0 text-ok" aria-hidden="true" />
          <p className="text-sm">
            <strong className="text-ok">Código enviado por {CHANNEL_NAME[channel]}</strong> a{" "}
            <strong>{masked}</strong>. Vale 15 minutos.
          </p>
        </div>
      )}

      {sending && !sent && (
        <p className="flex items-center justify-center gap-2 text-muted-foreground" role="status">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Enviando el código…
        </p>
      )}

      {sent && (
        <div className="space-y-3">
          <label htmlFor="otp-code" className="block text-center text-base font-bold">
            {verifying ? "Verificando…" : "Escribe el código de 6 dígitos"}
          </label>
          <div className="flex justify-center">
            <InputOTP
              id="otp-code"
              maxLength={6}
              value={code}
              onChange={setCode}
              onComplete={verify}
              pattern={REGEXP_ONLY_DIGITS}
              inputMode="numeric"
              autoComplete="one-time-code"
              disabled={verifying}
              autoFocus
            >
              <InputOTPGroup className="gap-2">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <InputOTPSlot
                    key={i}
                    index={i}
                    className="h-14 w-11 rounded-2xl border-2 border-border text-2xl font-bold first:border-l-2 sm:h-16 sm:w-14"
                  />
                ))}
              </InputOTPGroup>
            </InputOTP>
          </div>
          {verifying && (
            <p className="flex justify-center" role="status">
              <Loader2 className="h-6 w-6 animate-spin text-trust" aria-hidden="true" />
            </p>
          )}
        </div>
      )}

      {message && (
        <p
          role={message.tone === "error" ? "alert" : "status"}
          className={`text-center text-base font-semibold ${message.tone === "error" ? "text-destructive" : "text-muted-foreground"}`}
        >
          {message.text}
        </p>
      )}

      {expired ? (
        <Button type="button" onClick={onRestart} className="min-h-12 w-full rounded-2xl text-base">
          Volver al formulario
        </Button>
      ) : (
        <div className="space-y-3 text-center">
          {sent &&
            (cooldown > 0 ? (
              <p className="text-sm text-muted-foreground">
                Podrás pedir otro código en {cooldown} s
              </p>
            ) : (
              <button
                type="button"
                onClick={() => void send()}
                disabled={sending}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-trust underline underline-offset-4 disabled:opacity-60"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Enviar un código nuevo
              </button>
            ))}

          {!changing ? (
            <div>
              <button
                type="button"
                onClick={() => setChanging(true)}
                className="text-sm font-semibold text-muted-foreground underline underline-offset-4"
              >
                ¿No te llega? Cambiar mi contacto
              </button>
            </div>
          ) : (
            <form
              className="space-y-3 rounded-2xl border-2 border-border p-4 text-left"
              onSubmit={(e) => {
                e.preventDefault();
                if (newContactKind) void send(newContact);
              }}
            >
              <label htmlFor="new-contact" className="block text-sm font-bold">
                Tu WhatsApp o correo
              </label>
              <input
                id="new-contact"
                value={newContact}
                onChange={(e) => setNewContact(e.target.value)}
                inputMode="email"
                autoComplete="email"
                placeholder="3001234567 o correo@ejemplo.com"
                className="min-h-14 w-full rounded-2xl border-2 border-border bg-background px-4 text-base font-medium outline-none focus:border-trust"
              />
              <Button
                type="submit"
                disabled={!newContactKind || sending}
                className="min-h-12 w-full rounded-2xl text-base"
              >
                {sending ? (
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                ) : (
                  "Enviar código a este contacto"
                )}
              </Button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
