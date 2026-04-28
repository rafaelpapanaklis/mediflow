export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { TvOperationalView } from "./operational-view";
import { TvMarketingView } from "./marketing-view";
import { TvHybridView } from "./hybrid-view";

interface PageProps {
  params: { slug: string };
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
