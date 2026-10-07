// Catch-all SEO landing pages for city × specialty combinations.
// Handles URLs like /auxiliar-enfermeria-bogota, /fisioterapia-medellin, etc.
// Specific route files (enfermeria-bogota, cuidado-adulto-mayor, etc.) take
// priority over this splat — TanStack Router's more-specific-first rule.
import { createFileRoute, notFound } from "@tanstack/react-router";
import { SeoLanding } from "@/components/humanix/SeoLanding";
import { buildSeo } from "@/lib/seo";
import { serviceLd } from "@/lib/seo-landing";

// Extended city catalog beyond the 7 in seo-landing.ts
const ALL_CITIES: Record<string, { name: string; region: string }> = {
  bogota: { name: "Bogotá", region: "Cundinamarca" },
  medellin: { name: "Medellín", region: "Antioquia" },
  cali: { name: "Cali", region: "Valle del Cauca" },
  barranquilla: { name: "Barranquilla", region: "Atlántico" },
  cartagena: { name: "Cartagena", region: "Bolívar" },
  bucaramanga: { name: "Bucaramanga", region: "Santander" },
  pereira: { name: "Pereira", region: "Risaralda" },
  manizales: { name: "Manizales", region: "Caldas" },
  cucuta: { name: "Cúcuta", region: "Norte de Santander" },
  ibague: { name: "Ibagué", region: "Tolima" },
  villavicencio: { name: "Villavicencio", region: "Meta" },
  "santa-marta": { name: "Santa Marta", region: "Magdalena" },
  monteria: { name: "Montería", region: "Córdoba" },
  pasto: { name: "Pasto", region: "Nariño" },
  armenia: { name: "Armenia", region: "Quindío" },
  valledupar: { name: "Valledupar", region: "Cesar" },
  sincelejo: { name: "Sincelejo", region: "Sucre" },
  neiva: { name: "Neiva", region: "Huila" },
};

// Sorted longest-first so "santa-marta" matches before "marta"
const CITY_SLUGS = Object.keys(ALL_CITIES).sort((a, b) => b.length - a.length);

type SpecialtyDef = {
  title: string;
  serviceType: string;
  intro: (city: string, region: string) => string;
  bullets: (city: string) => string[];
  faqs: (city: string) => Array<{ q: string; a: string }>;
};

