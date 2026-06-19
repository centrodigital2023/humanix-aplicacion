/**
 * Humanix AI SDK
 * ----------------------------------------------------------------------------
 * Cliente tipado para invocar las edge functions de IA de Humanix sin repetir
 * lógica de fetch / auth / errores en cada componente.
 *
 * Uso en la app (React):
 *   import { humanixAi } from "@/lib/humanixAi";
 *   const { suggestion } = await humanixAi.suggestRates({ profile });
 *
 * Uso desde script externo (Node, GitHub Actions, IDE local):
 *   import { createHumanixAi } from "./humanixAi";
 *   const ai = createHumanixAi({
 *     supabaseUrl: process.env.SUPABASE_URL!,
 *     anonKey: process.env.SUPABASE_ANON_KEY!,
 *     accessToken: process.env.USER_JWT, // requerido si la function tiene verify_jwt
 *   });
 *   const res = await ai.matchOffers({ profile, offers });
 *
 * NUNCA expongas LOVABLE_API_KEY ni SERVICE_ROLE_KEY en el cliente.
 * El SDK siempre llama a edge functions, que son las que usan esas claves.
 */

import { supabase as defaultSupabase } from "@/integrations/supabase/client";

// ---------- Tipos públicos ----------

export type ChatPersona = "professional" | "family" | "institution" | "default";

// ── Clinical types (Módulo 4-6) ──────────────────────────────────────────────

export type VitalType =
  | "heart_rate"
  | "spo2"
  | "temperature"
  | "blood_pressure_sys"
  | "blood_pressure_dia"
  | "respiration_rate"
  | "steps"
  | "fall_detected"
  | "glucose"
  | "weight";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface VitalDataPoint {
  value: number;
  recorded_at: string;
  type?: VitalType;
  unit?: string;
}

export interface ClinicalTrendResult {
  vital_type: VitalType;
  trend: "improving" | "stable" | "worsening" | "insufficient_data";
  direction: "up" | "down" | "flat";
  mean: number;
  std_dev: number;
  min: number;
  max: number;
  insight: string;
  alert_risk: boolean;
}

export interface ClinicalAnomaly {
  vital_type: VitalType;
  recorded_at: string;
  value: number;
  z_score: number;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
}

export interface RiskFactor {
  name: string;
  weight: number;
  value: string | number;
  description?: string;
  direction?: "increase" | "decrease" | "neutral";
}

export interface ClinicalRiskResult {
  patient_id: string;
  score: number;
  level: RiskLevel;
  factors: RiskFactor[];
  ai_summary: string;
  recommendations: Array<{
    priority: "urgent" | "high" | "medium" | "low";
    action: string;
    rationale?: string;
  }>;
  trend: "improving" | "stable" | "worsening";
}

export interface ClinicalReportResult {
  period: "daily" | "weekly" | "monthly";
  period_start: string;
  period_end: string;
  report_text: string;
  summary: string;
  vitals_summary: Record<VitalType, { mean: number; min: number; max: number; count: number }>;
  alerts_count: number;
  risk_score: number;
  pdf_url?: string;
}

export interface ClinicalSummaryResult {
  summary: string;
  key_findings: string[];
  recommendations: string[];
  risk_level: RiskLevel;
  follow_up_in_days: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface RateSuggestion {
  hourly_rate: number;
  shift_rate: number;
  monthly_rate: number;
  rate_rationale?: string;
  bio: string;
}

export interface OfferMatch {
  offer_id: string;
  score: number;
  reason: string;
}

export interface PqrsClassification {
  category: string;
  priority: "low" | "normal" | "high" | "urgent";
  sentiment: "positive" | "neutral" | "negative" | "very_negative";
  summary: string;
}

export interface SemanticMatchResult {
  offer_id?: string;
  user_id?: string;
  similarity: number;
}

export class HumanixAiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "HumanixAiError";
    this.status = status;
    this.code = code;
  }
}

// ---------- Configuración ----------

export interface HumanixAiConfig {
  supabaseUrl: string;
  anonKey: string;
  accessToken?: string | null;
  getAccessToken?: () => Promise<string | null | undefined>;
  fetchImpl?: typeof fetch;
}

