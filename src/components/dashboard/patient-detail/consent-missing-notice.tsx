"use client";
// Aviso de datos incompletos en la carta de consentimiento.
//
// El aviso en sí ya no vive aquí: es el COMÚN de los documentos del paciente
// (`documentos-paciente/aviso-datos-faltantes`), el mismo que usa la nota de
// evolución. Este archivo se queda como la puerta de siempre de la carta: hoy la
// usa la hoja en blanco del alta (`consent-editor`).
//
// Es un aviso, NO un bloqueo: el botón de crear sigue activo. Una carta
// incompleta es mejor que ninguna; lo que no puede pasar es que el doctor se
// entere de lo que falta cuando el paciente ya la tiene en la mano.

import { AvisoDatosFaltantes } from "@/components/dashboard/documentos-paciente/aviso-datos-faltantes";
import type { ConsentMissingItem } from "@/lib/consent/document-data";

export function ConsentMissingNotice({
  missing, patientId,
}: {
  missing: ConsentMissingItem[];
  patientId: string;
}) {
  return <AvisoDatosFaltantes faltantes={missing} patientId={patientId} documento="carta" />;
}
