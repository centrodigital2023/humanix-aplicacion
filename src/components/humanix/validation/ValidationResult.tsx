// Resultado tras verificar el contacto: beneficio activo, código para canjear, o el motivo por el que no hay.
import { useEffect, useState } from "react";
import { Check, Copy, Gift, PartyPopper, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BENEFIT, REDEEM_ERRORS, type Profile } from "@/lib/marketValidation";
import type { VerifiedResult } from "./ValidationOtpStep";

export const BENEFIT_CODE_KEY = "hx_benefit_code";

const ROLE_FOR_PROFILE: Record<Profile, string> = {
  familia: "family",
  ips_eps: "institution",
  profesional: "professional",
};

function dateEs(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso);
  return Number.isNaN(t.getTime())
    ? ""
    : t.toLocaleDateString("es-CO", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "America/Bogota",
      });
}

export function ValidationResult({
  result,
  profile,
  loggedIn,
}: {
  result: VerifiedResult;
  profile: Profile | undefined;
  loggedIn: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const redeemed = result.redeemed?.ok ? result.redeemed : null;
  const code = result.promoCode;

  useEffect(() => {
    // El código se guarda en el dispositivo para que /planes lo recuerde al iniciar sesión.
    try {
      if (code && !redeemed) localStorage.setItem(BENEFIT_CODE_KEY, code);
      if (redeemed) localStorage.removeItem(BENEFIT_CODE_KEY);
    } catch {
      /* modo privado: no pasa nada */
    }
  }, [code, redeemed]);

  const copy = async () => {
    if (!code) return;
    await navigator.clipboard.writeText(code).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const signup = `/auth?mode=signup${profile ? `&role=${ROLE_FOR_PROFILE[profile]}` : ""}&redirect=${encodeURIComponent("/planes")}`;
  const share = `https://wa.me/?text=${encodeURIComponent("Ayudé a Humanix a entender qué necesitamos las familias, los profesionales y las IPS de salud en Colombia, y gané 1 mes gratis. Cuéntales tú también: humanix.lat/validacion")}`;

  return (
    <div className="space-y-6 text-center">
      <div className="rounded-2xl bg-ok/10 p-6 ring-2 ring-ok/30">
        <PartyPopper className="mx-auto h-14 w-14 text-ok" aria-hidden="true" />
        <h2 className="mt-3 font-display text-2xl font-bold text-ok sm:text-3xl">
          ¡Gracias por contarnos!
        </h2>
        <p className="mt-2 text-base text-muted-foreground">
          Tus respuestas ya están con el equipo de Humanix y nos ayudan a construir lo que de verdad
          necesitas.
        </p>
      </div>

      {redeemed ? (
        <div className="space-y-3 rounded-2xl border-2 border-ok/40 bg-card p-6" role="status">
          <Gift className="mx-auto h-8 w-8 text-ok" aria-hidden="true" />
          <p className="text-xl font-bold">Tu {BENEFIT.label} ya está activo</p>
          {redeemed.endsAt && (
            <p className="text-sm text-muted-foreground">
              Disfrútalo hasta el {dateEs(redeemed.endsAt)}.
            </p>
          )}
          <Button asChild className="min-h-12 rounded-2xl px-6 text-base">
            <a href="/planes">Ver mi plan</a>
          </Button>
        </div>
      ) : result.benefit === "available" && code ? (
        <div className="space-y-4 rounded-2xl border-2 border-ok/40 bg-card p-6">
          <p className="flex items-center justify-center gap-2 text-lg font-bold text-ok">
            <Gift className="h-5 w-5 shrink-0" aria-hidden="true" /> Ganaste {BENEFIT.label}
          </p>
          {result.redeemed && !result.redeemed.ok && (
            <p role="status" className="text-sm font-semibold text-warn">
              {REDEEM_ERRORS[result.redeemed.error] ?? REDEEM_ERRORS.server}
            </p>
          )}
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-ok/40 bg-background px-4 py-3 sm:flex-row">
            <code
              className="flex-1 break-all text-center font-mono text-lg font-bold tracking-wider text-ok sm:text-left sm:text-xl sm:tracking-widest"
              aria-label="Tu código"
            >
              {code}
            </code>
            <Button
              type="button"
              onClick={copy}
              variant="outline"
              className="min-h-11 rounded-xl"
              aria-label="Copiar código"
            >
              {copied ? (
                <Check className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Copy className="h-4 w-4" aria-hidden="true" />
              )}
              <span className="ml-1.5">{copied ? "Copiado" : "Copiar"}</span>
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            {loggedIn
              ? "Pégalo en «Canjear código» dentro de Planes cuando quieras activarlo."
              : "Crea tu cuenta (o inicia sesión) y pégalo en «Canjear código» dentro de Planes."}
            {result.expiresAt && <> Vale hasta el {dateEs(result.expiresAt)}.</>}
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            {!loggedIn && (
              <Button asChild className="min-h-12 flex-1 rounded-2xl text-base">
                <a href={signup}>Crear mi cuenta gratis</a>
              </Button>
            )}
            <Button asChild variant="outline" className="min-h-12 flex-1 rounded-2xl text-base">
              <a
                href={
                  loggedIn
                    ? "/planes"
                    : `/auth?mode=signin&redirect=${encodeURIComponent("/planes")}`
                }
              >
                {loggedIn ? "Ir a Planes" : "Ya tengo cuenta"}
              </a>
            </Button>
          </div>
        </div>
      ) : result.benefit === "already_redeemed" ? (
        <div className="rounded-2xl bg-muted/60 p-5" role="status">
          <p className="font-bold">Este contacto ya canjeó su mes del plan Esencial.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Gracias por volver a ayudarnos: tus nuevas respuestas también cuentan.
          </p>
        </div>
      ) : result.benefit === "expired" ? (
        <div className="rounded-2xl bg-muted/60 p-5" role="status">
          <p className="font-bold">El código de este contacto venció.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Tus respuestas igual quedaron registradas. Gracias por ayudarnos.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl bg-muted/60 p-5" role="status">
          <p className="text-sm text-muted-foreground">
            Tus respuestas quedaron registradas. El equipo de Humanix te contactará para activar tu
            beneficio.
          </p>
        </div>
      )}

      <Button asChild variant="ghost" className="min-h-11 rounded-2xl text-sm">
        <a href={share} target="_blank" rel="noopener noreferrer">
          <Share2 className="mr-2 h-4 w-4" aria-hidden="true" /> Invitar a alguien más a contarnos
        </a>
      </Button>
    </div>
  );
}