const FUNCTIONS_PATH = "/functions/v1";

type FetchOpts<TBody> = {
  body?: TBody;
  signal?: AbortSignal;
  raw?: boolean;
};

function buildClient(config: HumanixAiConfig) {
  const fetchImpl = config.fetchImpl ?? fetch;
  const baseUrl = `${config.supabaseUrl.replace(/\/$/, "")}${FUNCTIONS_PATH}`;

  async function resolveToken(): Promise<string | null | undefined> {
    if (config.getAccessToken) return await config.getAccessToken();
    return config.accessToken;
  }

  async function call<TBody, TRes>(fnName: string, opts: FetchOpts<TBody> = {}): Promise<TRes> {
    const token = await resolveToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      apikey: config.anonKey,
      Authorization: `Bearer ${token ?? config.anonKey}`,
    };

    const res = await fetchImpl(`${baseUrl}/${fnName}`, {
      method: "POST",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });

    if (opts.raw) return res as unknown as TRes;

    if (!res.ok) {
      let message = `Error ${res.status} llamando a ${fnName}`;
      let code: string | undefined;
      try {
        const data = await res.json();
        if (data?.error) message = data.error;
        if (data?.code) code = data.code;
      } catch {
        /* ignore */
      }
      throw new HumanixAiError(message, res.status, code);
    }
    return (await res.json()) as TRes;
  }

  return { call };
}

// ---------- Cliente público ----------

export interface HumanixAiClient {
  assistantStream(input: {
    messages: ChatMessage[];
    persona?: ChatPersona;
    signal?: AbortSignal;
  }): Promise<Response>;

  assistant(input: {
    messages: ChatMessage[];
    persona?: ChatPersona;
    signal?: AbortSignal;
    onToken?: (delta: string) => void;
  }): Promise<string>;

  suggestRates(input: {
    profile: Record<string, unknown>;
  }): Promise<{ suggestion: RateSuggestion }>;

  matchOffers(input: {
    profile: Record<string, unknown>;
    offers: Array<Record<string, unknown>>;
  }): Promise<{ matches: OfferMatch[] }>;

  semanticMatch(input: {
    mode: "offers_for_professional" | "professionals_for_offer";
    id: string;
    limit?: number;
    minSimilarity?: number;
  }): Promise<{ results: SemanticMatchResult[] }>;

  embedText(input: { text: string }): Promise<{ embedding: number[] }>;

  classifyPqrs(input: { ticket_id: string }): Promise<PqrsClassification>;

  bioSummary(input: { text: string }): Promise<{ bio: string }>;

  extractCv(input: { text: string }): Promise<{ profile: Record<string, unknown> }>;

  verifyDocument(input: {
    document_url: string;
    document_type: string;
  }): Promise<Record<string, unknown>>;

  socialTrustScore(input: {
    user_id: string;
  }): Promise<{ score: number; signals: Record<string, unknown> }>;

  // ── Clinical AI (Módulo 4-6) ──────────────────────────────────────────────

  /** Analiza tendencias de signos vitales de un paciente en el período indicado */
  analyzeTrends(input: {
    patient_id: string;
    vital_types?: VitalType[];
    days?: number;
  }): Promise<{ trends: ClinicalTrendResult[]; overall_insight: string }>;

  /** Detecta anomalías estadísticas en una serie de signos vitales */
  detectAnomalies(input: {
    patient_id: string;
    vital_signs: VitalDataPoint[];
    sensitivity?: "low" | "medium" | "high";
  }): Promise<{ anomalies: ClinicalAnomaly[]; risk_score: number }>;

  /** Calcula el score de riesgo clínico del paciente con IA */
  patientRiskScore(input: {
    patient_id: string;
    include_history?: boolean;
  }): Promise<ClinicalRiskResult>;

  /** Genera un reporte clínico automático para el período indicado */
  generateClinicalReport(input: {
    patient_id: string;
    period: "daily" | "weekly" | "monthly";
    period_start?: string;
    period_end?: string;
  }): Promise<ClinicalReportResult>;

