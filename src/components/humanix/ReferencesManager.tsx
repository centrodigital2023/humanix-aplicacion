import { useEffect, useState } from "react";
import { Plus, Trash2, Phone, User, Briefcase, Heart, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

type RefType = "work" | "family";
type Reference = {
  id: string;
  user_id: string;
  ref_type: RefType;
  full_name: string;
  phone: string;
  relation: string | null;
  notes: string | null;
  verified: boolean;
};

const MIN_PER_TYPE = 2;

export function ReferencesManager({ userId }: { userId: string }) {
  const [refs, setRefs] = useState<Reference[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<
    Record<RefType, { full_name: string; phone: string; relation: string }>
  >({
    work: { full_name: "", phone: "", relation: "" },
    family: { full_name: "", phone: "", relation: "" },
  });

  useEffect(() => {
    let active = true;
    (async () => {
      const client = supabase as unknown as {
        from: (t: string) => {
          select: (cols: string) => {
            eq: (
              c: string,
              v: string,
            ) => {
              order: (
                c: string,
                o: { ascending: boolean },
              ) => Promise<{ data: Reference[] | null }>;
            };
          };
        };
      };
      const { data } = await client
        .from("professional_references")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: true });
      if (active) {
        setRefs(data ?? []);
        setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [userId]);

  const byType = (t: RefType) => refs.filter((r) => r.ref_type === t);

  const validatePhone = (p: string) => /^[+\d][\d\s-]{6,}$/.test(p.trim());

  async function addRef(t: RefType) {
    const d = draft[t];
    if (!d.full_name.trim() || d.full_name.trim().length < 3) {
      toast.error("Nombre completo (mínimo 3 caracteres)");
      return;
    }
    if (!validatePhone(d.phone)) {
      toast.error("Celular inválido (incluye país, ej: +57 300 1234567)");
      return;
    }
    setSaving(true);
    const client = supabase as unknown as {
      from: (t: string) => {
        insert: (row: Record<string, unknown>) => {
          select: () => {
            single: () => Promise<{ data: Reference | null; error: { message: string } | null }>;
          };
        };
      };
    };
    const { data, error } = await client
      .from("professional_references")
      .insert({
        user_id: userId,
        ref_type: t,
        full_name: d.full_name.trim().slice(0, 120),
        phone: d.phone.trim().slice(0, 30),
        relation: d.relation.trim().slice(0, 60) || null,
      })
      .select()
      .single();
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRefs((prev) => [...prev, data as Reference]);
    setDraft((prev) => ({ ...prev, [t]: { full_name: "", phone: "", relation: "" } }));
    toast.success("Referencia agregada");
  }

  async function removeRef(id: string) {
    if (!confirm("¿Eliminar esta referencia?")) return;
    const client = supabase as unknown as {
      from: (t: string) => {
        delete: () => {
          eq: (c: string, v: string) => Promise<{ error: { message: string } | null }>;
        };
      };
    };
    const { error } = await client.from("professional_references").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRefs((prev) => prev.filter((r) => r.id !== id));
  }

  if (loading) {
    return (
      <div className="text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 inline animate-spin mr-1.5" /> Cargando referencias…
      </div>
    );
  }

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <RefSection
        type="work"
        title="Referencias laborales"
        icon={<Briefcase className="h-4 w-4 text-biosensor" />}
        hint={`Agrega al menos ${MIN_PER_TYPE} referencias laborales con celular.`}
        items={byType("work")}
        draft={draft.work}
        onDraftChange={(d) => setDraft((p) => ({ ...p, work: d }))}
        onAdd={() => addRef("work")}
        onRemove={removeRef}
        saving={saving}
        relationPlaceholder="Cargo / Empresa"
      />
      <RefSection
        type="family"
        title="Referencias familiares"
        icon={<Heart className="h-4 w-4 text-fuchsia-neural" />}
        hint={`Agrega al menos ${MIN_PER_TYPE} familiares con celular.`}
        items={byType("family")}
        draft={draft.family}
        onDraftChange={(d) => setDraft((p) => ({ ...p, family: d }))}
        onAdd={() => addRef("family")}
        onRemove={removeRef}
        saving={saving}
        relationPlaceholder="Parentesco (mamá, hermano…)"
      />
    </div>
  );
}

function RefSection({
  type,
  title,
  icon,
  hint,
  items,
  draft,
  onDraftChange,
  onAdd,
  onRemove,
  saving,
  relationPlaceholder,
}: {
  type: RefType;
  title: string;
  icon: React.ReactNode;
  hint: string;
  items: Reference[];
  draft: { full_name: string; phone: string; relation: string };
  onDraftChange: (d: { full_name: string; phone: string; relation: string }) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  saving: boolean;
  relationPlaceholder: string;
}) {
  const ok = items.length >= MIN_PER_TYPE;
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        <span
          className={`text-[11px] px-2 py-0.5 rounded-full ${
            ok ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600"
          }`}
        >
          {items.length}/{MIN_PER_TYPE} {ok ? "✓" : "requerido"}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>

      {items.length > 0 && (
        <ul className="mt-3 space-y-2">
          {items.map((r) => (
            <li
              key={r.id}
              className="flex items-start justify-between gap-2 text-sm bg-muted/30 rounded-lg px-3 py-2"
            >
              <div className="min-w-0">
                <p className="font-medium truncate flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                  {r.full_name}
                </p>
                <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1 mt-0.5">
                  <Phone className="h-3 w-3" /> {r.phone}
                  {r.relation && ` · ${r.relation}`}
                </p>
              </div>
              <button
                onClick={() => onRemove(r.id)}
                className="text-muted-foreground hover:text-destructive shrink-0"
                aria-label="Eliminar referencia"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 space-y-2">
        <div className="grid grid-cols-1 gap-2">
          <div>
            <Label className="text-[11px]">Nombre completo</Label>
            <Input
              value={draft.full_name}
              onChange={(e) => onDraftChange({ ...draft, full_name: e.target.value })}
              placeholder="María Pérez"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[11px]">Celular</Label>
              <Input
                value={draft.phone}
                onChange={(e) => onDraftChange({ ...draft, phone: e.target.value })}
                placeholder="+57 300 1234567"
                inputMode="tel"
              />
            </div>
            <div>
              <Label className="text-[11px]">
                {type === "work" ? "Cargo / Empresa" : "Parentesco"}
              </Label>
              <Input
                value={draft.relation}
                onChange={(e) => onDraftChange({ ...draft, relation: e.target.value })}
                placeholder={relationPlaceholder}
              />
            </div>
          </div>
        </div>
        <Button onClick={onAdd} disabled={saving} variant="glass" size="sm" className="w-full">
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          <span className="ml-1.5">Agregar referencia</span>
        </Button>
      </div>
    </div>
  );
}
