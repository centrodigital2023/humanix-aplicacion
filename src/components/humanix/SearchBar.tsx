import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search, MapPin, Stethoscope, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

const specialties = [
  "Cualquier especialidad",
  "Enfermería general",
  "Cuidado adulto mayor",
  "Cuidado pediátrico",
  "UCI / Cuidado crítico",
  "Heridas y curaciones",
  "Acompañamiento hospitalario",
  "Rehabilitación domiciliaria",
];

const cities = [
  "Cualquier ciudad",
  "Bogotá",
  "Medellín",
  "Cali",
  "Barranquilla",
  "Cartagena",
  "Bucaramanga",
  "Pereira",
];

export function SearchBar({ compact = false }: { compact?: boolean }) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [specialty, setSpecialty] = useState(specialties[0]);
  const [city, setCity] = useState(cities[0]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    navigate({
      to: "/buscar",
      search: {
        q: q || undefined,
        specialty: specialty === specialties[0] ? undefined : specialty,
        city: city === cities[0] ? undefined : city,
      },
    });
  };

  return (
    <form
      onSubmit={submit}
      className={`w-full rounded-2xl border border-border bg-card/95 backdrop-blur-xl shadow-[var(--shadow-card)] ${
        compact ? "p-2" : "p-2 sm:p-2.5"
      }`}
    >
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto] items-stretch gap-2">
        <label className="flex items-center gap-2.5 px-3.5 rounded-xl hover:bg-muted/40 transition">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="¿Qué buscas? Ej: cuidador nocturno"
            className="w-full bg-transparent border-0 outline-none text-sm py-3 placeholder:text-muted-foreground"
          />
        </label>
        <div className="hidden md:block w-px bg-border my-2" />

        <label className="flex items-center gap-2.5 px-3.5 rounded-xl hover:bg-muted/40 transition">
          <Stethoscope className="h-4 w-4 text-muted-foreground shrink-0" />
          <select
            value={specialty}
            onChange={(e) => setSpecialty(e.target.value)}
            className="w-full bg-transparent border-0 outline-none text-sm py-3 cursor-pointer"
          >
            {specialties.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <div className="hidden md:block w-px bg-border my-2" />

        <label className="flex items-center gap-2.5 px-3.5 rounded-xl hover:bg-muted/40 transition">
          <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
          <select
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="w-full bg-transparent border-0 outline-none text-sm py-3 cursor-pointer"
          >
            {cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <Button type="submit" variant="hero" size="lg" className="md:px-6">
          Buscar <ArrowRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </form>
  );
}