  /** Genera un resumen clínico narrativo para un profesional o familia */
  clinicalSummary(input: {
    patient_id: string;
    audience: "professional" | "family" | "eps";
    vital_signs?: VitalDataPoint[];
    include_recommendations?: boolean;
  }): Promise<ClinicalSummaryResult>;

  raw<TRes = unknown, TBody = unknown>(
    fnName: string,
    body?: TBody,
    signal?: AbortSignal,
  ): Promise<TRes>;
}

export function createHumanixAi(config: HumanixAiConfig): HumanixAiClient {
  const { call } = buildClient(config);

  return {
    async assistantStream({ messages, persona = "default", signal }) {
      return call<unknown, Response>("humanix-assistant", {
        body: { messages, persona },
        signal,
        raw: true,
      });
    },

    async assistant({ messages, persona = "default", signal, onToken }) {
      const res = await call<unknown, Response>("humanix-assistant", {
        body: { messages, persona },
        signal,
        raw: true,
      });
      if (!res.ok || !res.body) {
        throw new HumanixAiError(`humanix-assistant respondió ${res.status}`, res.status);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") return full;
          try {
            const json = JSON.parse(payload);
            const delta: string | undefined = json?.choices?.[0]?.delta?.content;
            if (delta) {
              full += delta;
              onToken?.(delta);
            }
          } catch {
            /* keep-alive */
          }
        }
      }
      return full;
    },

    suggestRates: ({ profile }) => call("rate-suggester", { body: { profile } }),

    matchOffers: ({ profile, offers }) => call("match-offers", { body: { profile, offers } }),

    semanticMatch: ({ mode, id, limit, minSimilarity }) =>
      call("semantic-match", {
        body: { mode, id, limit, min_similarity: minSimilarity },
      }),

    embedText: ({ text }) => call("embed-text", { body: { text } }),

    classifyPqrs: ({ ticket_id }) => call("pqrs-classifier", { body: { ticket_id } }),

    bioSummary: ({ text }) => call("bio-summary", { body: { text } }),

    extractCv: ({ text }) => call("cv-extractor", { body: { text } }),

    verifyDocument: ({ document_url, document_type }) =>
      call("document-verifier", { body: { document_url, document_type } }),

    socialTrustScore: ({ user_id }) => call("social-trust-score", { body: { user_id } }),

    // ── Clinical AI ─────────────────────────────────────────────────────────

    analyzeTrends: ({ patient_id, vital_types, days = 7 }) =>
      call("clinical-trends", { body: { patient_id, vital_types, days } }),

    detectAnomalies: ({ patient_id, vital_signs, sensitivity = "medium" }) =>
      call("clinical-anomalies", { body: { patient_id, vital_signs, sensitivity } }),

    patientRiskScore: ({ patient_id, include_history = true }) =>
      call("patient-risk-score", { body: { patient_id, include_history } }),

    generateClinicalReport: ({ patient_id, period, period_start, period_end }) =>
      call("clinical-report", { body: { patient_id, period, period_start, period_end } }),

    clinicalSummary: ({ patient_id, audience, vital_signs, include_recommendations = true }) =>
      call("clinical-summary", {
        body: { patient_id, audience, vital_signs, include_recommendations },
      }),

    raw: (fnName, body, signal) => call(fnName, { body, signal }),
  };
}

// ---------- Instancia por defecto (uso dentro de la app) ----------

const SUPABASE_URL =
  (typeof import.meta !== "undefined" && (import.meta as ImportMeta).env?.VITE_SUPABASE_URL) || "";
const SUPABASE_ANON =
  (typeof import.meta !== "undefined" &&
    (import.meta as ImportMeta).env?.VITE_SUPABASE_PUBLISHABLE_KEY) ||
  "";

export const humanixAi: HumanixAiClient = createHumanixAi({
  supabaseUrl: SUPABASE_URL,
  anonKey: SUPABASE_ANON,
  getAccessToken: async () => {
    try {
      const { data } = await defaultSupabase.auth.getSession();
      return data.session?.access_token ?? null;
    } catch {
      return null;
    }
  },
});
