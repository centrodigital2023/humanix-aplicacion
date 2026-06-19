import { useState } from "react";
import { Sparkles, Loader2, MapPin, Star, ShieldCheck, Wand2, X, Pencil, Gift } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

type Candidate = {
  user_id: string;
  full_name?: string;
  city?: string;
  avatar_url?: string;
  specialty?: string;
  years_experience?: number;
  trust_score?: number;
  avg_rating?: number;
  rethus_verified?: boolean;
  hourly_rate?: number;
  shift_rate?: number;
  monthly_rate?: number;
  score: number;
  reason: string;
};

type OfferDraft = {
  title: string;
  description: string;
  specialty_required: string;
  modality: "hour" | "shift" | "month" | "package";
  suggested_amount_cop: number;
  city: string;
  requirements: string[];
};

const COP = (n: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);

export function HiringCopilot({ defaultCity }: { defaultCity?: string }) {
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState("");
  const [city, setCity] = useState(defaultCity ?? "");
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<OfferDraft | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [publishing, setPublishing] = useState(false);

  const startManual = () => {
    setDraft({
      title: "",
      description: "",
      specialty_required: "",
      modality: "hour",
      suggested_amount_cop: 0,
      city: city || defaultCity || "",
      requirements: [],
    });
    setCandidates([]);
  };

  const run = async () => {
    if (brief.trim().length < 15) {
      toast.error("Cuéntanos un poco más (mín. 15 caracteres).");
      return;
    }
    setLoading(true);
    setDraft(null);
    setCandidates([]);
    try {
      const { data, error } = await supabase.functions.invoke("hiring-copilot", {
        body: { brief, city: city || undefined },
      });
      if (error) throw error;
      setDraft(data?.offer_draft ?? null);
      setCandidates((data?.candidates ?? []) as Candidate[]);
      if (!data?.candidates?.length) {
        toast(
          "Aún no hay profesionales con embedding suficiente. Publica la oferta y los notificaremos.",
        );
      }
    } catch (e) {
      // Fallback: si la IA falla, abrimos el borrador manual con el brief
      // como descripción para que la familia/IPS pueda publicar igualmente.
      toast.warning("La IA no respondió. Puedes publicar tu oferta manualmente.");
      setDraft({
        title: "",
        description: brief,
        specialty_required: "",
        modality: "hour",
        suggested_amount_cop: 0,
        city: city || defaultCity || "",
        requirements: [],
      });
    } finally {
      setLoading(false);
    }
  };

  const publish = async () => {
    if (!draft) return;
    setPublishing(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Sesión expirada");
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", u.user.id);
      const isInst = (roles ?? []).some((r) => r.role === "institution");
      const { data: offer, error } = await supabase
        .from("job_offers")
        .insert({
          posted_by: u.user.id,
          poster_type: isInst ? "institution" : "family",
          title: draft.title,
          description: draft.description,
          specialty_required: draft.specialty_required,
          modality: draft.modality,
          amount: Math.round(draft.suggested_amount_cop),
          city: draft.city || city || "Bogotá",
          requirements: draft.requirements,
        })
        .select("id")
        .single();
      if (error) throw error;
      // Generar embedding de la oferta (no bloquea)
      supabase.functions.invoke("embed-offer", { body: { offer_id: offer.id } }).catch(() => {});
      toast.success("Oferta publicada. Los profesionales recomendados ya pueden verla.");
      setOpen(false);
      setBrief("");
      setDraft(null);
      setCandidates([]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo publicar");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <>
      <Button variant="hero" onClick={() => setOpen(true)}>
        <Wand2 className="h-4 w-4 mr-1.5" />
        Publicar oferta gratis
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm overflow-y-auto">
          <div className="min-h-screen p-4 sm:p-8 flex items-start justify-center">
            <div className="w-full max-w-3xl rounded-2xl border border-border bg-card shadow-[var(--shadow-elegant)]">
              <header className="flex items-center justify-between gap-3 px-6 py-4 border-b border-border">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-biosensor" />
                  <h2 className="font-display text-lg font-semibold">
                    Publicar oferta — gratis
                  </h2>
                  <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/30">
                    <Gift className="h-3 w-3" /> Sin costo
                  </span>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-5 w-5" />
                </button>
              </header>

              <div className="p-6 space-y-5">
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Cuéntanos qué necesitas (en lenguaje natural)
                  </label>
                  <Textarea
                    value={brief}
                    onChange={(e) => setBrief(e.target.value)}
                    rows={4}
                    placeholder="Ej: Mi mamá de 78 años salió de cirugía de cadera, necesito enfermera con experiencia en postoperatorio adulto mayor, turnos diurnos de lunes a viernes en Chapinero, Bogotá."
                  />
                  <Input
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="Ciudad (opcional)"
                  />
                  <Button variant="hero" onClick={run} disabled={loading} className="w-full">
                    {loading ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Sparkles className="h-4 w-4 mr-2" />
                    )}
                    Generar oferta y candidatos
                  </Button>
                  <button
                    type="button"
                    onClick={startManual}
                    className="w-full text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
                  >
                    O publicar manualmente sin IA →
                  </button>
                </div>

                {draft && (
                  <Card className="p-5 border-biosensor/40 bg-biosensor/5">
                    <p className="text-[11px] uppercase tracking-wider text-biosensor font-semibold mb-2">
                      <Sparkles className="h-3 w-3 inline mr-1" /> Borrador editable — la IA lo
                      prellena, tú decides
                    </p>
                    <div className="space-y-3">
                      <div>
                        <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                          Título
                        </label>
                        <Input
                          value={draft.title}
                          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                          className="mt-1 font-display text-lg"
                        />
                      </div>
                      <div className="grid sm:grid-cols-3 gap-2">
                        <div>
                          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                            Especialidad
                          </label>
                          <Input
                            value={draft.specialty_required}
                            onChange={(e) =>
                              setDraft({ ...draft, specialty_required: e.target.value })
                            }
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                            Ciudad
                          </label>
                          <Input
                            value={draft.city}
                            onChange={(e) => setDraft({ ...draft, city: e.target.value })}
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                            Modalidad
                          </label>
                          <select
                            value={draft.modality}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                modality: e.target.value as OfferDraft["modality"],
                              })
                            }
                            className="mt-1 w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                          >
                            <option value="hour">Por hora</option>
                            <option value="shift">Por turno</option>
                            <option value="month">Mensual</option>
                            <option value="package">Paquete</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                          Descripción
                        </label>
                        <Textarea
                          value={draft.description}
                          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                          rows={4}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                          Requisitos (separados por coma)
                        </label>
                        <Input
                          value={draft.requirements.join(", ")}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              requirements: e.target.value
                                .split(",")
                                .map((s) => s.trim())
                                .filter(Boolean),
                            })
                          }
                          className="mt-1"
                          placeholder="RETHUS, BLS, 2+ años de experiencia"
                        />
                        {draft.requirements.length > 0 && (
                          <ul className="mt-2 flex flex-wrap gap-1.5">
                            {draft.requirements.map((r, i) => (
                              <li
                                key={i}
                                className="text-[11px] px-2 py-0.5 rounded-full bg-background border border-border"
                              >
                                {r}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div>
                        <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                          Tarifa ({draft.modality}) — COP
                        </label>
                        <Input
                          type="number"
                          inputMode="numeric"
                          value={draft.suggested_amount_cop}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              suggested_amount_cop: Number(e.target.value) || 0,
                            })
                          }
                          className="mt-1"
                        />
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Sugerencia IA:{" "}
                          <span className="font-semibold">{COP(draft.suggested_amount_cop)}</span>
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 flex items-center justify-end gap-3 flex-wrap">
                      <Button onClick={publish} disabled={publishing} variant="copper">
                        {publishing && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                        <Pencil className="h-4 w-4 mr-1.5" /> Publicar oferta
                      </Button>
                    </div>
                  </Card>
                )}

                {candidates.length > 0 && (
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                      Top {candidates.length} candidatos sugeridos
                    </p>
                    <div className="space-y-3">
                      {candidates.map((c) => (
                        <Card key={c.user_id} className="p-4">
                          <div className="flex items-start gap-3">
                            <div className="h-12 w-12 rounded-full bg-muted overflow-hidden shrink-0">
                              {c.avatar_url && (
                                <img
                                  src={c.avatar_url}
                                  alt={c.full_name ?? "Profesional"}
                                  className="h-full w-full object-cover"
                                />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-semibold truncate">
                                  {c.full_name ?? "Profesional"}
                                </p>
                                <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-biosensor/10 text-biosensor border border-biosensor/30">
                                  <Sparkles className="h-3 w-3" /> Match {Math.round(c.score)}%
                                </span>
                                {c.rethus_verified && (
                                  <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-fuchsia-neural/10 text-fuchsia-neural border border-fuchsia-neural/30">
                                    <ShieldCheck className="h-3 w-3" /> RETHUS
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {c.specialty ?? "—"} · {c.years_experience ?? 0} años
                                {c.city && (
                                  <>
                                    {" · "}
                                    <MapPin className="inline h-3 w-3" /> {c.city}
                                  </>
                                )}
                                {c.avg_rating ? (
                                  <>
                                    {" · "}
                                    <Star className="inline h-3 w-3 fill-copper text-copper" />{" "}
                                    {Number(c.avg_rating).toFixed(1)}
                                  </>
                                ) : null}
                              </p>
                              <p className="mt-2 text-sm">{c.reason}</p>
                              {(c.hourly_rate || c.shift_rate || c.monthly_rate) && (
                                <p className="mt-1 text-[11px] text-muted-foreground">
                                  Tarifas: {c.hourly_rate ? `${COP(c.hourly_rate)}/h` : ""}{" "}
                                  {c.shift_rate ? `· ${COP(c.shift_rate)}/turno` : ""}{" "}
                                  {c.monthly_rate ? `· ${COP(c.monthly_rate)}/mes` : ""}
                                </p>
                              )}
                            </div>
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
