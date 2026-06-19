// Canonical social + contact links for Humanix. Update in one place.

export const CONTACT = {
  whatsappNumber: "573147444715",
  whatsappUrl: "https://wa.me/573147444715",
  email: "centrodigital2023@gmail.com",
  emailUrl: "mailto:centrodigital2023@gmail.com",
  phoneDisplay: "+57 314 744 4715",
  phoneUrl: "tel:+573147444715",
} as const;

export type SocialLink = {
  key: "whatsapp" | "email" | "facebook" | "instagram" | "youtube" | "tiktok" | "x";
  label: string;
  handle?: string;
  href: string;
  brandColor: string;
};

export const SOCIAL_LINKS: SocialLink[] = [
  {
    key: "whatsapp",
    label: "WhatsApp",
    handle: "+57 314 744 4715",
    href: "https://wa.me/573147444715",
    brandColor: "#25D366",
  },
  {
    key: "email",
    label: "Email",
    handle: "centrodigital2023@gmail.com",
    href: "mailto:centrodigital2023@gmail.com",
    brandColor: "#EA4335",
  },
  {
    key: "facebook",
    label: "Facebook",
    handle: "@feskawsay",
    href: "https://www.facebook.com/feskawsay",
    brandColor: "#1877F2",
  },
  {
    key: "instagram",
    label: "Instagram",
    handle: "@feskawsay",
    href: "https://www.instagram.com/feskawsay/",
    brandColor: "#E4405F",
  },
  {
    key: "youtube",
    label: "YouTube",
    handle: "@fundacionesperanzakawsay3637",
    href: "https://www.youtube.com/@fundacionesperanzakawsay3637",
    brandColor: "#FF0000",
  },
  {
    key: "tiktok",
    label: "TikTok",
    handle: "@feskawsay",
    href: "https://www.tiktok.com/@feskawsay",
    brandColor: "#000000",
  },
  {
    key: "x",
    label: "X (Twitter)",
    handle: "@profeia2050",
    href: "https://x.com/profeia2050",
    brandColor: "#000000",
  },
];
