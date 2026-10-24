// Familias: tarjeta en vivo con el profesional disponible más cercano y un botón grande «Pedir».
// Datos del directorio público (la función del servidor decide qué nombre y foto viajan).
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { fetchPublicProfessionals, publicProsKeys } from "@/hooks/use-public-professionals";
import { pickRadarPro, radarPrice } from "@/lib/homeRadar";
import { QuickBooking, type BookablePro } from "./QuickBooking";
import { primaryBtn } from "./ui";
import { useVoice } from "./voice";

const FILTERS = { limit: 40 } as const;

export function NearbyProRadar() {
  const { say } = useVoice();
  const [booking, setBooking] = useState<BookablePro | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: publicProsKeys.list(FILTERS),
    staleTime: 60_000,
    queryFn: () => fetchPublicProfessionals(FILTERS, { signal: AbortSignal.timeout(10000) }),
  });

  if (isLoading) {
    return (
      <div
        aria-busy="true"
        aria-label="Buscando profesionales cerca"
        className="h-36 animate-pulse rounded-[2rem] bg-muted"
      />
    );
  }

  const pro = pickRadarPro(data ?? []);
  if (!pro) return null;
  const price = radarPrice(pro);

  return (
    <section
      aria-label="Profesional cerca de ti, en vivo"
      className="relative overflow-hidden rounded-[2rem] border border-border bg-card p-4 shadow-xl shadow-trust/10 animate-in fade-in slide-in-from-bottom-2 duration-500 sm:p-6"
    >
      <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-ok/10 px-3 py-1 text-sm font-bold text-ok">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-60 motion-reduce:hidden" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-ok" />
        </span>
        {pro.available ? "Disponible ahora" : "Cerca de ti"}
      </p>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          {pro.avatarUrl ? (
            <img
              src={pro.avatarUrl}
              alt={`Foto de ${pro.name}`}
              loading="lazy"
              className={`h-20 w-20 shrink-0 rounded-full object-cover ring-4 ring-ok/40`}
            />
          ) : (
            <span
              aria-hidden="true"
              className={`flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-trust/10 font-display text-3xl font-bold text-trust ring-4 ring-ok/40`}
            >
              {pro.name.charAt(0)}
            </span>
          )}
          <div className="min-w-0">
            <p className="font-display text-2xl font-bold leading-tight">{pro.name}</p>
            <p className="text-base text-muted-foreground">
              {pro.specialty} · {pro.city}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="badge-rethus">RETHUS verificado</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-trust/10 px-3 py-1 text-xs font-bold text-trust">
                🛡️ Puerta Segura incluida
              </span>
              {pro.live && (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs font-bold">
                  🟢 En línea
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 sm:flex-col sm:items-end">
          {price && (
            <p className="flex-1 whitespace-nowrap text-lg font-bold sm:flex-none">{price}</p>
          )}
          <button
            type="button"
            onClick={() => {
              say(`Pedir a ${pro.name}`);
              setBooking({
                id: pro.id,
                name: pro.name,
                hourlyRate: pro.hourlyRate,
                avatarUrl: pro.avatarUrl,
              });
            }}
            className={`${primaryBtn} w-auto min-w-36 px-8 text-xl`}
          >
            Pedir
          </button>
        </div>
      </div>
      <QuickBooking pro={booking} onClose={() => setBooking(null)} />
    </section>
  );
}
