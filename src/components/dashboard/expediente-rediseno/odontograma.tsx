"use client";

import { OdontogramV2 } from "@/components/dashboard/odontogram-v2/App";
import { RaizExpediente } from "./raiz";
import s from "./expediente.module.css";

/**
 * El Odontograma del expediente con el marco vestido.
 *
 * El odontograma es un lienzo clínico (`odontogram-v2/`) con su propia hoja
 * global y su propia lógica de guardado: aquí NO se toca nada de eso. Este
 * componente solo lo envuelve en `.marcoOdontograma`, cuyas reglas
 * (`expediente.module.css`) visten la barra de título y sus controles, la
 * cabecera del lienzo, la leyenda, la paleta y el panel lateral del diente.
 * El dibujo —celdas, números, glifos, caras y escenas 2D/3D— se pinta
 * exactamente igual que sin el rediseño.
 *
 * `dedupeLegend` y `edgeScrollHint` van encendidos porque ya lo iban con la
 * bandera antes de esta ola (patient-detail-client.tsx los pasaba como
 * `rediseno`).
 */
export function OdontogramaExpediente({ patientId }: { patientId: string }) {
  return (
    <RaizExpediente className={s.marcoOdontograma}>
      <OdontogramV2 patientId={patientId} dedupeLegend edgeScrollHint />
    </RaizExpediente>
  );
}
