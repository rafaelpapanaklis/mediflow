/**
 * El enganche de «Sabina en todas partes» al panel.
 *
 * Existe para que `dashboard/layout.tsx` —el archivo más disputado del repo,
 * con el PR #265 encima— crezca UNA línea y nada más. Todo lo que hay que
 * saber del servidor para pintar el cajón se resuelve aquí:
 *   · si el catálogo trae acciones, que es lo único que cambia la línea de
 *     ayuda del composer («Sabina propone…» vs «Sabina solo lee…»).
 *
 * No consulta la base y no hace nada asíncrono: `ACCIONES_SABINA` es una lista
 * en memoria. Montarlo no cuesta ni una consulta ni un token.
 */

import { ACCIONES_SABINA } from "@/lib/sabina/engine-catalog";
import { SabinaPanel } from "./panel";

export function SabinaLanzador({
  clinicId,
  firstName,
  oculto = false,
}: {
  clinicId: string;
  firstName: string;
  /** Clínica suspendida: no se pinta (esa clínica solo ve la pantalla de pago). */
  oculto?: boolean;
}) {
  return (
    <SabinaPanel
      clinicId={clinicId}
      firstName={firstName}
      puedeProponer={ACCIONES_SABINA.length > 0}
      oculto={oculto}
    />
  );
}
