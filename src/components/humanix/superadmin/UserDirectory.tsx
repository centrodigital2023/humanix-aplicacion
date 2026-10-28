// Lista de todas las cuentas para el panel superadmin: filtros por tipo, búsqueda y estado de cada cuenta.
import { useMemo, useState } from "react";
import { Loader2, Search, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  KIND_LABEL,
  ROLE_LABEL,
  countByKind,
  filterUsers,
  type AdminUser,
  type AdminUserKind,
  type KindFilter,
} from "@/lib/adminUsers";

const FILTERS: { key: KindFilter; label: string }[] = [
  { key: "all", label: "Todos" },
  { key: "professional", label: "Profesionales" },
  { key: "family", label: "Familias" },
  { key: "institution", label: "EPS / IPS" },
  { key: "institution_staff", label: "Equipo EPS/IPS" },
  { key: "team", label: "Equipo Humanix" },
  { key: "incomplete", label: "Incompletos" },
];

const KIND_STYLE: Record<AdminUserKind, string> = {
  professional: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  family: "bg-rose-500/20 text-rose-300 border-rose-500/30",
  institution: "bg-violet-500/20 text-violet-300 border-violet-500/30",
  institution_staff: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
  team: "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/30",
};

const TONE_STYLE = {
  ok: "text-emerald-300",
  warn: "text-amber-300",
  bad: "text-red-300",
  muted: "text-white/40",
} as const;

const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "2-digit" })
    : null;

export function UserDirectory({
  users,
  loaded,
  deleting,
  onDelete,
}: {
  users: AdminUser[];
  loaded: boolean;
  deleting: string | null;
  onDelete: (uid: string, name: string) => void;
}) {
  const [kind, setKind] = useState<KindFilter>("all");
  const [query, setQuery] = useState("");
  const counts = useMemo(() => countByKind(users), [users]);
  const visible = useMemo(() => filterUsers(users, kind, query), [users, kind, query]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre, correo, ciudad o institución"
            className="pl-9 bg-white/[0.04] border-white/10 text-white placeholder:text-white/30"
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.filter((f) => f.key === "all" || counts[f.key] > 0 || f.key === kind).map((f) => (
          <button
            key={f.key}
            onClick={() => setKind(f.key)}
            className={`px-3 py-1 rounded-full text-[11px] font-semibold border transition ${
              kind === f.key
                ? "bg-violet-600 border-violet-500 text-white"
                : f.key === "incomplete"
                  ? "border-red-500/30 text-red-300/80 hover:text-red-200"
                  : "border-white/10 text-white/50 hover:text-white/80"
            }`}
          >
            {f.label} · {counts[f.key]}
          </button>
        ))}
      </div>

      {!loaded ? (
        <div className="flex items-center gap-2 text-white/30 text-sm py-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      ) : visible.length === 0 ? (
        <p className="text-white/40 text-sm py-4">
          {users.length === 0
            ? "Aún no hay cuentas registradas."
            : "Ninguna cuenta coincide con el filtro."}
        </p>
      ) : (
        <div className="divide-y divide-white/[0.05] max-h-[640px] overflow-y-auto pr-1">
          {visible.map((u) => {
            const name = u.institution_name ?? u.full_name ?? u.email ?? "Sin nombre";
            const extra =
              u.kind === "professional"
                ? u.pro_specialty
                : u.kind === "institution" && u.institution_name && u.full_name
                  ? `${(u.institution_type ?? "").toUpperCase()} · ${u.full_name}`.replace(
                      /^ · /,
                      "",
                    )
                  : u.kind === "team" && u.role
                    ? (ROLE_LABEL[u.role] ?? u.role)
                    : null;
            const lastSeen = fmtDate(u.last_sign_in_at);
            return (
              <div key={u.user_id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                {u.avatar_url ? (
                  <img
                    src={u.avatar_url}
                    alt={name}
                    className="h-9 w-9 rounded-full object-cover border border-white/10 shrink-0"
                  />
                ) : (
                  <div className="h-9 w-9 rounded-full bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-xs font-semibold text-white/50 shrink-0">
                    {name.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white/90 truncate">{name}</p>
                  <p className="text-[11px] text-white/40 truncate">
                    {u.email ?? "—"}
                    {u.city ? ` · ${u.city}` : ""}
                    {extra ? ` · ${extra}` : ""}
                  </p>
                  <p className={`text-[11px] truncate ${TONE_STYLE[u.status.tone]}`}>
                    {u.status.label}
                    {u.email_confirmed === false ? " · correo sin confirmar" : ""}
                    {lastSeen ? (
                      <span className="text-white/30"> · último ingreso {lastSeen}</span>
                    ) : null}
                  </p>
                </div>
                <Badge variant="outline" className={`text-[10px] shrink-0 ${KIND_STYLE[u.kind]}`}>
                  {KIND_LABEL[u.kind]}
                </Badge>
                <span className="text-[10px] text-white/30 whitespace-nowrap hidden sm:inline">
                  {fmtDate(u.created_at)}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:border-red-500/50 shrink-0"
                  disabled={deleting === u.user_id || u.kind === "team"}
                  title={
                    u.kind === "team"
                      ? "Las cuentas del equipo no se eliminan desde aquí"
                      : "Eliminar cuenta"
                  }
                  onClick={() => onDelete(u.user_id, name)}
                >
                  {deleting === u.user_id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
