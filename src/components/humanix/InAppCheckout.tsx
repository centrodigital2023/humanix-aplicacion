// Formularios de Mercado Pago dentro de Humanix (/pagar). Solo en el navegador: el SDK de Mercado Pago necesita
// `window` y carga su script desde sdk.mercadopago.com.
//
//  - «once»: Payment Brick. Tarjeta (se aprueba al instante), PSE (Bancolombia, Nequi y demás bancos: el banco abre su
//    página y luego vuelve a /pago/exito) o Efecty (muestra el código para pagar).
//  - «recurring»: Card Payment Brick. El token de la tarjeta crea la suscripción mensual ya autorizada.
//
// Los datos de la tarjeta los recoge Mercado Pago en su formulario y nunca pasan por Humanix: el servidor solo recibe
// el token (ver `payPlanInApp` y `subscribePlanInApp` en `src/lib/payments.functions.ts`).
import { useEffect, useMemo, useState } from "react";
import { CardPayment, Payment, initMercadoPago } from "@mercadopago/sdk-react";

export type BrickSubmit = (form: Record<string, unknown>) => Promise<void>;

let initializedKey: string | null = null;

function useMercadoPago(publicKey: string): boolean {
  const [ready, setReady] = useState(initializedKey === publicKey);
  useEffect(() => {
    if (initializedKey !== publicKey) {
      initMercadoPago(publicKey, { locale: "es-CO" });
      initializedKey = publicKey;
    }
    setReady(true);
  }, [publicKey]);
  return ready;
}

const customization = {
  visual: {
    style: { theme: "default" as const },
    hideFormTitle: true,
  },
};

export default function InAppCheckout(props: {
  publicKey: string;
  mode: "once" | "recurring";
  amount: number;
  email: string | null;
  onSubmit: BrickSubmit;
  onReady: () => void;
  onError: (message: string) => void;
}) {
  const ready = useMercadoPago(props.publicKey);
  // Las opciones se crean una vez: si cambian, el formulario se vuelve a dibujar y la persona pierde lo escrito.
  const initialization = useMemo(
    () => ({
      amount: props.amount,
      ...(props.email ? { payer: { email: props.email } } : {}),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.amount],
  );
  if (!ready) return null;

  const onError = (e: { message?: string; type?: string }) => {
    console.warn("mp brick:", e?.type, e?.message);
    // Los avisos no críticos (p. ej. un campo incompleto) no se muestran como error de la página.
    if (e?.type === "critical") props.onError("No pudimos cargar el formulario de pago.");
  };

  if (props.mode === "recurring") {
    return (
      <CardPayment
        key="recurring"
        initialization={initialization}
        customization={{
          ...customization,
          paymentMethods: { maxInstallments: 1, types: { excluded: ["debit_card"] } },
        }}
        onSubmit={(data) => props.onSubmit(data as unknown as Record<string, unknown>)}
        onReady={props.onReady}
        onError={onError}
      />
    );
  }

  return (
    <Payment
      key="once"
      initialization={initialization}
      customization={{
        ...customization,
        paymentMethods: {
          creditCard: "all",
          debitCard: "all",
          bankTransfer: "all",
          ticket: "all",
          maxInstallments: 12,
        },
      }}
      onSubmit={({ formData }) => props.onSubmit(formData as unknown as Record<string, unknown>)}
      onReady={props.onReady}
      onError={onError}
    />
  );
}
