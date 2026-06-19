import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { X } from "lucide-react";

type AdSize = "leaderboard" | "rectangle" | "skyscraper" | "banner" | "square";
type InternalBanner = {
  id: string;
  title: string;
  image_url: string | null;
  cta_label: string | null;
  link_url: string | null;
};

const SIZE_CLASS: Record<AdSize, string> = {
  leaderboard: "w-full min-h-[90px]",
  rectangle: "w-full min-h-[250px] max-w-[336px]",
  skyscraper: "w-[160px] min-h-[600px]",
  banner: "w-full min-h-[60px]",
  square: "w-full min-h-[200px] max-w-[250px]",
};

interface AdBannerProps {
  /** Position/slot identifier matching ad_banners.position */
  slot?: string;
  /** Google AdSense ad slot ID (e.g. "1234567890") */
  adsenseSlot?: string;
  /** Ad size variant */
  size?: AdSize;
  /** Extra Tailwind classes */
  className?: string;
  /** Show close button (dismissible) */
  dismissible?: boolean;
}

export function AdBanner({
  slot = "homepage",
  adsenseSlot,
  size = "leaderboard",
  className = "",
  dismissible = false,
}: AdBannerProps) {
  const [banner, setBanner] = useState<InternalBanner | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [adsenseLoaded, setAdsenseLoaded] = useState(false);
  const adsRef = useRef<HTMLModElement | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data } = await supabase
          .from("ad_banners")
          .select("id, title, image_url, cta_label, link_url")
          .eq("active", true)
          .eq("position", slot)
          .maybeSingle();
        if (mounted && data) setBanner(data as InternalBanner);
      } catch {
        // no internal banner, fall through to AdSense
      }
    })();
    return () => { mounted = false; };
  }, [slot]);

  useEffect(() => {
    if (banner || !adsenseSlot || adsenseLoaded) return;
    const timer = setTimeout(() => {
      try {
        const win = window as any;
        if (win.adsbygoogle && adsRef.current) {
          (win.adsbygoogle = win.adsbygoogle || []).push({});
          setAdsenseLoaded(true);
        }
      } catch {
        // AdSense not loaded yet
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, [banner, adsenseSlot, adsenseLoaded]);

  if (dismissed) return null;

  const trackClick = async () => {
    if (!banner?.id) return;
    try {
      await supabase
        .from("ad_banners")
        .update({ clicks: 0 } as any)
        .eq("id", banner.id);
    } catch {
      // non-critical
    }
  };

  if (banner) {
    return (
      <div
        className={`relative rounded-2xl overflow-hidden border border-border/50 shadow-[var(--shadow-card)] ${SIZE_CLASS[size]} ${className}`}
      >
        {dismissible && (
          <button
            onClick={() => setDismissed(true)}
            className="absolute top-2 right-2 z-10 h-6 w-6 rounded-full bg-black/20 hover:bg-black/40 flex items-center justify-center transition-colors"
            aria-label="Cerrar anuncio"
          >
            <X className="h-3 w-3 text-white" />
          </button>
        )}
        {banner.image_url ? (
          <a
            href={banner.link_url ?? "#"}
            target="_blank"
            rel="noopener noreferrer sponsored"
            onClick={trackClick}
            className="block h-full"
          >
            <img
              src={banner.image_url}
              alt={banner.title ?? "Patrocinado"}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          </a>
        ) : (
          <div className="flex items-center justify-between gap-4 px-5 py-4 h-full bg-gradient-to-r from-biosensor/10 via-card to-copper/10">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-0.5">
                Patrocinado
              </p>
              <p className="font-semibold text-sm truncate">{banner.title}</p>
            </div>
            {banner.cta_label && banner.link_url && (
              <a
                href={banner.link_url}
                target="_blank"
                rel="noopener noreferrer sponsored"
                onClick={trackClick}
                className="shrink-0 inline-flex h-9 items-center justify-center rounded-xl bg-biosensor px-4 text-xs font-semibold text-biosensor-foreground shadow-[var(--shadow-glow-bio)] hover:-translate-y-0.5 transition-transform whitespace-nowrap"
              >
                {banner.cta_label}
              </a>
            )}
          </div>
        )}
      </div>
    );
  }

  if (adsenseSlot) {
    return (
      <div className={`relative ${SIZE_CLASS[size]} ${className}`}>
        {dismissible && (
          <button
            onClick={() => setDismissed(true)}
            className="absolute top-2 right-2 z-10 h-6 w-6 rounded-full bg-black/20 hover:bg-black/40 flex items-center justify-center transition-colors"
            aria-label="Cerrar anuncio"
          >
            <X className="h-3 w-3 text-white" />
          </button>
        )}
        <ins
          ref={adsRef}
          className="adsbygoogle block"
          style={{ display: "block" }}
          data-ad-client={import.meta.env.VITE_ADSENSE_PUBLISHER_ID ?? "ca-pub-XXXXXXXXXXXXXXXX"}
          data-ad-slot={adsenseSlot}
          data-ad-format="auto"
          data-full-width-responsive="true"
        />
      </div>
    );
  }

  return null;
}
