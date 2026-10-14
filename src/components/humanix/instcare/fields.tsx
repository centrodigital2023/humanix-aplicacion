// Campos de formulario con react-hook-form: etiqueta, ayuda y error unidos al control (aria-describedby / aria-invalid). Un solo camino:
// los errores salen del esquema Zod del formulario (lib/instForms), no de reglas sueltas en la pantalla.
import { useId, type ComponentProps, type ReactNode } from "react";
import { Controller, type FieldValues, type Path, type UseFormReturn } from "react-hook-form";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/** Radix no admite un valor vacío en un ítem: el «sin elegir» viaja con esta clave. */
const NONE = "__none__";

function errorOf<T extends FieldValues>(form: UseFormReturn<T>, name: Path<T>): string | undefined {
  const e = (form.formState.errors as Record<string, { message?: unknown } | undefined>)[name];
  return typeof e?.message === "string" ? e.message : undefined;
}

function FieldShell({
  id,
  label,
  hint,
  error,
  required,
  className,
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id} className="text-xs font-medium">
        {label}
        {required && (
          <span className="text-sos" aria-hidden>
            {" "}
            *
          </span>
        )}
      </Label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-[11px] text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-sos">
          {error}
        </p>
      )}
    </div>
  );
}

const describedBy = (id: string, error?: string, hint?: ReactNode) =>
  error ? `${id}-error` : hint ? `${id}-hint` : undefined;

export function TextField<T extends FieldValues>({
  form,
  name,
  label,
  hint,
  required,
  className,
  ...input
}: {
  form: UseFormReturn<T>;
  name: Path<T>;
  label: ReactNode;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
} & Omit<ComponentProps<typeof Input>, "name" | "form">) {
  const id = useId();
  const error = errorOf(form, name);
  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={className}
    >
      <Input
        id={id}
        aria-invalid={!!error}
        aria-describedby={describedBy(id, error, hint)}
        {...input}
        {...form.register(name)}
      />
    </FieldShell>
  );
}

export function TextAreaField<T extends FieldValues>({
  form,
  name,
  label,
  hint,
  required,
  className,
  ...area
}: {
  form: UseFormReturn<T>;
  name: Path<T>;
  label: ReactNode;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
} & Omit<ComponentProps<typeof Textarea>, "name" | "form">) {
  const id = useId();
  const error = errorOf(form, name);
  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={className}
    >
      <Textarea
        id={id}
        aria-invalid={!!error}
        aria-describedby={describedBy(id, error, hint)}
        {...area}
        {...form.register(name)}
      />
    </FieldShell>
  );
}

export function SelectField<T extends FieldValues>({
  form,
  name,
  label,
  hint,
  options,
  placeholder = "Elige una opción",
  allowEmpty = false,
  emptyLabel = "Sin dato",
  required,
  className,
  disabled,
}: {
  form: UseFormReturn<T>;
  name: Path<T>;
  label: ReactNode;
  hint?: ReactNode;
  options: ReadonlyArray<{ value: string; label: string }>;
  placeholder?: string;
  /** Permite dejarlo sin elegir (el valor vacío del formulario). */
  allowEmpty?: boolean;
  emptyLabel?: string;
  required?: boolean;
  className?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const error = errorOf(form, name);
  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={className}
    >
      <Controller
        control={form.control}
        name={name}
        render={({ field }) => (
          <Select
            value={
              field.value === "" || field.value == null
                ? allowEmpty
                  ? NONE
                  : ""
                : String(field.value)
            }
            onValueChange={(v) => field.onChange(v === NONE ? "" : v)}
            disabled={disabled}
          >
            <SelectTrigger
              id={id}
              aria-invalid={!!error}
              aria-describedby={describedBy(id, error, hint)}
              onBlur={field.onBlur}
            >
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
              {allowEmpty && <SelectItem value={NONE}>{emptyLabel}</SelectItem>}
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
    </FieldShell>
  );
}

/** Casilla con texto largo (por ejemplo la autorización del paciente). */
export function CheckField<T extends FieldValues>({
  form,
  name,
  label,
  description,
  className,
}: {
  form: UseFormReturn<T>;
  name: Path<T>;
  label: ReactNode;
  description?: ReactNode;
  className?: string;
}) {
  const id = useId();
  const error = errorOf(form, name);
  return (
    <div className={cn("space-y-1.5", className)}>
      <Controller
        control={form.control}
        name={name}
        render={({ field }) => (
          <div className="flex items-start gap-2.5">
            <Checkbox
              id={id}
              checked={field.value === true}
              onCheckedChange={(v) => field.onChange(v === true)}
              aria-invalid={!!error}
              aria-describedby={describedBy(id, error, description)}
              className="mt-0.5"
            />
            <Label htmlFor={id} className="text-sm font-normal leading-snug">
              {label}
              {description && (
                <span id={`${id}-hint`} className="mt-0.5 block text-[11px] text-muted-foreground">
                  {description}
                </span>
              )}
            </Label>
          </div>
        )}
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="pl-7 text-xs text-sos">
          {error}
        </p>
      )}
    </div>
  );
}

/** Interruptor con título y explicación. */
export function SwitchField<T extends FieldValues>({
  form,
  name,
  label,
  description,
  disabled,
  className,
}: {
  form: UseFormReturn<T>;
  name: Path<T>;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  const error = errorOf(form, name);
  return (
    <div className={cn("space-y-1", className)}>
      <Controller
        control={form.control}
        name={name}
        render={({ field }) => (
          <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-muted/30 p-3">
            <Label htmlFor={id} className="text-sm font-medium leading-snug">
              {label}
              {description && (
                <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
                  {description}
                </span>
              )}
            </Label>
            <Switch
              id={id}
              checked={field.value === true}
              onCheckedChange={field.onChange}
              disabled={disabled}
              aria-invalid={!!error}
            />
          </div>
        )}
      />
      {error && (
        <p role="alert" className="text-xs text-sos">
          {error}
        </p>
      )}
    </div>
  );
}
