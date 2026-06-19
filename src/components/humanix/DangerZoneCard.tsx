import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Trash2, Loader2, AlertTriangle, ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Props = {
  userId: string;
  role: "family" | "professional";
  onDeleted?: () => void;
};

/**
 * Zona de peligro: el usuario puede eliminar SU PROPIO perfil.
 * Nunca el de otros (RLS enforced en Supabase: delete policy usa auth.uid() = user_id).
 * Borra el perfil de dominio (family_profiles / professional_profiles) y documentos,
 * pero mantiene la cuenta auth viva (el usuario puede volver a registrarse).
 */
export function DangerZoneCard({ userId, role, onDeleted }: Props) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  async function deleteProfile() {
    setBusy(true);
    try {
      if (role === "family") {
        // Borrar docs de la familia
        await supabase.from("family_documents" as never).delete().eq("user_id", userId);
        await supabase.from("family_profiles").delete().eq("user_id", userId);
      } else {
        await supabase.from("professional_documents").delete().eq("user_id", userId);
        await supabase.from("professional_references").delete().eq("user_id", userId);
        await supabase.from("professional_profiles").delete().eq("user_id", userId);
      }

      // Quitar el rol (family / professional). Superadmin/staff no se tocan.
      await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", userId)
        .in("role", role === "family" ? ["family"] : ["professional"]);

      toast.success("Tu perfil fue eliminado.");
      onDeleted?.();

      // Cerrar sesión y volver al inicio.
      await supabase.auth.signOut();
      navigate({ to: "/" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo eliminar");
    } finally {
      setBusy(false);
      setOpen(false);
      setConfirmText("");
    }
  }

  const kind = role === "family" ? "familiar" : "profesional";

  return (
    <>
      <Card className="border-destructive/30 bg-destructive/5 p-5 space-y-3">
        <div className="flex items-start gap-3">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-destructive/15 text-destructive shrink-0">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-display text-base font-semibold">Zona de peligro</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              Puedes eliminar <strong>tu propio perfil {kind}</strong> en cualquier momento. Los
              datos quedan fuera de Humanix y no podrán ser recuperados. No puedes eliminar el
              perfil de otros usuarios.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          className="border-destructive/40 text-destructive hover:bg-destructive/10"
          onClick={() => setOpen(true)}
        >
          <Trash2 className="h-4 w-4 mr-1" /> Eliminar mi perfil
        </Button>
      </Card>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              ¿Eliminar tu perfil {kind}?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                Se borrarán tus datos de perfil, documentos anexados y referencias. Las reservas
                y calificaciones históricas se conservan por obligación legal (Ley 1581/2012).
              </span>
              <span className="block">
                Para confirmar, escribe <strong>ELIMINAR</strong> abajo:
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="ELIMINAR"
            autoFocus
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (confirmText.trim().toUpperCase() !== "ELIMINAR") {
                  toast.error("Debes escribir ELIMINAR para confirmar.");
                  return;
                }
                deleteProfile();
              }}
              disabled={busy || confirmText.trim().toUpperCase() !== "ELIMINAR"}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  Eliminando…
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-1" /> Eliminar para siempre
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
