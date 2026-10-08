import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ShieldCheck, ShieldAlert, ShieldQuestion, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { verifyRethus, type RethusResult } from "@/lib/rethus.functions";

/**
 * Verificación ReTHUS automática y única. Se dispara sola al cargar.
 * Solo pide consentimiento/documento una vez si faltan; nunca ofrece reintento.
 */
export function RethusAutoVerification({ initialStatus }: { initialStatus?: string | null }) {
  const run = useServerFn(verifyRethus);
  const [result, setResult] = useState<RethusResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [doc, setDoc] = useState("");
  const [consent, setConsent] = useState(false);
  const started = useRef(false);

  const final = initialStatus && initialStatus !== "unverified" ? initialStatus : null;

  const call = async (input: { documentNumber?: string; consent?: boolean }) => {
    setBusy(true);
    try {
      setResult(await run({ data: input }));
    } catch {
      setResult({ ok: false, code: "provider_error", message: "No pudimos verificar ahora." });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (final || started.current) return;
    started.current = true;
    void call({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [final]);

  const status = result?.ok ? result.status : result?.code === "already_verified" ? result.status ?? final : final;

  if (status === "verified") {
    return <Box icon={<ShieldCheck className="h-5 w-5 text-primary" />} title="ReTHUS verificado" text="Tu registro profesional fue confirmado." />;
  }
  if (status === "not_found" || status === "name_mismatch") {
    return (
      <Box
        icon={<ShieldAlert className="h-5 w-5 text-destructive" />}
        title="ReTHUS no confirmado"
        text={status === "not_found" ? "No encontramos tu registro en ReTHUS. El equipo de Humanix revisará tu caso." : "El nombre en ReTHUS no coincide con tu perfil. El equipo de Humanix revisará tu caso."}
      />
    );
  }

  const needsConsent = result && !result.ok && result.code === "consent_required";
  const needsDoc = result && !result.ok && result.code === "document_required";

  if (needsConsent || needsDoc) {
    const valid = /^\d{5,12}$/.test(doc.replace(/\D/g, ""));
    return (
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2 font-medium"><ShieldQuestion className="h-5 w-5 text-primary" /> Verificación ReTHUS</div>
        {needsDoc && (
          <div className="space-y-1">
            <Label htmlFor="rethus-doc">Número de cédula</Label>
            <Input id="rethus-doc" inputMode="numeric" value={doc} onChange={(e) => setDoc(e.target.value)} />
          </div>
        )}
        {needsConsent && (
          <label className="flex items-start gap-2 text-sm text-muted-foreground">
            <Checkbox checked={consent} onCheckedChange={(v) => setConsent(v === true)} />
            Autorizo a Humanix a consultar mi registro en ReTHUS (Ley 1581 de 2012).
          </label>
        )}
        <Button
          disabled={busy || (needsConsent && !consent) || (needsDoc && !valid)}
          onClick={() => call({ consent: needsConsent ? consent : undefined, documentNumber: needsDoc ? doc : undefined })}
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Continuar
        </Button>
      </div>
    );
  }

  const text = busy || !result
    ? "Verificando tu registro profesional…"
    : !result.ok ? result.message : "";
  return <Box icon={busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ShieldQuestion className="h-5 w-5 text-muted-foreground" />} title="Verificación ReTHUS" text={text} />;
}

function Box({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-start gap-3">
      {icon}
      <div><p className="font-medium">{title}</p><p className="text-sm text-muted-foreground">{text}</p></div>
    </div>
  );
}
