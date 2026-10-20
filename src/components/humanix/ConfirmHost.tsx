// Confirmación con el diseño de Humanix, en lugar de la ventana gris del navegador (`window.confirm`).
// Se monta UNA vez (`<ConfirmHost />` en `__root.tsx`) y cualquier pantalla la usa con `await confirmAction({...})`.
// Si por algún motivo no está montada, cae a `window.confirm` para no bloquear la acción.
import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Acción que borra o cierra algo: el botón se pinta en rojo. */
  destructive?: boolean;
}

type Pending = { opts: ConfirmOptions; resolve: (ok: boolean) => void };
let openDialog: ((opts: ConfirmOptions) => Promise<boolean>) | null = null;

export function confirmAction(opts: ConfirmOptions): Promise<boolean> {
  if (openDialog) return openDialog(opts);
  if (typeof window === "undefined") return Promise.resolve(false);
  return Promise.resolve(window.confirm(opts.description ? `${opts.title}\n\n${opts.description}` : opts.title));
}

export function ConfirmHost() {
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    openDialog = (opts) =>
      new Promise<boolean>((resolve) => {
        setPending((prev) => {
          prev?.resolve(false);
          return { opts, resolve };
        });
      });
    return () => {
      openDialog = null;
    };
  }, []);

  const close = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  const o = pending?.opts;
  return (
    <AlertDialog open={!!pending} onOpenChange={(v) => !v && close(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{o?.title}</AlertDialogTitle>
          {o?.description && <AlertDialogDescription>{o.description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => close(false)}>{o?.cancelLabel ?? "Cancelar"}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => close(true)}
            className={cn(o?.destructive && "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
          >
            {o?.confirmLabel ?? "Sí, continuar"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
