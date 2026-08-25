import { ImageResponse } from "next/og";
import landingEs from "@/i18n/dictionaries/barber/landing.es.json";
import { BarberOgArtwork } from "@/components/public/barberias/og-artwork";

/**
 * Imagen social de /barberias (1200×630). Edge a propósito: no necesita
 * Prisma (ningún precio va en la imagen: cambia en la tabla sin redeploy) y
 * el runtime nodejs de next/og no arranca en el `next dev` de Windows.
 */
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
