// La persona del equipo cambia su propia contraseña. Se vuelve a comprobar la actual (iniciando sesión de nuevo) antes de cambiarla,
// y la nueva cumple la misma política que usa la institución al crearla o reiniciarla.
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { supabase } from "@/integrations/supabase/client";
import { passwordError, staffEmail } from "@/lib/institutionMembers";

function schemaFor(username: string) {
  return z
    .object({
      current: z.string().min(1, "Escribe tu contraseña actual."),
      next: z.string(),
      confirm: z.string(),
    })
    .superRefine((v, ctx) => {
      const weak = passwordError(v.next, username);
      if (weak) ctx.addIssue({ code: "custom", path: ["next"], message: weak });
      else if (v.next === v.current) {
        ctx.addIssue({
          code: "custom",
          path: ["next"],
          message: "Elige una contraseña distinta de la actual.",
        });
      }
      if (v.next !== v.confirm) {
        ctx.addIssue({
          code: "custom",
          path: ["confirm"],
          message: "Las contraseñas no coinciden.",
        });
      }
    });
}
type Values = { current: string; next: string; confirm: string };

export function StaffPasswordDialog({
  username,
  open,
  onOpenChange,
}: {
  username: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schemaFor(username)),
    defaultValues: { current: "", next: "", confirm: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const close = (next: boolean) => {
    if (!next) {
      form.reset();
      setFormError(null);
    }
    onOpenChange(next);
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    const check = await supabase.auth.signInWithPassword({
      email: staffEmail(username),
      password: values.current,
    });
    if (check.error) {
      setFormError("La contraseña actual no es correcta.");
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: values.next });
    if (error) {
      setFormError(
        error.code === "same_password"
          ? "Elige una contraseña distinta de la actual."
          : error.code === "weak_password"
            ? "Elige una contraseña más segura."
            : "No se pudo cambiar la contraseña. Inténtalo de nuevo en unos minutos.",
      );
      return;
    }
    toast.success("Cambiaste tu contraseña");
    close(false);
  });

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cambiar mi contraseña</DialogTitle>
          <DialogDescription>
            Usa al menos 10 caracteres, con letras y números, y sin tu usuario.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={onSubmit}
          noValidate
          className="space-y-4"
          aria-label="Cambiar mi contraseña"
        >
          {(
            [
              ["current", "Contraseña actual", "current-password"],
              ["next", "Contraseña nueva", "new-password"],
              ["confirm", "Repite la contraseña nueva", "new-password"],
            ] as const
          ).map(([name, label, auto]) => (
            <div key={name} className="space-y-1.5">
              <Label htmlFor={`staff-pw-${name}`}>{label}</Label>
              <Input
                id={`staff-pw-${name}`}
                type="password"
                autoComplete={auto}
                aria-invalid={!!errors[name]}
                aria-describedby={errors[name] ? `staff-pw-${name}-error` : undefined}
                {...form.register(name)}
              />
              {errors[name] && (
                <p id={`staff-pw-${name}-error`} role="alert" className="text-xs text-sos">
                  {errors[name]?.message}
                </p>
              )}
            </div>
          ))}
          {formError && (
            <p
              role="alert"
              className="rounded-lg border border-sos/30 bg-sos/10 px-3 py-2 text-sm text-sos"
            >
              {formError}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => close(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="hero" disabled={isSubmitting}>
              {isSubmitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <KeyRound className="mr-2 h-4 w-4" aria-hidden />
              )}
              Cambiar contraseña
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
