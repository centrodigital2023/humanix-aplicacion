import { useEffect, useState } from "react";
import { Star, Quote, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TestimonialComposer } from "./TestimonialComposer";
import t1 from "@/assets/testimonial-1.webp";
import t2 from "@/assets/testimonial-2.webp";
import t3 from "@/assets/testimonial-3.webp";
import t4 from "@/assets/testimonial-4.webp";

const sb = supabase as unknown as SupabaseClient;

type Testimonial = {
  id: string;
  name: string;
  role: string;
  city: string;
  avatar: string;
  rating: number;
  quote: string;
  badge?: string;
  trustScore?: number;
};

const fallback: Testimonial[] = [
  {
    id: "static-1",
    name: "Laura Mendoza",
    role: "Enfermera Jefe · 7 años de experiencia",
    city: "Bogotá",
    avatar: t1,
    rating: 5,
    badge: "Top Rated",
    quote:
      "Antes pasaba semanas buscando turnos. Con Humanix recibo ofertas a 2 km de mi casa y me pagan en Nequi al terminar. Mi ingreso mensual subió 38%.",
  },
  {
    id: "static-2",
    name: "Carlos Restrepo",
    role: "Hijo de paciente · cuida a su mamá",
    city: "Medellín",
    avatar: t2,
    rating: 5,
    badge: "Familia verificada",
    quote:
      "Mi mamá necesitaba cuidado nocturno urgente. En 14 minutos llegó Diana, una auxiliar verificada por RETHUS. La tranquilidad de ver su Trust Score de 96 no tiene precio.",
  },
  {
    id: "static-3",
    name: "Andrés Quintero",
    role: "Auxiliar de enfermería · UCI",
    city: "Cali",
    avatar: t3,
    rating: 5,
    badge: "Verificado RETHUS",
    quote:
      "El asistente de IA me ayudó a estructurar mi hoja de vida y a prepararme para entrevistas. Conseguí un contrato fijo en una clínica top en menos de un mes.",
  },
  {
    id: "static-4",
    name: "Marta Herrera",
    role: "Cuidadora de adulto mayor",
    city: "Barranquilla",
    avatar: t4,
    rating: 5,
    badge: "120 turnos",
    quote:
      "Soy mamá soltera y necesito horarios flexibles. Acepto turnos desde WhatsApp y cobro inmediato por PSE. Humanix cambió la economía de mi familia.",
  },
];

function Stars({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-0.5" aria-label={`${value} de 5 estrellas`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`h-4 w-4 ${
            i < value ? "fill-copper text-copper" : "text-muted-foreground/30"
          }`}
        />
      ))}
    </div>
  );
}

const ROLE_LABEL: Record<string, string> = {
  professional: "Profesional Humanix",
  family: "Familia Humanix",
  institution: "Institución aliada",
};

type DbRow = {
  id: string;
  author_name: string;
  author_role: "professional" | "family" | "institution";
  author_city: string | null;
  author_avatar_url: string | null;
  content: string;
  rating: number;
  trust_score_snapshot: number;
  created_at: string;
};

export function Testimonials() {
  const [live, setLive] = useState<Testimonial[]>([]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data } = await sb
        .from("community_testimonials")
        .select(
          "id, author_name, author_role, author_city, author_avatar_url, content, rating, trust_score_snapshot, created_at",
        )
        .eq("status", "published")
        .order("created_at", { ascending: false })
        .limit(8);
      if (!active) return;
      setLive(
        ((data ?? []) as DbRow[]).map((r) => ({
          id: r.id,
          name: r.author_name,
          role: ROLE_LABEL[r.author_role] ?? "Comunidad Humanix",
          city: r.author_city ?? "Colombia",
          avatar: r.author_avatar_url ?? t1,
          rating: r.rating,
          quote: r.content,
          badge: r.trust_score_snapshot >= 70 ? "Trust verificado" : undefined,
          trustScore: r.trust_score_snapshot,
        })),
      );
    };
    void load();
    const ch = sb
      .channel("community_testimonials_pub")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "community_testimonials" },
        () => void load(),
      )
      .subscribe();
    return () => {
      active = false;
      sb.removeChannel(ch);
    };
  }, []);

  const list = live.length >= 2 ? live : [...live, ...fallback].slice(0, 6);

  return (
    <section id="testimonios" className="py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6">
          <div className="max-w-2xl">
          <span className="text-xs uppercase tracking-[0.2em] text-fuchsia-neural font-semibold">
            Casos reales
          </span>
          <h2 className="mt-3 font-display text-3xl sm:text-4xl font-bold leading-tight">
            Historias que pasan en Colombia,{" "}
            <span className="text-gradient-bio">todos los días</span>.
          </h2>
          <p className="mt-4 text-muted-foreground leading-relaxed">
            Profesionales y familias que ya transformaron su forma de cuidar y de trabajar con
            Humanix.
          </p>
          </div>
          <TestimonialComposer />
        </div>

        <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-2 gap-5">
          {list.map((t) => (
            <article
              key={t.id}
              className="group relative rounded-3xl border border-border bg-card p-6 sm:p-7 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-elegant)] hover:-translate-y-1 transition-all duration-300"
            >
              <Quote className="absolute top-5 right-5 h-8 w-8 text-biosensor/20" />

              <div className="flex items-start gap-4">
                <img
                  src={t.avatar}
                  alt={`Foto de ${t.name}`}
                  loading="lazy"
                  width={64}
                  height={64}
                  className="h-16 w-16 rounded-2xl object-cover border border-border"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-display font-semibold text-lg leading-tight">{t.name}</h3>
                    {t.badge && (
                      <span className="inline-flex items-center text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-biosensor/15 text-biosensor border border-biosensor/30">
                        {t.badge}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{t.role}</p>
                  <div className="mt-2 flex items-center gap-3">
                    <Stars value={t.rating} />
                    <span className="text-xs text-muted-foreground">· {t.city}</span>
                    {typeof t.trustScore === "number" && t.trustScore > 0 ? (
                      <span className="inline-flex items-center gap-1 text-[10px] text-biosensor">
                        <ShieldCheck className="h-3 w-3" /> {t.trustScore}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              <p className="mt-5 text-sm sm:text-[15px] leading-relaxed text-foreground/90">
                "{t.quote}"
              </p>
            </article>
          ))}
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-10 gap-y-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Star className="h-4 w-4 fill-copper text-copper" />
            <strong className="text-foreground">4.9/5</strong> promedio en 1.2k reseñas
          </div>
          <div>
            <strong className="text-foreground">94%</strong> de turnos completados
          </div>
          <div>
            <strong className="text-foreground">38 min</strong> tiempo medio de match
          </div>
        </div>
      </div>
    </section>
  );
}
