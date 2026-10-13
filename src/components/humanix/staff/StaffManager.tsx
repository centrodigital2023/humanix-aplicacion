// «Personal» de la institución: agrega personas con usuario y contraseña, decide a qué módulos entra cada una, suspéndelas, reinicia su
// contraseña, quítalas y mira qué hizo cada quien. Solo la cuenta de la institución ve esto (el servidor y la base de datos lo exigen).
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  KeyRound,
  Loader2,
  Lock,
  Pencil,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserCheck,
  UserPlus,
  UserX,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { staffKeys, useTeamActivity, useTeamMembers } from "@/hooks/use-staff";
import { usePlan } from "@/hooks/use-plan";
import {
  MAX_STAFF_PER_INSTITUTION,
  MEMBER_STATUS_LABEL,
  RESERVED_FOR_OWNER,
  STAFF_MODULES,
  memberInitials,
  moduleLabel,
  remainingStaffSlots,
} from "@/lib/institutionMembers";
import {
  removeInstitutionMember,
  updateInstitutionMember,
} from "@/lib/institutionMembers.functions";
import { isRecentlyActive, lastSeenLabel, type TeamMember } from "@/lib/staffPanel";
import { cn } from "@/lib/utils";
import { CredentialsDialog, type IssuedCredentials } from "./CredentialsDialog";
import { StaffMemberDialog } from "./StaffMemberDialog";
import { StaffResetPasswordDialog } from "./StaffResetPasswordDialog";

