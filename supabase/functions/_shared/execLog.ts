// Registro de ejecuciones de funciones críticas. Nunca guardar secretos ni datos clínicos.
export type ExecStatus = "success" | "error" | "rejected" | "duplicate" | "blocked";
export type TriggerType = "webhook" | "cron" | "db_trigger" | "frontend" | "internal";

export async function logExecution(entry: {
  functionName: string;
  triggerType: TriggerType;
  status: ExecStatus;
  startedAt: number;
  executionId?: string;
  errorCode?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const srk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !srk) return;
    await fetch(`${url}/rest/v1/function_execution_logs`, {
      method: "POST",
      headers: { apikey: srk, Authorization: `Bearer ${srk}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        function_name: entry.functionName,
        trigger_type: entry.triggerType,
        status: entry.status,
        execution_id: entry.executionId ?? null,
        duration_ms: Date.now() - entry.startedAt,
        error_code: entry.errorCode ?? null,
        metadata: entry.metadata ?? {},
      }),
    });
  } catch (_) {
    // El log nunca debe romper la función.
  }
}
