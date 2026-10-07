// Tarjeta digital viral para profesionales de salud.
// Compartible en WhatsApp, Instagram y cualquier canal.
// URL personalizada: humanix.lat/pro/[username]
// El profesional la muestra antes de un servicio para que la familia
// verifique su identidad en tiempo real.
import { useState } from "react";
import { Share2, QrCode, Copy, CheckCircle2, MapPin, Star, BadgeCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

export type ProCardData = {
  name: string;
  username: string; // slug for humanix.lat/pro/[username]
  photoUrl?: string;
  specialty: string;
  city: string;
  yearsExp: number;
  rating?: number;
  reviewCount?: number;
  rethusBadge: boolean;
  certBadge: boolean;
  bio?: string;
  availableNow?: boolean;
};

export function ProfessionalShareCard({
  pro,
  compact = false,
}: {
  pro: ProCardData;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const profileUrl = `https://humanix.lat/pro/${pro.username}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(profileUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // fallback: select the text
    }
  };

  const shareWa = () => {
    const text = `*${pro.name}* | ${pro.specialty} en ${pro.city}\nVerificado en Humanix ✅\nMira mi perfil: ${profileUrl}`;
    window.open(
      `https://wa.me/?text=${encodeURIComponent(text)}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  const initials = pro.name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  return (
    <div
      className={`relative overflow-hidden rounded-[2rem] bg-card ring-1 ring-border shadow-xl shadow-trust/10 transition ${
        compact ? "max-w-xs" : "max-w-sm"
      } mx-auto`}
    >
      {/* header gradient band */}
      <div className="h-24 bg-gradient-to-br from-trust/30 via-ok/20 to-accent/10" />

      {/* avatar */}
      <div className="absolute left-1/2 -translate-x-1/2 top-10">
        {pro.photoUrl ? (
          <img
            src={pro.photoUrl}
            alt={pro.name}
            className="h-28 w-28 rounded-full object-cover ring-4 ring-card shadow-lg"
          />
        ) : (
          <div className="flex h-28 w-28 items-center justify-center rounded-full bg-trust/15 ring-4 ring-card shadow-lg text-4xl font-bold text-trust">
            {initials}
          </div>
        )}
        {pro.availableNow && (
          <span className="absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-ok ring-2 ring-card">
            <span className="h-2.5 w-2.5 rounded-full bg-ok-foreground animate-pulse" />
          </span>
        )}
      </div>

      {/* content */}
      <div className="pt-16 pb-6 px-5 text-center space-y-3">
        {/* name + badges */}
        <div>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <h2 className="text-xl font-bold">{pro.name}</h2>
            {pro.rethusBadge && (
              <BadgeCheck size={18} className="text-trust shrink-0" aria-label="RETHUS verificado" />
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            {pro.specialty}
          </p>
          <div className="flex items-center justify-center gap-1 mt-1 text-xs text-muted-foreground">
            <MapPin size={12} />
            <span>{pro.city}</span>
            <span className="mx-1.5 text-border">·</span>
            <span>{pro.yearsExp} años exp.</span>
          </div>
        </div>

        {/* rating */}
        {pro.rating !== undefined && (
          <div className="flex items-center justify-center gap-1.5">
            <Star size={14} className="fill-amber-400 text-amber-400" />
            <span className="text-sm font-bold">{pro.rating.toFixed(1)}</span>
            {pro.reviewCount !== undefined && (
              <span className="text-xs text-muted-foreground">
                ({pro.reviewCount} reseñas)
              </span>
            )}
          </div>
        )}

        {/* verification chips */}
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          {pro.rethusBadge && (
            <Chip color="trust" icon={<CheckCircle2 size={11} />}>
              RETHUS vigente
            </Chip>
          )}
          {pro.certBadge && (
            <Chip color="ok" icon={<CheckCircle2 size={11} />}>
              Certificado Humanix
            </Chip>
          )}
          {pro.availableNow && (
            <Chip color="ok" icon={<span className="h-2 w-2 rounded-full bg-ok inline-block" />}>
              Disponible ahora
            </Chip>
          )}
        </div>

        {/* bio */}
        {!compact && pro.bio && (
          <p className="text-sm text-muted-foreground px-2 leading-relaxed line-clamp-3">
            {pro.bio}
          </p>
        )}

        {/* actions */}
        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={copyLink}
            className="flex-1 rounded-xl h-10 gap-1.5 text-xs font-bold"
          >
            {copied ? (
              <>
                <CheckCircle2 size={14} className="text-ok" />
                ¡Copiado!
              </>
            ) : (
              <>
                <Copy size={14} />
                Copiar enlace
              </>
            )}
          </Button>
          <Button
            onClick={shareWa}
            size="sm"
            className="flex-1 rounded-xl h-10 gap-1.5 text-xs font-bold bg-ok text-ok-foreground hover:bg-ok/90"
          >
            <Share2 size={14} />
            Compartir
          </Button>
        </div>

        {/* profile URL hint */}
        <p className="text-[0.68rem] text-muted-foreground truncate">
          {profileUrl}
        </p>
      </div>
    </div>
  );
}

function Chip({
  children,
  color,
  icon,
}: {
  children: React.ReactNode;
  color: "trust" | "ok" | "amber";
  icon?: React.ReactNode;
}) {
  const cls =
    color === "trust"
      ? "bg-trust/10 border-trust/30 text-trust"
      : color === "ok"
        ? "bg-ok/10 border-ok/30 text-ok"
        : "bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.7rem] font-semibold ${cls}`}
    >
      {icon}
      {children}
    </span>
  );
}
