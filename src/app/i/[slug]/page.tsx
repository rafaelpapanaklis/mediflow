import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/blog/json-ld";
import { PlantillaRealtyWeb } from "@/components/realty/web";
import { rutaWebInmobiliaria } from "@/lib/realty/landing";
import { cargarSeoRealty, cargarWebRealty } from "./_shared/data";
import { descripcionSeo, imagenSocial, jsonLdCuenta, metadataDe, tituloSeo } from "./_shared/seo";
import { WebApagada } from "@/components/realty/web/apagada";

/* ═══════════════════════════════════════════════════════════════════════
   LA PORTADA DE LA WEB PÚBLICA DE UNA CUENTA DE INMUEBLES.

   ── CACHÉ: ISR de 5 minutos + revalidación AL PUBLICAR ────────────
   `revalidate` sin `generateStaticParams` NO enciende ISR en Next 14: la
   ruta se queda como `ƒ (Dynamic)` y se invoca en cada visita. Con
   `generateStaticParams` devolviendo [] no se prerenderiza nada en el
   build —y no hace falta base de datos para compilar—, pero cada slug se
   genera en su primera visita y queda cacheado.

   El otro lado del trato: PATCH /api/realty/landing llama a
   `revalidatePath("/i/<slug>")` en CADA guardado que entra. Sin eso, la
   inmobiliaria cambia un texto, entra a ver su página, no lo ve y da por
   perdido lo que escribió. Ese fue exactamente el bug de "tarda cinco
   minutos" del editor dental, y por eso aquí no se puede quitar la
   revalidación sin quitar también el caché.

   ── NO SE LEEN searchParams ───────────────────────────────────────
   Leerlos en una ruta ISR lanza DYNAMIC_SERVER_USAGE al regenerar y
   devuelve un 500 al visitante. El buscador con filtros vive en
   /propiedades, que sí es dinámica. La vista previa vive dentro del
   editor, que pinta la MISMA plantilla con los MISMOS datos.
   ═══════════════════════════════════════════════════════════════════════ */

export const revalidate = 300;
export const dynamicParams = true;

export function generateStaticParams(): { slug: string }[] {
  // Vacío a propósito: nada se prerenderiza en el build. Ver la cabecera.
  return [];
}

interface Props {
  params: { slug: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const seo = await cargarSeoRealty(params.slug);
  if (!seo) {
    return { title: "Página no encontrada", robots: { index: false, follow: false } };
  }
  return metadataDe({
    titulo: tituloSeo(seo.cuenta, seo.config),
    descripcion: descripcionSeo(seo.cuenta, seo.config),
    ruta: rutaWebInmobiliaria(seo.cuenta.slug),
    imagen: imagenSocial(seo.config, seo.cuenta),
    indexable: seo.indexable,
    nombre: seo.cuenta.nombre,
  });
}

export default async function PaginaWebInmuebles({ params }: Props) {
  const carga = await cargarWebRealty(params.slug);
  if (!carga) notFound();

  // Apagada a propósito desde el editor. NO es un 404: el slug existe y la
  // cuenta la enciende otra vez en un clic, así que al visitante se le deja
  // una salida (el teléfono) en vez de una pared.
  if (!carga.publicada) {
    return <WebApagada data={carga.data} />;
  }

  return (
    <>
      <JsonLd data={jsonLdCuenta(carga.data.cuenta, carga.data.config)} />
      <PlantillaRealtyWeb data={carga.data} />
    </>
  );
}
