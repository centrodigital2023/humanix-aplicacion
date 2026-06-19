import { type ReactNode, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useRouter } from "@tanstack/react-router";
import {
  ArrowLeft,
  ChevronRight,
  Home,
  LogOut,
  Menu,
  Moon,
  Search,
  Sun,
  X,
  type LucideIcon,
} from "lucide-react";
import { Logo } from "./Logo";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/use-theme";
import type { AppRole, AppUser } from "@/hooks/use-app-user";

export type NavItem = {
  label: string;
  to: string;
  icon: LucideIcon;
  badge?: string | number;
};

export type Crumb = { label: string; to?: string };

type Props = {
  user: AppUser;
  onLogout: () => void;
  nav: NavItem[];
  bottomNav?: NavItem[];
  title: string;
  subtitle?: string;
  crumbs?: Crumb[];
  actions?: ReactNode;
  badge?: { label: string; tone?: "bio" | "copper" | "fuchsia" | "cyber" };
  children: ReactNode;
};

const ROLE_LABEL: Record<AppRole, string> = {
  professional: "Profesional",
  family: "Familia",
  institution: "Institución",
  superadmin: "Superadmin",
  hr_staff: "Talento Humano",
  evaluator: "Evaluador",
};

const TONE: Record<NonNullable<Props["badge"]>["tone"] & string, string> = {
  bio: "bg-biosensor/10 text-biosensor border-biosensor/30",
  copper: "bg-copper/10 text-copper border-copper/30",
  fuchsia: "bg-fuchsia-neural/10 text-fuchsia-neural border-fuchsia-neural/30",
  cyber: "bg-cyber/10 text-cyber border-cyber/30 dark:text-cyber-foreground",
};