const SPECIALTY_DATA: Record<string, SpecialtyDef> = {
  "auxiliar-enfermeria": {
    title: "Auxiliar de Enfermería a Domicilio",
    serviceType: "Auxiliar de Enfermería Domiciliaria",
    intro: (city) =>
      `Auxiliares de enfermería verificados con tarjeta RETHUS activa en ${city}. Turnos 12 o 24 horas, cuidado postoperatorio, adulto mayor y paciente crónico.`,
    bullets: (city) => [
      `Red de auxiliares activos en ${city} con RETHUS vigente.`,
      "Disponibilidad 7 días a la semana, 24 horas.",
      "Verificación de antecedentes penales y referencias laborales.",
      "GPS en vivo durante el servicio.",
    ],
    faqs: (city) => [
      {
        q: `¿Cuánto cuesta un auxiliar de enfermería en ${city}?`,
        a: `En ${city} los auxiliares de enfermería domiciliaria cobran desde $22.000/hora. Las jornadas de 12 horas tienen tarifas especiales.`,
      },
      {
        q: "¿Los auxiliares tienen RETHUS?",
        a: "Sí. Humanix verifica RETHUS en tiempo real antes de asignar cualquier auxiliar. Solo aparecen perfiles con tarjeta profesional vigente.",
      },
    ],
  },
  "cuidado-adulto-mayor": {
    title: "Cuidado de Adulto Mayor a Domicilio",
    serviceType: "Cuidado de Adulto Mayor Domiciliario",
    intro: (city) =>
      `Cuidadores certificados para adultos mayores en ${city}. Atención integral, compañía, administración de medicamentos y movilidad asistida.`,
    bullets: (city) => [
      `Cuidadores con formación en gerontología en ${city}.`,
      "Atención a pacientes con Alzheimer, Parkinson y ACV.",
      "Turnos de 6, 12 o 24 horas.",
      "Reportes en tiempo real a la familia.",
    ],
    faqs: (city) => [
      {
        q: `¿Qué incluye el cuidado de adulto mayor en ${city}?`,
        a: "Incluye compañía, higiene personal, medicamentos, alimentación, ejercicios de movilidad y registro de signos vitales.",
      },
      {
        q: "¿Cuánto tiempo tarda en llegar un cuidador?",
        a: `En ${city} el tiempo promedio es 90 minutos para urgentes. Para programados la confirmación es en menos de 2 horas.`,
      },
    ],
  },
  "cuidado-pediatrico": {
    title: "Cuidado Pediátrico Domiciliario",
    serviceType: "Enfermería Pediátrica Domiciliaria",
    intro: (city) =>
      `Enfermeras y auxiliares especializadas en pediatría en ${city}. Cuidado neonatal, postoperatorio infantil y niños con patologías crónicas en casa.`,
    bullets: (city) => [
      `Profesionales con formación pediátrica en ${city}.`,
      "Cuidado neonatal, lactantes y niños hasta 14 años.",
      "Experiencia en asma, diabetes tipo 1 y cardiopatías.",
      "Coordinación directa con pediatra tratante.",
    ],
    faqs: (city) => [
      {
        q: `¿Cómo funciona la enfermería pediátrica en ${city}?`,
        a: `Una enfermera especializada visita el hogar en ${city}: control postoperatorio, nebulizaciones, monitoreo de glucosa y manejo de sondas.`,
      },
      {
        q: "¿Atienden a recién nacidos?",
        a: "Sí, contamos con enfermeras con experiencia en neonatología para cuidados en casa tras el alta hospitalaria.",
      },
    ],
  },
  "cuidado-paliativo": {
    title: "Cuidado Paliativo a Domicilio",
    serviceType: "Cuidados Paliativos Domiciliarios",
    intro: (city) =>
      `Equipos de cuidado paliativo en ${city} para pacientes con enfermedades terminales o crónicas avanzadas. Dignidad, confort y apoyo a la familia.`,
    bullets: (city) => [
      `Profesionales especializados en cuidado paliativo en ${city}.`,
      "Manejo del dolor y síntomas según protocolo clínico.",
      "Apoyo psicosocial para paciente y cuidadores.",
      "Coordinación con equipo médico tratante.",
    ],
    faqs: (city) => [
      {
        q: `¿Qué es el cuidado paliativo domiciliario en ${city}?`,
        a: "Es atención integral para mejorar la calidad de vida frente a enfermedades que amenazan la vida: manejo del dolor, soporte emocional y espiritual.",
      },
      {
        q: "¿Quién puede acceder a cuidado paliativo en casa?",
        a: "Pacientes con cáncer avanzado, EPOC severo, insuficiencia cardíaca terminal, demencias avanzadas u otras patologías crónicas con pronóstico limitado.",
      },
    ],
  },
  "cuidado-postoperatorio": {
    title: "Cuidado Postoperatorio en Casa",
    serviceType: "Cuidado Postoperatorio Domiciliario",
    intro: (city) =>
      `Recuperación postoperatoria en casa con enfermería especializada en ${city}. Manejo de heridas, drenajes, medicamentos y rehabilitación temprana.`,
    bullets: (city) => [
      `Enfermeras postoperatorias disponibles en ${city}.`,
      "Cura de heridas, catéteres y sondas.",
      "Control de signos vitales y alerta de complicaciones.",
      "Coordinación con cirujano o médico tratante.",
    ],
    faqs: (city) => [
      {
        q: `¿Cuándo contratar enfermería postoperatoria en ${city}?`,
        a: "Desde el alta hospitalaria. Lo ideal es tener la enfermera lista el día del alta para el traslado y la primera noche en casa.",
      },
      {
        q: "¿Qué cirugías requieren más seguimiento domiciliario?",
        a: "Artroplastia, cirugía bariátrica, colecistectomía, cesárea, cirugía cardíaca y cualquier procedimiento con drenajes o catéteres.",
      },
    ],
  },
  "cuidador-domicilio": {
    title: "Cuidador a Domicilio Certificado",
    serviceType: "Servicio de Cuidador Domiciliario",
    intro: (city) =>
      `Cuidadores certificados en ${city} para apoyo en actividades diarias, compañía y bienestar en el hogar. Verificación de antecedentes incluida.`,
    bullets: (city) => [
      `Red de cuidadores certificados en ${city}.`,
      "Apoyo en higiene, alimentación, movilidad y medicamentos.",
      "Ideal para adulto mayor, discapacidad o convalecencia.",
      "Reportes diarios a la familia.",
    ],
    faqs: (city) => [
      {
        q: `¿Cuánto cuesta un cuidador a domicilio en ${city}?`,
        a: `Los cuidadores en ${city} cobran desde $20.000/hora o desde $350.000 por jornada de 12 horas. Tarifas especiales de lunes a viernes.`,
      },
      {
        q: "¿Los cuidadores están verificados?",
        a: "Sí. Humanix verifica antecedentes penales, referencias laborales y certificaciones antes de activar cualquier perfil.",
      },
    ],
  },
  fisioterapia: {
    title: "Fisioterapia a Domicilio",
    serviceType: "Fisioterapia Domiciliaria",
    intro: (city) =>
      `Fisioterapeutas con tarjeta RETHUS activa en ${city}. Rehabilitación motora, neurológica y respiratoria directamente en el hogar del paciente.`,
    bullets: (city) => [
      `Fisioterapeutas activos en ${city} con RETHUS vigente.`,
      "Rehabilitación post-ACV, post-fractura y post-cirugía ortopédica.",
      "Terapia respiratoria y neurológica domiciliaria.",
      "Equipos de electroterapia, ultrasonido y kinesiotaping.",
    ],
    faqs: (city) => [
      {
        q: `¿Cuánto cuesta una sesión de fisioterapia en ${city}?`,
        a: `En ${city} las sesiones van desde $45.000 por consulta individual. Paquetes de 10 o 20 sesiones tienen descuentos significativos.`,
      },
      {
        q: "¿Qué condiciones trata la fisioterapia domiciliaria?",
        a: "Post-ACV, lesiones ligamentosas, artrosis, escoliosis, EPOC, enfermedades neuromusculares y recuperación deportiva.",
      },
    ],
  },
  "terapia-respiratoria": {
    title: "Terapia Respiratoria a Domicilio",
    serviceType: "Terapia Respiratoria Domiciliaria",
    intro: (city) =>
      `Terapeutas respiratorios certificados en ${city} para EPOC, asma, COVID prolongado y traqueostomía en casa.`,
    bullets: (city) => [
      `Terapeutas respiratorios con RETHUS en ${city}.`,
      "Nebulizaciones, aspiración de secreciones, oxigenoterapia.",
      "Pacientes con ventilación mecánica domiciliaria.",
      "Educación a cuidadores en manejo respiratorio.",
    ],
    faqs: (city) => [
      {
        q: `¿Qué incluye la terapia respiratoria en ${city}?`,
        a: "Evaluación funcional, nebulizaciones, aspiración de secreciones, ejercicios de expansión pulmonar y control de saturación de oxígeno.",
      },
      {
        q: "¿Atienden traqueostomía en casa?",
        a: "Sí, contamos con terapeutas especializados en manejo de traqueostomía, cuidado del estoma y aspiración de secreciones.",
      },
    ],
  },
};

