// Modal que se abre cuando un visitante sin sesión hace clic en
// "Buscar cuidador" en la home. Pregunta si es Familia o Institución
// y luego lo lleva a /auth con el rol pre-seleccionado.
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { HeartHandshake, Building2, ArrowRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

type Role = "family" | "institution";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Ruta a la que volver tras autenticarse. Default: /buscar */
  redirectTo?: string;
};

export function RoleGate({ open, onOpenChange, redirectTo = "/buscar" }: Props) {
  const navigate = useNavigate();
  const [hover, setHover] = useState<Role | null>(null);

  const choose = (role: Role) => {
    onOpenChange(false);
    navigate({
      to: "/auth",
      search: { role, redirect: redirectTo } as never,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">¿Quién está buscando cuidado?</DialogTitle>
          <DialogDescription>
            Para personalizar tu experiencia, cuéntanos cómo te identificas. Solo toma un segundo.
          </DialogDescription>
        </DialogHeader>

        <div className="grid sm:grid-cols-2 gap-3 mt-2">
          <button
            type="button"
            onClick={() => choose("family")}
            onMouseEnter={() => setHover("family")}
            onMouseLeave={() => setHover(null)}
            className={`group text-left rounded-2xl border p-5 transition ${
              hover === "family"
                ? "border-copper bg-copper/5"
                : "border-border hover:border-copper/40"
            }`}
          >
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-copper/10 text-copper">
              <HeartHandshake className="h-5 w-5" />
            </div>
            <p className="mt-3 font-display font-semibold">Soy una familia</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Busco cuidador, enfermero o auxiliar para mi familiar.
            </p>
            <p className="mt-3 text-xs font-semibold text-copper inline-flex items-center gap-1">
              Continuar <ArrowRight className="h-3.5 w-3.5" />
            </p>
          </button>

          <button
            type="button"
            onClick={() => choose("institution")}
            onMouseEnter={() => setHover("institution")}
            onMouseLeave={() => setHover(null)}
            className={`group text-left rounded-2xl border p-5 transition ${
              hover === "institution"
                ? "border-fuchsia-neural bg-fuchsia-neural/5"
                : "border-border hover:border-fuchsia-neural/40"
            }`}
          >
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-fuchsia-neural/10 text-fuchsia-neural">
              <Building2 className="h-5 w-5" />
            </div>
            <p className="mt-3 font-display font-semibold">Soy una institución</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Clínica, IPS o agencia que necesita talento de salud.
            </p>
            <p className="mt-3 text-xs font-semibold text-fuchsia-neural inline-flex items-center gap-1">
              Continuar <ArrowRight className="h-3.5 w-3.5" />
            </p>
          </button>
        </div>

        <p className="text-[11px] text-center text-muted-foreground mt-2">
          ¿Eres profesional de la salud?{" "}
          <a href="/profesionales" className="underline hover:text-foreground">
            Entra por aquí
          </a>
          .
        </p>
      </DialogContent>
    </Dialog>
  );
}
