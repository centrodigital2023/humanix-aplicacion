// Se muestra UNA vez, justo después de crear a una persona o reiniciar su contraseña: la contraseña no se guarda en ningún lado
// (ni siquiera la institución puede volver a verla), así que aquí se copia y se entrega por un canal seguro.
import { useState } from "react";
import { Check, Copy, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface IssuedCredentials {
  displayName: string;
  username: string;
  password: string;
  /** «creada» o «reiniciada», para el título. */
  kind: "created" | "reset";
}

function CopyRow({ label, value, testId }: { label: string; value: string; testId: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* sin portapapeles: la persona puede seleccionarlo y copiarlo a mano */
    }
  };
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2">
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="select-all break-all font-mono text-sm" data-testid={testId}>
          {value}
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={copy}
        aria-label={`Copiar ${label.toLowerCase()}`}
      >
        {copied ? (
          <Check className="mr-1.5 h-3.5 w-3.5 text-ok" aria-hidden />
        ) : (
          <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden />
        )}
        {copied ? "Copiado" : "Copiar"}
      </Button>
    </div>
  );
}

export function CredentialsDialog({
  credentials,
  onClose,
}: {
  credentials: IssuedCredentials | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!credentials} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="credentials-dialog">
        {credentials && (
          <>
            <DialogHeader>
              <DialogTitle>
                {credentials.kind === "created" ? "Acceso creado" : "Contraseña reiniciada"} para{" "}
                {credentials.displayName}
              </DialogTitle>
              <DialogDescription>
                Entra en <strong>humanix.lat/acceso-equipo</strong> con este usuario y esta
                contraseña.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <CopyRow label="Usuario" value={credentials.username} testId="credential-username" />
              <CopyRow
                label="Contraseña"
                value={credentials.password}
                testId="credential-password"
              />
            </div>
            <p className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />
              <span>
                Compártela por un canal seguro y <strong>no volverá a mostrarse</strong>: Humanix no
                la guarda. Si se pierde, la reinicias desde aquí. La persona puede cambiarla cuando
                entre.
              </span>
            </p>
            <DialogFooter>
              <Button type="button" variant="hero" onClick={onClose}>
                Listo, ya la guardé
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
