// «Gracias»: el reconocimiento cálido que cierra un servicio. Lo da quien contrata (familia o institución) al
// profesional, y el profesional a quien contrata. No es una calificación: es lo que se recuerda.
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Heart, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { friendlyError, useBookingKudos, useSendKudos } from "@/hooks/use-care-loop";
import {
  KUDOS_MESSAGE_MAX,
  MAX_KUDOS_KINDS,
  kudosEmoji,
  kudosFormSchema,
  kudosKindsFor,
  kudosLabel,
  type KudosFormValues,
  type KudosRole,
} from "@/lib/kudos";
import { cn } from "@/lib/utils";
import { InviteFriendInline } from "./InviteFriendInline";

function KindChips({ kinds }: { kinds: string[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {kinds.map((k) => (
        <li
          key={k}
          className="inline-flex items-center gap-1 rounded-full bg-copper/10 px-2.5 py-1 text-xs font-medium text-copper"
        >
          <span aria-hidden="true">{kudosEmoji(k)}</span> {kudosLabel(k)}
        </li>
      ))}
    </ul>
  );
}

export function KudosCard({
  bookingId,
  userId,
  role,
  peerName,
}: {
  bookingId: string;
  userId: string;
  role: KudosRole;
  /** Nombre de la otra parte (corto). */
  peerName: string;
}) {
  const kudos = useBookingKudos(bookingId, userId);
  const send = useSendKudos(bookingId, userId);
  const {
    control,
    handleSubmit,
    register,
    watch,
    formState: { errors },
  } = useForm<KudosFormValues>({
    resolver: zodResolver(kudosFormSchema(role)),
    defaultValues: { kinds: [], message: "" },
  });
  const message = watch("message") ?? "";
  const first = peerName.split(" ")[0] || (role === "client" ? "tu profesional" : "la otra parte");

  if (kudos.isLoading) return <Skeleton className="mt-6 h-32 w-full" />;
  // Antes de aplicar la migración la tabla no existe: no se muestra un error al usuario.
  if (kudos.error) return null;

  const sent = kudos.data?.sent ?? null;
  const received = kudos.data?.received ?? null;

  const onSubmit = (values: KudosFormValues) => {
    send.mutate(values, {
      onSuccess: () => toast.success("¡Gracias enviadas! Se las hicimos llegar."),
      onError: (err) =>
        toast.error(friendlyError(err, "No se pudieron enviar las gracias. Inténtalo de nuevo.")),
    });
  };

  return (
    <Card className="mt-6 space-y-4 border-copper/30 bg-copper/5 p-5" aria-label="Dar las gracias">
      <h2 className="flex items-center gap-2 font-display text-lg font-bold">
        <Heart className="h-5 w-5 text-copper" aria-hidden="true" /> Gracias
      </h2>

      {received && (
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-sm font-semibold">💛 {first} te dio las gracias</p>
          <div className="mt-2">
            <KindChips kinds={received.kinds} />
          </div>
          {received.message && (
            <p className="mt-2 text-sm italic text-foreground/90">«{received.message}»</p>
          )}
        </div>
      )}

      {sent ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Ya le diste las gracias a {first}. Es lo que más se recuerda de un servicio.
          </p>
          <KindChips kinds={sent.kinds} />
          <InviteFriendInline
            userId={userId}
            role={role === "client" ? "family" : "professional"}
          />
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">
              {role === "client"
                ? `¿Qué quieres agradecerle a ${first}?`
                : `¿Qué quieres agradecer a ${first}?`}
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                (hasta {MAX_KUDOS_KINDS})
              </span>
            </legend>
            <Controller
              control={control}
              name="kinds"
              render={({ field }) => (
                <div className="grid gap-2 sm:grid-cols-2">
                  {kudosKindsFor(role).map((k) => {
                    const selected = field.value.includes(k.id);
                    const full = !selected && field.value.length >= MAX_KUDOS_KINDS;
                    return (
                      <button
                        key={k.id}
                        type="button"
                        aria-pressed={selected}
                        disabled={full}
                        onClick={() =>
                          field.onChange(
                            selected
                              ? field.value.filter((x) => x !== k.id)
                              : [...field.value, k.id],
                          )
                        }
                        className={cn(
                          "flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                          selected
                            ? "border-copper bg-copper/10"
                            : "border-border bg-card hover:bg-muted/40",
                        )}
                      >
                        <span className="text-xl leading-none" aria-hidden="true">
                          {k.emoji}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold">{k.label}</span>
                          <span className="block text-xs text-muted-foreground">{k.blurb}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            />
            {errors.kinds?.message && (
              <p className="mt-1 text-xs text-destructive" role="alert">
                {errors.kinds.message}
              </p>
            )}
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor={`kudos-msg-${bookingId}`} className="text-sm font-medium">
              Un mensaje (opcional)
            </Label>
            <Textarea
              id={`kudos-msg-${bookingId}`}
              rows={3}
              maxLength={KUDOS_MESSAGE_MAX + 50}
              placeholder="Ej.: Mi mamá estuvo feliz con tu compañía. Gracias por tanta paciencia."
              aria-invalid={!!errors.message}
              {...register("message")}
            />
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs text-destructive" role="alert">
                {errors.message?.message}
              </p>
              <p className="shrink-0 text-xs text-muted-foreground">
                {message.length}/{KUDOS_MESSAGE_MAX}
              </p>
            </div>
            <p className="text-[11px] text-muted-foreground">
              El mensaje lo lee solo {first}. No incluyas teléfonos, correos ni datos de pago.
            </p>
          </div>

          <Button
            type="submit"
            variant="hero"
            disabled={send.isPending}
            className="w-full gap-2 sm:w-auto"
          >
            {send.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
            Enviar gracias
          </Button>
        </form>
      )}
    </Card>
  );
}
