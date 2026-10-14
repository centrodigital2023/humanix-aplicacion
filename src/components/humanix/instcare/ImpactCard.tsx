// «Tu semana de cuidado»: lo que el equipo hizo en los últimos 7 días, con la racha de alertas atendidas a tiempo, listo para compartir como
// texto o como imagen. Solo cifras: ningún nombre, documento ni dato de un paciente. Sin actividad no se muestran ceros disfrazados de logro.
import { useRef, useState } from "react";
import { Copy, Download, Flame, Loader2, Share2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { CareOverview } from "@/lib/instCare";
import { impactShareText, impactSummary, streakInfo, STREAK_HINT } from "@/lib/instCelebrate";
import { cn } from "@/lib/utils";
import { TONE } from "./tones";

function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ImpactCard({
  overview,
  institution,
  className,
}: {
  overview: CareOverview;
  institution: string;
  className?: string;
}) {
  const summary = impactSummary(overview);
  const streak = streakInfo(overview);
  const nodeRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const text = impactShareText(overview, { institution });
  const st = TONE[streak.tone];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Texto copiado: pégalo donde quieras compartirlo");
    } catch {
      toast.error("No se pudo copiar. Selecciónalo y cópialo a mano.");
    }
  };

  const share = async () => {
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ text });
        return;
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
    }
    await copy();
  };

  const saveImage = async () => {
    const node = nodeRef.current;
    if (!node) return;
    setBusy(true);
    try {
      const { toBlob } = await import("html-to-image");
      const blob = await toBlob(node, {
        pixelRatio: 2,
        cacheBust: true,
        // El fondo del propio tema: la imagen sale igual en claro y en oscuro.
        backgroundColor: getComputedStyle(document.body).backgroundColor,
      });
      if (!blob) throw new Error("vacía");
      downloadBlob(
        `humanix-semana-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.png`,
        blob,
      );
      toast.success("Imagen descargada");
    } catch {
      toast.error("No se pudo crear la imagen. Copia el texto en su lugar.");
    } finally {
      setBusy(false);
    }
  };

  if (summary.empty) {
    return (
      <Card
        className={cn(
          "rounded-2xl border-dashed border-border p-4 text-sm text-muted-foreground",
          className,
        )}
        data-testid="impact-empty"
      >
        <p className="flex items-center gap-1.5 font-semibold text-foreground">
          <Sparkles className="h-4 w-4 text-copper" aria-hidden /> Tu semana de cuidado
        </p>
        <p className="mt-1">
          Aquí verás lo que tu equipo logra cada semana: controles, alertas atendidas a tiempo,
          casos cerrados. Empieza con el primer control de signos o la primera nota.
        </p>
      </Card>
    );
  }

  return (
    <section
      aria-label="Tu semana de cuidado"
      className={cn("space-y-2", className)}
      data-testid="impact-card"
    >
      <div
        ref={nodeRef}
        className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-biosensor/10 via-card to-fuchsia-neural/10 p-5"
      >
        <div aria-hidden="true" className="orb-bio -right-10 -top-10 h-40 w-40 opacity-70" />
        <div className="relative">
          <p className="text-[10px] font-bold uppercase tracking-widest text-biosensor">
            Últimos 7 días · {institution}
          </p>
          <h3 className="mt-1 font-display text-xl font-bold leading-tight">
            Tu semana de cuidado
          </h3>
          {summary.headline && (
            <p className="mt-1 text-sm text-muted-foreground">Tu equipo hizo {summary.headline}.</p>
          )}
          <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {summary.lines.map((l) => (
              <div
                key={l.key}
                className="rounded-2xl bg-background/70 px-3 py-2 ring-1 ring-border"
              >
                <dd className="font-display text-xl font-bold tabular-nums">{l.value}</dd>
                <dt className="text-[11px] leading-tight text-muted-foreground">{l.label}</dt>
                {l.sub && <p className="mt-0.5 text-[10px] text-muted-foreground">{l.sub}</p>}
              </div>
            ))}
          </dl>
          {summary.onTimePct !== null && (
            <p className="mt-3 text-xs font-medium">
              {summary.onTimePct} % de las alertas se atendieron a tiempo.
            </p>
          )}
          {streak.count > 0 && (
            <p
              className={cn(
                "mt-3 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
                st.chip,
              )}
              title={STREAK_HINT}
            >
              <Flame className="h-3.5 w-3.5" aria-hidden /> Racha: {streak.count} alertas urgentes a
              tiempo
            </p>
          )}
          <p className="mt-4 text-[10px] text-muted-foreground">
            Cuidado coordinado, a tiempo y con trazabilidad · humanix.lat
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => void copy()}>
          <Copy aria-hidden /> Copiar texto
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => void share()}>
          <Share2 aria-hidden /> Compartir
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void saveImage()}
          disabled={busy}
        >
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}{" "}
          Descargar imagen
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Solo cifras de la semana: no incluye nombres ni datos de pacientes. Tú decides si lo
        compartes.
      </p>
    </section>
  );
}
