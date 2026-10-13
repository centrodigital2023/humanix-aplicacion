// Campo de contraseña con «ver», «generar» y mensaje de error, para los formularios de la institución (crear y reiniciar).
import { useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PasswordFieldRow({
  id,
  label,
  hint,
  error,
  onGenerate,
  inputProps,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  /** Si se da, aparece el botón «Generar» (crea una contraseña segura y la muestra). */
  onGenerate?: () => void;
  inputProps: InputHTMLAttributes<HTMLInputElement>;
}) {
  const [show, setShow] = useState(false);
  const describedBy =
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") ||
    undefined;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            id={id}
            type={show ? "text" : "password"}
            autoComplete="new-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="pr-10"
            aria-invalid={!!error}
            aria-describedby={describedBy}
            {...inputProps}
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
            aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}
            aria-pressed={show}
          >
            {show ? (
              <EyeOff className="h-4 w-4" aria-hidden />
            ) : (
              <Eye className="h-4 w-4" aria-hidden />
            )}
          </button>
        </div>
        {onGenerate && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onGenerate();
              setShow(true);
            }}
          >
            <Sparkles className="mr-1.5 h-4 w-4" aria-hidden /> Generar
          </Button>
        )}
      </div>
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
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
