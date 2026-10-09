// Pasaporte profesional (plan Pro): resumen imprimible de la trayectoria con código QR al perfil público.
// Las cifras las calcula el servidor a partir de servicios completados en la plataforma; el QR lleva a la página
// pública donde cualquiera puede comprobarlas. Se imprime o se guarda como PDF desde el navegador.
import { BadgeCheck, Printer } from "lucide-react";
import QRCode from "react-qr-code";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  careerLevel,
  computeBadges,
  publicHighlights,
  tierName,
  type CareerStats,
} from "@/lib/careerStats";
import { kudosChips, kudosRowsFromMap, publicProfileUrl } from "@/lib/kudos";

const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  .passport-print-area, .passport-print-area * { visibility: visible !important; }
  .passport-print-area { position: fixed !important; inset: 0 !important; margin: 0 !important; padding: 18mm !important; border: 0 !important; box-shadow: none !important; max-width: none !important; }
}`;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  fullName: string;
  specialty: string | null;
  verified: boolean;
  stats: CareerStats;
};

export function CareerPassportDialog({
  open,
  onOpenChange,
  userId,
  fullName,
  specialty,
  verified,
  stats,
}: Props) {
  const url = publicProfileUrl(userId);
  const level = careerLevel(stats.completedServices);
  const earned = computeBadges(stats).filter((b) => b.earned);
  const highlights = publicHighlights(stats);
  const gratitude = kudosChips(kudosRowsFromMap(stats.kudosByKind), 4);
  const today = new Intl.DateTimeFormat("es-CO", {
    dateStyle: "long",
    timeZone: "America/Bogota",
  }).format(new Date());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <style>{PRINT_CSS}</style>
        <DialogHeader className="print:hidden">
          <DialogTitle>Pasaporte profesional</DialogTitle>
          <DialogDescription>
            Tu trayectoria verificada, lista para imprimir o guardar como PDF. El código QR lleva a
            tu perfil público.
          </DialogDescription>
        </DialogHeader>

        <article className="passport-print-area space-y-5 rounded-xl border border-border bg-white p-6 text-black">
          <header className="flex items-start justify-between gap-4 border-b border-black/10 pb-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-black/60">
                Humanix · Pasaporte profesional
              </p>
              <h2 className="mt-1 font-display text-2xl font-bold">
                {fullName || "Profesional de la salud"}
              </h2>
              <p className="text-sm text-black/70">{specialty || "Cuidado en casa"}</p>
              {verified && (
                <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-black/80">
                  <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" /> Identidad y RETHUS
                  verificados por Humanix
                </p>
              )}
            </div>
            <div className="shrink-0 text-center">
              <div className="h-24 w-24 bg-white p-1 text-black">
                <QRCode
                  value={url}
                  size={88}
                  level="M"
                  fgColor="currentColor"
                  bgColor="transparent"
                  style={{ height: "100%", width: "100%" }}
                />
              </div>
              <p className="mt-1 text-[9px] text-black/60">Escanea para verificar</p>
            </div>
          </header>

          <section aria-label="Nivel">
            <p className="text-sm font-semibold">
              Nivel {level.level} · {level.label}
            </p>
          </section>

          {highlights.length > 0 && (
            <section aria-label="Cifras">
              <ul className="grid grid-cols-2 gap-2 text-sm">
                {highlights.map((h) => (
                  <li key={h} className="rounded-lg border border-black/10 px-3 py-2 font-medium">
                    {h}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {earned.length > 0 && (
            <section aria-label="Sellos">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-black/60">
                Sellos
              </h3>
              <ul className="mt-2 flex flex-wrap gap-2">
                {earned.map((b) => (
                  <li
                    key={b.id}
                    className="rounded-full border border-black/15 px-3 py-1 text-xs font-medium"
                  >
                    {b.title} · {tierName(b.tier)}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {gratitude.length > 0 && (
            <section aria-label="Reconocimientos">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-black/60">
                Lo que dicen las familias
              </h3>
              <ul className="mt-2 flex flex-wrap gap-2">
                {gratitude.map((g) => (
                  <li
                    key={g.id}
                    className="rounded-full border border-black/15 px-3 py-1 text-xs font-medium"
                  >
                    {g.emoji} {g.label} · {g.count}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <footer className="border-t border-black/10 pt-3 text-[10px] leading-relaxed text-black/60">
            <p>
              Cifras calculadas por Humanix a partir de servicios completados en la plataforma, al{" "}
              {today}. No incluye nombres de pacientes ni de familias. Verifica en {url}
            </p>
          </footer>
        </article>

        <div className="flex justify-end print:hidden">
          <Button type="button" variant="hero" className="gap-2" onClick={() => window.print()}>
            <Printer className="h-4 w-4" aria-hidden="true" /> Imprimir o guardar PDF
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
