import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { pseDetailsSchema, type PseDetails } from "@/lib/pseDetails";

const fields = [
  { name: "firstName", label: "Nombres", autoComplete: "given-name" },
  { name: "lastName", label: "Apellidos", autoComplete: "family-name" },
  { name: "streetName", label: "Calle o carrera", autoComplete: "address-line1" },
  { name: "streetNumber", label: "Número", autoComplete: "address-line2" },
  { name: "neighborhood", label: "Barrio", autoComplete: "off" },
  { name: "city", label: "Ciudad", autoComplete: "address-level2" },
  { name: "zipCode", label: "Código postal", autoComplete: "postal-code" },
  { name: "phone", label: "Celular", autoComplete: "tel-national" },
] as const;

export function PseDetailsDialog(props: {
  open: boolean;
  onCancel: () => void;
  onConfirm: (data: PseDetails) => Promise<void>;
}) {
  const form = useForm<PseDetails>({ resolver: zodResolver(pseDetailsSchema) });
  return (
    <Dialog open={props.open} onOpenChange={(open) => { if (!open && !form.formState.isSubmitting) props.onCancel(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Datos del titular para PSE</DialogTitle>
          <DialogDescription>Completa los datos de quien paga. El banco te pedirá autorizar el pago.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(props.onConfirm)} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {fields.map((field) => (
              <div key={field.name} className="space-y-1.5">
                <Label htmlFor={`pse-${field.name}`}>{field.label}</Label>
                <Input id={`pse-${field.name}`} autoComplete={field.autoComplete}
                  inputMode={field.name === "phone" || field.name === "zipCode" ? "numeric" : "text"}
                  aria-invalid={!!form.formState.errors[field.name]}
                  aria-describedby={form.formState.errors[field.name] ? `pse-${field.name}-error` : undefined}
                  {...form.register(field.name)} />
                {form.formState.errors[field.name] && <p id={`pse-${field.name}-error`} className="text-xs text-destructive">{form.formState.errors[field.name]?.message}</p>}
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={form.formState.isSubmitting} onClick={props.onCancel}>Volver</Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Continuar al banco
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}