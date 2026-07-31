import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { buildMetadata, SITE_URL } from "@/lib/seo";
import { PRODUCTO_MODULES } from "@/lib/producto/data";
import { ProductoPage } from "@/components/producto/producto-page";
import { ExpedienteHero, Expediente1, Expediente2, Expediente3, Expediente4 } from "@/components/producto/mockups/expediente";
import "../producto.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-inter",
  display: "swap",
});

const M = PRODUCTO_MODULES["expediente-clinico-dental"];

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
      hero={<ExpedienteHero />}
      mocks={{
        "expediente-1": <Expediente1 />,
        "expediente-2": <Expediente2 />,
        "expediente-3": <Expediente3 />,
        "expediente-4": <Expediente4 />,
      }}
    />
  );
}
