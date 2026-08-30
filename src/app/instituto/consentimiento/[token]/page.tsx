export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getEduConsentPublic } from "@/lib/edu/consentimientos";
import { EduConsentimientoPublico } from "@/components/edu/consentimiento-publico";
import "../../edu-theme.css";

export const metadata: Metadata = {
  title: "Consentimiento informado",
  // 🔴 Un documento clínico con el nombre de un paciente NO se indexa.
  robots: { index: false, follow: false, nocache: true },
};

/**
 * ═══════════════════════════════════════════════════════════════════════
 * /instituto/consentimiento/[token] — la carta que abre el PACIENTE.
 *
 * 🔴 ESTA PÁGINA VIVE FUERA DEL GRUPO (panel), y eso es TODO el diseño.
 *
 * El guard autoritativo del vertical es
 * src/app/instituto/(panel)/layout.tsx: sin sesión de instituto, a la
 * calle. Esta ruta cuelga de /instituto pero NO del grupo (panel), así que
 * no pasa por él — exactamente como /instituto/login, que también es
 * pública. Meterla dentro del grupo mandaría al paciente al login del
 * instituto, donde no tiene cuenta.
 *
 * El middleware sí la ve (`/instituto/:path*`), pero lo único que hace en
 * ese caso es refrescar la cookie de Supabase; solo redirige en
 * /dashboard. Un visitante anónimo pasa.
 *
 * 🔴 EL TOKEN ES LA CREDENCIAL. No hay sesión, no hay permiso y no hay
 * institutionId que comprobar: quien tiene la liga ve la carta. Por eso el
 * contenido que se devuelve es el MÍNIMO (el texto, el procedimiento, los
 * nombres y las firmas) y no lleva ni un id interno ni una línea del
 * expediente.
 *
 * `force-dynamic` no es una precaución genérica: el estado de la carta
 * cambia (se firma, se revoca, caduca) y una página cacheada le enseñaría
 * al paciente un botón de firmar sobre algo que ya está firmado.
 *
 * ⚠️ Un token con forma inválida y uno que no existe dan el MISMO 404. Ver
 * `eduConsentTokenIsValid`: cualquier diferencia entre esos dos casos es un
 * oráculo para ir adivinando tokens.
 * ═══════════════════════════════════════════════════════════════════════
 */
export default async function ConsentimientoPublicoPage({
  params,
}: {
  params: { token: string };
}) {
  const vista = await getEduConsentPublic(params.token);
  if (!vista) notFound();

  return <EduConsentimientoPublico token={params.token} inicial={vista} />;
}
