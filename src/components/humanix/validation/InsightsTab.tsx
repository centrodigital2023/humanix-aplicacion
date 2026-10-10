// Pestaña «Hallazgos» del panel de validación de mercado: lo que dicen los números, en lenguaje claro.
// Todo sale de funciones puras de `src/lib/marketInsights.ts` (misma lectura para las mismas respuestas).
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Lightbulb,
  Mail,
  MessageCircle,
  MinusCircle,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  LEAD_STAGE_LABEL,
  READINESS_LABEL,
  buildInsights,
  executiveSummary,
  funnel,
  leadGreeting,
  leadsToCsv,
  marketVerdict,
  priorityLeads,
  sampleReadiness,
  segmentRanking,
  themeStats,
  type Lead,
  type Severity,
  type Verdict,
} from "@/lib/marketInsights";
import {
  PROFILES,
  PROFILE_META,
  responsesFilename,
  type Profile,
  type ResponseRow,
} from "@/lib/marketValidation";
import { nf } from "./format";
import { Bar, Panel } from "./panels";

const SEVERITY_STYLE: Record<
  Severity,
  { Icon: typeof Lightbulb; box: string; text: string; label: string }
> = {
  risk: {
    Icon: XCircle,
    box: "border-destructive/40 bg-destructive/5",
    text: "text-destructive",
    label: "Riesgo",
  },
  warn: {
    Icon: AlertTriangle,
    box: "border-warn/40 bg-warn/5",
    text: "text-warn",
    label: "Atención",
  },
  good: { Icon: CheckCircle2, box: "border-ok/40 bg-ok/5", text: "text-ok", label: "Bien" },
  info: { Icon: Lightbulb, box: "border-border bg-card", text: "text-trust", label: "Dato" },
};

const VERDICT_STYLE: Record<Verdict, { box: string; text: string }> = {
  validated: { box: "border-ok/50 bg-ok/5", text: "text-ok" },
  promising: { box: "border-trust/40 bg-trust/5", text: "text-trust" },
  weak: { box: "border-warn/50 bg-warn/5", text: "text-warn" },
  insufficient: { box: "border-border bg-muted/40", text: "text-muted-foreground" },
};

const PROFILE_SHORT: Record<Profile, string> = {
  familia: "Familia",
  ips_eps: "IPS / EPS",
  profesional: "Profesional",
};

const STATUS_CLASS: Record<string, string> = {
  none: "bg-muted text-muted-foreground",
  few: "bg-destructive/15 text-destructive",
  growing: "bg-warn/15 text-warn",
  ready: "bg-ok/15 text-ok",
};

async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text).catch(() => undefined);
}

