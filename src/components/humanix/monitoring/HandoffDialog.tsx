// Relevo de turno (I-PASS): un borrador por paciente con los datos reales (gravedad sugerida por el NEWS2 y las alertas, resumen, acciones de
// las próximas 12 horas, qué hacer si cambia) que la persona corrige. Copiar o descargar la hoja es libre; guardarla en la historia de cada
// paciente es del plan Institucional. Es un borrador: no reemplaza el criterio clínico de quien entrega ni de quien recibe.
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ClipboardCopy, Download, Loader2, Lock, Repeat, Save } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { downloadText } from "@/components/humanix/premium/download";
import type { CareActions } from "@/hooks/use-inst-care";
import type { CareOverview } from "@/lib/instCare";
import type { InstAlert, InstLive, InstPatient, InstTask } from "@/lib/instCareTypes";
import {
  HANDOFF_MAX_PATIENTS,
  HANDOFF_TEXT_MAX,
  ILLNESS_META,
  draftHandoff,
  handoffPayload,
  handoffToText,
  validateHandoff,
  type HandoffDraft,
  type Illness,
} from "@/lib/instHandoff";
import { cn } from "@/lib/utils";
import { TONE } from "@/components/humanix/instcare/tones";

const ORDER: Illness[] = ["unstable", "watcher", "stable"];

