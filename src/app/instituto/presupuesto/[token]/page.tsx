export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getEduQuotePorToken } from "@/lib/edu/presupuestos";
import { EduPresupuestoPublico } from "@/components/edu/dinero/presupuesto-publico";
import "../../edu-theme.css";

export const metadata: Metadata = {
  title: "Presupuesto",
  // 🔴 Un documento con el importe de un tratamiento NO se indexa.
  robots: { index: false, follow: false, nocache: true },
};

/**
 * ═══════════════════════════════════════════════════════════════════════
 * /instituto/presupuesto/[token] — el presupuesto que abre el PACIENTE.
 *
 * 🔴 VIVE FUERA DEL GRUPO (panel), y eso es TODO el diseño. El guard
 * autoritativo del vertical es `src/app/instituto/(panel)/layout.tsx`: sin
 * sesión de instituto, a la calle. Esta ruta cuelga de /instituto pero NO
 * del grupo (panel), así que no pasa por él — exactamente igual que
 * `/instituto/consentimiento/[token]`, que es la hermana de ésta y de la
 * que se copió el patrón. Meterla dentro del grupo mandaría al paciente al
 * login del instituto, donde no tiene cuenta.
 *
 * 🔴 EL TOKEN ES LA CREDENCIAL. No hay sesión, no hay permiso y no hay
 * institutionId que comprobar: quien tiene la liga ve el presupuesto. Por
 * eso lo que se devuelve es el MÍNIMO —folio, título, partidas, importes
 * y vigencia— y NO lleva ni el nombre del paciente, ni el caso, ni el
 * instituto, ni un id interno: una URL con token que se comparte por
 * WhatsApp acaba en más manos de las previstas.
 *
 * `force-dynamic` no es una precaución genérica: el estado del
 * presupuesto cambia (se acepta, se cancela, vence) y una página cacheada
 * le enseñaría al paciente un botón de aceptar sobre algo que ya aceptó.
 *
 * ⚠️ Un token con forma inválida y uno que no existe dan el MISMO 404
 * (`getEduQuotePorToken` devuelve null en los dos casos): cualquier
 * diferencia entre ellos es un oráculo para ir adivinando tokens.
 * ═══════════════════════════════════════════════════════════════════════
 */
export default async function PresupuestoPublicoPage({
  params,
}: {
  params: { token: string };
}) {
  const vista = await getEduQuotePorToken(params.token);
  if (!vista) notFound();

  return <EduPresupuestoPublico token={params.token} inicial={vista} />;
}
