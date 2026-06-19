# Humanix AI SDK

Cliente tipado para llamar las edge functions IA de Humanix sin repetir lógica.

## Dentro de la app (React)

```ts
import { humanixAi } from "@/lib/humanixAi";

// Sugerir tarifas
const { suggestion } = await humanixAi.suggestRates({ profile });

// Match de ofertas
const { matches } = await humanixAi.matchOffers({ profile, offers });

// Chat con streaming
await humanixAi.assistant({
  messages: [{ role: "user", content: "Hola" }],
  persona: "professional",
  onToken: (delta) => console.log(delta),
});

// Embeddings
const { embedding } = await humanixAi.embedText({ text: "enfermera UCI Bogotá" });
```

El JWT del usuario se inyecta automáticamente desde la sesión Supabase.

## Desde repo externo / Node / GitHub Actions

```ts
import { createHumanixAi } from "./humanixAi";

const ai = createHumanixAi({
  supabaseUrl: process.env.SUPABASE_URL!,
  anonKey: process.env.SUPABASE_ANON_KEY!,
  // Opcional: JWT de un usuario logueado (necesario para functions con verify_jwt = true)
  accessToken: process.env.USER_JWT,
});

const { matches } = await ai.matchOffers({ profile, offers });
console.log(matches);
```

### Variables de entorno (.env.example)

```
SUPABASE_URL=https://rwllmouomrytejtbpxvn.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...
# Opcional, sólo si llamas funciones con verify_jwt = true
USER_JWT=
```

## Métodos disponibles

| Método              | Edge function          | verify_jwt |
| ------------------- | ---------------------- | ---------- |
| `assistant`         | humanix-assistant      | no         |
| `assistantStream`   | humanix-assistant      | no         |
| `suggestRates`      | rate-suggester         | no         |
| `matchOffers`       | match-offers           | no         |
| `semanticMatch`     | semantic-match         | no         |
| `embedText`         | embed-text             | no         |
| `classifyPqrs`      | pqrs-classifier        | sí         |
| `bioSummary`        | bio-summary            | no         |
| `extractCv`         | cv-extractor           | no         |
| `verifyDocument`    | document-verifier      | no         |
| `socialTrustScore`  | social-trust-score     | no         |
| `raw(fnName, body)` | cualquiera             | depende    |

## Manejo de errores

Todas las llamadas pueden lanzar `HumanixAiError` con `status` y `code`.

```ts
import { HumanixAiError } from "@/lib/humanixAi";

try {
  await humanixAi.suggestRates({ profile });
} catch (e) {
  if (e instanceof HumanixAiError && e.status === 429) {
    // demasiadas solicitudes
  }
}
```

## Seguridad

- **NUNCA** uses `LOVABLE_API_KEY` ni `SERVICE_ROLE_KEY` en el cliente o en el repo externo.
- El SDK siempre llama edge functions, que son las que manejan claves sensibles.
- Para acciones por usuario (PQRS, ratings, etc.), pásale un `accessToken` válido.
