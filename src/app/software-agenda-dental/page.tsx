import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { buildMetadata, SITE_URL } from "@/lib/seo";
import { PRODUCTO_MODULES } from "@/lib/producto/data";
import { ProductoPage } from "@/components/producto/producto-page";
import { AgendaHero, Agenda1, Agenda2, Agenda3, Agenda4 } from "@/components/producto/mockups/agenda";
import "../producto.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-inter",
  display: "swap",
});

const M = PRODUCTO_MODULES["software-agenda-dental"];

export const metadata: Metadata = buildMetadata({
  title: M.metaTitle,
  description: M.metaDescription,
  path: `/${M.slug}`,
  // Misma OG dinámica que el blog, los casos de uso y las herramientas.
  ogImage: `${SITE_URL}/og/blog?title=${encodeURIComponent(M.metaTitle)}`,
  keywords: M.keywords,
});

// Estática: el contenido vive en src/lib/producto/data.ts y no toca la BD.
export const revalidate = 3600;

export default function Page() {
  return (
    <ProductoPage
      module={M}
      fontClass={inter.variable}
      hero={<AgendaHero />}
      mocks={{
        "agenda-1": <Agenda1 />,
        "agenda-2": <Agenda2 />,
        "agenda-3": <Agenda3 />,
        "agenda-4": <Agenda4 />,
      }}
    />
  );
}
