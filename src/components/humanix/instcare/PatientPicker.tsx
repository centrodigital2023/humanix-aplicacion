// Elegir a un paciente de la lista: buscador y filas grandes y claras. Lo usan «Para un paciente existente» (iniciar un caso desde una
// postulación) y «Agregar al monitoreo».
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ageLabel, filterPatients, MODALITY_META } from "@/lib/instCare";
import type { InstPatient } from "@/lib/instCareTypes";
import { PersonAvatar } from "./PersonAvatar";

export function PatientPicker({
  patients,
  onPick,
  now,
  emptyText = "No hay pacientes para elegir.",
  disabled = false,
}: {
  patients: InstPatient[];
  onPick: (p: InstPatient) => void;
  now: number;
  emptyText?: string;
  disabled?: boolean;
}) {
  const [q, setQ] = useState("");
  const list = useMemo(
    () => filterPatients(patients, { q, status: "all" }).slice(0, 50),
    [patients, q],
  );
  return (
    <div className="space-y-2" data-testid="patient-picker">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar paciente…"
          aria-label="Buscar paciente"
          className="pl-9"
          autoComplete="off"
        />
      </div>
      {list.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          {patients.length === 0 ? emptyText : "Ningún paciente coincide con la búsqueda."}
        </p>
      ) : (
        <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
          {list.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPick(p)}
                className="focus-premium flex w-full items-center gap-3 rounded-xl border border-border p-2.5 text-left transition-colors hover:bg-muted/50 disabled:opacity-50"
              >
                <PersonAvatar name={p.full_name} id={p.id} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{p.full_name}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {[
                      ageLabel(p.birth_date, now),
                      MODALITY_META[p.modality].label,
                      p.room ? `hab. ${p.room}` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
