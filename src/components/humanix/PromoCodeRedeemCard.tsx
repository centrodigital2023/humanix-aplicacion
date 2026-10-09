// «Canjear código» de Planes: activa 1 mes del plan Esencial con el código que se gana al llenar /validacion.
// La activación la hace el servidor (`redeemMarketBenefit` → `redeem_validation_benefit`); aquí solo se pide el código.
import { useEffect, useState } from "react";
import { Gift, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { redeemMarketBenefit } from "@/lib/marketValidation.functions";
import { BENEFIT, REDEEM_ERRORS } from "@/lib/marketValidation";
import { BENEFIT_CODE_KEY } from "./validation/ValidationResult";

export function PromoCodeRedeemCard({
  signedIn,
  onRedeemed,
}: {
  signedIn: boolean;
  onRedeemed?: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [endsAt, setEndsAt] = useState<string | null>(null);

  // El código llega por ?codigo= o se recuerda en este dispositivo desde el formulario.
  useEffect(() => {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get("codigo");
      const stored = localStorage.getItem(BENEFIT_CODE_KEY);
      const c = (fromUrl || stored || "").trim().toUpperCase();
      if (c) setCode(c);
    } catch {
      /* modo privado */
    }
  }, []);

  const redeem = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await redeemMarketBenefit({ data: { code } });
      if (!res.ok) {
        setError(REDEEM_ERRORS[res.error] ?? REDEEM_ERRORS.server);
        return;
      }
      try {
        localStorage.removeItem(BENEFIT_CODE_KEY);
      } catch {
        /* modo privado */
      }
      setEndsAt(res.endsAt);
      toast.success(`Tu ${BENEFIT.label} está activo`);
      onRedeemed?.();
    } catch {
      setError(REDEEM_ERRORS.server);
    } finally {
      setBusy(false);
    }
  };

  const endText = endsAt
    ? new Date(endsAt).toLocaleDateString("es-CO", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "America/Bogota",
      })
    : null;

  return (
    <section
      aria-labelledby="canje-titulo"
      className="rounded-2xl border border-ok/30 bg-ok/5 p-5 sm:p-6"
    >
      <div className="flex items-start gap-3">
        <Gift className="mt-0.5 h-6 w-6 shrink-0 text-ok" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 id="canje-titulo" className="font-display text-lg font-bold">
            ¿Tienes un código? Canjea tu {BENEFIT.label}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Se gana llenando el formulario de{" "}
            <a href="/validacion" className="font-semibold text-trust underline underline-offset-4">
              Registro de usuario y beneficio premium
            </a>{" "}
            y confirmando tu contacto. Sin tarjeta.
          </p>

          {endText ? (
            <p role="status" className="mt-3 font-semibold text-ok">
              ¡Listo! Tu plan Esencial está activo hasta el {endText}.
            </p>
          ) : signedIn ? (
            <form
              className="mt-3 flex flex-col gap-2 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault();
                if (code.trim().length >= 8) void redeem();
              }}
            >
              <label htmlFor="promo-code" className="sr-only">
                Código del beneficio
              </label>
              <Input
                id="promo-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="MLP-XXXXX-XXXXX"
                maxLength={24}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "promo-error" : undefined}
                className="min-h-12 flex-1 font-mono tracking-widest"
              />
              <Button
                type="submit"
                disabled={busy || code.trim().length < 8}
                className="min-h-12 rounded-xl px-6"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-label="Canjeando" />
                ) : (
                  "Canjear"
                )}
              </Button>
            </form>
          ) : (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Button asChild className="min-h-12 rounded-xl px-6">
                <a href={`/auth?mode=signin&redirect=${encodeURIComponent("/planes")}`}>
                  Inicia sesión para canjear
                </a>
              </Button>
              <Button asChild variant="outline" className="min-h-12 rounded-xl px-6">
                <a href="/validacion">Llenar el formulario (4 min)</a>
              </Button>
            </div>
          )}

          {error && (
            <p
              id="promo-error"
              role="alert"
              className="mt-2 text-sm font-semibold text-destructive"
            >
              {error}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
