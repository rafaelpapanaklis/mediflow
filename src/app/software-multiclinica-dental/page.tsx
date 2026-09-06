import type { Metadata } from "next";
import { inter } from "@/fonts/inter-400-800";
import { buildMetadata, SITE_URL } from "@/lib/seo";
import { PRODUCTO_MODULES } from "@/lib/producto/data";
import { ProductoPage } from "@/components/producto/producto-page";
import { MultisedeHero, Multisede1, Multisede2, Multisede3, Multisede4 } from "@/components/producto/mockups/multisede";
import "../producto.css";

const M = PRODUCTO_MODULES["software-multiclinica-dental"];

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
      hero={<MultisedeHero />}
      mocks={{
        "multisede-1": <Multisede1 />,
        "multisede-2": <Multisede2 />,
        "multisede-3": <Multisede3 />,
        "multisede-4": <Multisede4 />,
      }}
    />
  );
}
