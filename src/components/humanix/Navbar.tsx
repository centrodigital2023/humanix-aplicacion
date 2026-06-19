import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Moon, Sun, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "./Logo";
import { useTheme } from "@/hooks/use-theme";
import { CONTACT } from "@/lib/social";

const links = [
  { to: "/profesionales" as const, label: "Profesionales" },
  { to: "/familias" as const, label: "Familias" },
  { to: "/tecnologia" as const, label: "Tecnología IA" },
  { to: "/planes" as const, label: "Planes" },
];

export function Navbar() {
  const { theme, toggleTheme } = useTheme();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
        scrolled ? "bg-background/80 backdrop-blur-xl border-b border-border" : "bg-transparent"
      }`}
    >
      <nav className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-3 sm:px-6 py-3 sm:py-4">
        <Link to="/" aria-label="Humanix inicio">
          <Logo />
        </Link>

        <div className="hidden lg:flex items-center gap-1">
          {links.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              preload="intent"
              activeProps={{ className: "text-foreground bg-foreground/5" }}
              className="px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors whitespace-nowrap"
            >
              {l.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          <button
            onClick={toggleTheme}
            aria-label="Cambiar tema"
            className="h-9 w-9 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <Button variant="ghost" size="sm" className="hidden xl:inline-flex" asChild>
            <Link to="/buscar" preload="intent">
              Buscar
            </Link>
          </Button>
          <a
            href={CONTACT.whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              e.preventDefault();
              try {
                const w = window.open(CONTACT.whatsappUrl, "_blank", "noopener,noreferrer");
                if (!w) {
                  if (window.top && window.top !== window.self)
                    window.top.location.href = CONTACT.whatsappUrl;
                  else window.location.href = CONTACT.whatsappUrl;
                }
              } catch {
                window.location.href = CONTACT.whatsappUrl;
              }
            }}
            aria-label={`WhatsApp Humanix ${CONTACT.phoneDisplay}`}
            title={`WhatsApp ${CONTACT.phoneDisplay}`}
            className="hidden md:inline-flex h-9 w-9 items-center justify-center rounded-md text-[#25D366] hover:bg-[#25D366]/10 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden="true">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.174.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
          </a>
          <Button variant="ghost" size="sm" className="hidden md:inline-flex" asChild>
            <Link to="/auth" search={{ mode: "signin" }}>
              Iniciar sesión
            </Link>
          </Button>
          <Button variant="hero" size="sm" className="hidden sm:inline-flex" asChild>
            <Link to="/auth" search={{ mode: "signup" }}>
              Empezar gratis
            </Link>
          </Button>
          <button
            onClick={() => setOpen(!open)}
            aria-label="Menú"
            className="lg:hidden h-9 w-9 inline-flex items-center justify-center rounded-md hover:bg-foreground/5"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </nav>

      {open && (
        <div className="lg:hidden border-t border-border bg-background/95 backdrop-blur-xl">
          <div className="flex flex-col px-4 py-3 gap-1">
            {links.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                onClick={() => setOpen(false)}
                className="px-3 py-2.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-foreground/5"
              >
                {l.label}
              </Link>
            ))}
            <Link
              to="/buscar"
              onClick={() => setOpen(false)}
              className="px-3 py-2.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-foreground/5"
            >
              Buscar
            </Link>
            <Button variant="ghost" size="sm" className="mt-2 w-full" asChild>
              <Link
                to="/auth"
                search={{ mode: "signin" }}
                onClick={() => setOpen(false)}
              >
                Iniciar sesión
              </Link>
            </Button>
            <Button variant="hero" size="sm" className="mt-2 w-full" asChild>
              <Link
                to="/auth"
                search={{ mode: "signup" }}
                onClick={() => setOpen(false)}
              >
                Empezar gratis
              </Link>
            </Button>
          </div>
        </div>
      )}
    </header>
  );
}
