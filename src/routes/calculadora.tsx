import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Calculator, ArrowRight, ShieldCheck, Sparkles, Info } from "lucide-react";
import { Navbar } from "@/components/humanix/Navbar";
import { Footer } from "@/components/humanix/Footer";
import { BreadcrumbJsonLd } from "@/components/humanix/BreadcrumbJsonLd";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { buildSeo, jsonLdString, faqLd } from "@/lib/seo";
import { CONTACT } from "@/lib/social";

export const Route = createFileRoute("/calculadora")({
  head: () =>
    buildSeo({
      title: "Calculadora de costos de cuidado domiciliario en Colombia",
      path: "/calculadora",
      description:
        "Estima cuánto cuesta contratar un enfermero, auxiliar o cuidador a domicilio en Colombia. Tarifas 2026 por ciudad, turno y especialidad. Gratis y sin registro.",
    }),
  component: CalculadoraPage,
});

// ---------------------------------------------------------------------------
// Tarifas referenciales 2026 (COP por hora, mercado colombiano)
// Fuentes: encuestas internas Humanix + observatorio del mercado de cuidado
// domiciliario. Son estimaciones; el precio final lo fija el profesional.
// ---------------------------------------------------------------------------
type Role = "cuidador" | "auxiliar" | "enfermero" | "enfermero_jefe";
type City = "bogota" | "medellin" | "cali" | "barranquilla" | "cartagena" | "bucaramanga" | "pereira" | "otra";
type Shift = "diurno" | "nocturno" | "24h";

const ROLE_HOURLY: Record<Role, { label: string; min: number; max: number; description: string }> = {
  cuidador: {
    label: "Cuidador(a) básico",
    min: 7000,
    max: 11000,
    description: "Acompañamiento, higiene, alimentación y movilización. Sin tareas clínicas.",
  },
  auxiliar: {
    label: "Auxiliar de enfermería",
    min: 10000,
    max: 16000,
    description: "Signos vitales, medicación oral, curaciones básicas. RETHUS requerido.",
  },
  enfermero: {
    label: "Enfermero(a) profesional",
    min: 18000,
    max: 28000,
    description: "Manejo de catéteres, sondas, medicación IV y planes de cuidado.",
  },
  enfermero_jefe: {
    label: "Enfermero(a) jefe especializado",
    min: 28000,
    max: 45000,
    description: "Cuidado crítico, paliativo, postoperatorio complejo o pediátrico avanzado.",
  },
};

const CITY_FACTOR: Record<City, { label: string; factor: number }> = {
  bogota: { label: "Bogotá", factor: 1.0 },
  medellin: { label: "Medellín", factor: 0.95 },
  cali: { label: "Cali", factor: 0.92 },
  barranquilla: { label: "Barranquilla", factor: 0.93 },
  cartagena: { label: "Cartagena", factor: 0.95 },
  bucaramanga: { label: "Bucaramanga", factor: 0.9 },
  pereira: { label: "Pereira", factor: 0.88 },
  otra: { label: "Otra ciudad de Colombia", factor: 0.85 },
};

const SHIFT_OPTIONS: Record<Shift, { label: string; hoursPerDay: number; nightSurcharge: number }> = {
  diurno: { label: "Diurno (12 horas, 7am – 7pm)", hoursPerDay: 12, nightSurcharge: 0 },
  nocturno: { label: "Nocturno (12 horas, 7pm – 7am)", hoursPerDay: 12, nightSurcharge: 0.35 },
  "24h": { label: "24 horas continuas", hoursPerDay: 24, nightSurcharge: 0.175 },
};

const HOLIDAY_SURCHARGE = 0.75; // recargo dominical/festivo

function formatCOP(value: number) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

