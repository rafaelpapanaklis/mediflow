// Vista previa de plantillas de landing (la abre /dashboard/landing).
// Ruta DINÁMICA a propósito: aquí SÍ se leen searchParams (?preview=) —
// en /[slug] (ISR) eso lanzaba DYNAMIC_SERVER_USAGE al regenerar.
export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { ClinicLandingServer } from "../../[slug]/clinic-landing-server";

export const metadata: Metadata = {
  title: "Vista previa — DaleControl",
  robots: { index: false, follow: false },
};

interface Props {
  params: { slug: string };
  searchParams?: { preview?: string };
}

export default function LandingPreviewPage({ params, searchParams }: Props) {
  return (
    <ClinicLandingServer slug={params.slug} previewTpl={searchParams?.preview} />
  );
}