function parseSlug(slug: string): { specialty: string; city: string } | null {
  for (const citySlug of CITY_SLUGS) {
    const suffix = `-${citySlug}`;
    if (slug.endsWith(suffix)) {
      const specialtySlug = slug.slice(0, -suffix.length);
      if (SPECIALTY_DATA[specialtySlug]) {
        return { specialty: specialtySlug, city: citySlug };
      }
    }
  }
  return null;
}

export const Route = createFileRoute("/$")({
  head: ({ params }: { params: Record<string, string> }) => {
    const slug = params["*"] ?? "";
    const parsed = parseSlug(slug);
    if (!parsed) return {};
    const cityInfo = ALL_CITIES[parsed.city];
    const specData = SPECIALTY_DATA[parsed.specialty];
    if (!cityInfo || !specData) return {};
    return buildSeo({
      title: `${specData.title} en ${cityInfo.name} — Profesionales Verificados`,
      path: `/${slug}`,
      description: specData.intro(cityInfo.name, cityInfo.region).slice(0, 155),
    });
  },
  component: Page,
});

function Page() {
  const params = Route.useParams();
  const slug = (params as Record<string, string>)["*"] ?? "";
  const parsed = parseSlug(slug);

  if (!parsed) throw notFound();

  const cityInfo = ALL_CITIES[parsed.city];
  const specData = SPECIALTY_DATA[parsed.specialty];
  if (!cityInfo || !specData) throw notFound();

  const path = `/${slug}`;
  const cityName = cityInfo.name;

  const relatedLinks = [
    { label: `Enfermería en ${cityName}`, to: `/enfermeria-${parsed.city}` },
    { label: specData.title, to: `/${parsed.specialty}` },
    { label: `Buscar profesionales en ${cityName}`, to: "/buscar" },
    { label: "Cuidado adulto mayor", to: "/cuidado-adulto-mayor" },
  ].filter((l) => l.to !== path);

  return (
    <SeoLanding
      badge={cityInfo.region}
      h1={
        <>
          {specData.title} en <span className="text-gradient-bio">{cityName}</span>
        </>
      }
      intro={specData.intro(cityName, cityInfo.region)}
      breadcrumbs={[
        { name: "Inicio", path: "/" },
        { name: specData.title, path: `/${parsed.specialty}` },
        { name: cityName, path },
      ]}
      serviceJsonLd={serviceLd({
        name: `${specData.title} en ${cityName}`,
        description: specData.intro(cityName, cityInfo.region),
        path,
        areaName: cityName,
      })}
      bullets={specData.bullets(cityName)}
      faqs={specData.faqs(cityName)}
      ctaPath="/buscar"
      ctaLabel={`Buscar profesional en ${cityName}`}
      relatedLinks={relatedLinks as { label: string; to: string }[]}
    />
  );
}
