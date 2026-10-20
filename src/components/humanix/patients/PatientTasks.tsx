// Tareas: lo que falta hacer por cada paciente (llamar, visitar, laboratorio…) y, en el tablero, la bandeja de lo que vence hoy. Con el plan
// IPS Mejorado el sistema agenda solo los seguimientos de cada caso; aquí se marcan como hechos u omitidos.
import { useState, type ReactNode } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Bot, Check, ChevronDown, ListPlus, Loader2, SkipForward } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { CareActions } from "@/hooks/use-inst-care";
import { TASK_KIND_LABEL, dayClockLabel, nowMs, type Clock } from "@/lib/instCare";
import type { InstCase, InstPatient, InstTask } from "@/lib/instCareTypes";
import {
  TASK_KIND_OPTIONS,
  taskFormSchema,
  taskPayload,
  type TaskFormValues,
} from "@/lib/instForms";
import { cn } from "@/lib/utils";
import { SelectField, TextField } from "@/components/humanix/instcare/fields";
import { TONE } from "@/components/humanix/instcare/tones";
import { friendlyError } from "@/lib/friendlyError";

function TaskRow({
  task,
  now,
  actions,
  canWrite,
  who,
  extra,
}: {
  task: InstTask;
  now: Clock;
  actions: CareActions;
  canWrite: boolean;
  who?: string;
  /** Algo más a la derecha (por ejemplo el botón para abrir la ficha). */
  extra?: ReactNode;
}) {
  const late = Date.parse(task.due_at) < nowMs(now);
  const busy = actions.finishTask.isPending;
  const finish = async (status: "done" | "skipped") => {
    try {
      await actions.finishTask.mutateAsync({ id: task.id, status });
      toast.success(status === "done" ? "Tarea hecha" : "Tarea omitida");
    } catch (e) {
      toast.error(friendlyError(e));
    }
  };
  return (
    <li
      className={cn(
        "flex items-center gap-3 rounded-xl border p-3",
        late ? cn(TONE.warn.border, TONE.warn.soft) : "border-border bg-card",
      )}
      data-testid="task-item"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{task.title}</p>
        <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
          {who && <span className="font-medium text-foreground">{who}</span>}
          <span>{TASK_KIND_LABEL[task.kind]}</span>
          <span className={cn(late && "font-semibold text-warn")}>
            {late ? "Venció " : "Vence "}
            {dayClockLabel(task.due_at, now)}
          </span>
          {task.source === "auto_followup" && (
            <span className="inline-flex items-center gap-1 text-biosensor">
              <Bot className="h-3 w-3" aria-hidden /> Seguimiento automático
            </span>
          )}
        </p>
      </div>
      {extra}
      {canWrite && (
        <div className="flex shrink-0 gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void finish("done")}
            aria-label={`Marcar como hecha: ${task.title}`}
          >
            <Check aria-hidden /> Hecha
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            disabled={busy}
            onClick={() => void finish("skipped")}
            aria-label={`Omitir: ${task.title}`}
            title="Omitir"
          >
            <SkipForward aria-hidden />
          </Button>
        </div>
      )}
    </li>
  );
}

