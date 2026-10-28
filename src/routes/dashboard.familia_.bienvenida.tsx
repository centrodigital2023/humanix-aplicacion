// Bienvenida de la familia recién registrada: poco texto, dos botones grandes y lo demás en un acordeón.
// El panel de familia la abre una sola vez (ver `lib/familyWelcome`); desde aquí se va al panel cuando se quiera.
import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, ChevronRight, Circle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Logo } from "@/components/humanix/Logo";
import { HiringCopilot } from "@/components/humanix/HiringCopilot";
import { useAppUser } from "@/hooks/use-app-user";
import { markWelcomeSeen, safeLocalStorage, welcomeSteps } from "@/lib/familyWelcome";
import { buildSeo } from "@/lib/seo";

export const Route = createFileRoute("/dashboard/familia_/bienvenida")({
  head: () =>
    buildSeo({
      title: "Bienvenida · Humanix",
      path: "/dashboard/familia/bienvenida",
      description:
        "Empieza en Humanix: pide cuidado en casa o busca un profesional verificado cerca de ti.",
    }),
  component: FamilyWelcome,
});

const HOW = [
  { emoji: "📝", text: "Cuéntanos qué necesitas. Publicar es gratis." },
  { emoji: "🙋", text: "Profesionales verificados cerca de ti se postulan." },
  { emoji: "💛", text: "Eliges a quien te dé confianza y sigues el turno en vivo." },
];

const SAFE = [
  { emoji: "🪪", text: "Revisamos el RETHUS y los documentos de cada profesional." },
  { emoji: "⭐", text: "Cada persona tiene su Trust Score y calificaciones reales." },
  { emoji: "🔒", text: "Tu dirección y teléfono solo los ve quien tú aceptes." },
  { emoji: "🆘", text: "Botón SOS para avisar a tu círculo con tu ubicación." },
];

function FamilyWelcome() {
  const { user, loading } = useAppUser({ allow: ["family", "superadmin"] });
  const [profile, setProfile] = useState<{
    idNumber: string | null;
    address: string | null;
    emergencyPhone: string | null;
  } | null>(null);

  useEffect(() => {
    if (!user) return;
    markWelcomeSeen(safeLocalStorage(), user.id);
    let active = true;
    void supabase
      .from("family_profiles")
      .select("id_number, default_address, emergency_contact_phone")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        setProfile({
          idNumber: data?.id_number ?? null,
          address: data?.default_address ?? null,
          emergencyPhone: data?.emergency_contact_phone ?? null,
        });
      });
    return () => {
      active = false;
    };
  }, [user]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando…
      </div>
    );
  }

  const first = user.fullName && !user.fullName.includes("@") ? user.fullName.split(" ")[0] : "";
  const steps = profile ? welcomeSteps(profile) : null;
  const done = steps?.filter((s) => s.done).length ?? 0;
  const missing = steps?.find((s) => !s.done);

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/10 via-background to-background">
      <div className="mx-auto flex max-w-md flex-col gap-6 px-4 pb-16 pt-6">
        <div className="flex items-center justify-between">
          <Logo />
          <Link
            to="/dashboard/familia"
            className="text-sm font-semibold text-muted-foreground hover:text-foreground"
          >
            Saltar
          </Link>
        </div>

        <header className="text-center">
          <span
            aria-hidden="true"
            className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-card text-5xl shadow-sm ring-1 ring-border motion-safe:animate-in motion-safe:zoom-in-50"
          >
            💛
          </span>
          <h1 className="mt-4 font-display text-3xl font-bold leading-tight">
            {first ? `¡Hola, ${first}!` : "¡Hola!"}
          </h1>
          <p className="mt-2 text-lg text-muted-foreground">Cuidamos contigo. ¿Empezamos?</p>
        </header>

        <div className="grid gap-3">
          <HiringCopilot
            label="Pedir cuidado"
            icon={
              <span aria-hidden="true" className="mr-2 text-2xl">
                🙋
              </span>
            }
            triggerClassName="h-16 w-full rounded-3xl text-lg font-bold"
          />
          <Button asChild variant="outline" className="h-16 w-full rounded-3xl text-lg font-bold">
            <Link to="/buscar">
              <span aria-hidden="true" className="mr-2 text-2xl">
                🔎
              </span>
              Ver profesionales cerca
            </Link>
          </Button>
          <Button
            asChild
            variant="ghost"
            className="h-12 w-full rounded-3xl text-base font-semibold"
          >
            <Link to="/dashboard/familia">
              <span aria-hidden="true" className="mr-2 text-xl">
                🏠
              </span>
              Ir a mi panel
            </Link>
          </Button>
        </div>

        {steps && missing && (
          <Link
            to="/dashboard/familia/onboarding"
            search={{ step: missing.key }}
            className="flex items-center gap-3 rounded-3xl bg-card p-4 shadow-sm ring-1 ring-border transition hover:shadow-md active:scale-[0.99]"
          >
            <span className="min-w-0 flex-1">
              <span className="block font-bold">Completa tus datos · 2 min</span>
              <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
                {steps.map((s) => (
                  <span key={s.key} className="inline-flex items-center gap-1">
                    {s.done ? (
                      <CheckCircle2 className="h-4 w-4 text-ok" aria-hidden="true" />
                    ) : (
                      <Circle className="h-4 w-4" aria-hidden="true" />
                    )}
                    <span className="sr-only">{s.done ? "Listo: " : "Falta: "}</span>
                    {s.label}
                  </span>
                ))}
              </span>
            </span>
            <span className="text-sm font-semibold text-muted-foreground tabular-nums">
              {done}/3
            </span>
            <ChevronRight className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          </Link>
        )}

        <Accordion
          type="single"
          collapsible
          className="rounded-3xl bg-card px-4 ring-1 ring-border"
        >
          <AccordionItem value="como">
            <AccordionTrigger className="text-base font-bold">¿Cómo funciona?</AccordionTrigger>
            <AccordionContent>
              <ol className="space-y-3">
                {HOW.map((h, i) => (
                  <li key={h.text} className="flex items-start gap-3">
                    <span aria-hidden="true" className="text-2xl leading-none">
                      {h.emoji}
                    </span>
                    <span>
                      <span className="sr-only">Paso {i + 1}: </span>
                      {h.text}
                    </span>
                  </li>
                ))}
              </ol>
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="seguro">
            <AccordionTrigger className="text-base font-bold">¿Es seguro?</AccordionTrigger>
            <AccordionContent>
              <ul className="space-y-3">
                {SAFE.map((s) => (
                  <li key={s.text} className="flex items-start gap-3">
                    <span aria-hidden="true" className="text-2xl leading-none">
                      {s.emoji}
                    </span>
                    {s.text}
                  </li>
                ))}
              </ul>
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="costo" className="border-b-0">
            <AccordionTrigger className="text-base font-bold">¿Cuánto cuesta?</AccordionTrigger>
            <AccordionContent className="space-y-2">
              <p>Crear tu cuenta y pedir cuidado es gratis.</p>
              <p>
                Si quieres más, el plan Familiar cuesta COP 9.900 al mes y lo cancelas cuando
                quieras.
              </p>
              <Link to="/planes" className="inline-flex font-semibold text-primary hover:underline">
                Ver planes
              </Link>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </div>
  );
}
