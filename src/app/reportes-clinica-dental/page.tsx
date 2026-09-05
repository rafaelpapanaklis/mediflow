import type { Metadata } from "next";
import { inter } from "@/fonts/inter-400-800";
import { buildMetadata, SITE_URL } from "@/lib/seo";
import { PRODUCTO_MODULES } from "@/lib/producto/data";
import { ProductoPage } from "@/components/producto/producto-page";
import { ReportesHero, Reportes1, Reportes2, Reportes3, Reportes4 } from "@/components/producto/mockups/reportes";
import "../producto.css";

const M = PRODUCTO_MODULES["reportes-clinica-dental"];

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
      hero={<ReportesHero />}
      mocks={{
        "reportes-1": <Reportes1 />,
        "reportes-2": <Reportes2 />,
        "reportes-3": <Reportes3 />,
        "reportes-4": <Reportes4 />,
      }}
    />
  );
}