const FAQS = [
  {
    q: "¿Cuánto cuesta un enfermero a domicilio en Colombia en 2026?",
    a: "Un enfermero profesional cuesta entre $18.000 y $28.000 COP por hora en Bogotá. Un auxiliar de enfermería entre $10.000 y $16.000. Un cuidador básico entre $7.000 y $11.000. El precio varía según ciudad, turno (diurno, nocturno o 24h), día (entre semana o festivo) y complejidad del paciente.",
  },
  {
    q: "¿Qué recargos aplican en turnos nocturnos y festivos?",
    a: "El recargo nocturno (7pm – 7am) suele ser del 35% sobre la tarifa hora. El recargo dominical o festivo es del 75% según el Código Sustantivo del Trabajo. Un turno de 24 horas en domingo puede ser hasta 60% más caro que uno diurno entre semana.",
  },
  {
    q: "¿Es más barato contratar por agencia o directamente al profesional?",
    a: "Contratar directamente al profesional verificado en Humanix suele ser entre 30% y 50% más económico que una agencia tradicional, porque eliminas la intermediación. El profesional recibe pago inmediato y tú decides la frecuencia del servicio.",
  },
  {
    q: "¿La tarifa incluye seguridad social y prestaciones?",
    a: "Las tarifas mostradas son honorarios profesionales. Si contratas por más de 21 días al mes, debes vincular al profesional por nómina o exigir certificado de aportes a salud y pensión como independiente. Humanix verifica el estado RETHUS y los aportes a seguridad social de cada profesional.",
  },
  {
    q: "¿Cómo reduzco el costo del cuidado domiciliario sin perder calidad?",
    a: "Tres palancas: (1) ajusta el perfil al nivel real de complejidad — no contrates enfermero jefe si necesitas un cuidador; (2) combina turnos diurnos con apoyo familiar nocturno cuando el paciente es estable; (3) negocia tarifa por jornada completa o mensual, no por hora suelta.",
  },
];

