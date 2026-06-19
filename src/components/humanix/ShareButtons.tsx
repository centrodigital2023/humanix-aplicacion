import { MessageCircle, Link2, Check, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { toast } from "sonner";

export type ShareTarget = "linkedin" | "facebook" | "twitter" | "whatsapp" | "copy";

export interface ShareButtonsProps {
  url: string;
  title: string;
  description?: string;
  targets?: ShareTarget[];
  size?: "sm" | "default";
  onShare?: (target: ShareTarget) => void;
}

const ICONS = {
  linkedin: Share2,
  facebook: Share2,
  twitter: Share2,
  whatsapp: MessageCircle,
  copy: Link2,
} as const;

const LABELS: Record<ShareTarget, string> = {
  linkedin: "LinkedIn",
  facebook: "Facebook",
  twitter: "X",
  whatsapp: "WhatsApp",
  copy: "Copiar",
};

function buildShareUrl(
  target: ShareTarget,
  url: string,
  title: string,
  description?: string,
): string {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(title);
  const d = encodeURIComponent(description || title);
  switch (target) {
    case "linkedin":
      return `https://www.linkedin.com/sharing/share-offsite/?url=${u}`;
    case "facebook":
      return `https://www.facebook.com/sharer/sharer.php?u=${u}&quote=${t}`;
    case "twitter":
      return `https://twitter.com/intent/tweet?url=${u}&text=${t}`;
    case "whatsapp":
      return `https://wa.me/?text=${t}%20${u}`;
    case "copy":
      return url;
  }
}

export function ShareButtons({
  url,
  title,
  description,
  targets = ["linkedin", "facebook", "twitter", "whatsapp", "copy"],
  size = "sm",
  onShare,
}: ShareButtonsProps) {
  const [copied, setCopied] = useState(false);

  const handle = async (target: ShareTarget) => {
    if (!url || url.trim() === "" || url.trim() === "#") {
      toast.error("URL no disponible para compartir");
      return;
    }
    if (target === "copy") {
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        toast.success("Enlace copiado");
        setTimeout(() => setCopied(false), 2000);
      } catch {
        toast.error("No se pudo copiar");
      }
    } else {
      window.open(
        buildShareUrl(target, url, title, description),
        "_blank",
        "noopener,noreferrer,width=640,height=560",
      );
    }
    onShare?.(target);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {targets.map((t) => {
        const Icon = t === "copy" && copied ? Check : ICONS[t];
        return (
          <Button
            key={t}
            type="button"
            variant="outline"
            size={size}
            onClick={() => handle(t)}
            className="gap-1.5"
            title={`Compartir en ${LABELS[t]}`}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline text-xs">{LABELS[t]}</span>
          </Button>
        );
      })}
    </div>
  );
}
