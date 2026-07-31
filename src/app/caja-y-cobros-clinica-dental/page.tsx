import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { buildMetadata, SITE_URL } from "@/lib/seo";
import { PRODUCTO_MODULES } from "@/lib/producto/data";
import { ProductoPage } from "@/components/producto/producto-page";
import { CajaHero, Caja1, Caja2, Caja3, Caja4 } from "@/components/producto/mockups/caja";
import "../producto.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-inter",
  display: "swap",
});

const M = PRODUCTO_MODULES["caja-y-cobros-clinica-dental"];

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
      hero={<CajaHero />}
      mocks={{
        "caja-1": <Caja1 />,
        "caja-2": <Caja2 />,
        "caja-3": <Caja3 />,
        "caja-4": <Caja4 />,
      }}
    />
  );
}