export function TasksPanel({
  patient,
  tasks,
  cases,
  actions,
  now,
  canWrite,
}: {
  patient: InstPatient;
  tasks: InstTask[];
  cases: InstCase[];
  actions: CareActions;
  now: Clock;
  canWrite: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: { title: "", kind: "call", due_local: "" },
  });
  const { isSubmitting } = form.formState;
  const open = tasks
    .filter((t) => t.status === "open")
    .sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at));
  const closed = tasks.filter((t) => t.status !== "open");
  const discharged = patient.status === "discharged";
  void cases;

  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const p = taskPayload(v);
      await actions.addTask.mutateAsync({
        patientId: patient.id,
        title: p.title,
        kind: p.kind,
        dueAt: p.dueAt,
      });
      toast.success("Tarea agregada");
      form.reset({ title: "", kind: v.kind, due_local: "" });
    } catch (e) {
      setError((e as Error).message);
    }
  });

  return (
    <div className="space-y-4" data-testid="tasks-panel">
      {canWrite && !discharged && (
        <Card className="rounded-2xl p-4">
          <form onSubmit={submit} noValidate className="space-y-3" aria-label="Agregar una tarea">
            {error && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
              <TextField
                form={form}
                name="title"
                label="Nueva tarea"
                placeholder="Ej.: Llamar para confirmar la cita"
              />
              <SelectField form={form} name="kind" label="Tipo" options={TASK_KIND_OPTIONS} />
            </div>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <TextField
                form={form}
                name="due_local"
                label="Cuándo vence (hora de Colombia)"
                type="datetime-local"
                hint="Si lo dejas vacío, vence mañana a esta hora."
                className="w-full sm:w-64"
              />
              <Button type="submit" variant="hero" size="sm" disabled={isSubmitting}>
                {isSubmitting ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <ListPlus aria-hidden />
                )}{" "}
                Agregar tarea
              </Button>
            </div>
          </form>
        </Card>
      )}

      {open.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {discharged
            ? "No quedan tareas pendientes."
            : "Sin tareas pendientes. ¡Todo al día con esta persona!"}
        </p>
      ) : (
        <ul className="space-y-2" aria-label="Tareas pendientes">
          {open.map((t) => (
            <TaskRow key={t.id} task={t} now={now} actions={actions} canWrite={canWrite} />
          ))}
        </ul>
      )}

      {closed.length > 0 && (
        <details className="group rounded-2xl border border-border p-3">
          <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-medium text-muted-foreground">
            Hechas y omitidas ({closed.length})
            <ChevronDown
              className="h-4 w-4 transition-transform group-open:rotate-180"
              aria-hidden
            />
          </summary>
          <ul className="mt-3 space-y-1.5">
            {closed.slice(0, 40).map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-2 text-xs text-muted-foreground"
              >
                <span className={cn("truncate", t.status === "skipped" && "line-through")}>
                  {t.title}
                </span>
                <span className="shrink-0">
                  {t.status === "done" ? "Hecha" : "Omitida"}
                  {t.completed_name ? ` por ${t.completed_name}` : ""}
                  {t.completed_at ? ` · ${dayClockLabel(t.completed_at, now)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** La bandeja del tablero: lo que vence primero en toda la institución. */
export function TasksInbox({
  tasks,
  patients,
  now,
  actions,
  canWrite,
  onOpenPatient,
  max = 5,
}: {
  tasks: InstTask[];
  patients: InstPatient[];
  now: Clock;
  actions: CareActions;
  canWrite: boolean;
  onOpenPatient: (id: string) => void;
  max?: number;
}) {
  const names = new Map(patients.map((p) => [p.id, p.full_name]));
  const open = tasks
    .filter((t) => t.status === "open" && names.has(t.patient_id))
    .sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at));
  if (open.length === 0) return null;
  const overdue = open.filter((t) => Date.parse(t.due_at) < nowMs(now)).length;
  return (
    <section aria-label="Tareas por hacer" data-testid="tasks-inbox" className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h3 className="font-display text-sm font-bold">Tareas por hacer</h3>
        <span className="text-[11px] text-muted-foreground">
          {open.length} {open.length === 1 ? "pendiente" : "pendientes"}
          {overdue > 0 && <span className="font-semibold text-warn"> · {overdue} vencidas</span>}
        </span>
      </div>
      <ul className="space-y-2">
        {open.slice(0, max).map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            now={now}
            actions={actions}
            canWrite={canWrite}
            who={names.get(t.patient_id)}
            extra={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0 px-2 text-xs"
                onClick={() => onOpenPatient(t.patient_id)}
                aria-label={`Abrir la ficha de ${names.get(t.patient_id)}`}
              >
                Ficha
              </Button>
            }
          />
        ))}
      </ul>
      {open.length > max && (
        <p className="text-[11px] text-muted-foreground">
          Y {open.length - max} más en las fichas.
        </p>
      )}
    </section>
  );
}
