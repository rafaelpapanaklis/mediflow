import { ImageResponse } from "next/og";
import { EDU_BRAND, EDU_LANDING_SEO, EDU_VERTICAL } from "@/lib/edu/marketing";
import { EduOgArtwork } from "@/components/public/instituciones/og-artwork";

/**
 * Imagen social de /instituciones (1200×630). Edge a propósito: no
 * necesita Prisma (ningún dato de la base va en la imagen) y el runtime
 * `nodejs` de next/og no arranca en el `next dev` de Windows.
 *
 * Los textos salen de src/lib/edu/marketing.ts, que es un módulo PURO: por
 * eso se puede importar desde aquí sin arrastrar nada del vertical al Edge.
 */
export const runtime = "edge";
export const alt = EDU_LANDING_SEO.ogAlt;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <EduOgArtwork
        brand={EDU_BRAND}
        vertical={EDU_VERTICAL}
        title={EDU_LANDING_SEO.ogTitle}
        sub={EDU_LANDING_SEO.ogSub}
      />
    ),
    { ...size },
  );
}