export function HandoffDialog({
  open,
  onOpenChange,
  patients,
  live,
  alerts,
  tasks,
  overview,
  actions,
  institutionName,
  viewerName,
  now,
  onlyMonitored,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patients: InstPatient[];
  live: Map<string, InstLive>;
  alerts: InstAlert[];
  tasks: InstTask[];
  overview: CareOverview;
  actions: CareActions;
  institutionName: string;
  viewerName?: string | null;
  now: number;
  /** En el módulo de monitoreo se releva a las personas monitoreadas; en el de pacientes, a todas las activas. */
  onlyMonitored: boolean;
}) {
  const initial = useMemo(
    () =>
      draftHandoff({
        patients: onlyMonitored ? patients.filter((p) => p.monitoring) : patients,
        live,
        alerts,
        tasks,
        now,
      }),
    // Un borrador por apertura: no se reescribe lo que la persona ya corrigió cada vez que llega un dato en vivo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open],
  );
  const [drafts, setDrafts] = useState<HandoffDraft[]>(initial);
  const [included, setIncluded] = useState<Set<string>>(new Set(initial.map((d) => d.patientId)));
  const [from, setFrom] = useState(viewerName ?? "");
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) {
      setDrafts(initial);
      setIncluded(new Set(initial.map((d) => d.patientId)));
      setFrom(viewerName ?? "");
      setTo("");
      setError(null);
    }
  }, [open, initial, viewerName]);

  const chosen = drafts.filter((d) => included.has(d.patientId));
  const check = validateHandoff(chosen);
  const canSave = overview.limits.handoff;
  const update = (id: string, patch: Partial<HandoffDraft>) =>
    setDrafts((list) => list.map((d) => (d.patientId === id ? { ...d, ...patch } : d)));
  const sheet = () => handoffToText(chosen, { institution: institutionName, now, from, to });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sheet());
      toast.success("Hoja del relevo copiada");
    } catch {
      toast.error("No se pudo copiar. Descárgala como archivo.");
    }
  };
  const download = () =>
    downloadText(`relevo-de-turno-${new Date(now).toISOString().slice(0, 10)}.txt`, sheet());
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await actions.commitHandoff.mutateAsync({ items: handoffPayload(chosen) });
      toast.success(`Relevo guardado en ${r.saved} ${r.saved === 1 ? "historia" : "historias"}`);
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-3xl" data-testid="handoff">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Repeat className="h-4 w-4 text-biosensor" aria-hidden /> Relevo de turno
          </DialogTitle>
          <DialogDescription>
            Un borrador por paciente con sus datos reales. Corrígelo: quien recibe repite lo más
            importante con sus palabras y firma la hoja.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="ho-from" className="text-xs font-medium">
              Entrega
            </Label>
            <Input
              id="ho-from"
              value={from}
              onChange={(e) => setFrom(e.target.value.slice(0, 80))}
              placeholder="Tu nombre"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ho-to" className="text-xs font-medium">
              Recibe
            </Label>
            <Input
              id="ho-to"
              value={to}
              onChange={(e) => setTo(e.target.value.slice(0, 80))}
              placeholder="Quién toma el turno"
            />
          </div>
        </div>

        {drafts.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No hay pacientes activos para relevar.
          </p>
        ) : (
          <ul className="space-y-3" aria-label="Pacientes del relevo">
            {drafts.map((d) => {
              const on = included.has(d.patientId);
              const meta = ILLNESS_META[d.illness];
              return (
                <li
                  key={d.patientId}
                  className={cn(
                    "rounded-2xl border p-3 sm:p-4",
                    on ? TONE[meta.tone].border : "border-border opacity-60",
                  )}
                  data-testid="handoff-item"
                  data-illness={d.illness}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Checkbox
                      id={`ho-${d.patientId}`}
                      checked={on}
                      onCheckedChange={(v) =>
                        setIncluded((s) => {
                          const n = new Set(s);
                          if (v === true) n.add(d.patientId);
                          else n.delete(d.patientId);
                          return n;
                        })
                      }
                      aria-label={`Incluir a ${d.name}`}
                    />
                    <Label htmlFor={`ho-${d.patientId}`} className="text-sm font-semibold">
                      {d.name}
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                        {[d.age, d.room ? `hab. ${d.room}` : ""].filter(Boolean).join(" · ")}
                      </span>
                    </Label>
                    <div
                      role="radiogroup"
                      aria-label={`Gravedad de ${d.name}`}
                      className="ml-auto flex gap-1"
                    >
                      {ORDER.map((i) => (
                        <button
                          key={i}
                          type="button"
                          role="radio"
                          aria-checked={d.illness === i}
                          disabled={!on}
                          onClick={() => update(d.patientId, { illness: i })}
                          title={ILLNESS_META[i].help}
                          className={cn(
                            "rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors focus-premium",
                            d.illness === i
                              ? TONE[ILLNESS_META[i].tone].chip
                              : "border-border text-muted-foreground hover:bg-muted/50",
                          )}
                        >
                          {ILLNESS_META[i].label}
                          {d.suggested === i && (
                            <span className="ml-1 text-[9px] font-normal opacity-70">
                              (sugerido)
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                  {d.flags.length > 0 && (
                    <p className="mt-2 flex items-start gap-1.5 text-xs font-medium text-sos">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{" "}
                      {d.flags.join(" · ")}
                    </p>
                  )}
                  {on && (
                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      {(
                        [
                          ["summary", "Resumen"],
                          ["actions", "Qué falta hacer"],
                          ["contingency", "Si cambia"],
                        ] as const
                      ).map(([key, label]) => (
                        <div key={key} className="space-y-1">
                          <Label
                            htmlFor={`ho-${key}-${d.patientId}`}
                            className="text-[11px] font-medium text-muted-foreground"
                          >
                            {label}
                          </Label>
                          <Textarea
                            id={`ho-${key}-${d.patientId}`}
                            rows={4}
                            value={d[key]}
                            onChange={(e) => update(d.patientId, { [key]: e.target.value })}
                            className="text-xs leading-relaxed"
                          />
                          <p
                            className={cn(
                              "text-right text-[10px] tabular-nums",
                              d[key].length > HANDOFF_TEXT_MAX
                                ? "text-sos"
                                : "text-muted-foreground",
                            )}
                          >
                            {d[key].length} / {HANDOFF_TEXT_MAX}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {!check.ok && chosen.length > 0 && (
          <ul className="space-y-0.5 text-xs text-sos" role="alert">
            {check.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        {drafts.length > HANDOFF_MAX_PATIENTS && (
          <p className="text-xs text-warn">
            Un relevo admite hasta {HANDOFF_MAX_PATIENTS} pacientes: quita a algunos.
          </p>
        )}

        <DialogFooter className="gap-2 sm:flex-wrap sm:justify-between sm:gap-0">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void copy()}
              disabled={chosen.length === 0}
            >
              <ClipboardCopy aria-hidden /> Copiar hoja
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={download}
              disabled={chosen.length === 0}
            >
              <Download aria-hidden /> Descargar
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!canSave && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Lock className="h-3 w-3" aria-hidden /> Guardar en la historia: Institucional
              </span>
            )}
            <Button
              type="button"
              variant="hero"
              size="sm"
              onClick={() => void save()}
              disabled={!canSave || !check.ok || saving}
            >
              {saving ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}{" "}
              Guardar en la historia
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
