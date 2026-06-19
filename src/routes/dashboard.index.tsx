import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { pathForRole, type AppRole } from "@/hooks/use-app-user";

export const Route = createFileRoute("/dashboard/")({
  head: () => ({
    meta: [{ title: "Mi panel · Humanix" }],
  }),
  component: DashboardRouter,
});

const PRIORITY: AppRole[] = [
  "superadmin",
  "hr_staff",
  "evaluator",
  "institution",
  "family",
  "professional",
];

function hardRedirect(to: string) {
  if (typeof window === "undefined") return;
  window.location.replace(to);
}

function DashboardRouter() {
  const [msg, setMsg] = useState("Verificando sesión...");

  useEffect(() => {
    let done = false;

    const go = (to: string) => {
      if (done) return;
      done = true;
      hardRedirect(to);
    };

    const safety = setTimeout(() => {
      if (!done) {
        console.warn("[dashboard] safety timeout fired → /auth");
        go("/auth");
      }
    }, 4000);

    (async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          console.warn("[dashboard] getSession error:", error.message);
        }
        if (!data?.session) {
          go("/auth");
          return;
        }
        setMsg("Redirigiendo a tu panel...");
        const uid = data.session.user.id;

        const rolesPromise = supabase.from("user_roles").select("role").eq("user_id", uid);
        const timeout = new Promise<{ data: null }>((resolve) =>
          setTimeout(() => resolve({ data: null }), 2500),
        );
        const result = (await Promise.race([rolesPromise, timeout])) as {
          data: { role: AppRole }[] | null;
        };

        const list = (result.data?.map((x) => x.role) ?? []) as AppRole[];
        const primary = PRIORITY.find((p) => list.includes(p)) ?? "family";
        go(pathForRole(primary));
      } catch (err) {
        console.error("[dashboard] router error:", err);
        go("/auth");
      }
    })();

    return () => {
      clearTimeout(safety);
    };
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin mr-2" />
      {msg}
    </div>
  );
}