function CopyButton({
  text,
  label,
  children,
  variant = "outline",
}: {
  text: string;
  label: string;
  children?: string;
  variant?: "outline" | "ghost";
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant={variant}
      size={children ? "default" : "icon"}
      aria-label={label}
      className={children ? "min-h-10 rounded-xl" : "h-8 w-8 rounded-lg"}
      onClick={async () => {
        await copyText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? (
        <Check className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Copy className="h-4 w-4" aria-hidden="true" />
      )}
      {children && <span className="ml-2">{copied ? "Copiado" : children}</span>}
    </Button>
  );
}

function download(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function contactLink(l: Lead): string | null {
  if (l.contactKind === "whatsapp") {
    const digits = l.contact.replace(/\D/g, "");
    return `https://wa.me/${digits}?text=${encodeURIComponent(leadGreeting(l))}`;
  }
  if (l.contactKind === "email") {
    return `mailto:${l.contact}?subject=${encodeURIComponent("Humanix: gracias por contarnos qué necesitas")}&body=${encodeURIComponent(leadGreeting(l))}`;
  }
  return null;
}

export function InsightsTab({ rows }: { rows: ResponseRow[] }) {
  // «Ahora» se fija cuando llegan datos nuevos, no en cada render (las cifras no deben moverse solas).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => Date.now(), [rows]);
  const verdict = useMemo(() => marketVerdict(rows), [rows]);
  const insights = useMemo(() => buildInsights(rows, now), [rows, now]);
  const readiness = useMemo(() => sampleReadiness(rows), [rows]);
  const fun = useMemo(() => funnel(rows, now), [rows, now]);
  const themes = useMemo(() => themeStats(rows), [rows]);
  const leads = useMemo(() => priorityLeads(rows, now, 10), [rows, now]);
  const segments = useMemo(() => segmentRanking(rows), [rows]);
  const summary = useMemo(() => executiveSummary(rows, now), [rows, now]);
  const vs = VERDICT_STYLE[verdict.verdict];

  const steps = [
    { label: "Respuestas", n: fun.responses, rate: null as number | null },
    { label: "Contacto verificado", n: fun.verified, rate: fun.verifiedRate },
    { label: "Con código del beneficio", n: fun.withCode, rate: fun.codeRate },
    { label: "Mes Esencial canjeado", n: fun.redeemed, rate: fun.redeemRate },
  ];

  return (
    <div className="space-y-6">
      <section
        aria-labelledby="veredicto-titulo"
        className={`rounded-[1.5rem] border-2 p-6 ${vs.box}`}
      >
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Lectura automática (orientativa)
        </p>
        <h2 id="veredicto-titulo" className={`mt-1 font-display text-3xl font-bold ${vs.text}`}>
          {verdict.label}
        </h2>
        <p className="mt-2 max-w-3xl text-base">{verdict.summary}</p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Criterios">
          {verdict.criteria.map((c) => (
            <li key={c.key} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold">{c.label}</p>
                {c.ok === true ? (
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-ok" aria-hidden="true" />
                ) : c.ok === false ? (
                  <XCircle className="h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
                ) : (
                  <MinusCircle
                    className="h-5 w-5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                )}
              </div>
              <p className="mt-1 font-display text-2xl font-bold">{c.value}</p>
              <p className="text-xs text-muted-foreground">
                Meta {c.target} ·{" "}
                <span className="font-semibold">
                  {c.ok === true ? "cumple" : c.ok === false ? "no cumple" : "sin datos"}
                </span>
              </p>
            </li>
          ))}
        </ul>
      </section>

      <Panel
        title="Qué conviene hacer"
        caption="Hallazgos en lenguaje claro, de lo más urgente a lo informativo."
      >
        <ul className="space-y-3 p-5">
          {insights.map((i) => {
            const st = SEVERITY_STYLE[i.severity];
            return (
              <li key={i.id} className={`flex gap-3 rounded-2xl border p-4 ${st.box}`}>
                <st.Icon className={`mt-0.5 h-5 w-5 shrink-0 ${st.text}`} aria-hidden="true" />
                <div className="min-w-0">
                  <p className="font-bold">
                    <span className="sr-only">{st.label}: </span>
                    {i.title}
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{i.detail}</p>
                  {i.action && (
                    <p className="mt-1.5 text-sm">
                      <strong>Qué hacer:</strong> {i.action}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel
        title="¿Ya son suficientes para creerle a los números?"
        caption="Margen de error en el peor caso (95 % de confianza). Con menos de 30 respuestas por perfil, tómalo como orientación."
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Grupo</TableHead>
              <TableHead className="text-right">Respuestas</TableHead>
              <TableHead className="w-48">Avance hacia la meta</TableHead>
              <TableHead className="text-right">Meta</TableHead>
              <TableHead className="text-right">Margen de error</TableHead>
              <TableHead>Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[readiness.total, ...readiness.byProfile].map((r) => (
              <TableRow key={r.label} className={r.profile ? "" : "bg-muted/40 font-semibold"}>
                <TableCell className="font-semibold">{r.label}</TableCell>
                <TableCell className="text-right tabular-nums">{nf.format(r.n)}</TableCell>
                <TableCell>
                  <Bar
                    pct={Math.round((r.n / r.target) * 100)}
                    label={`${r.n} de ${r.target} respuestas`}
                  />
                </TableCell>
                <TableCell className="text-right tabular-nums">{nf.format(r.target)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.moePct === null ? "—" : `±${r.moePct} pts`}
                </TableCell>
                <TableCell>
                  <span
                    className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold ${STATUS_CLASS[r.status]}`}
                  >
                    {READINESS_LABEL[r.status]}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>

      <Panel
        title="Embudo del beneficio"
        caption="De quien llena el formulario a quien activa su mes del plan Esencial."
      >
        <ol className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4" aria-label="Etapas del embudo">
          {steps.map((s, i) => (
            <li key={s.label} className="rounded-2xl border border-border bg-background p-4">
              <p className="text-sm font-semibold text-muted-foreground">
                {i + 1}. {s.label}
              </p>
              <p className="mt-1 font-display text-3xl font-bold text-trust">{nf.format(s.n)}</p>
              <p className="text-xs text-muted-foreground">
                {s.rate === null ? "Punto de partida" : `${s.rate} % de la etapa anterior`}
              </p>
            </li>
          ))}
        </ol>
        <p className="border-t border-border px-5 py-3 text-sm text-muted-foreground">
          {fun.unredeemed === 0
            ? "No hay códigos vigentes sin canjear."
            : `${nf.format(fun.unredeemed)} ${fun.unredeemed === 1 ? "código vigente sin canjear" : "códigos vigentes sin canjear"}${fun.expiringSoon ? `, ${nf.format(fun.expiringSoon)} de ellos vencen en 7 días` : ""}.`}
        </p>
      </Panel>

      <Panel
        title="Temas que más se repiten"
        caption="Se detectan en el problema, el beneficio buscado y los requisitos que escribió la gente. Una respuesta puede tocar varios temas."
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tema</TableHead>
              <TableHead className="w-44">Respuestas</TableHead>
              {PROFILES.map((p) => (
                <TableHead key={p} className="text-right">
                  {PROFILE_SHORT[p]}
                </TableHead>
              ))}
              <TableHead>Lo que dijeron</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {themes.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="max-w-64 align-top">
                  <p className="font-semibold">{t.label}</p>
                  <p className="text-xs text-muted-foreground">{t.meaning}</p>
                </TableCell>
                <TableCell className="align-top">
                  <div className="flex items-center gap-2">
                    <Bar pct={t.pct} label={`${t.pct}%`} />
                    <span className="w-24 whitespace-nowrap text-right text-xs tabular-nums text-muted-foreground">
                      {t.count} · {t.pct}%
                    </span>
                  </div>
                </TableCell>
                {PROFILES.map((p) => (
                  <TableCell key={p} className="text-right align-top tabular-nums">
                    {t.byProfile[p]}
                  </TableCell>
                ))}
                <TableCell className="max-w-80 align-top text-sm">
                  {t.quote ? (
                    <>
                      <span className="italic">«{t.quote.text}»</span>
                      <span className="ml-1 text-xs text-muted-foreground">
                        — {PROFILE_META[t.quote.profile as Profile]?.label ?? t.quote.profile}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {themes.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={3 + PROFILES.length}
                  className="py-6 text-center text-muted-foreground"
                >
                  Aún no hay textos suficientes para detectar temas.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Panel>

      <Panel
        title="Contactar primero"
        caption="Contactos verificados, sin avisos graves de calidad, ordenados por puntaje (señal, disposición a pagar, presupuesto actual, tipo de cuenta y cercanía)."
      >
        <div className="flex justify-end px-5 pt-4">
          <Button
            type="button"
            variant="outline"
            disabled={leads.length === 0}
            className="min-h-10 rounded-xl"
            onClick={() =>
              download(
                responsesFilename(now).replace("validacion-de-mercado", "contactos-prioritarios"),
                leadsToCsv(leads),
              )
            }
          >
            <Download className="mr-2 h-4 w-4" aria-hidden="true" /> Exportar contactos (
            {leads.length})
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-right">Puntaje</TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead>Perfil</TableHead>
              <TableHead>Contacto</TableHead>
              <TableHead>Etapa</TableHead>
              <TableHead>Por qué</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.map((l) => {
              const link = contactLink(l);
              return (
                <TableRow key={l.id}>
                  <TableCell className="text-right align-top">
                    <span className="inline-block rounded-full bg-trust/10 px-2.5 py-0.5 text-sm font-bold tabular-nums text-trust">
                      {l.score}
                    </span>
                  </TableCell>
                  <TableCell className="align-top">
                    <p className="font-semibold">{l.name}</p>
                    {l.city && <p className="text-xs text-muted-foreground">{l.city}</p>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap align-top">
                    {PROFILE_SHORT[l.profile as Profile] ?? l.profile}
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="flex items-center gap-1.5">
                      {l.contactKind === "whatsapp" ? (
                        <MessageCircle className="h-4 w-4 text-ok" aria-label="WhatsApp" />
                      ) : (
                        <Mail className="h-4 w-4 text-trust" aria-label="Correo" />
                      )}
                      <span className="text-sm">{l.contact}</span>
                      <CopyButton
                        text={l.contact}
                        label={`Copiar contacto de ${l.name}`}
                        variant="ghost"
                      />
                    </div>
                    {link && (
                      <a
                        href={link}
                        target={l.contactKind === "whatsapp" ? "_blank" : undefined}
                        rel="noopener noreferrer"
                        className="mt-1 inline-block text-xs font-semibold text-trust underline underline-offset-4"
                      >
                        {l.contactKind === "whatsapp"
                          ? "Escribir por WhatsApp (mensaje sugerido)"
                          : "Escribir un correo (mensaje sugerido)"}
                      </a>
                    )}
                  </TableCell>
                  <TableCell className="align-top text-sm">{LEAD_STAGE_LABEL[l.stage]}</TableCell>
                  <TableCell className="max-w-72 align-top">
                    <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                      {l.reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </TableCell>
                </TableRow>
              );
            })}
            {leads.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                  Todavía no hay contactos verificados para priorizar.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
          Los mensajes sugeridos nunca hablan de pagos: el cobro ocurre solo en el checkout de la
          web.
        </p>
      </Panel>

      <Panel
        title="Dónde está la oportunidad"
        caption="Perfil y ciudad con al menos 2 respuestas, ordenados por señal (60 %), disposición a pagar (25 %) y presupuesto actual (15 %)."
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Segmento</TableHead>
              <TableHead className="text-right">Respuestas</TableHead>
              <TableHead className="text-right">Señal media</TableHead>
              <TableHead className="text-right">Disposición a pagar</TableHead>
              <TableHead className="text-right">Ya pagan</TableHead>
              <TableHead className="text-right">Verificados</TableHead>
              <TableHead className="text-right">Puntaje</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {segments.map((s) => (
              <TableRow key={s.key}>
                <TableCell className="font-semibold">
                  {PROFILE_META[s.profile].emoji} {s.profileLabel} · {s.city}
                  {s.n < 5 && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      (pocas respuestas)
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{s.n}</TableCell>
                <TableCell className="text-right tabular-nums">{s.avgSignal}</TableCell>
                <TableCell className="text-right tabular-nums">{s.avgWtp} %</TableCell>
                <TableCell className="text-right tabular-nums">{s.payingPct} %</TableCell>
                <TableCell className="text-right tabular-nums">{s.verifiedPct} %</TableCell>
                <TableCell className="text-right font-bold tabular-nums text-trust">
                  {s.score}
                </TableCell>
              </TableRow>
            ))}
            {segments.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                  Hace falta que un mismo perfil y ciudad tengan al menos 2 respuestas.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Panel>

      <Panel
        title="Resumen para compartir"
        caption="Texto listo para pegar en un correo o en el chat con el equipo o con inversionistas."
      >
        <div className="space-y-3 p-5">
          <pre
            aria-label="Resumen"
            className="whitespace-pre-wrap rounded-2xl bg-muted/50 p-4 font-sans text-sm leading-relaxed"
          >
            {summary}
          </pre>
          <CopyButton text={summary} label="Copiar resumen">
            Copiar resumen
          </CopyButton>
        </div>
      </Panel>
    </div>
  );
}
