// Vista previa de plantillas de landing (la abre /dashboard/landing).
// Ruta DINÁMICA a propósito: aquí SÍ se leen searchParams (?preview=) —
// en /[slug] (ISR) eso lanzaba DYNAMIC_SERVER_USAGE al regenerar.
export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { hasPermission } from "@/lib/auth/permissions";
import { ClinicLandingServer } from "../../[slug]/clinic-landing-server";

export const metadata: Metadata = {
  title: "Vista previa — DaleControl",
  robots: { index: false, follow: false },
};

interface Props {
  params: { slug: string };
  searchParams?: { preview?: string; edit?: string; borrador?: string };
}

/**
 * ¿Quien está mirando puede EDITAR esta mini-web desde el lienzo?
 *
 * Tres condiciones, y las tres mandan:
 *   1. Hay sesión (esta ruta no pasa por el middleware — ver src/middleware.ts:
 *      el matcher no incluye /landing-preview —, así que se comprueba aquí).
 *   2. La sesión es de ESTA clínica. El slug viene de la URL y es público:
 *      sin este check, cualquier clínica con sesión abriría el lienzo de otra.
 *   3. Tiene "landing.edit". No "landing.view": un usuario de solo lectura
 *      hereda todas las keys *.view, y abrirle el editor sería regalarle una
 *      pantalla donde cada guardado responde 403.
 *
 * Ocultar el botón no es un gate: el gate es este, y el del PATCH.
 */
async function permitirEdicion(slug: string): Promise<boolean> {
  return sesionDeEstaClinicaCon(slug, "landing.edit");
}

/**
 * ¿Quien está mirando puede ver la mini-web AUNQUE NO ESTÉ PUBLICADA?
 *
 * Es la vista previa de Página web → Plantilla (?borrador=1). Sin esto, la
 * clínica que todavía no publica veía el cartel de «disponible pronto» en vez
 * de la plantilla que estaba eligiendo — justo la que más necesita verla.
 *
 * Mismas dos primeras condiciones que el lienzo (sesión, y de ESTA clínica),
 * pero con "landing.view": es el permiso que ya abre /dashboard/landing, y
 * aquí solo se MIRA. No enciende el editor y no publica nada: landingActive
 * no se toca, y el visitante sin sesión sigue viendo el cartel.
 */
async function permitirBorrador(slug: string): Promise<boolean> {
  return sesionDeEstaClinicaCon(slug, "landing.view");
}

async function sesionDeEstaClinicaCon(slug: string, permiso: "landing.edit" | "landing.view"): Promise<boolean> {
  const ctx = await getAuthContext();
  if (!ctx) return false;
  const clinica = await prisma.clinic.findUnique({ where: { slug }, select: { id: true } });
  if (!clinica || clinica.id !== ctx.clinicId) return false;
  return hasPermission({ role: ctx.role as any, permissionsOverride: ctx.permissionsOverride }, permiso);
}

export default async function LandingPreviewPage({ params, searchParams }: Props) {
  const pedido = searchParams?.edit === "1";
  const edit = pedido ? await permitirEdicion(params.slug) : false;
  // Con edit ya concedido el cartel de «pronto» no sale: no se pregunta dos veces.
  const borrador = !edit && searchParams?.borrador === "1" ? await permitirBorrador(params.slug) : false;

  return (
    // live: aquí (y solo aquí) se escucha al editor por postMessage para
    // repintar sin recargar mientras la clínica escribe.
    <ClinicLandingServer
      slug={params.slug}
      previewTpl={searchParams?.preview}
      live
      edit={edit}
      borrador={borrador}
    />
  );
}
