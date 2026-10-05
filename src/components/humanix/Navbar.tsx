// Barra superior única de Humanix (misma en la home y en el resto del sitio):
// logo · 3 perfiles (Familias / IPS-EPS / Profesional) · WhatsApp · Entrar / Mi panel.
import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { HomeButton } from "./HomeButton";
import { Menu, MessageCircle, Moon, Sun, X } from "lucide-react";
import { Logo } from "./Logo";
import { useTheme } from "@/hooks/use-theme";
import { useAppUser, pathForRole } from "@/hooks/use-app-user";
import { AUDIENCES, AUDIENCE_COPY, whatsappLink } from "@/lib/audience";
import { CONTACT } from "@/lib/social";

const pill =
  "inline-flex min-h-12 items-center justify-center rounded-full px-5 text-base font-bold transition active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/30";

export function Navbar({ static: isStatic = false }: { static?: boolean }) {
  const { theme, toggleTheme } = useTheme();
  const { user } = useAppUser({ requireAuth: false });
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const isHome = useRouterState({ select: (st) => st.location.pathname === "/" });

  useEffect(() => {
    if (isStatic) return;
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, [isStatic]);

  const account = user ? (
    <Link
      to={pathForRole(user.primaryRole)}
      className={`${pill} bg-primary text-primary-foreground shadow-md`}
    >
      Mi panel
    </Link>
  ) : (
    <Link
      to="/auth"
      search={{ mode: "signin" } as never}
      className={`${pill} bg-card shadow-sm hover:shadow-md`}
    >
      Entrar
    </Link>
  );

  return (
    <header
      className={
        isStatic
          ? "relative z-50"
          : `fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
              scrolled || open ? "bg-background/90 shadow-sm backdrop-blur-xl" : "bg-transparent"
            }`
      }
    >
      <nav
        aria-label="Principal"
        className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3 sm:px-6"
      >
        <Link to="/" aria-label="Humanix, inicio">
          <Logo wordmarkClassName={isHome ? "" : "hidden sm:inline"} />
        </Link>

        {!isStatic && (
          <div className="hidden items-center gap-1 lg:flex">
            {AUDIENCES.map((a) => (
              <Link
                key={a}
                to="/"
                search={{ para: a }}
                className="inline-flex min-h-12 items-center gap-2 rounded-full px-4 text-base font-semibold hover:bg-accent"
              >
                <span aria-hidden="true">{AUDIENCE_COPY[a].emoji}</span>
                {AUDIENCE_COPY[a].tab}
              </Link>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          {!isHome && <HomeButton />}
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Modo claro" : "Modo oscuro"}
            className="hidden h-12 w-12 items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground sm:inline-flex"
          >
            {theme === "dark" ? (
              <Sun className="h-5 w-5" aria-hidden="true" />
            ) : (
              <Moon className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
          <a
            href={whatsappLink(CONTACT.whatsappNumber, "Hola Humanix, necesito ayuda.")}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Ayuda por WhatsApp"
            className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-card shadow-sm transition hover:shadow-md active:scale-95"
          >
            <MessageCircle className="h-6 w-6 text-ok" aria-hidden="true" />
          </a>
          {account}
          {!isStatic && (
            <button
              type="button"
              onClick={() => setOpen(!open)}
              aria-label="Menú"
              aria-expanded={open}
              className={`h-12 w-12 items-center justify-center rounded-full hover:bg-accent lg:hidden ${
                isHome ? "inline-flex" : "hidden sm:inline-flex"
              }`}
            >
              {open ? (
                <X className="h-6 w-6" aria-hidden="true" />
              ) : (
                <Menu className="h-6 w-6" aria-hidden="true" />
              )}
            </button>
          )}
        </div>
      </nav>

      {open && !isStatic && (
        <div className="border-t border-border bg-background/95 backdrop-blur-xl lg:hidden">
          <div className="mx-auto grid max-w-6xl grid-cols-3 gap-2 px-4 py-4">
            {AUDIENCES.map((a) => (
              <Link
                key={a}
                to="/"
                search={{ para: a }}
                onClick={() => setOpen(false)}
                className="flex min-h-20 flex-col items-center justify-center gap-1 rounded-2xl bg-card text-sm font-bold shadow-sm"
              >
                <span aria-hidden="true" className="text-2xl">
                  {AUDIENCE_COPY[a].emoji}
                </span>
                {AUDIENCE_COPY[a].tab}
              </Link>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
