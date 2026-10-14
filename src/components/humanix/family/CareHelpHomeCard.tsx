// «Casa lista» y «Pedir ayuda al círculo»: dos ayudas prácticas para la ruta de cuidado.
//
//  - Casa lista: una lista corta y práctica (la casa, lo que hay que tener a la mano, papeles, personas) que la
//    familia va marcando. Se guarda solo en este navegador. Solo organización: nada clínico.
//  - Pedir ayuda: arma un mensaje concreto con los días de la semana sin servicio programado. Solo lo PREPARA; la
//    familia lo revisa y lo envía por su cuenta. Nunca habla de pagos ni de salud.
//
// Lógica pura y probada en `lib/careHomeReady` y `lib/helpRequest`.
import { useEffect, useMemo, useState } from "react";
import { ClipboardCopy, HandHeart, Home, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  HOME_GROUP_LABEL,
  HOME_ITEMS,
  HOME_READY_DISCLAIMER,
  homeProgress,
  pendingItems,
  sanitizeDone,
  toggleDone,
  type HomeGroup,
} from "@/lib/careHomeReady";
import { ROUTES, type CareRoute } from "@/lib/careJourney";
import {
  HELP_ASKS,
  HELP_ASK_LABEL,
  buildHelpRequest,
  type HelpAsk,
  type HelpBooking,
} from "@/lib/helpRequest";
import { whatsappLink } from "@/lib/sos";
import { cn } from "@/lib/utils";

const GROUP_ORDER: readonly HomeGroup[] = ["house", "supplies", "papers", "people"];

export interface CareHelpHomeCardProps {
  route: CareRoute | null;
  userId: string;
  bookings: readonly HelpBooking[];
  now: number;
}

function readDone(key: string, route: CareRoute): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? sanitizeDone(route, JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

async function copyText(text: string, ok: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(ok);
  } catch {
    toast.error("No pude copiar. Selecciona el texto y cópialo a mano.");
  }
}

export function CareHelpHomeCard({ route, userId, bookings, now }: CareHelpHomeCardProps) {
  const [done, setDone] = useState<string[]>([]);
  const [ask, setAsk] = useState<HelpAsk>("company");

  const storageKey = route ? `humanix-home-ready:${userId}:${route}` : null;
  useEffect(() => {
    setDone(route && storageKey ? readDone(storageKey, route) : []);
  }, [route, storageKey]);

  const tone = route ? ROUTES[route].tone : "warm";
  const progress = useMemo(() => (route ? homeProgress(route, done) : null), [route, done]);
  const help = useMemo(
    () => buildHelpRequest({ bookings, now, ask, tone }),
    [bookings, now, ask, tone],
  );

  if (!route || !progress) return null;

  const onToggle = (id: string) => {
    const next = toggleDone(route, done, id);
    setDone(next);
    try {
      if (storageKey) window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* sin almacenamiento: la lista funciona igual durante esta visita */
    }
  };

  // Lo que falta de la casa, listo para repartir con el círculo.
  const pendingText = pendingItems(route, done)
    .map((i) => `• ${i.label}`)
    .join("\n");

  return (
    <Card
      aria-label="Casa lista y ayuda del círculo"
      className="grid gap-4 rounded-3xl border-copper/20 bg-gradient-to-br from-copper/5 via-background to-biosensor/5 p-4 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-500 sm:p-6 lg:grid-cols-2"
    >
      {/* Casa lista */}
      <section aria-label="Casa lista" className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-copper/15 text-copper">
            <Home className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 className="font-display text-lg font-bold leading-tight">Casa lista</h3>
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {progress.line}
            </p>
          </div>
        </div>
        <div
          role="progressbar"
          aria-label="Avance de la casa"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.done}
          aria-valuetext={`${progress.done} de ${progress.total}`}
          className="h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div
            className={cn(
              "h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500",
              progress.complete ? "bg-ok" : "bg-copper",
            )}
            style={{ width: `${progress.pct}%` }}
          />
        </div>
        {GROUP_ORDER.map((g) => {
          const items = HOME_ITEMS[route].filter((i) => i.group === g);
          if (items.length === 0) return null;
          return (
            <div key={g}>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {HOME_GROUP_LABEL[g]}
              </p>
              <ul className="mt-1 space-y-1.5">
                {items.map((i) => (
                  <li key={i.id}>
                    <label className="flex cursor-pointer items-start gap-2 text-sm">
                      <Checkbox
                        checked={done.includes(i.id)}
                        onCheckedChange={() => onToggle(i.id)}
                        className="mt-0.5"
                      />
                      <span
                        className={cn(done.includes(i.id) && "text-muted-foreground line-through")}
                      >
                        {i.label}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {!progress.complete && pendingText && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() =>
              void copyText(
                `Para dejar la casa lista nos falta:\n${pendingText}\n\n¿Quién se anima con alguno?`,
                "Lista copiada para repartir",
              )
            }
          >
            <ClipboardCopy className="h-4 w-4" aria-hidden="true" /> Copiar lo que falta para
            repartir
          </Button>
        )}
        <p className="text-xs text-muted-foreground">
          {HOME_READY_DISCLAIMER} Se guarda solo en este navegador.
        </p>
      </section>

      {/* Pedir ayuda */}
      <section aria-label="Pedir ayuda al círculo" className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-biosensor/15 text-biosensor">
            <HandHeart className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 className="font-display text-lg font-bold leading-tight">Pedir ayuda al círculo</h3>
            <p className="text-sm text-muted-foreground">
              Pedir ayuda no es fallar. Un mensaje concreto es más fácil de responder.
            </p>
          </div>
        </div>
        <ToggleGroup
          type="single"
          value={ask}
          onValueChange={(v) => {
            if ((HELP_ASKS as readonly string[]).includes(v)) setAsk(v as HelpAsk);
          }}
          aria-label="Qué necesitas"
          className="flex flex-wrap justify-start gap-1.5"
        >
          {HELP_ASKS.map((a) => (
            <ToggleGroupItem
              key={a}
              value={a}
              className="h-auto rounded-full border border-border px-3 py-1.5 text-xs data-[state=on]:border-biosensor/40 data-[state=on]:bg-biosensor/10 data-[state=on]:text-biosensor"
            >
              {HELP_ASK_LABEL[a]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <pre
          aria-label="Vista previa del mensaje"
          className="max-h-56 overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-background p-3 font-sans text-sm"
        >
          {help.text}
        </pre>
        <p className="text-xs text-muted-foreground">
          Revísalo antes de enviarlo: solo lo preparamos, tú eliges a quién. No incluye nombres,
          pagos ni datos de salud.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => void copyText(help.text, "Mensaje copiado")}
          >
            <ClipboardCopy className="h-4 w-4" aria-hidden="true" /> Copiar
          </Button>
          <Button asChild size="sm" className="gap-1.5">
            <a
              href={whatsappLink(null, help.text)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Preparar el mensaje en WhatsApp (tú eliges a quién enviarlo)"
            >
              <Share2 className="h-4 w-4" aria-hidden="true" /> Preparar en WhatsApp
            </a>
          </Button>
        </div>
      </section>
    </Card>
  );
}
