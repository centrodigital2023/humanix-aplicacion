/* eslint-disable react-refresh/only-export-components */
import { createRouter, useRouter } from "@tanstack/react-router";
import { HeartPulse } from "lucide-react";
import { CONTACT } from "@/lib/social";
import { routeTree } from "./routeTree.gen";

// Pantalla de error general: en español, cálida y con salida (reintentar, volver al inicio o escribirnos). El detalle técnico solo en
// desarrollo; a la persona nunca se le muestra.
function DefaultErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <HeartPulse className="h-8 w-8 text-primary" aria-hidden />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Algo se nos enredó por un momento
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          No es tu culpa y tus datos están a salvo. Inténtalo de nuevo; si sigue pasando, escríbenos y lo
          resolvemos contigo.
        </p>
        {import.meta.env.DEV && error.message && (
          <pre className="mt-4 max-h-40 overflow-auto rounded-md bg-muted p-3 text-left font-mono text-xs text-destructive">
            {error.message}
          </pre>
        )}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Intentar de nuevo
          </button>
          <a
            href="/"
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Ir al inicio
          </a>
          <a
            href={`${CONTACT.whatsappUrl}?text=${encodeURIComponent("Hola Humanix, una pantalla me mostró un error.")}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center justify-center rounded-md px-4 py-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Escribir a soporte
          </a>
        </div>
      </div>
    </div>
  );
}

export const getRouter = () => {
  const router = createRouter({
    routeTree,
    context: {},
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadDelay: 50,
    defaultPreloadStaleTime: 30_000,
    defaultPendingMinMs: 0,
    defaultErrorComponent: DefaultErrorComponent as never,
  });

  return router;
};