function CalculadoraPage() {
  const [role, setRole] = useState<Role>("auxiliar");
  const [city, setCity] = useState<City>("bogota");
  const [shift, setShift] = useState<Shift>("diurno");
  const [daysPerWeek, setDaysPerWeek] = useState<number>(5);
  const [weeks, setWeeks] = useState<number>(4);
  const [includeHoliday, setIncludeHoliday] = useState<boolean>(false);

  const result = useMemo(() => {
    const r = ROLE_HOURLY[role];
    const c = CITY_FACTOR[city];
    const s = SHIFT_OPTIONS[shift];

    const baseMin = r.min * c.factor;
    const baseMax = r.max * c.factor;

    const hourMin = baseMin * (1 + s.nightSurcharge);
    const hourMax = baseMax * (1 + s.nightSurcharge);

    const hoursPerDay = s.hoursPerDay;

    const totalDays = daysPerWeek * weeks;
    const totalHours = totalDays * hoursPerDay;

    // 1 de cada 7 días asumido como festivo si activa recargo
    const holidayFactor = includeHoliday ? 1 + HOLIDAY_SURCHARGE / 7 : 1;

    const periodMin = hourMin * totalHours * holidayFactor;
    const periodMax = hourMax * totalHours * holidayFactor;

    const dayMin = hourMin * hoursPerDay * (includeHoliday ? 1 + HOLIDAY_SURCHARGE / 7 : 1);
    const dayMax = hourMax * hoursPerDay * (includeHoliday ? 1 + HOLIDAY_SURCHARGE / 7 : 1);

    return {
      hourMin,
      hourMax,
      dayMin,
      dayMax,
      periodMin,
      periodMax,
      totalHours,
      totalDays,
    };
  }, [role, city, shift, daysPerWeek, weeks, includeHoliday]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <BreadcrumbJsonLd
        items={[
          { name: "Inicio", path: "/" },
          { name: "Calculadora de costos de cuidado", path: "/calculadora" },
        ]}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(faqLd(FAQS)) }}
      />
      <Navbar />

      <main id="main" className="pt-24 pb-20">
        {/* HERO */}
        <section className="relative overflow-hidden py-10 sm:py-14">
          <div className="absolute inset-0 bg-cyber" />
          <div className="absolute inset-0 bg-aurora opacity-60" />
          <div className="absolute inset-0 grid-pattern opacity-30" />
          <div className="relative mx-auto max-w-5xl px-4 sm:px-6">
            <span className="inline-flex items-center gap-2 rounded-full border border-biosensor/30 bg-biosensor/10 px-3.5 py-1.5 text-xs font-medium text-biosensor">
              <Calculator className="h-3.5 w-3.5" />
              Calculadora gratuita · Tarifas 2026
            </span>
            <h1 className="mt-4 font-display text-3xl sm:text-5xl font-bold leading-[1.05] text-cyber-foreground">
              ¿Cuánto cuesta un enfermero o cuidador a domicilio en Colombia?
            </h1>
            <p className="mt-5 max-w-3xl text-base sm:text-lg text-cyber-foreground/75 leading-relaxed">
              Estima en segundos el costo de contratar talento humano en salud por hora, día o mes
              según ciudad, perfil profesional y tipo de turno. Datos referenciales del mercado
              colombiano basados en miles de servicios verificados.
            </p>
          </div>
        </section>

        {/* CALCULATOR */}
        <section className="mx-auto max-w-5xl px-4 sm:px-6 -mt-4 sm:-mt-8 relative z-10">
          <Card className="p-5 sm:p-8 shadow-elegant">
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Controls */}
              <div className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="role">Tipo de profesional</Label>
                  <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                    <SelectTrigger id="role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(ROLE_HOURLY) as Role[]).map((k) => (
                        <SelectItem key={k} value={k}>
                          {ROLE_HOURLY[k].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{ROLE_HOURLY[role].description}</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="city">Ciudad</Label>
                  <Select value={city} onValueChange={(v) => setCity(v as City)}>
                    <SelectTrigger id="city">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(CITY_FACTOR) as City[]).map((k) => (
                        <SelectItem key={k} value={k}>
                          {CITY_FACTOR[k].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="shift">Tipo de turno</Label>
                  <Select value={shift} onValueChange={(v) => setShift(v as Shift)}>
                    <SelectTrigger id="shift">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(SHIFT_OPTIONS) as Shift[]).map((k) => (
                        <SelectItem key={k} value={k}>
                          {SHIFT_OPTIONS[k].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Días por semana</Label>
                    <span className="text-sm font-semibold text-biosensor">{daysPerWeek} días</span>
                  </div>
                  <Slider
                    min={1}
                    max={7}
                    step={1}
                    value={[daysPerWeek]}
                    onValueChange={(v) => setDaysPerWeek(v[0] ?? 5)}
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Duración del servicio</Label>
                    <span className="text-sm font-semibold text-biosensor">
                      {weeks} {weeks === 1 ? "semana" : "semanas"}
                    </span>
                  </div>
                  <Slider
                    min={1}
                    max={12}
                    step={1}
                    value={[weeks]}
                    onValueChange={(v) => setWeeks(v[0] ?? 4)}
                  />
                </div>

                <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-muted/30 p-3">
                  <div>
                    <Label htmlFor="holiday" className="cursor-pointer">
                      Incluir domingos y festivos
                    </Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Suma el recargo legal del 75% prorrateado.
                    </p>
                  </div>
                  <Switch
                    id="holiday"
                    checked={includeHoliday}
                    onCheckedChange={setIncludeHoliday}
                  />
                </div>
              </div>

              {/* Result */}
              <div className="rounded-2xl border border-biosensor/30 bg-gradient-to-br from-biosensor/5 to-transparent p-5 sm:p-6 flex flex-col">
                <p className="text-xs uppercase tracking-[0.18em] text-biosensor/80 font-semibold">
                  Costo estimado
                </p>

                <div className="mt-3 space-y-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Por hora</p>
                    <p className="font-display text-xl sm:text-2xl font-bold">
                      {formatCOP(result.hourMin)} – {formatCOP(result.hourMax)}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs text-muted-foreground">
                      Por jornada ({SHIFT_OPTIONS[shift].hoursPerDay}h)
                    </p>
                    <p className="font-display text-xl sm:text-2xl font-bold">
                      {formatCOP(result.dayMin)} – {formatCOP(result.dayMax)}
                    </p>
                  </div>

                  <div className="border-t border-border pt-4">
                    <p className="text-xs text-muted-foreground">
                      Total del periodo ({result.totalDays} días · {result.totalHours} horas)
                    </p>
                    <p className="font-display text-2xl sm:text-3xl font-bold text-biosensor mt-1">
                      {formatCOP(result.periodMin)}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      hasta <span className="font-semibold">{formatCOP(result.periodMax)}</span>
                    </p>
                  </div>
                </div>

                <div className="mt-auto pt-5 space-y-3">
                  <Button variant="hero" size="lg" className="w-full" asChild>
                    <Link to="/buscar">
                      Buscar profesional ahora
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                  <a
                    href={CONTACT.whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-center text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    ¿Caso complejo? Habla con un coordinador por WhatsApp
                  </a>
                </div>
              </div>
            </div>

            <p className="mt-6 flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              Tarifas referenciales basadas en el mercado colombiano de cuidado domiciliario 2026.
              El precio final lo define cada profesional según experiencia, complejidad del
              paciente y desplazamiento. Humanix nunca cobra comisión sobre el servicio.
            </p>
          </Card>
        </section>

        {/* TRUST BAND */}
        <section className="mx-auto max-w-5xl px-4 sm:px-6 mt-10">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-biosensor" />
              <div>
                <p className="text-sm font-semibold">RETHUS verificado</p>
                <p className="text-xs text-muted-foreground">
                  Validamos registro profesional y antecedentes antes de publicar.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4">
              <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-biosensor" />
              <div>
                <p className="text-sm font-semibold">Sin comisiones ocultas</p>
                <p className="text-xs text-muted-foreground">
                  Pagas directo al profesional. Humanix vive de planes, no de descuentos al
                  servicio.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4">
              <Calculator className="mt-0.5 h-5 w-5 shrink-0 text-biosensor" />
              <div>
                <p className="text-sm font-semibold">Cotización en vivo</p>
                <p className="text-xs text-muted-foreground">
                  Recibes propuestas reales de profesionales cercanos en menos de 10 minutos.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* CONTENT FOR SEO */}
        <section className="mx-auto max-w-3xl px-4 sm:px-6 mt-14 prose prose-invert prose-sm sm:prose-base">
          <h2>Cómo se calcula el costo del cuidado domiciliario en Colombia</h2>
          <p>
            El precio de contratar un enfermero, auxiliar o cuidador a domicilio depende de cuatro
            variables: <strong>perfil profesional</strong>, <strong>ciudad</strong>,{" "}
            <strong>tipo de turno</strong> y <strong>recargos legales</strong>. Esta calculadora
            combina las cuatro y entrega un rango realista que puedes usar para presupuestar el
            cuidado de un familiar o paciente.
          </p>

          <h3>Tarifas hora promedio en Colombia (2026)</h3>
          <ul>
            <li>Cuidador básico: $7.000 – $11.000 COP/hora</li>
            <li>Auxiliar de enfermería: $10.000 – $16.000 COP/hora</li>
            <li>Enfermero(a) profesional: $18.000 – $28.000 COP/hora</li>
            <li>Enfermero(a) jefe especializado: $28.000 – $45.000 COP/hora</li>
          </ul>

          <h3>Diferencia por ciudad</h3>
          <p>
            Bogotá es el mercado de referencia. Medellín, Cali, Barranquilla y Cartagena están
            entre 5% y 8% por debajo. Bucaramanga y Pereira entre 10% y 12% por debajo. Ciudades
            intermedias suelen estar 15% por debajo de la tarifa capitalina.
          </p>

          <h3>Recargos legales que debes conocer</h3>
          <p>
            El turno nocturno (entre 7pm y 7am) tiene un recargo cercano al 35%. El trabajo en
            domingo o festivo aplica recargo del 75% según el Código Sustantivo del Trabajo. Si
            contratas un turno 24 horas en festivo, el costo puede ser hasta 60% mayor que un
            turno diurno regular.
          </p>
        </section>

        {/* FAQ */}
        <section className="mx-auto max-w-3xl px-4 sm:px-6 mt-14">
          <h2 className="font-display text-2xl sm:text-3xl font-bold mb-6">
            Preguntas frecuentes sobre costos
          </h2>
          <div className="space-y-3">
            {FAQS.map((f) => (
              <details
                key={f.q}
                className="group rounded-xl border border-border bg-card p-4 [&_summary::-webkit-details-marker]:hidden"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-foreground">
                  {f.q}
                  <span className="text-muted-foreground group-open:rotate-180 transition-transform">
                    ⌄
                  </span>
                </summary>
                <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* RELATED */}
        <section className="mx-auto max-w-5xl px-4 sm:px-6 mt-14">
          <h2 className="font-display text-xl sm:text-2xl font-bold mb-4">
            Servicios relacionados
          </h2>
          <div className="flex flex-wrap gap-2">
            {[
              { label: "Enfermería domiciliaria", to: "/enfermeria-domiciliaria" },
              { label: "Cuidado adulto mayor", to: "/cuidado-adulto-mayor" },
              { label: "Cuidado postoperatorio", to: "/cuidado-postoperatorio" },
              { label: "Cuidados paliativos", to: "/cuidado-paliativo" },
              { label: "Cuidador a domicilio", to: "/cuidador-domicilio" },
              { label: "Enfermería en Bogotá", to: "/enfermeria-bogota" },
              { label: "Enfermería en Medellín", to: "/enfermeria-medellin" },
              { label: "Ver planes Humanix", to: "/planes" },
            ].map((l) => (
              <Link
                key={l.to}
                to={l.to as never}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3.5 py-1.5 text-sm text-foreground/80 hover:text-foreground hover:border-foreground/30 transition-colors"
              >
                {l.label}
              </Link>
            ))}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}