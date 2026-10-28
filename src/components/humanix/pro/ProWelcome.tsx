// Bienvenida del profesional recién registrado: un saludo, cuatro pasos plegables y dos botones. Poco texto a
// propósito; lo demás (perfil completo, agenda, plan) vive en el panel, a un toque con «Ir a mi panel».
import { useState } from "react";
import { Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Logo } from "@/components/humanix/Logo";
import { AvatarUploader } from "@/components/humanix/AvatarUploader";
import { FamilyFold } from "@/components/humanix/family/FamilyFold";
import { missingWelcomeDocs, proWelcomeSteps, type ProWelcomeStepKey } from "@/lib/proWelcome";
import { cn } from "@/lib/utils";

const SPECIALTY_CHIPS = [
  "Enfermería",
  "Auxiliar de enfermería",
  "Cuidador/a",
  "Fisioterapia",
  "Adulto mayor",
];

export type ProWelcomeWork = { specialty: string; city: string; hourly: number | "" };

export function ProWelcome({
  userId,
  name,
  avatarUrl,
  specialty,
  cities,
  hourlyRate,
  docs,
  available,
  togglingAvailable,
  onAvatar,
  onSaveWork,
  onToggleAvailable,
  onGoDocs,
  onGoOffers,
  onClose,
  onLogout,
}: {
  userId: string;
  name: string;
  avatarUrl: string | null;
  specialty: string;
  cities: string;
  hourlyRate: number | "";
  docs: Record<string, boolean>;
  available: boolean;
  togglingAvailable: boolean;
  onAvatar: (url: string) => void;
  onSaveWork: (work: ProWelcomeWork) => Promise<boolean>;
  onToggleAvailable: () => void;
  onGoDocs: () => void;
  onGoOffers: () => void;
  onClose: () => void;
  onLogout: () => void;
}) {
  const steps = proWelcomeSteps({ avatarUrl, specialty, cities, hourlyRate, docs, available });
  const done = (key: ProWelcomeStepKey) => steps.find((s) => s.key === key)?.done ?? false;
  const doneCount = steps.filter((s) => s.done).length;
  // Abre el primer paso pendiente, una sola vez (al montar): luego cada fila la abre quien la toca.
  const [firstOpen] = useState(() => steps.find((s) => !s.done)?.key);
  const missingDocs = missingWelcomeDocs(docs);
  const firstName = name.trim().split(" ")[0] || "";

  const [work, setWork] = useState<ProWelcomeWork>({
    specialty,
    city: cities.split(",")[0]?.trim() ?? "",
    hourly: hourlyRate,
  });
  const [saving, setSaving] = useState(false);
  const canSave = work.specialty.trim() && work.city.trim() && Number(work.hourly) > 0;

  const saveWork = async () => {
    setSaving(true);
    try {
      await onSaveWork(work);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground bg-aurora">
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-md items-center justify-between gap-3 px-4 py-3">
          <Logo />
          <Button variant="ghost" size="icon" onClick={onLogout} title="Salir" aria-label="Salir">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-md space-y-5 px-4 py-6">
        <section className="space-y-3 text-center">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt=""
              className="mx-auto h-20 w-20 rounded-full border-4 border-biosensor/30 object-cover"
            />
          ) : (
            <div aria-hidden="true" className="text-6xl">
              👋
            </div>
          )}
          <h1 className="font-display text-2xl font-bold leading-tight">
            ¡Hola{firstName ? `, ${firstName}` : ""}!
          </h1>
          <p className="text-base text-muted-foreground">4 pasos y empiezas a recibir trabajo.</p>
          <div className="mx-auto max-w-xs space-y-1">
            <Progress value={(doneCount / steps.length) * 100} className="h-2" />
            <p className="text-sm font-semibold text-biosensor">{doneCount} de 4 listos</p>
          </div>
        </section>

        <div className="space-y-3">
          <FamilyFold
            id="bienvenida-foto"
            emoji={done("photo") ? "✅" : "📸"}
            title="1. Tu foto"
            hint={done("photo") ? "Lista" : "Las familias eligen a quien ven"}
            defaultOpen={firstOpen === "photo"}
          >
            <AvatarUploader userId={userId} initialUrl={avatarUrl} onChange={onAvatar} />
          </FamilyFold>

          <FamilyFold
            id="bienvenida-trabajo"
            emoji={done("work") ? "✅" : "🩺"}
            title="2. Lo que haces"
            hint={done("work") ? "Listo" : "Especialidad, ciudad y tarifa"}
            defaultOpen={firstOpen === "work"}
          >
            <div className="flex flex-wrap gap-2">
              {SPECIALTY_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => setWork((w) => ({ ...w, specialty: chip }))}
                  aria-pressed={work.specialty === chip}
                  className={cn(
                    "min-h-10 rounded-full border px-3 text-sm font-medium transition-colors",
                    work.specialty === chip
                      ? "border-biosensor bg-biosensor text-white"
                      : "border-border bg-background hover:border-biosensor/50",
                  )}
                >
                  {chip}
                </button>
              ))}
            </div>
            <Input
              aria-label="Especialidad"
              placeholder="Otra especialidad"
              value={work.specialty}
              onChange={(e) => setWork((w) => ({ ...w, specialty: e.target.value }))}
            />
            <Input
              aria-label="Ciudad"
              placeholder="Ciudad donde trabajas"
              value={work.city}
              onChange={(e) => setWork((w) => ({ ...w, city: e.target.value }))}
            />
            <Input
              aria-label="Tarifa por hora"
              type="number"
              inputMode="numeric"
              placeholder="Tarifa por hora (COP)"
              value={work.hourly}
              onChange={(e) =>
                setWork((w) => ({
                  ...w,
                  hourly: e.target.value === "" ? "" : Number(e.target.value),
                }))
              }
            />
            <Button
              className="h-12 w-full text-base"
              variant="hero"
              disabled={!canSave || saving}
              onClick={saveWork}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar"}
            </Button>
          </FamilyFold>

          <FamilyFold
            id="bienvenida-documentos"
            emoji={done("docs") ? "✅" : "📄"}
            title="3. Tus documentos"
            hint={done("docs") ? "Completos" : `Falta: ${missingDocs.join(", ")}`}
            defaultOpen={firstOpen === "docs"}
          >
            <p className="text-sm text-muted-foreground">Una foto con el celular sirve.</p>
            <Button className="h-12 w-full text-base" variant="hero" onClick={onGoDocs}>
              Subir documentos
            </Button>
          </FamilyFold>

          <FamilyFold
            id="bienvenida-disponible"
            emoji={done("available") ? "✅" : "🟢"}
            title="4. Ponte disponible"
            hint={done("available") ? "Te ven disponible en el mapa" : "Así te encuentran"}
            defaultOpen={firstOpen === "available"}
          >
            <label className="flex min-h-14 cursor-pointer items-center justify-between gap-3 rounded-2xl bg-muted/50 px-4">
              <span className="text-base font-semibold">
                {available ? "Disponible" : "No disponible"}
              </span>
              {togglingAvailable ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : (
                <Switch
                  aria-label="Disponible"
                  checked={available}
                  onCheckedChange={onToggleAvailable}
                  className="data-[state=checked]:bg-emerald-500"
                />
              )}
            </label>
          </FamilyFold>
        </div>

        {doneCount === steps.length && (
          <p className="text-center text-base font-semibold text-emerald-600">
            🎉 ¡Listo! Ya puedes recibir trabajo.
          </p>
        )}

        <div className="space-y-2">
          <Button className="h-14 w-full text-base" variant="hero" onClick={onGoOffers}>
            Ver trabajos para mí
          </Button>
          <Button className="h-12 w-full text-base" variant="ghost" onClick={onClose}>
            Ir a mi panel
          </Button>
        </div>

        <FamilyFold id="bienvenida-como" emoji="❓" title="¿Cómo funciona?" hint="En 3 pasos">
          <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            <li>Familias, IPS y clínicas publican turnos cerca de ti.</li>
            <li>Te postulas con un toque y acuerdan el valor.</li>
            <li>Haces el servicio y te califican: más estrellas, más trabajo.</li>
          </ol>
        </FamilyFold>
      </main>
    </div>
  );
}
