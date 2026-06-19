// @ts-nocheck
/**
 * REAL TIME PROFESSIONALS MAP
 * 
 * Mapa en tiempo real de profesionales disponibles (estilo Uber)
 * - Vista en tiempo real de profesionales por ciudad
 * - Filtro por especialidad
 * - Distancia y disponibilidad
 * - Integración con realtime de Supabase
 */

import { useEffect, useState } from "react";
import {
  Loader2,
  MapPin,
  Users,
  Star,
  Filter,
  Zap,
  Activity,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type ProfessionalLive = {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  specialty: string | null;
  city: string | null;
  avg_rating: number | null;
  hourly_rate: number | null;
  phone: string | null;
  availability_status: "available" | "unavailable" | null;
  is_online: boolean;
  is_live: boolean;
};

type AvailabilityFilter = "all" | "available" | "unavailable";

export function RealTimeProfessionalsMap({
  institutionCity,
  userId,
}: {
  institutionCity: string;
  userId: string;
}) {
  const [professionals, setProfessionals] = useState<ProfessionalLive[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<AvailabilityFilter>("all");
  const [specialtyFilter, setSpecialtyFilter] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [tick, setTick] = useState(0);

  // ── Suscripción realtime (separada de la carga para evitar re-subscribe infinito) ──
  useEffect(() => {
    const suffix = Math.random().toString(36).slice(2, 7);
    const ch = supabase
      .channel(`rt_pros_map_${institutionCity}_${suffix}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "professional_profiles" },
        () => setTick((n) => n + 1))
      .on("postgres_changes", { event: "*", schema: "public", table: "user_locations" },
        () => setTick((n) => n + 1))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [institutionCity]);

  // ── Carga de datos (se re-ejecuta cuando cambia tick o filtros) ───────────
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        // La vista public_professionals_safe ya incluye full_name, avatar_url, phone
        let query = supabase
          .from("public_professionals_safe")
          .select("user_id, specialty, avg_rating, hourly_rate, availability_status, available, home_city, full_name, avatar_url, phone")
          .eq("home_city", institutionCity);

        if (statusFilter === "available") {
          query = query.eq("available", true);
        } else if (statusFilter === "unavailable") {
          query = query.eq("available", false);
        }

        // Cargar IDs con GPS en vivo en paralelo
        const [{ data, error }, { data: liveData }] = await Promise.all([
          query.order("avg_rating", { ascending: false }),
          (supabase as any)
            .from("user_locations")
            .select("user_id")
            .eq("is_online", true),
        ]);

        if (error) throw error;
        if (!active) return;

        const liveSet = new Set<string>((liveData ?? []).map((r: any) => r.user_id));

        const pros = (data ?? []).map((p: any) => ({
          user_id: p.user_id,
          full_name: p.full_name || null,
          avatar_url: p.avatar_url || null,
          specialty: p.specialty,
          city: p.home_city || null,
          avg_rating: p.avg_rating,
          hourly_rate: p.hourly_rate,
          phone: p.phone || null,
          availability_status: p.availability_status as "available" | "unavailable" | null,
          is_online: p.available === true,
          is_live: liveSet.has(p.user_id),
        }));

        const specs = Array.from(new Set(pros.map((p) => p.specialty).filter(Boolean))) as string[];
        setProfessionals(pros);
        setSpecialties(specs);
      } catch (e) {
        console.error("[RealTimeProfessionalsMap] load failed", e);
        if (active) toast.error("Error cargando profesionales");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [institutionCity, statusFilter, tick]);

  // Filtrar profesionales
  const filtered = professionals.filter((p) => {
    const matchesSpecialty = !specialtyFilter || p.specialty === specialtyFilter;
    const matchesSearch =
      !searchTerm ||
      p.full_name?.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSpecialty && matchesSearch;
  });

  const availableCount = filtered.filter((p) => p.is_online).length;
  const unavailableCount = filtered.filter((p) => !p.is_online).length;
  const liveCount = filtered.filter((p) => p.is_live).length;
  const averageRating =
    filtered.length > 0
      ? (
          filtered.reduce((sum, p) => sum + (p.avg_rating || 0), 0) /
          filtered.length
        ).toFixed(1)
      : "0";

  if (loading) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Cargando
        profesionales…
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-3 bg-gradient-to-br from-emerald-50 to-transparent border-emerald-200/50">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Disponibles</p>
              <p className="text-2xl font-bold text-emerald-600">{availableCount}</p>
              {liveCount > 0 && (
                <p className="text-[10px] text-emerald-500 flex items-center gap-1 mt-0.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping" />
                  {liveCount} GPS en vivo
                </p>
              )}
            </div>
            <Zap className="h-5 w-5 text-emerald-600 opacity-30" />
          </div>
        </Card>

        <Card className="p-3 bg-gradient-to-br from-gray-50 to-transparent border-gray-200/50">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">No disponibles</p>
              <p className="text-2xl font-bold text-gray-500">{unavailableCount}</p>
            </div>
            <Activity className="h-5 w-5 text-gray-400 opacity-30" />
          </div>
        </Card>

        <Card className="p-3 bg-gradient-to-br from-amber-50 to-transparent border-amber-200/50">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Promedio rating</p>
              <p className="text-2xl font-bold text-amber-600">
                {averageRating}⭐
              </p>
            </div>
            <Star className="h-5 w-5 text-amber-600 opacity-30" />
          </div>
        </Card>

        <Card className="p-3 bg-gradient-to-br from-fuchsia-50 to-transparent border-fuchsia-200/50">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-2xl font-bold text-fuchsia-600">
                {filtered.length}
              </p>
            </div>
            <Users className="h-5 w-5 text-fuchsia-600 opacity-30" />
          </div>
        </Card>
      </div>

      {/* Filtros */}
      <Card className="p-3 space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">Filtrar profesionales</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Input
            placeholder="Buscar por nombre…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />

          <Select value={specialtyFilter} onValueChange={setSpecialtyFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Todas las especialidades" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Todas</SelectItem>
              {specialties.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
            <SelectTrigger>
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="available">Disponibles</SelectItem>
              <SelectItem value="unavailable">No disponibles</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* Lista de profesionales */}
      {filtered.length === 0 ? (
        <Card className="p-8 text-center">
          <Users className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="font-semibold">Sin profesionales disponibles</p>
          <p className="text-sm text-muted-foreground mt-1">
            Intenta cambiar los filtros o espera a que se conecten más
            profesionales.
          </p>
        </Card>
      ) : (
        <div className="grid gap-2">
          {filtered.map((pro) => (
            <Card
              key={pro.user_id}
              className="p-3 flex items-start justify-between gap-3 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-start gap-3 flex-1 min-w-0">
                {pro.avatar_url ? (
                  <img
                    src={pro.avatar_url}
                    alt={pro.full_name || ""}
                    className="h-10 w-10 rounded-full object-cover border-2 border-border shrink-0"
                  />
                ) : (
                  <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center font-semibold text-xs shrink-0">
                    {(pro.full_name || "?").slice(0, 1).toUpperCase()}
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-sm truncate">
                      {pro.full_name || "Profesional"}
                    </p>

                    {/* Status badge */}
                    <Badge
                      className={
                        pro.is_online
                          ? "bg-emerald-600/15 text-emerald-700 border-emerald-600/30 text-[10px]"
                          : "bg-gray-600/15 text-gray-700 border-gray-600/30 text-[10px]"
                      }
                    >
                      {pro.is_online ? "🟢 Disponible" : "⚪ No disponible"}
                    </Badge>

                    {/* GPS en vivo */}
                    {pro.is_live && (
                      <Badge className="bg-emerald-500/20 text-emerald-600 border-emerald-500/40 text-[10px] gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping inline-block" />
                        En vivo
                      </Badge>
                    )}

                    {pro.avg_rating && pro.avg_rating > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-xs text-amber-600">
                        <Star className="h-3 w-3 fill-amber-600" />
                        {Number(pro.avg_rating).toFixed(1)}
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-muted-foreground mt-1">
                    {pro.specialty || "Profesional de salud"}
                    {pro.city ? ` · ${pro.city}` : ""}
                  </p>

                  <div className="flex flex-wrap gap-2 mt-1.5 text-xs">
                    {pro.hourly_rate && (
                      <span className="bg-muted px-2 py-1 rounded">
                        ${pro.hourly_rate.toLocaleString("es-CO")}/h
                      </span>
                    )}

                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2 shrink-0">
                <Button size="sm" variant="hero" className="text-xs">
                  Contactar
                </Button>
                <Button size="sm" variant="outline" className="text-xs">
                  Ver perfil
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Footer info */}
      <Card className="p-3 bg-muted/50 text-center text-xs text-muted-foreground">
        <p className="flex items-center justify-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Profesionales en {institutionCity} · Sincronización Supabase en tiempo real
        </p>
      </Card>
    </div>
  );
}
