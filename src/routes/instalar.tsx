import { createFileRoute, Link } from "@tanstack/react-router";
import { InstallAppButton } from "@/components/humanix/InstallAppButton";
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

function InstallPage() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-start justify-center gap-6 px-6 py-12">
      <Logo />
      <img
        src="/icons/humanix-192.png"
        width={96}
        height={96}
        alt="Icono de Humanix"
        className="rounded-lg"
      />
      <h1 className="text-3xl font-semibold">Humanix en tu dispositivo</h1>
      <div className="flex flex-wrap gap-3">
        <InstallAppButton />
        <Button variant="ghost" asChild>
          <Link to="/dashboard">Ir a mi panel</Link>
        </Button>
      </div>
    </main>
  );
}
