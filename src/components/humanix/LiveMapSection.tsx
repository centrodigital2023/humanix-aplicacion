import { LiveMarketplaceMap } from "@/components/humanix/LiveMarketplaceMap";

type Role = "professional" | "family" | "institution" | "guest";

const COPY: Record<Role, { title: string; desc: string }> = {
  family: {
    title: "Mapa en vivo · Profesionales y tu ubicación",
    desc: "Puntos azules = profesionales conectados. Marca tu ubicación (toca el mapa o usa GPS) para calcular la distancia exacta a cada profesional.",
  },
  professional: {
    title: "Mapa en vivo · Familias, instituciones y tu ubicación",
    desc: "Familias en amarillo · instituciones en fucsia. Marca tu ubicación (toca el mapa o usa GPS) para aparecer cerca de quien te necesita.",
  },
  institution: {
    title: "Mapa en vivo · Profesionales y tu sede",
    desc: "Profesionales en azul · familias en amarillo. Marca la ubicación de tu sede (toca el mapa o usa GPS) para verlos por cercanía.",
  },
  guest: {
    title: "Mapa en vivo · Talento humano en salud",
    desc: "Mira profesionales, familias e instituciones conectados en este momento en Colombia.",
  },
};

export function LiveMapSection({
  role,
  userId,
  height = 480,
  pickLocation,
  className = "",
}: {
  role: Role;
  userId?: string;
  height?: number;
  pickLocation?: {
    lat: number | null;
    lng: number | null;
    onChange: (lat: number, lng: number, address?: string) => void;
    defaultCity?: string;
  };
  className?: string;
}) {
  const copy = COPY[role];
  return (
    <section className={`rounded-2xl border border-border bg-card/95 p-6 ${className}`}>
      <div className="mb-4">
        <h2 className="font-semibold">{copy.title}</h2>
        <p className="text-sm text-muted-foreground">{copy.desc}</p>
      </div>
      <LiveMarketplaceMap
        role={role}
        userId={userId}
        height={height}
        pickLocation={pickLocation}
      />
    </section>
  );
}