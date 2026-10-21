import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, Loader2, Lock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { pseDetailsSchema, type PseDetails } from "@/lib/pseDetails";

const fields = [
  { name: "firstName", label: "Nombres", autoComplete: "given-name", maxLength: 32, placeholder: "Tus nombres" },
  { name: "lastName", label: "Apellidos", autoComplete: "family-name", maxLength: 32, placeholder: "Tus apellidos" },
  { name: "phone", label: "Celular", autoComplete: "tel-national", maxLength: 10, placeholder: "3001234567" },
  { name: "streetName", label: "Calle o carrera", autoComplete: "address-line1", maxLength: 18, placeholder: "Carrera 15" },
  { name: "streetNumber", label: "Número", autoComplete: "address-line2", maxLength: 5, placeholder: "93-10" },
  { name: "neighborhood", label: "Barrio", autoComplete: "off", maxLength: 18, placeholder: "Tu barrio" },
  { name: "city", label: "Ciudad", autoComplete: "address-level2", maxLength: 18, placeholder: "Tu ciudad" },
  { name: "zipCode", label: "Código postal", autoComplete: "postal-code", maxLength: 6, placeholder: "6 dígitos" },
] as const;

export function PseDetailsDialog(props: {
  open: boolean;
  onCancel: () => void;
  onConfirm: (data: PseDetails) => Promise<void>;
}) {
  const form = useForm<PseDetails>({ resolver: zodResolver(pseDetailsSchema) });
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open && !form.formState.isSubmitting) props.onCancel();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
           <DialogTitle>Ya casi: confirma tus datos</DialogTitle>
          <DialogDescription>
             PSE necesita los datos del titular. Después autorizas el pago en tu banco.
          </DialogDescription>
        </DialogHeader>
         <form onSubmit={form.handleSubmit(props.onConfirm)} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {fields.map((field) => (
              <div key={field.name} className="space-y-1.5">
                <Label htmlFor={`pse-${field.name}`}>{field.label}</Label>
                <Input
                  id={`pse-${field.name}`}
                   placeholder={field.placeholder}
                   maxLength={field.maxLength}
                   disabled={form.formState.isSubmitting}
                   className="h-11"
                  autoComplete={field.autoComplete}
                  inputMode={
                    field.name === "phone" || field.name === "zipCode" ? "numeric" : "text"
                  }
                  aria-invalid={!!form.formState.errors[field.name]}
                  aria-describedby={
                    form.formState.errors[field.name] ? `pse-${field.name}-error` : undefined
                  }
                  {...form.register(field.name)}
                />
                {form.formState.errors[field.name] && (
                  <p id={`pse-${field.name}-error`} className="text-xs text-destructive">
                    {form.formState.errors[field.name]?.message}
                  </p>
                )}
              </div>
            ))}
          </div>
           <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
             <Lock className="h-3.5 w-3.5" aria-hidden="true" /> El pago se autoriza en tu banco.
           </p>
           <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
               className="h-11 sm:flex-1"
              disabled={form.formState.isSubmitting}
              onClick={props.onCancel}
            >
              Volver
            </Button>
             <Button type="submit" className="h-11 sm:flex-[2]" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
               {form.formState.isSubmitting ? "Preparando tu pago…" : "Continuar al banco"}
               {!form.formState.isSubmitting && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
