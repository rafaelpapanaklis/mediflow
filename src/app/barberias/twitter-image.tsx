import { ImageResponse } from "next/og";
import landingEs from "@/i18n/dictionaries/barber/landing.es.json";
import { BarberOgArtwork } from "@/components/public/barberias/og-artwork";

/** Misma pieza que opengraph-image: X/Twitter pide su propia etiqueta. */
export const runtime = "edge";
export const alt = landingEs.meta.ogAlt;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <BarberOgArtwork
        brand={landingEs.nav.brand}
        vertical={landingEs.nav.vertical}
        title={landingEs.meta.ogTitle}
        sub={landingEs.meta.ogSub}
      />
    ),
    { ...size },
  );
}
