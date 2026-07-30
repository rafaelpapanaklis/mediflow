// ISR en vez de force-dynamic: esta página es SOLO el cascarón (resuelve el
// display por slug y elige la vista). Los datos vivos los pide el cliente:
// TvOperationalView pollea /api/tv/[slug]/operational cada 15 s, y las vistas
// de marketing/híbrida son client components que se alimentan de `config`.
// Antes cada recarga de cada pantalla era 1 invocación + 1 query a Supabase;
// una TV que se reinicia en bucle podía martillear el pooler ella sola.
// Contrapartida aceptada: cambiar el modo o la config de un display tarda
// hasta 60 s en verse en la pantalla.
export const revalidate = 60;

import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { TvOperationalView } from "./operational-view";
import { TvMarketingView } from "./marketing-view";
import { TvHybridView } from "./hybrid-view";

interface PageProps {
  params: { slug: string };
}

/**
 * Vacío A PROPÓSITO: los slugs viven en la BD, no hay ninguno que prerenderizar
 * en build. Pero sin `generateStaticParams` Next NO registra la ruta en el
 * prerender-manifest y `revalidate` no aplica: quedaría como ƒ (Dynamic) y cada
 * recarga seguiría siendo una invocación. Con esto, la primera visita a cada
 * pantalla la genera y las siguientes se sirven de caché durante 60 s.
 * (Mismo patrón que las landings de clínica en /[slug].)
 */
export function generateStaticParams(): { slug: string }[] {
  return [];
}

/**
 * /tv/[slug] — vista pública para pantallas TV. NO requiere auth (es la
 * pantalla de sala de espera). Pero TODAS las queries derivan clinicId
 * desde el TVDisplay row encontrado por publicSlug — ÚNICA excepción al
 * patrón "clinicId desde getCurrentUser" del resto del proyecto.
 *
 * Si el slug no existe o el display está inactivo → 404.
 *
 * El resto de queries internas usan ese clinicId trusted (validado contra
 * la base por FK y unique slug). No hay forma de leer datos de OTRA clínica.
 */
export default async function TvPublicPage({ params }: PageProps) {
  const display = await prisma.tVDisplay.findUnique({
    where: { publicSlug: params.slug },
    select: {
      id: true,
      clinicId: true,
      name: true,
      mode: true,
      config: true,
      active: true,
      clinic: {
        select: { name: true, logoUrl: true, timezone: true },
      },
    },
  });

  if (!display || !display.active) {
    notFound();
  }

  const clinicId = display.clinicId;
  const config = (display.config ?? {}) as Record<string, unknown>;

  switch (display.mode) {
    case "OPERATIONAL":
      return <TvOperationalView clinicId={clinicId} clinicName={display.clinic.name} clinicLogo={display.clinic.logoUrl} config={config} />;
    case "MARKETING":
      return <TvMarketingView clinicName={display.clinic.name} clinicLogo={display.clinic.logoUrl} config={config} />;
    case "HYBRID":
      return <TvHybridView clinicId={clinicId} clinicName={display.clinic.name} clinicLogo={display.clinic.logoUrl} config={config} />;
    default:
      notFound();
  }
}
