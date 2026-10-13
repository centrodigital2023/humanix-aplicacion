// La institución reinicia la contraseña de una persona de su equipo. La nueva se muestra una sola vez (ver CredentialsDialog).
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { generatePassword, passwordError } from "@/lib/institutionMembers";
import { resetInstitutionMemberPassword } from "@/lib/institutionMembers.functions";
import type { TeamMember } from "@/lib/staffPanel";
import type { IssuedCredentials } from "./CredentialsDialog";
import { PasswordFieldRow } from "./PasswordFieldRow";

function schemaFor(username: string) {
  return z.object({ password: z.string() }).superRefine((v, ctx) => {
    const weak = passwordError(v.password, username);
    if (weak) ctx.addIssue({ code: "custom", path: ["password"], message: weak });
  });
}
type Values = { password: string };

export function StaffResetPasswordDialog({
  member,
  onOpenChange,
  onReset,
}: {
  member: TeamMember | null;
  onOpenChange: (open: boolean) => void;
  onReset: (credentials: IssuedCredentials) => void;
}) {
  return (
    <Dialog open={!!member} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {member && (
          <ResetForm
            key={member.id}
            member={member}
            onClose={() => onOpenChange(false)}
            onReset={onReset}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ResetForm({
  member,
  onClose,
  onReset,
}: {
  member: TeamMember;
  onClose: () => void;
  onReset: (credentials: IssuedCredentials) => void;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schemaFor(member.username)),
    defaultValues: { password: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const result = await resetInstitutionMemberPassword({
        data: { memberId: member.id, password: values.password },
      });
      if (!result.ok) {
        const fieldMessage = result.fields?.password;
        if (fieldMessage) form.setError("password", { message: fieldMessage });
        else setFormError(result.message);
        return;
      }
      onReset({
        displayName: member.displayName,
        username: member.username,
        password: values.password,
        kind: "reset",
      });
      onClose();
    } catch {
      setFormError("No se pudo reiniciar la contraseña. Revisa tu conexión e inténtalo de nuevo.");
    }
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>Reiniciar la contraseña de {member.displayName}</DialogTitle>
        <DialogDescription>
          Escribe una nueva o genera una segura. La anterior deja de servir; la nueva se te mostrará
          una sola vez para que se la entregues.
        </DialogDescription>
      </DialogHeader>
      <form
        onSubmit={onSubmit}
        noValidate
        className="space-y-4"
        aria-label={`Reiniciar la contraseña de ${member.displayName}`}
      >
        <PasswordFieldRow
          id="staff-reset-password"
          label="Contraseña nueva"
          hint="Mínimo 10 caracteres, con letras y números, y sin su usuario."
          error={errors.password?.message}
          onGenerate={() =>
            form.setValue("password", generatePassword(14, undefined, member.username), {
              shouldValidate: true,
              shouldDirty: true,
            })
          }
          inputProps={form.register("password")}
        />
        {formError && (
          <p
            role="alert"
            className="rounded-lg border border-sos/30 bg-sos/10 px-3 py-2 text-sm text-sos"
          >
            {formError}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" variant="hero" disabled={isSubmitting}>
            {isSubmitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <KeyRound className="mr-2 h-4 w-4" aria-hidden />
            )}
            Reiniciar contraseña
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
