import { beforeEach, describe, expect, it } from "vitest";
import { HEARTBEAT_MS } from "./presence";
import { createPresenceManager, type PresenceDeps } from "./presenceManager";

/** Un mundo falso: reloj, temporizador, visibilidad, ubicación y las dos llamadas a la base. */
function world(opts: { geo?: boolean; error?: { code?: string } | null } = {}) {
  const w = {
    now: 1_000_000,
    visible: true,
    touches: [] as Array<[number | null, number | null]>,
    stops: 0,
    tick: null as null | (() => void),
    visibleCbs: new Set<() => void>(),
    pageHideCbs: new Set<() => void>(),
    watching: null as null | {
      ok: (p: { lat: number; lng: number }) => void;
      fail: (m: string) => void;
    },
    cleared: 0,
    error: opts.error ?? null,
  };
  const deps: PresenceDeps = {
    touch: async (lat, lng) => {
      w.touches.push([lat, lng]);
      return w.error;
    },
    stop: async () => {
      w.stops += 1;
    },
    now: () => w.now,
    setInterval: (fn) => {
      w.tick = fn;
      return 1;
    },
    clearInterval: () => {
      w.tick = null;
    },
    isVisible: () => w.visible,
    onVisible: (cb) => {
      w.visibleCbs.add(cb);
      return () => w.visibleCbs.delete(cb);
    },
    onPageHide: (cb) => {
      w.pageHideCbs.add(cb);
      return () => w.pageHideCbs.delete(cb);
    },
    geolocation:
      opts.geo === false
        ? null
        : {
            watch: (ok, fail) => {
              w.watching = { ok, fail };
              return 7;
            },
            clear: () => {
              w.cleared += 1;
              w.watching = null;
            },
          },
  };
  return { w, deps };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("latido", () => {
  let ctx: ReturnType<typeof world>;
  beforeEach(() => {
    ctx = world();
  });

  it("al empezar avisa «aquí estoy» sin posición y programa el latido cada minuto", async () => {
    const m = createPresenceManager(ctx.deps);
    m.attach();
    await flush();
    expect(ctx.w.touches).toEqual([[null, null]]);
    expect(ctx.w.tick).not.toBeNull();
  });

  it("cada latido manda otro aviso mientras la pestaña está visible", async () => {
    const m = createPresenceManager(ctx.deps);
    m.attach();
    ctx.w.tick!();
    ctx.w.tick!();
    await flush();
    expect(ctx.w.touches).toHaveLength(3);
  });

  it("con la pestaña oculta no late; al volver late de inmediato", async () => {
    const m = createPresenceManager(ctx.deps);
    m.attach();
    await flush();
    ctx.w.visible = false;
    ctx.w.tick!();
    await flush();
    expect(ctx.w.touches).toHaveLength(1);
    ctx.w.visible = true;
    ctx.w.visibleCbs.forEach((cb) => cb());
    await flush();
    expect(ctx.w.touches).toHaveLength(2);
  });

  it("varios componentes comparten un solo latido; solo el último en irse apaga la presencia", async () => {
    const m = createPresenceManager(ctx.deps);
    const a = m.attach();
    const b = m.attach();
    await flush();
    expect(ctx.w.touches).toHaveLength(1);
    a();
    expect(ctx.w.stops).toBe(0);
    expect(ctx.w.tick).not.toBeNull();
    b();
    expect(ctx.w.stops).toBe(1);
    expect(ctx.w.tick).toBeNull();
    expect(ctx.w.visibleCbs.size).toBe(0);
    expect(ctx.w.pageHideCbs.size).toBe(0);
  });

  it("soltar dos veces lo mismo no descuenta de más", async () => {
    const m = createPresenceManager(ctx.deps);
    const a = m.attach();
    m.attach();
    a();
    a();
    expect(ctx.w.tick).not.toBeNull();
  });

  it("al cerrar la pestaña avisa «me fui»", async () => {
    const m = createPresenceManager(ctx.deps);
    m.attach();
    ctx.w.pageHideCbs.forEach((cb) => cb());
    expect(ctx.w.stops).toBe(1);
  });

  it("si la base no tiene la función o no hay sesión, no insiste", async () => {
    for (const code of ["42883", "PGRST202", "42501", "28000"]) {
      const c = world({ error: { code } });
      const m = createPresenceManager(c.deps);
      m.attach();
      await flush();
      c.w.tick!();
      c.w.tick!();
      await flush();
      expect(c.w.touches).toHaveLength(1);
    }
  });

  it("un error de red no la apaga: reintenta en el siguiente latido", async () => {
    const c = world({ error: { code: "network" } });
    const m = createPresenceManager(c.deps);
    m.attach();
    await flush();
    c.w.tick!();
    await flush();
    expect(c.w.touches).toHaveLength(2);
  });
});

describe("compartir la posición", () => {
  it("sin ubicación en el aparato avisa y no comparte", async () => {
    const { w, deps } = world({ geo: false });
    const m = createPresenceManager(deps);
    m.attach();
    expect(m.startSharing()).toBe(false);
    expect(m.getState().error).toMatch(/no tiene ubicación/);
    expect(m.getState().sharing).toBe(false);
    expect(w.watching).toBeNull();
  });

  it("no se puede compartir sin haberse conectado", () => {
    const { deps } = world();
    expect(createPresenceManager(deps).startSharing()).toBe(false);
  });

  it("la primera posición se envía; moverse dentro de la cuadrícula no", async () => {
    const { w, deps } = world();
    const m = createPresenceManager(deps);
    m.attach();
    await flush();
    expect(m.startSharing()).toBe(true);
    expect(m.getState().sharing).toBe(true);
    w.watching!.ok({ lat: 4.60971, lng: -74.08175 });
    await flush();
    // El punto exacto no sale del aparato: se envía la cuadrícula de ~1 km.
    expect(w.touches.at(-1)).toEqual([4.61, -74.08]);
    const n = w.touches.length;
    w.now += 5_000;
    w.watching!.ok({ lat: 4.6149, lng: -74.0751 });
    await flush();
    expect(w.touches).toHaveLength(n);
  });

  it("cambiar de cuadrícula se envía enseguida", async () => {
    const { w, deps } = world();
    const m = createPresenceManager(deps);
    m.attach();
    m.startSharing();
    w.watching!.ok({ lat: 4.61, lng: -74.08 });
    await flush();
    const n = w.touches.length;
    w.now += 1_000;
    w.watching!.ok({ lat: 4.7, lng: -74.08 });
    await flush();
    expect(w.touches).toHaveLength(n + 1);
    expect(w.touches.at(-1)).toEqual([4.7, -74.08]);
  });

  it("los latidos mientras se comparte llevan la última posición", async () => {
    const { w, deps } = world();
    const m = createPresenceManager(deps);
    m.attach();
    m.startSharing();
    w.watching!.ok({ lat: 4.61, lng: -74.08 });
    await flush();
    w.now += HEARTBEAT_MS;
    w.tick!();
    await flush();
    expect(w.touches.at(-1)).toEqual([4.61, -74.08]);
  });

  it("una ubicación fuera de Colombia no se comparte y se explica", async () => {
    const { w, deps } = world();
    const m = createPresenceManager(deps);
    m.attach();
    m.startSharing();
    const n = w.touches.length;
    w.watching!.ok({ lat: 40.7, lng: -74.0 });
    await flush();
    expect(w.touches).toHaveLength(n);
    expect(m.getState().error).toMatch(/fuera de Colombia/);
  });

  it("al dejar de compartir sigue en vivo pero sin sitio", async () => {
    const { w, deps } = world();
    const m = createPresenceManager(deps);
    m.attach();
    m.startSharing();
    w.watching!.ok({ lat: 4.61, lng: -74.08 });
    await flush();
    m.stopSharing();
    await flush();
    expect(m.getState().sharing).toBe(false);
    expect(w.cleared).toBe(1);
    expect(w.touches.at(-1)).toEqual([null, null]);
    w.tick!();
    await flush();
    expect(w.touches.at(-1)).toEqual([null, null]);
  });

  it("si el permiso se niega, deja de compartir, lo explica y sigue en vivo", async () => {
    const { w, deps } = world();
    const m = createPresenceManager(deps);
    m.attach();
    m.startSharing();
    w.watching!.fail("Permiso denegado");
    await flush();
    expect(m.getState()).toEqual({ sharing: false, error: "Permiso denegado" });
    expect(w.touches.at(-1)).toEqual([null, null]);
  });

  it("al irse el último componente se apaga el seguimiento y no queda estado", async () => {
    const { w, deps } = world();
    const m = createPresenceManager(deps);
    const off = m.attach();
    m.startSharing();
    w.watching!.ok({ lat: 4.61, lng: -74.08 });
    await flush();
    off();
    expect(w.cleared).toBe(1);
    expect(w.stops).toBe(1);
    expect(m.getState()).toEqual({ sharing: false, error: null });
  });

  it("avisa a quien está suscrito cuando cambia el estado", async () => {
    const { w, deps } = world();
    const m = createPresenceManager(deps);
    let calls = 0;
    const off = m.subscribe(() => (calls += 1));
    m.attach();
    m.startSharing();
    expect(calls).toBeGreaterThan(0);
    const before = calls;
    off();
    w.watching!.ok({ lat: 40, lng: 0 });
    expect(calls).toBe(before);
  });

  it("empezar a compartir dos veces no abre dos seguimientos", () => {
    const { deps } = world();
    let watches = 0;
    const base = deps.geolocation!;
    deps.geolocation = { ...base, watch: (ok, fail) => (watches++, base.watch(ok, fail)) };
    const m = createPresenceManager(deps);
    m.attach();
    expect(m.startSharing()).toBe(true);
    expect(m.startSharing()).toBe(true);
    expect(watches).toBe(1);
  });
});
