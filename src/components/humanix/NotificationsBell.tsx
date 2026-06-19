import { useEffect, useState } from "react";
import { Bell, CheckCheck, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Link } from "@tanstack/react-router";

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

export function NotificationsBell({ userId }: { userId: string }) {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const client = supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (
            k: string,
            v: string,
          ) => {
            order: (
              c: string,
              o: { ascending: boolean },
            ) => {
              limit: (n: number) => Promise<{ data: Notification[] | null }>;
            };
          };
        };
      };
    };
    const load = async () => {
      const { data } = await client
        .from("notifications")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (active) {
        setItems(data ?? []);
        setLoading(false);
      }
    };
    load();

    // Realtime
    const channel = supabase
      .channel(`notif-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          setItems((prev) => [payload.new as Notification, ...prev].slice(0, 20));
        },
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const unread = items.filter((n) => !n.read_at).length;

  const markAllRead = async () => {
    const ids = items.filter((n) => !n.read_at).map((n) => n.id);
    if (ids.length === 0) return;
    const client = supabase as unknown as {
      from: (t: string) => {
        update: (v: Record<string, unknown>) => {
          in: (k: string, v: string[]) => Promise<{ error: { message: string } | null }>;
        };
      };
    };
    await client.from("notifications").update({ read_at: new Date().toISOString() }).in("id", ids);
    setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
  };

  return (
    <Popover>
      <PopoverTrigger
        className="relative p-2 rounded-lg hover:bg-muted/50 transition-colors"
        aria-label="Notificaciones"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-fuchsia-neural text-white text-[10px] font-semibold flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <p className="text-sm font-semibold">Notificaciones</p>
          {unread > 0 && (
            <button
              onClick={markAllRead}
              className="text-xs text-biosensor hover:underline inline-flex items-center gap-1"
            >
              <CheckCheck className="h-3 w-3" /> Marcar todas
            </button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 inline animate-spin mr-1" /> Cargando…
            </div>
          ) : items.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">Sin notificaciones</p>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((n) => {
                const inner = (
                  <>
                    <p
                      className={`text-sm font-medium ${!n.read_at ? "text-foreground" : "text-muted-foreground"}`}
                    >
                      {n.title}
                    </p>
                    {n.body && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {new Date(n.created_at).toLocaleString("es-CO", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </p>
                  </>
                );
                return (
                  <li key={n.id} className={`px-3 py-2 ${!n.read_at ? "bg-biosensor/5" : ""}`}>
                    {n.link ? (
                      <Link to={n.link} className="block hover:bg-muted/30 -mx-3 -my-2 px-3 py-2">
                        {inner}
                      </Link>
                    ) : (
                      inner
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
