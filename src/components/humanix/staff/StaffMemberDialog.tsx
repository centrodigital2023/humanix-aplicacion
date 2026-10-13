// Crear a una persona del equipo (usuario, contraseña, cargo y módulos) o editar nombre, cargo y módulos de una existente.
// Una sola validación: los mismos esquemas Zod que repite el servidor (`institutionMembers.ts`).
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
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
import {
  STAFF_MODULES,
  createMemberSchema,
  generatePassword,
  memberProfileSchema,
  normalizeUsername,
  type CreateMemberInput,
  type MemberProfileInput,
  type StaffModuleKey,
} from "@/lib/institutionMembers";
import {
  createInstitutionMember,
  updateInstitutionMember,
  type MemberResult,
} from "@/lib/institutionMembers.functions";
import type { TeamMember } from "@/lib/staffPanel";
import type { IssuedCredentials } from "./CredentialsDialog";
import { PasswordFieldRow } from "./PasswordFieldRow";

function ModulePicker({
  value,
  onChange,
  error,
}: {
  value: readonly string[];
  onChange: (next: StaffModuleKey[]) => void;
  error?: string;
}) {
  return (
    <fieldset className="space-y-2" aria-describedby={error ? "staff-modules-error" : undefined}>
      <legend className="text-sm font-medium">Módulos a los que puede entrar</legend>
      {STAFF_MODULES.map((m) => {
        const checked = value.includes(m.key);
        return (
          <label
            key={m.key}
            htmlFor={`staff-module-${m.key}`}
            className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-muted/40"
          >
            <Checkbox
              id={`staff-module-${m.key}`}
              checked={checked}
              onCheckedChange={(on) => {
                const set = new Set(value);
                if (on === true) set.add(m.key);
                else set.delete(m.key);
                onChange(STAFF_MODULES.filter((x) => set.has(x.key)).map((x) => x.key));
              }}
              className="mt-0.5"
            />
            <span className="space-y-0.5">
              <span className="block text-sm font-medium">{m.label}</span>
              <span className="block text-xs text-muted-foreground">{m.description}</span>
            </span>
          </label>
        );
      })}
      {error && (
        <p id="staff-modules-error" role="alert" className="text-xs text-sos">
          {error}
        </p>
      )}
    </fieldset>
  );
}

function applyServerFields<T extends Record<string, unknown>>(
  result: Extract<MemberResult, { ok: false }>,
  setError: (name: keyof T & string, error: { message: string }) => void,
  known: readonly string[],
): string | null {
  let placed = false;
  for (const [field, message] of Object.entries(result.fields ?? {})) {
    if (known.includes(field)) {
      setError(field as keyof T & string, { message });
      placed = true;
    }
  }
  return placed && result.code !== "failed" ? null : result.message;
}

