// «Cuenta y privacidad»: eliminar la propia cuenta, de forma discreta.
//
// Discreto en tres sentidos:
//  - En el panel es una línea sobria al final, no una tarjeta roja: nadie tropieza con ella ni la ve como amenaza.
//  - No se avisa a nadie: ni al círculo de cuidado, ni a profesionales, ni a familias.
//  - El diálogo es sereno: dice qué se borra, que no se puede deshacer y ofrece quedarse como opción principal.
//
// Protección (la misma regla en el servidor, `_shared/accountDeletion.ts`): con servicios en curso o programados no
// se elimina; primero se terminan o cancelan desde la agenda, para que nadie se quede esperando.
// Se conserva el nombre del componente para no tocar los tres paneles que lo usan.
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRight, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import {
  OPEN_BOOKING_STATUSES,
  blockersLine,
  deletionBlockers,
  isDeleteConfirmation,
  type DeletionBlockers,
} from "@/lib/accountDeletion";
import { readErrorPayload } from "@/lib/checkout";

type Props = {
  userId: string;
  role: "family" | "professional" | "institution";
  onDeleted?: () => void;
};

const WHAT_GOES: Record<Props["role"], string> = {
  family: "tu perfil, tus solicitudes, tu agenda, tus mensajes y documentos, y tu plan",
  professional:
    "tu perfil profesional, tus documentos y verificaciones, tus postulaciones, tus mensajes y tu plan",
  institution: "el perfil de tu institución, sus ofertas, documentos y mensajes, y tu plan",
};

export function DangerZoneCard({ userId, role, onDeleted }: Props) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [blockers, setBlockers] = useState<DeletionBlockers | null>(null);

  // Se revisa al abrir (no al cargar el panel): sin consultas de más para algo que casi nadie usa.
  useEffect(() => {
    if (!open) return;
    let active = true;
    setBlockers(null);
    void supabase
      .from("service_bookings")
      .select("status, scheduled_at")
      .or(`client_id.eq.${userId},professional_id.eq.${userId}`)
      .in("status", [...OPEN_BOOKING_STATUSES])
      .then(({ data, error }) => {
        if (!active) return;
        // Si la lectura falla, el servidor vuelve a revisar antes de borrar nada.
        setBlockers(
          error
            ? { inProgress: 0, upcoming: 0, blocked: false }
            : deletionBlockers(data ?? [], Date.now()),
        );
      });
    return () => {
      active = false;
    };
  }, [open, userId]);

  const blockedLine = blockers ? blockersLine(blockers) : null;
  const confirmed = isDeleteConfirmation(confirmText);

  async function deleteAccount() {
    setBusy(true);
    const { error } = await supabase.functions.invoke("delete-account");
    if (error) {
      const payload = (await readErrorPayload(error)) as {
        error?: string;
        in_progress?: unknown;
        upcoming?: unknown;
      } | null;
      if (payload?.error === "active_services") {
        const inProgress = Number(payload.in_progress) || 0;
        const upcoming = Number(payload.upcoming) || 0;
        // El servidor encontró servicios abiertos que la lectura del panel no vio: se muestran igual de sereno.
        setBlockers({
          inProgress,
          upcoming: inProgress + upcoming > 0 ? upcoming : 1,
          blocked: true,
        });
      } else {
        toast("No pudimos completar la eliminación.", {
          description: "Tu cuenta sigue igual. Inténtalo de nuevo en un momento.",
        });
      }
      setBusy(false);
      return;
    }
    onDeleted?.();
    await supabase.auth.signOut();
    toast("Tu cuenta fue eliminada.", {
      description: "Gracias por el tiempo que compartiste con Humanix.",
    });
    navigate({ to: "/" });
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Cuenta y privacidad
        </span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-1 underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          Eliminar mi cuenta <ChevronRight className="h-3 w-3" aria-hidden="true" />
        </button>
      </div>

      <AlertDialog
        open={open}
        onOpenChange={(o) => {
          if (busy) return;
          setOpen(o);
          if (!o) setConfirmText("");
        }}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">
              ¿Quieres eliminar tu cuenta?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  Borraremos {WHAT_GOES[role]}. No se puede deshacer y no podremos recuperarlo
                  después.
                </p>
                <p>Es discreto: no enviamos ningún aviso a otras personas.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          {blockers === null ? (
            <div
              className="h-10 animate-pulse rounded-lg bg-muted/60"
              aria-busy="true"
              aria-label="Revisando tu agenda"
            />
          ) : blockedLine ? (
            <p role="status" className="rounded-xl border border-border bg-muted/40 p-3 text-sm">
              {blockedLine}
            </p>
          ) : (
            <label className="block space-y-1.5 text-sm">
              <span>
                Si estás seguro, escribe <strong className="font-semibold">eliminar</strong>:
              </span>
              <Input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                disabled={busy}
                aria-label="Escribe eliminar para confirmar"
              />
            </label>
          )}

          <AlertDialogFooter className="gap-2 sm:gap-2">
            <AlertDialogCancel disabled={busy}>Me quedo</AlertDialogCancel>
            {!blockedLine && (
              <Button
                type="button"
                variant="outline"
                onClick={() => void deleteAccount()}
                disabled={busy || !confirmed || blockers === null}
                className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                {busy ? (
                  <>
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" /> Eliminando…
                  </>
                ) : (
                  "Eliminar mi cuenta"
                )}
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
