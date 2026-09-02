import { ImageResponse } from "next/og";
import { EDU_BRAND, EDU_LANDING_SEO, EDU_VERTICAL } from "@/lib/edu/marketing";
import { EduOgArtwork } from "@/components/public/instituciones/og-artwork";

/** La MISMA pieza que opengraph-image: X pide su propia etiqueta. */
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
