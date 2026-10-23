import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Smartphone } from "lucide-react";
import { InstallAppButton } from "@/components/humanix/InstallAppButton";
import { ShareAppButton } from "@/components/humanix/ShareAppButton";
import { Logo } from "@/components/humanix/Logo";
import { Button } from "@/components/ui/button";
import { buildSeo } from "@/lib/seo";

export const Route = createFileRoute("/instalar")({
  head: () =>
    buildSeo({
      title: "Instalar Humanix · Cuidado en casa",
      description:
        "Añade Humanix a tu teléfono o computador y abre tu agenda de cuidado desde su icono.",
      path: "/instalar",
    }),
  component: InstallPage,
});

const BENEFITS = [
  "Abre Humanix desde un ícono, como cualquier app",
  "Gratis y ligera: no ocupa espacio ni pasa por la tienda",
  "Tus servicios, agenda y profesionales siempre a la mano",
];

const STEPS = [
  "Toca «Instalar app» y confirma, o usa el menú de tu navegador.",
  "En iPhone: abre humanix.lat en Safari, toca Compartir y «Añadir a pantalla de inicio».",
  "Busca el ícono de Humanix en tu pantalla de inicio.",
];

function InstallPage() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-start justify-center gap-6 px-6 py-12">
      <Logo />
      <div className="flex items-center gap-4">
        <img
          src="/icons/humanix-192.png"
          width={96}
          height={96}
          alt="Icono de Humanix"
          className="rounded-lg"
        />
        <div>
          <h1 className="text-3xl font-semibold">Humanix en tu dispositivo</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Cuidado en casa con profesionales verificados, a un toque de distancia.
          </p>
        </div>
      </div>

      <ul className="space-y-2">
        {BENEFITS.map((benefit) => (
          <li key={benefit} className="flex items-start gap-2 text-sm">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>{benefit}</span>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-3">
        <InstallAppButton />
        <ShareAppButton />
        <Button variant="ghost" asChild>
          <Link to="/dashboard">Ir a mi panel</Link>
        </Button>
      </div>

      <div className="w-full rounded-xl border border-border bg-muted/30 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Smartphone className="h-4 w-4 text-primary" />
          Cómo instalarla
        </h2>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
          {STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>
    </main>
  );
}
