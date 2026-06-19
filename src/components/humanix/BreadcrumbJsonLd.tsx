import type { ReactNode } from "react";
import * as seo from "@/lib/seo";

export type BreadcrumbItem = { name: string; path: string };

/**
 * Renders a BreadcrumbList JSON-LD script. Safe to place at the top of any
 * public page to improve sitelinks in Google SERPs.
 */
export function BreadcrumbJsonLd({ items }: { items: BreadcrumbItem[] }): ReactNode {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: seo.jsonLdString(seo.breadcrumbLd(items)) }}
    />
  );
}
