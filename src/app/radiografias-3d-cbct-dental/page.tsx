import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { buildMetadata, SITE_URL } from "@/lib/seo";
import { PRODUCTO_MODULES } from "@/lib/producto/data";
import { ProductoPage } from "@/components/producto/producto-page";
import { RadiografiasHero, Radiografias1, Radiografias2, Radiografias3, Radiografias4 } from "@/components/producto/mockups/radiografias";
import "../producto.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-inter",
  display: "swap",
});

// "La IA asiste, el doctor decide": el FAQ responde "No" a si la IA diagnostica.
const M = PRODUCTO_MODULES["radiografias-3d-cbct-dental"];

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
      hero={<RadiografiasHero />}
      mocks={{
        "radiografias-1": <Radiografias1 />,
        "radiografias-2": <Radiografias2 />,
        "radiografias-3": <Radiografias3 />,
        "radiografias-4": <Radiografias4 />,
      }}
    />
  );
}