export function AppShell({
  user,
  onLogout,
  nav,
  bottomNav,
  title,
  subtitle,
  crumbs,
  actions,
  badge,
  children,
}: Props) {
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const router = useRouter();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const isActive = (to: string) =>
    location.pathname === to || location.pathname.startsWith(to + "/");

  const sidebarWidth = collapsed ? "lg:w-[76px]" : "lg:w-[260px]";
  const initials = user.fullName
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const phoneNav = (bottomNav && bottomNav.length ? bottomNav : nav).slice(0, 5);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Sidebar desktop */}
      <aside
        className={`hidden lg:flex fixed inset-y-0 left-0 z-30 flex-col border-r border-border bg-card/80 backdrop-blur-xl transition-[width] duration-300 ${sidebarWidth}`}
      >
        <div className="flex items-center gap-2 px-4 h-16 border-b border-border">
          <Link to="/" className="flex items-center gap-2.5 min-w-0">
            {collapsed ? (
              <div className="h-9 w-9 rounded-xl bg-cyber flex items-center justify-center text-biosensor font-display font-bold">
                H
              </div>
            ) : (
              <Logo />
            )}
          </Link>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {nav.map((item) => {
            const active = isActive(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-foreground text-background shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-foreground/5"
                }`}
                title={collapsed ? item.label : undefined}
              >
                <Icon className="h-[18px] w-[18px] shrink-0" />
                {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                {!collapsed && item.badge !== undefined && (
                  <span
                    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                      active ? "bg-background/20 text-background" : "bg-biosensor/15 text-biosensor"
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border p-3 space-y-2">
          <div
            className={`flex items-center gap-2.5 rounded-xl p-2 ${collapsed ? "justify-center" : ""}`}
          >
            <div className="h-9 w-9 rounded-full bg-gradient-to-br from-biosensor to-fuchsia-neural flex items-center justify-center text-xs font-bold text-white shrink-0">
              {user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt=""
                  className="h-full w-full rounded-full object-cover"
                />
              ) : (
                initials || "U"
              )}
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold truncate">{user.fullName}</p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {ROLE_LABEL[user.primaryRole]}
                </p>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={toggleTheme}
              className="flex-1 h-9 inline-flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-foreground/5"
              title="Tema"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button
              onClick={onLogout}
              className="flex-1 h-9 inline-flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              title="Cerrar sesión"
            >
              <LogOut className="h-4 w-4" />
            </button>
            <button
              onClick={() => setCollapsed((c) => !c)}
              className="flex-1 h-9 inline-flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-foreground/5"
              title={collapsed ? "Expandir" : "Colapsar"}
            >
              <ChevronRight
                className={`h-4 w-4 transition-transform ${collapsed ? "" : "rotate-180"}`}
              />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-foreground/40 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-[280px] bg-card border-r border-border flex flex-col">
            <div className="flex items-center justify-between px-4 h-16 border-b border-border">
              <Logo />
              <button
                onClick={() => setMobileOpen(false)}
                className="h-9 w-9 inline-flex items-center justify-center rounded-md hover:bg-foreground/5"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
              {nav.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.to);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium ${
                      active
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground hover:bg-foreground/5"
                    }`}
                  >
                    <Icon className="h-[18px] w-[18px]" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            <div className="border-t border-border p-3 flex items-center gap-2">
              <Button variant="ghost" size="sm" className="flex-1" onClick={toggleTheme}>
                {theme === "dark" ? (
                  <Sun className="h-4 w-4 mr-1.5" />
                ) : (
                  <Moon className="h-4 w-4 mr-1.5" />
                )}
                Tema
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="flex-1 text-destructive"
                onClick={onLogout}
              >
                <LogOut className="h-4 w-4 mr-1.5" /> Salir
              </Button>
            </div>
          </aside>
        </div>
      )}

      {/* Main */}
      <div
        className={`min-h-screen flex flex-col transition-[padding] duration-300 ${
          collapsed ? "lg:pl-[76px]" : "lg:pl-[260px]"
        } pb-20 lg:pb-0`}
      >
        {/* Top bar */}
        <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur-xl">
          <div className="flex items-center gap-2 px-4 sm:px-6 h-16">
            <button
              onClick={() => setMobileOpen(true)}
              className="lg:hidden h-9 w-9 inline-flex items-center justify-center rounded-md hover:bg-foreground/5"
              aria-label="Abrir menú"
            >
              <Menu className="h-5 w-5" />
            </button>

            <button
              onClick={() => router.history.back()}
              className="hidden sm:inline-flex items-center gap-1.5 h-9 px-2.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-foreground/5"
              title="Volver"
            >
              <ArrowLeft className="h-4 w-4" /> Volver
            </button>

            <button
              onClick={() => navigate({ to: "/" })}
              className="hidden sm:inline-flex items-center gap-1.5 h-9 px-2.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-foreground/5"
              title="Inicio"
            >
              <Home className="h-4 w-4" />
            </button>

            <div className="hidden md:flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
              {(crumbs ?? [{ label: title }]).map((c, i, arr) => (
                <span key={`${c.label}-${i}`} className="flex items-center gap-1.5 truncate">
                  {i > 0 && <ChevronRight className="h-3 w-3 opacity-50" />}
                  {c.to ? (
                    <Link to={c.to} className="hover:text-foreground truncate">
                      {c.label}
                    </Link>
                  ) : (
                    <span className={i === arr.length - 1 ? "text-foreground font-medium" : ""}>
                      {c.label}
                    </span>
                  )}
                </span>
              ))}
            </div>

            <div className="flex-1" />

            <Link
              to="/buscar"
              className="hidden md:inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-border bg-card text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
            >
              <Search className="h-4 w-4" /> Buscar talento o turno…
            </Link>

            <button
              onClick={toggleTheme}
              className="lg:hidden h-9 w-9 inline-flex items-center justify-center rounded-md hover:bg-foreground/5"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            <div className="hidden lg:flex items-center gap-2 ml-1">
              <div className="text-right">
                <p className="text-xs font-semibold leading-tight">{user.fullName.split(" ")[0]}</p>
                <p className="text-[10px] text-muted-foreground leading-tight">
                  {ROLE_LABEL[user.primaryRole]}
                </p>
              </div>
              <div className="h-9 w-9 rounded-full bg-gradient-to-br from-biosensor to-fuchsia-neural flex items-center justify-center text-xs font-bold text-white">
                {user.avatarUrl ? (
                  <img
                    src={user.avatarUrl}
                    alt=""
                    className="h-full w-full rounded-full object-cover"
                  />
                ) : (
                  initials || "U"
                )}
              </div>
            </div>
          </div>

          {/* Page header */}
          <div className="px-4 sm:px-6 pb-4 sm:pb-5 pt-1 flex items-end gap-3 sm:gap-4 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="font-display text-xl sm:text-2xl lg:text-[28px] font-bold tracking-tight truncate">
                  {title}
                </h1>
                {badge && (
                  <span
                    className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-1 rounded-full border ${
                      TONE[badge.tone ?? "bio"]
                    }`}
                  >
                    {badge.label}
                  </span>
                )}
              </div>
              {subtitle && (
                <p className="text-xs sm:text-sm text-muted-foreground mt-1 line-clamp-2">
                  {subtitle}
                </p>
              )}
            </div>
            {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
          </div>
        </header>

        <main className="flex-1 px-4 sm:px-6 py-4 sm:py-6 safe-x">{children}</main>
      </div>

      {/* Bottom nav mobile */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 border-t border-border bg-background/95 backdrop-blur-xl pb-[env(safe-area-inset-bottom)] safe-x">
        <div className="grid grid-cols-5 h-16">
          {phoneNav.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors touch-target ${
                  active ? "text-biosensor" : "text-muted-foreground"
                }`}
              >
                <div
                  className={`h-9 w-9 inline-flex items-center justify-center rounded-xl ${
                    active
                      ? "bg-biosensor/15 shadow-[0_0_0_1px_color-mix(in_oklab,var(--biosensor)_30%,transparent)]"
                      : ""
                  }`}
                >
                  <Icon className="h-[18px] w-[18px]" />
                </div>
                <span className="truncate max-w-[64px]">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
