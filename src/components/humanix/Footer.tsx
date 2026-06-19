import { Link } from "@tanstack/react-router";
import { Logo } from "./Logo";
import { SocialIcons } from "./SocialIcons";
import { CONTACT } from "@/lib/social";

type FooterLink = { label: string; to?: string; href?: string };

const cols: { title: string; links: FooterLink[] }[] = [
  {
    title: "Servicios de cuidado",
    links: [
      { label: "Enfermería domiciliaria 24/7", to: "/enfermeria-domiciliaria" },
      { label: "Cuidado adulto mayor", to: "/cuidado-adulto-mayor" },
      { label: "Cuidado postoperatorio", to: "/cuidado-postoperatorio" },
      { label: "Cuidado pediátrico", to: "/cuidado-pediatrico" },
      { label: "Cuidados paliativos", to: "/cuidado-paliativo" },
      { label: "Cuidador a domicilio", to: "/cuidador-domicilio" },
      { label: "Auxiliar de enfermería", to: "/auxiliar-enfermeria" },
    ],
  },
  {
    title: "Ciudades",
    links: [
      { label: "Bogotá", to: "/enfermeria-bogota" },
      { label: "Medellín", to: "/enfermeria-medellin" },
      { label: "Cali", to: "/enfermeria-cali" },
      { label: "Barranquilla", to: "/enfermeria-barranquilla" },
      { label: "Cartagena", to: "/enfermeria-cartagena" },
      { label: "Bucaramanga", to: "/enfermeria-bucaramanga" },
      { label: "Pereira", to: "/enfermeria-pereira" },
    ],
  },
  {
    title: "Plataforma",
    links: [
      { label: "Familias", to: "/familias" },
      { label: "Profesionales", to: "/profesionales" },
      { label: "Clínicas e IPS", to: "/talento-humano" },
      { label: "Buscar cuidado", to: "/buscar" },
      { label: "Planes", to: "/planes" },
      { label: "Calculadora de costos", to: "/calculadora" },
      { label: "Tecnología IA", to: "/tecnologia" },
      { label: "Recursos", to: "/recursos" },
      { label: "Sobre Humanix", to: "/sobre" },
      { label: "Contacto", to: "/contacto" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Términos", to: "/terminos" },
      { label: "Privacidad", to: "/privacidad" },
      { label: "Habeas Data", to: "/habeas-data" },
      { label: "Cumplimiento", to: "/cumplimiento" },
      { label: "Confianza", to: "/confianza" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-10 sm:py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <Logo />
            <p className="mt-4 text-sm text-muted-foreground max-w-md leading-relaxed">
              Plataforma colombiana de talento humano en salud, con IA en tiempo real, verificación
              RETHUS y pagos inmediatos.
            </p>
            <p className="mt-4 text-xs text-muted-foreground">
              Bogotá · Medellín · Cali · Barranquilla
            </p>
            <div className="mt-4 space-y-1 text-xs text-muted-foreground">
              <p>
                <a
                  href={CONTACT.whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground transition-colors"
                >
                  WhatsApp {CONTACT.phoneDisplay}
                </a>
              </p>
              <p>
                <a
                  href={CONTACT.emailUrl}
                  className="hover:text-foreground transition-colors"
                >
                  {CONTACT.email}
                </a>
              </p>
            </div>
            <div className="mt-5">
              <p className="text-xs font-semibold text-foreground mb-2">Síguenos en redes</p>
              <SocialIcons size="sm" />
            </div>
            <p className="mt-5 text-[11px] uppercase tracking-[0.2em] text-muted-foreground/70">
              humanix.lat
            </p>
          </div>
          {cols.map((col, idx) => (
            <div key={col.title} className={idx === 2 ? "lg:col-span-3" : "lg:col-span-2"}>
              <p className="text-sm font-semibold mb-3">{col.title}</p>
              <ul className="space-y-2">
                {col.links.map((l) => (
                  <li key={l.label}>
                    {l.to ? (
                      <Link
                        to={l.to as never}
                        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {l.label}
                      </Link>
                    ) : (
                      <a
                        href={l.href ?? "#"}
                        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {l.label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-8 sm:mt-10 pt-6 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left">
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} Humanix Colombia · humanix.lat · Todos los derechos reservados.
          </p>
          <div className="flex items-center gap-4">
            <p className="text-xs text-muted-foreground">
              Hecho con <span className="text-fuchsia-neural">♥</span> en Colombia
            </p>
            <span className="text-muted-foreground/40">·</span>
            <Link
              to="/auth"
              search={{ staff: "1" } as never}
              className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground/50 hover:text-foreground transition-colors"
              title="Acceso staff"
            >
              Admin
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
