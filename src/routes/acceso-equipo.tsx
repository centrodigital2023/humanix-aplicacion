import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff, KeyRound, Loader2, ShieldCheck, UsersRound } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/humanix/Logo";
import { HomeButton } from "@/components/humanix/HomeButton";
import { supabase } from "@/integrations/supabase/client";
import { normalizeUsername, staffEmail } from "@/lib/institutionMembers";

type Motivo = "suspendido" | "retirado";

export const Route = createFileRoute("/acceso-equipo")({
  validateSearch: (search: Record<string, unknown>): { motivo?: Motivo } =>
    search.motivo === "suspendido" || search.motivo === "retirado" ? { motivo: search.motivo } : {},
  head: () => ({
    meta: [
      { title: "Acceso del equipo · Humanix" },
      {
        name: "description",
        content: "Entra con el usuario y la contraseña que te dio tu institución.",
      },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: StaffLoginPage,
});

// En el ingreso no se aplica la política de contraseñas (eso lo hace quien la crea): solo que no vengan vacíos.
const loginSchema = z.object({
  username: z.string().trim().min(1, "Escribe tu usuario."),
  password: z.string().min(1, "Escribe tu contraseña."),
});
type LoginValues = z.infer<typeof loginSchema>;

const NOTICE: Record<Motivo, string> = {
  suspendido:
    "Tu acceso está suspendido. Habla con quien administra el equipo de tu institución para recuperarlo.",
  retirado:
    "Tu acceso ya no existe: te quitaron del equipo. Si crees que es un error, habla con quien administra el equipo de tu institución.",
};

function StaffLoginPage() {
  const navigate = useNavigate();
  const { motivo } = Route.useSearch();
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    const { error } = await supabase.auth.signInWithPassword({
      email: staffEmail(normalizeUsername(values.username)),
      password: values.password,
    });
    if (error) {
      // Mismo mensaje para «no existe» y «clave incorrecta»: no se revela qué usuarios existen.
      setFormError(
        error.status === 429 || error.code === "over_request_rate_limit"
          ? "Demasiados intentos seguidos. Espera un minuto e inténtalo de nuevo."
          : error.code === "user_banned"
            ? NOTICE.suspendido
            : "Usuario o contraseña incorrectos.",
      );
      return;
    }
    await navigate({ to: "/dashboard/equipo", replace: true });
  });

  return (
    <div className="min-h-screen bg-background text-foreground bg-aurora">
      <div className="mx-auto max-w-md px-4 sm:px-6 py-6 sm:py-10">
        <div className="flex items-center justify-between gap-3">
          <Logo />
          <HomeButton />
        </div>

        <div className="mt-8 rounded-2xl sm:rounded-3xl border border-border bg-card/95 backdrop-blur-xl shadow-[var(--shadow-elegant)] p-5 sm:p-8">
          <div className="mb-6 text-center">
            <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-fuchsia-neural/10 text-fuchsia-neural mb-3">
              <UsersRound className="h-7 w-7" aria-hidden />
            </div>
            <h1 className="font-display text-2xl font-bold">Acceso del equipo</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Entra con el usuario y la contraseña que te dio tu institución.
            </p>
          </div>

          {motivo && (
            <Alert variant="destructive" className="mb-4" role="alert">
              <AlertTitle>No puedes entrar</AlertTitle>
              <AlertDescription>{NOTICE[motivo]}</AlertDescription>
            </Alert>
          )}

          <form onSubmit={onSubmit} noValidate className="space-y-4" aria-label="Acceso del equipo">
            <div className="space-y-1.5">
              <Label htmlFor="staff-username">Usuario</Label>
              <Input
                id="staff-username"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="por ejemplo: marta.coord"
                aria-invalid={!!errors.username}
                aria-describedby={errors.username ? "staff-username-error" : undefined}
                {...form.register("username")}
              />
              {errors.username && (
                <p id="staff-username-error" role="alert" className="text-xs text-sos">
                  {errors.username.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="staff-password">Contraseña</Label>
              <div className="relative">
                <Input
                  id="staff-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  className="pr-10"
                  aria-invalid={!!errors.password}
                  aria-describedby={errors.password ? "staff-password-error" : undefined}
                  {...form.register("password")}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  aria-pressed={showPassword}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" aria-hidden />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden />
                  )}
                </button>
              </div>
              {errors.password && (
                <p id="staff-password-error" role="alert" className="text-xs text-sos">
                  {errors.password.message}
                </p>
              )}
            </div>

            {formError && (
              <p
                role="alert"
                className="rounded-lg border border-sos/30 bg-sos/10 px-3 py-2 text-sm text-sos"
              >
                {formError}
              </p>
            )}

            <Button type="submit" variant="hero" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <KeyRound className="mr-2 h-4 w-4" aria-hidden />
              )}
              Entrar
            </Button>
          </form>

          <div className="mt-6 space-y-2 border-t border-border pt-4 text-xs text-muted-foreground">
            <p className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-trust" aria-hidden />
              Tu usuario y tu contraseña los administra la institución. Si los olvidaste o no
              funcionan, pídele a quien administra el equipo que los restablezca.
            </p>
            <p>
              ¿Eres profesional, familia o la cuenta principal de la institución?{" "}
              <Link
                to="/auth"
                search={{ mode: "signin" }}
                className="font-medium text-biosensor hover:underline"
              >
                Entra aquí
              </Link>
              .
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
