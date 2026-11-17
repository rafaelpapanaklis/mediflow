import { ImageResponse } from "next/og";
import { NextResponse } from "next/server";
import { IconoTarjeta } from "@/components/barber/stars/icono-tarjeta";
import { datosDeInstalacion } from "@/lib/barber/tarjeta-instalar";
import { logoParaIcono } from "@/lib/barber/tarjeta-instalar-logo";
import { coloresDeTarjeta, esTamanoDeIcono, inicialDeTarjeta } from "@/lib/barber/tarjeta-instalar-core";

/**
 * GET /b/[slug]/tarjeta-icono/[size] — el ícono de la tarjeta de estrellas
 * para la pantalla de inicio (ws6-t2, punto 5). PNG cuadrado de 180, 192 o
 * 512 px: el logo de la barbería (PNG/JPEG de nuestro almacenamiento) o, si
 * no tiene, su inicial con una estrella, sobre el acento de su página.
 *
 * El mismo PNG sirve de ícono «maskable» en Android y de apple-touch-icon.
 * No lleva nada del cliente: se puede cachear para todos.
 */

export const dynamic = "force-dynamic";

export async function GET(_req: Request, props: { params: Promise<{ slug: string; size: string }> }) {
  const params = await props.params;
  if (!esTamanoDeIcono(params.size)) return new NextResponse(null, { status: 404 });
  const size = Number(params.size);

  const shop = await datosDeInstalacion(params.slug);
  if (!shop) return new NextResponse(null, { status: 404 });

  const c = coloresDeTarjeta(shop.template, shop.acento);
  const logo = await logoParaIcono(shop.logoUrl);
  const inicial = inicialDeTarjeta(shop.name);

  return new ImageResponse(
    <IconoTarjeta size={size} inicial={inicial === "★" ? "" : inicial} logo={logo} fondo={c.tema} tinta={c.sobreTema} />,
    {
      width: size,
      height: size,
      headers: {
        // El logo cambia poco: un día en el navegador y en la CDN.
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
        "X-Robots-Tag": "noindex",
      },
    },
  );
}
