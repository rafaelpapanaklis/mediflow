import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PlantillaBarberWeb } from "@/components/barber/templates";
import { rutaWebBarberia } from "@/lib/barber/landing";
import { cargarBarberWeb, cargarSeoBarberWeb } from "./_shared/shop-data";
import { descripcionSeo, imagenSocial, jsonLdBarberia, serializarJsonLd, tituloSeo } from "./_shared/seo";

/* ═══════════════════════════════════════════════════════════════════════
   LA PÁGINA WEB DE UNA BARBERÍA.

   ── CACHÉ: ISR de 5 minutos + revalidación AL GUARDAR ─────────────
   `revalidate` sin `generateStaticParams` NO enciende ISR en Next 14: la
   ruta se queda como `ƒ (Dynamic)` y se invoca en cada visita. Con
   `generateStaticParams` devolviendo [] no se prerenderiza nada en el
   build, pero cada slug se genera en su primera visita y queda cacheado
   — que es justo lo que queremos con miles de barberías, de las que no
   sabemos los slugs en tiempo de build.

   El otro lado del trato: /api/barber/landing llama a
   `revalidatePath("/b/<slug>")` en CADA guardado. Sin eso, la barbería
   cambia un texto, entra a ver su página, no ve el cambio y da por
   perdido lo que escribió. Ese fue exactamente el bug de "tarda cinco
   minutos" del editor dental, y el motivo de que aquí no se pueda
   quitar la revalidación sin quitar también el caché.

   ── NO SE LEEN searchParams ───────────────────────────────────────
   Leerlos en una ruta ISR lanza DYNAMIC_SERVER_USAGE al regenerar y
   devuelve un 500 al visitante. La vista previa NO vive aquí: vive
   dentro del editor, que pinta la misma plantilla con los mismos datos
   en el navegador.
   ═══════════════════════════════════════════════════════════════════════ */

export const revalidate = 300;
export const dynamicParams = true;

export function generateStaticParams(): { slug: string }[] {
  // Vacío a propósito: nada se prerenderiza en el build. Ver la cabecera.
  return [];
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.dalecontrol.com";

interface Props {
  params: { slug: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const seo = await cargarSeoBarberWeb(params.slug);
  if (!seo) return { title: "Barbería no encontrada", robots: { index: false, follow: false } };

  const url = `${SITE_URL}${rutaWebBarberia(seo.slug)}`;
  const title = tituloSeo(seo.name, seo.city, seo.config);
  const description = descripcionSeo(seo.name, seo.city, seo.config);
  const imagen = imagenSocial(seo.config, seo.logoUrl);

  return {
    title,
    description,
    alternates: { canonical: url },
    // Una barbería que apagó su web no debe quedarse indexada.
    robots: seo.config.oculta ? { index: false, follow: false } : { index: true, follow: true },
    openGraph: {
      type: "website",
      locale: "es_MX",
      url,
      siteName: seo.name,
      title,
      description,
      images: imagen ? [imagen] : [],
    },
    twitter: {
      card: imagen ? "summary_large_image" : "summary",
      title,
      description,
      images: imagen ? [imagen] : [],
    },
  };
}

export default async function PaginaBarberia({ params }: Props) {
  const carga = await cargarBarberWeb(params.slug);
  if (!carga) notFound();

  // Apagada a propósito desde el editor. No es un 404: el slug existe y la
  // barbería puede volver a encenderla en un clic, así que se le deja al
  // visitante una salida (el teléfono) en vez de una pared.
  if (carga.oculta) {
    return (
      <main
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: 24,
          textAlign: "center",
          background: "#14100e",
          color: "#f7f1e8",
          fontFamily: "var(--font-sans), system-ui, sans-serif",
        }}
      >
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 8 }}>{carga.data.shop.name}</h1>
          <p style={{ opacity: 0.72, marginBottom: 22 }}>Nuestra página estará disponible muy pronto.</p>
          {carga.data.shop.phone && (
            <a
              href={`tel:${carga.data.shop.phone}`}
              style={{
                display: "inline-block",
                background: "#A2612F",
                color: "#fff",
                padding: "13px 24px",
                borderRadius: 999,
                fontWeight: 650,
              }}
            >
              Llamar para reservar
            </a>
          )}
        </div>
      </main>
    );
  }

  const ld = jsonLdBarberia({
    shop: carga.data.shop,
    config: carga.data.config,
    servicios: carga.data.servicios,
    url: `${SITE_URL}${rutaWebBarberia(carga.data.shop.slug)}`,
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializarJsonLd(ld) }}
      />
      <PlantillaBarberWeb data={carga.data} />
    </>
  );
}
