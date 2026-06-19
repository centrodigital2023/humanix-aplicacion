import type { ReactElement, SVGProps } from "react";
import { SOCIAL_LINKS, type SocialLink } from "@/lib/social";

type IconProps = SVGProps<SVGSVGElement> & { className?: string };

function WhatsAppIcon({ className = "h-4 w-4", ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.174.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

function EmailIcon({ className = "h-4 w-4", ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M2 7l10 6 10-6" />
    </svg>
  );
}

function FacebookIcon({ className = "h-4 w-4", ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      <path d="M22 12.07C22 6.51 17.52 2 12 2S2 6.51 2 12.07c0 5.02 3.66 9.18 8.44 9.93v-7.02H7.9V12.07h2.54V9.85c0-2.51 1.49-3.89 3.77-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.78l-.44 2.91h-2.34V22c4.78-.75 8.44-4.91 8.44-9.93z" />
    </svg>
  );
}

function InstagramIcon({ className = "h-4 w-4", ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      <rect x="2" y="2" width="20" height="20" rx="5" />
      <path d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}

function YoutubeIcon({ className = "h-4 w-4", ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      <path d="M23.5 6.2a3 3 0 00-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 00.5 6.2 31 31 0 000 12a31 31 0 00.5 5.8 3 3 0 002.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 002.1-2.1A31 31 0 0024 12a31 31 0 00-.5-5.8zM9.75 15.5v-7l6.5 3.5-6.5 3.5z" />
    </svg>
  );
}

function TikTokIcon({ className = "h-4 w-4", ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      <path d="M16.5 3a5.5 5.5 0 0 0 4.5 5v3.1a8.6 8.6 0 0 1-4.5-1.3v6.6A6.6 6.6 0 1 1 10 9.8v3.3a3.3 3.3 0 1 0 3.3 3.3V3h3.2z" />
    </svg>
  );
}

function XIcon({ className = "h-4 w-4", ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      <path d="M18.244 2H21.5l-7.5 8.58L22.5 22h-6.83l-5.35-6.99L4.2 22H.94l8.02-9.18L1.5 2h7l4.84 6.4L18.244 2zm-1.2 18h1.84L7.04 4H5.1l11.944 16z" />
    </svg>
  );
}

const ICON_BY_KEY: Record<SocialLink["key"], (p: IconProps) => ReactElement> = {
  whatsapp: WhatsAppIcon,
  email: EmailIcon,
  facebook: FacebookIcon,
  instagram: InstagramIcon,
  youtube: YoutubeIcon,
  tiktok: TikTokIcon,
  x: XIcon,
};

export function SocialIcons({
  size = "sm",
  showLabels = false,
  className = "",
}: {
  size?: "sm" | "md";
  showLabels?: boolean;
  className?: string;
}) {
  const btnCls = size === "md" ? "h-10 w-10" : "h-8 w-8";
  const iconCls = size === "md" ? "h-5 w-5" : "h-4 w-4";
  return (
    <ul className={`flex flex-wrap items-center gap-2 ${className}`}>
      {SOCIAL_LINKS.map((s) => {
        const Icon = ICON_BY_KEY[s.key];
        return (
          <li key={s.key} className={showLabels ? "flex items-center gap-2" : undefined}>
            <a
              href={s.href}
              target={s.key === "email" ? "_self" : "_blank"}
              rel="noopener noreferrer"
              aria-label={`${s.label}${s.handle ? ` · ${s.handle}` : ""}`}
              title={`${s.label}${s.handle ? ` · ${s.handle}` : ""}`}
              className={`${btnCls} inline-flex items-center justify-center rounded-full border border-border bg-card hover:bg-foreground hover:text-background hover:border-foreground transition-colors text-muted-foreground`}
            >
              <Icon className={iconCls} />
            </a>
            {showLabels && (
              <span className="text-xs text-muted-foreground">{s.handle ?? s.label}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
