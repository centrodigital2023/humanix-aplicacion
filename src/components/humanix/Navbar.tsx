// Barra superior única de Humanix (misma en la home y en el resto del sitio):
// logo · perfil activo (solo el suyo) · 🏠 Inicio · WhatsApp · Entrar / Mi panel.
// Nunca muestra los otros perfiles: cada persona ve solo su experiencia.
import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { MessageCircle, Moon, Sun } from "lucide-react";
import { HomeButton } from "./HomeButton";
import { Logo } from "./Logo";
import { useTheme } from "@/hooks/use-theme";
import { pathForRole } from "@/hooks/use-app-user";
import { useAudience } from "@/hooks/use-audience";
import { AUDIENCE_COPY, whatsappLink } from "@/lib/audience";
import { CONTACT } from "@/lib/social";

const pill =
  "inline-flex min-h-12 items-center justify-center rounded-full px-5 text-base font-bold transition active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/30";

export function Navbar({ static: isStatic = false }: { static?: boolean }) {
  const { theme, toggleTheme } = useTheme();
  const { user, audience } = useAudience();
  const [scrolled, setScrolled] = useState(false);
  const isHome = useRouterState({ select: (st) => st.location.pathname === "/" });

  useEffect(() => {
    if (isStatic) return;
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, [isStatic]);

  const copy = audience ? AUDIENCE_COPY[audience] : null;

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
      search={{ mode: "signin", ...(copy ? { role: copy.authRole } : {}) } as never}
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
              scrolled ? "bg-background/90 shadow-sm backdrop-blur-xl" : "bg-transparent"
            }`
      }
    >
      <nav
        aria-label="Principal"
        className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3 sm:px-6"
      >
        <div className="flex min-w-0 items-center gap-3">
          <Link to="/" aria-label="Humanix, inicio">
            <Logo wordmarkClassName={isHome ? "" : "hidden sm:inline"} />
          </Link>
          {/* Perfil activo: solo el de esta persona */}
          {copy && !isHome && (
            <span className="hidden items-center gap-2 rounded-full bg-card px-4 py-2 text-base font-bold shadow-sm ring-1 ring-border md:inline-flex">
              <span aria-hidden="true">{copy.emoji}</span>
              {copy.tab}
            </span>
          )}
        </div>

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
            href={whatsappLink(
              CONTACT.whatsappNumber,
              copy
                ? `Hola Humanix, soy de "${copy.tab}" y necesito ayuda.`
                : "Hola Humanix, necesito ayuda.",
            )}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Ayuda por WhatsApp"
            className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-card shadow-sm transition hover:shadow-md active:scale-95"
          >
            <MessageCircle className="h-6 w-6 text-ok" aria-hidden="true" />
          </a>
          {account}
        </div>
      </nav>
    </header>
  );
}