export function StaffMemberDialog({
  member,
  open,
  onOpenChange,
  onSaved,
  onCreated,
}: {
  /** `null` = crear una persona nueva; con valor = editar a esa persona. */
  member: TeamMember | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  onCreated: (credentials: IssuedCredentials) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {member ? (
          <EditForm
            key={member.id}
            member={member}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        ) : (
          <CreateForm onClose={() => onOpenChange(false)} onCreated={onCreated} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CreateForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (credentials: IssuedCredentials) => void;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<CreateMemberInput>({
    resolver: zodResolver(createMemberSchema),
    defaultValues: {
      displayName: "",
      jobTitle: "",
      username: "",
      password: "",
      modules: ["ofertas"],
    },
  });
  const { errors, isSubmitting } = form.formState;
  const modules = form.watch("modules");

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    const username = normalizeUsername(values.username);
    try {
      const result = await createInstitutionMember({ data: { ...values, username } });
      if (!result.ok) {
        setFormError(
          applyServerFields<CreateMemberInput>(result, form.setError, [
            "displayName",
            "jobTitle",
            "username",
            "password",
            "modules",
          ]),
        );
        return;
      }
      onCreated({
        displayName: values.displayName,
        username,
        password: values.password,
        kind: "created",
      });
      onClose();
    } catch {
      setFormError("No se pudo crear el acceso. Revisa tu conexión e inténtalo de nuevo.");
    }
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>Agregar persona al equipo</DialogTitle>
        <DialogDescription>
          Crea su usuario y su contraseña y elige a qué módulos entra. Podrás cambiar los módulos,
          suspenderla o quitarla cuando quieras.
        </DialogDescription>
      </DialogHeader>
      <form
        onSubmit={onSubmit}
        noValidate
        className="space-y-4"
        aria-label="Agregar persona al equipo"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="staff-name">Nombre completo</Label>
            <Input
              id="staff-name"
              autoComplete="off"
              aria-invalid={!!errors.displayName}
              {...form.register("displayName")}
            />
            {errors.displayName && (
              <p role="alert" className="text-xs text-sos">
                {errors.displayName.message}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="staff-job">Cargo (opcional)</Label>
            <Input
              id="staff-job"
              autoComplete="off"
              placeholder="Coordinadora de turnos"
              aria-invalid={!!errors.jobTitle}
              {...form.register("jobTitle")}
            />
            {errors.jobTitle && (
              <p role="alert" className="text-xs text-sos">
                {errors.jobTitle.message}
              </p>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="staff-new-username">Usuario</Label>
          <Input
            id="staff-new-username"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="marta.coord"
            aria-invalid={!!errors.username}
            aria-describedby={
              errors.username ? "staff-new-username-error" : "staff-new-username-hint"
            }
            {...form.register("username")}
          />
          {errors.username ? (
            <p id="staff-new-username-error" role="alert" className="text-xs text-sos">
              {errors.username.message}
            </p>
          ) : (
            <p id="staff-new-username-hint" className="text-xs text-muted-foreground">
              Lo usará para entrar. De 3 a 30 caracteres, en minúsculas; único en toda la
              plataforma.
            </p>
          )}
        </div>

        <PasswordFieldRow
          id="staff-new-password"
          label="Contraseña"
          hint="Mínimo 10 caracteres, con letras y números. Puedes generar una segura."
          error={errors.password?.message}
          onGenerate={() =>
            form.setValue("password", generatePassword(14, undefined, form.getValues("username")), {
              shouldValidate: true,
              shouldDirty: true,
            })
          }
          inputProps={form.register("password")}
        />

        <ModulePicker
          value={modules}
          onChange={(next) =>
            form.setValue("modules", next, { shouldValidate: true, shouldDirty: true })
          }
          error={errors.modules?.message}
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
              <UserPlus className="mr-2 h-4 w-4" aria-hidden />
            )}
            Crear acceso
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

function EditForm({
  member,
  onClose,
  onSaved,
}: {
  member: TeamMember;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<MemberProfileInput>({
    resolver: zodResolver(memberProfileSchema),
    defaultValues: {
      displayName: member.displayName,
      jobTitle: member.jobTitle ?? "",
      modules: member.modules,
    },
  });
  const { errors, isSubmitting } = form.formState;
  const modules = form.watch("modules");

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const result = await updateInstitutionMember({
        data: {
          memberId: member.id,
          displayName: values.displayName,
          jobTitle: values.jobTitle ?? "",
          modules: values.modules,
        },
      });
      if (!result.ok) {
        setFormError(
          applyServerFields<MemberProfileInput>(result, form.setError, [
            "displayName",
            "jobTitle",
            "modules",
          ]),
        );
        return;
      }
      toast.success(`Guardaste los cambios de ${values.displayName}`);
      onSaved();
      onClose();
    } catch {
      setFormError("No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.");
    }
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>Editar a {member.displayName}</DialogTitle>
        <DialogDescription>
          Su usuario es <strong>{member.username}</strong> y no se cambia. Los módulos nuevos
          aplican de inmediato.
        </DialogDescription>
      </DialogHeader>
      <form
        onSubmit={onSubmit}
        noValidate
        className="space-y-4"
        aria-label={`Editar a ${member.displayName}`}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="staff-edit-name">Nombre completo</Label>
            <Input
              id="staff-edit-name"
              autoComplete="off"
              aria-invalid={!!errors.displayName}
              {...form.register("displayName")}
            />
            {errors.displayName && (
              <p role="alert" className="text-xs text-sos">
                {errors.displayName.message}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="staff-edit-job">Cargo (opcional)</Label>
            <Input
              id="staff-edit-job"
              autoComplete="off"
              aria-invalid={!!errors.jobTitle}
              {...form.register("jobTitle")}
            />
            {errors.jobTitle && (
              <p role="alert" className="text-xs text-sos">
                {errors.jobTitle.message}
              </p>
            )}
          </div>
        </div>
        <ModulePicker
          value={modules}
          onChange={(next) =>
            form.setValue("modules", next, { shouldValidate: true, shouldDirty: true })
          }
          error={errors.modules?.message}
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
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            Guardar cambios
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
