import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { buildMetadata, SITE_URL } from "@/lib/seo";
import { PRODUCTO_MODULES } from "@/lib/producto/data";
import { ProductoPage } from "@/components/producto/producto-page";
import { FacturacionHero, Facturacion1, Facturacion2, Facturacion3, Facturacion4 } from "@/components/producto/mockups/facturacion";
import "../producto.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-inter",
  display: "swap",
});

// OJO: este módulo NO promete timbrado ante el SAT. La primera pregunta del FAQ
// responde "No" a propósito (ver src/lib/producto/data.ts) — no cambiarla.
const M = PRODUCTO_MODULES["facturacion-dental-cfdi"];

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
      hero={<FacturacionHero />}
      mocks={{
        "facturacion-1": <Facturacion1 />,
        "facturacion-2": <Facturacion2 />,
        "facturacion-3": <Facturacion3 />,
        "facturacion-4": <Facturacion4 />,
      }}
    />
  );
}
