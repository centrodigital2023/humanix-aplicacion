// «Inicio y cierre» de la ruta de cuidado: una bienvenida corta cuando el cuidado empieza y, solo en las rutas de
// posoperatorio y niño o niña, la opción de guardar el recuerdo del capítulo cuando el episodio parece haber terminado.
//
// Lógica pura y probada en `lib/careChapter`. Nada se envía solo; el cierre es opcional, en condicional, y nunca
// afirma que la persona se recuperó (que no haya servicios no lo prueba).
import { useMemo, useState } from "react";
import { BookHeart, ClipboardCopy, Share2, Sunrise } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  WELCOME_LINES,
  buildChapterNote,
  chapterState,
  chapterSummary,
  type ChapterBooking,
} from "@/lib/careChapter";
import type { CareRoute } from "@/lib/careJourney";
import { whatsappLink } from "@/lib/sos";

export interface CareChapterCardProps {
  route: CareRoute | null;
  bookings: readonly ChapterBooking[];
  now: number;
}

async function copyText(text: string, ok: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(ok);
  } catch {
    toast.error("No pude copiar. Selecciona el texto y cópialo a mano.");
  }
}

export function CareChapterCard({ route, bookings, now }: CareChapterCardProps) {
  const [includeTeam, setIncludeTeam] = useState(false);
  const state = useMemo(() => chapterState({ route, bookings, now }), [route, bookings, now]);
  const summary = useMemo(() => chapterSummary({ bookings, now }), [bookings, now]);
  const note = useMemo(
    () => (summary ? buildChapterNote(summary, { includeTeam }) : ""),
    [summary, includeTeam],
  );

  if (!route) return null;

  if (state.phase === "start") {
    return (
      <Card
        aria-label="Bienvenida al cuidado"
        className="flex items-start gap-3 rounded-3xl border-biosensor/20 bg-gradient-to-br from-biosensor/5 via-background to-copper/5 p-4 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-500 sm:p-5"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-biosensor/15 text-biosensor">
          <Sunrise className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="font-display text-base font-bold leading-tight">Empieza el cuidado</h3>
          <p className="mt-1 text-sm text-muted-foreground">{WELCOME_LINES[route]}</p>
        </div>
      </Card>
    );
  }

  if (state.phase === "closing" && summary) {
    return (
      <Card
        aria-label="Guardar el recuerdo de este capítulo"
        className="space-y-3 rounded-3xl border-copper/25 bg-gradient-to-br from-copper/5 via-background to-biosensor/5 p-4 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-500 sm:p-5"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-copper/15 text-copper">
            <BookHeart className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 className="font-display text-base font-bold leading-tight">
              ¿Quieres guardar el recuerdo de este capítulo?
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Hace {state.daysSince} días que no hay servicio. Si este capítulo ya terminó, puedes
              dejar constancia de lo que hicieron juntos y agradecer a quienes estuvieron. Es
              opcional.
            </p>
          </div>
        </div>
        <pre
          aria-label="Vista previa del recuerdo"
          className="max-h-48 overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-background p-3 font-sans text-sm"
        >
          {note}
        </pre>
        {summary.team.length > 0 && (
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={includeTeam}
              onCheckedChange={setIncludeTeam}
              aria-label="Incluir quién los acompañó"
            />
            Incluir quién los acompañó
          </label>
        )}
        <p className="text-xs text-muted-foreground">
          Solo hechos del cuidado: sin nombres de la persona, pagos ni datos de salud. Tú decides a
          quién enviarlo.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => void copyText(note, "Recuerdo copiado")}
          >
            <ClipboardCopy className="h-4 w-4" aria-hidden="true" /> Copiar
          </Button>
          <Button asChild size="sm" className="gap-1.5">
            <a
              href={whatsappLink(null, note)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Preparar el recuerdo en WhatsApp (tú eliges a quién enviarlo)"
            >
              <Share2 className="h-4 w-4" aria-hidden="true" /> Preparar en WhatsApp
            </a>
          </Button>
        </div>
      </Card>
    );
  }

  return null;
}
