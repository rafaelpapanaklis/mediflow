import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { buildMetadata, SITE_URL } from "@/lib/seo";
import { PRODUCTO_MODULES } from "@/lib/producto/data";
import { ProductoPage } from "@/components/producto/producto-page";
import { PortalHero, Portal1, Portal2, Portal3, Portal4 } from "@/components/producto/mockups/portal";
import "../producto.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-inter",
  display: "swap",
});

const M = PRODUCTO_MODULES["portal-del-paciente-dental"];

export const metadata: Metadata = buildMetadata({
  title: M.metaTitle,
  description: M.metaDescription,
  path: `/${M.slug}`,
  ogImage: `${SITE_URL}/og/blog?title=${encodeURIComponent(M.metaTitle)}`,
  keywords: M.keywords,
});

export const revalidate = 3600;

export default function Page() {
  return (
    <ProductoPage
      module={M}
      fontClass={inter.variable}
      hero={<PortalHero />}
      mocks={{
        "portal-1": <Portal1 />,
        "portal-2": <Portal2 />,
        "portal-3": <Portal3 />,
        "portal-4": <Portal4 />,
      }}
    />
  );
}