function MemberCard({
  member,
  busy,
  onEdit,
  onReset,
  onToggle,
  onRemove,
}: {
  member: TeamMember;
  busy: boolean;
  onEdit: () => void;
  onReset: () => void;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const suspended = member.status === "suspended";
  const live = !suspended && isRecentlyActive(member.lastSeenAt);
  return (
    <Card
      className={cn("space-y-3 p-4", suspended && "opacity-80")}
      data-testid="staff-member"
      aria-label={`Persona del equipo: ${member.displayName}`}
    >
      <div className="flex items-start gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-fuchsia-neural/10 text-sm font-semibold text-fuchsia-neural"
          aria-hidden
        >
          {memberInitials(member.displayName)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            {member.displayName}
            <Badge variant="outline" className={suspended ? "text-warn" : "text-ok"}>
              {MEMBER_STATUS_LABEL[member.status]}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {member.jobTitle ? `${member.jobTitle} · ` : ""}
            <span className="font-mono">@{member.username}</span>
          </p>
          <p
            className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"
            data-testid="staff-last-seen"
          >
            <span
              className={cn("h-1.5 w-1.5 rounded-full", live ? "bg-ok" : "bg-muted-foreground/40")}
              aria-hidden
            />
            {live ? "Activa ahora" : lastSeenLabel(member.lastSeenAt)}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5" aria-label="Módulos">
        {member.modules.length ? (
          member.modules.map((m) => (
            <Badge key={m} variant="secondary" className="text-biosensor">
              {moduleLabel(m)}
            </Badge>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">Sin módulos</span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onEdit} disabled={busy}>
          <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Editar
        </Button>
        <Button size="sm" variant="outline" onClick={onReset} disabled={busy}>
          <KeyRound className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Contraseña
        </Button>
        <Button size="sm" variant="outline" onClick={onToggle} disabled={busy}>
          {busy ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : suspended ? (
            <UserCheck className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          ) : (
            <UserX className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          )}
          {suspended ? "Reactivar" : "Suspender"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-sos hover:text-sos"
          onClick={onRemove}
          disabled={busy}
        >
          <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Quitar
        </Button>
      </div>
    </Card>
  );
}

export function StaffManager({ institutionId }: { institutionId: string }) {
  const qc = useQueryClient();
  const plan = usePlan(institutionId);
  const team = useTeamMembers(institutionId);
  const activity = useTeamActivity(institutionId, 20);

  const [dialog, setDialog] = useState<{ member: TeamMember | null } | null>(null);
  const [resetting, setResetting] = useState<TeamMember | null>(null);
  const [removing, setRemoving] = useState<TeamMember | null>(null);
  const [credentials, setCredentials] = useState<IssuedCredentials | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const members = team.data ?? [];
  const entitled = plan.loading ? true : plan.can("multi_user_roles");
  const slots = remainingStaffSlots(members.length);
  const canAdd = entitled && slots > 0;
  const refresh = () => void qc.invalidateQueries({ queryKey: staffKeys.members(institutionId) });

  const toggle = async (m: TeamMember) => {
    setBusyId(m.id);
    try {
      const next = m.status === "suspended" ? "active" : "suspended";
      const result = await updateInstitutionMember({ data: { memberId: m.id, status: next } });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(
        next === "suspended"
          ? `Suspendiste a ${m.displayName}: ya no puede entrar`
          : `Reactivaste a ${m.displayName}`,
      );
      refresh();
    } catch {
      toast.error("No se pudo completar la acción. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setBusyId(null);
    }
  };

  const confirmRemove = async () => {
    if (!removing) return;
    setRemoveBusy(true);
    try {
      const result = await removeInstitutionMember({ data: { memberId: removing.id } });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(`Quitaste a ${removing.displayName} del equipo`);
      setRemoving(null);
      refresh();
    } catch {
      toast.error("No se pudo quitar. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setRemoveBusy(false);
    }
  };

  return (
    <div className="space-y-5" data-testid="staff-manager">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
            <UsersRound className="h-5 w-5 text-fuchsia-neural" aria-hidden /> Personal con acceso
            propio
          </h2>
          <p className="text-sm text-muted-foreground">
            Agrega a tu equipo con usuario y contraseña y decide a qué módulos entra cada persona.
            Todo lo que hagan queda registrado.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground" data-testid="staff-count">
            {members.length} de {MAX_STAFF_PER_INSTITUTION} personas
          </span>
          <Button variant="hero" onClick={() => setDialog({ member: null })} disabled={!canAdd}>
            <UserPlus className="mr-1.5 h-4 w-4" aria-hidden /> Agregar persona
          </Button>
        </div>
      </div>

      {!entitled && (
        <Alert data-testid="staff-plan-required">
          <Sparkles className="h-4 w-4" aria-hidden />
          <AlertTitle>Esto es parte del plan IPS Mejorado</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              Con IPS Mejorado tu equipo entra con su propio usuario y contraseña. Mientras tanto
              puedes suspender o quitar a quien ya tengas agregado, y su acceso a los datos de la
              institución se pausa si el plan no está vigente.
            </p>
            <Button asChild size="sm" variant="hero">
              <Link to="/planes">Ver planes</Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {entitled && slots === 0 && (
        <p
          className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
          data-testid="staff-full"
        >
          Llegaste al máximo de {MAX_STAFF_PER_INSTITUTION} personas. Quita a alguien para agregar a
          otra.
        </p>
      )}

      {team.isLoading ? (
        <Skeleton className="h-40 w-full rounded-2xl" />
      ) : team.error ? (
        <p role="alert" className="text-sm text-sos">
          No pudimos cargar a tu equipo. Revisa tu conexión e inténtalo de nuevo.
        </p>
      ) : members.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground" data-testid="staff-empty">
          <UsersRound className="mx-auto mb-2 h-6 w-6" aria-hidden />
          Todavía no has agregado a nadie. Crea el primer acceso con «Agregar persona».
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {members.map((m) => (
            <MemberCard
              key={m.id}
              member={m}
              busy={busyId === m.id}
              onEdit={() => setDialog({ member: m })}
              onReset={() => setResetting(m)}
              onToggle={() => void toggle(m)}
              onRemove={() => setRemoving(m)}
            />
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3 p-4" aria-label="Qué puede hacer cada módulo">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 text-trust" aria-hidden /> Qué puede hacer el personal
          </h3>
          <ul className="space-y-2 text-xs text-muted-foreground">
            {STAFF_MODULES.map((m) => (
              <li key={m.key}>
                <span className="font-medium text-foreground">{m.label}:</span> {m.description}
              </li>
            ))}
          </ul>
          <p className="flex items-center gap-1.5 pt-1 text-xs font-medium">
            <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden /> Solo la cuenta de la
            institución puede:
          </p>
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
            {RESERVED_FOR_OWNER.map((r) => (
              <li key={r.label}>
                <span className="font-medium text-foreground">{r.label}</span> — {r.reason}
              </li>
            ))}
          </ul>
        </Card>

        <Card className="space-y-3 p-4" aria-label="Actividad del personal">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Activity className="h-4 w-4 text-biosensor" aria-hidden /> Lo último que hizo tu equipo
          </h3>
          {activity.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : activity.error ? (
            <p role="alert" className="text-xs text-sos">
              No pudimos cargar la actividad.
            </p>
          ) : (activity.data ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground" data-testid="staff-activity-empty">
              Aún no hay actividad. Aquí verás quién publicó, aceptó, rechazó o contraofertó.
            </p>
          ) : (
            <ul className="divide-y divide-border" data-testid="staff-activity">
              {(activity.data ?? []).map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3 py-2 text-xs">
                  <span>
                    <span className="font-medium">{a.who}</span> · {a.action}
                  </span>
                  <span className="shrink-0 text-muted-foreground">{lastSeenLabel(a.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <StaffMemberDialog
        member={dialog?.member ?? null}
        open={dialog !== null}
        onOpenChange={(open) => !open && setDialog(null)}
        onSaved={refresh}
        onCreated={(c) => {
          refresh();
          setCredentials(c);
        }}
      />
      <StaffResetPasswordDialog
        member={resetting}
        onOpenChange={(open) => !open && setResetting(null)}
        onReset={setCredentials}
      />
      <CredentialsDialog credentials={credentials} onClose={() => setCredentials(null)} />

      <AlertDialog
        open={!!removing}
        onOpenChange={(open) => !open && !removeBusy && setRemoving(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Quitar a {removing?.displayName}?</AlertDialogTitle>
            <AlertDialogDescription>
              Se elimina su acceso: ya no podrá entrar. Lo que hizo hasta hoy queda en el registro
              de actividad. Si solo quieres pausarlo, usa «Suspender».
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeBusy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmRemove();
              }}
              disabled={removeBusy}
              className="bg-sos text-white hover:bg-sos/90"
            >
              {removeBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              Sí, quitar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
