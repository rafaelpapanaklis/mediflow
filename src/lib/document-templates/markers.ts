// Los marcadores que se pueden escribir en una plantilla. NO es una sintaxis
// nueva: son los mismos `[NOMBRE_PACIENTE]`… que ya sustituye
// `interpolateConsent` (src/lib/consent/templates.ts). Esta lista existe para
// ENSEÑARLOS en el popup; el test `document-templates.test.ts` comprueba que
// cada uno de aquí lo sustituye de verdad `interpolateConsent`, para que la
// lista no prometa un marcador que no funciona.
//
// Sin imports a propósito: el popup (cliente) lo carga y no debe arrastrar el
// catálogo de cartas de consentimiento. Rellenar vive en ./interpolate.ts.

export interface DocumentMarker {
  /** Lo que se escribe en el texto, con corchetes. */
  token: string;
  /** Clave i18n bajo `plantillas.marcadores`. */
  labelKey: string;
  /**
   * C-123 (ws1-t8): solo tiene sentido en una carta de consentimiento (quién
   * firma por el paciente y dónde). Una nota de evolución no los ofrece.
   */
  soloConsentimiento?: boolean;
}

export const DOCUMENT_MARKERS: readonly DocumentMarker[] = [
  { token: "[NOMBRE_PACIENTE]", labelKey: "nombrePaciente" },
  { token: "[EDAD_PACIENTE]", labelKey: "edadPaciente" },
  { token: "[EXPEDIENTE_PACIENTE]", labelKey: "expedientePaciente" },
  { token: "[NOMBRE_DOCTOR]", labelKey: "nombreDoctor" },
  { token: "[CEDULA_DOCTOR]", labelKey: "cedulaDoctor" },
  { token: "[NOMBRE_CLINICA]", labelKey: "nombreClinica" },
  { token: "[NOMBRE_REPRESENTANTE]", labelKey: "nombreRepresentante", soloConsentimiento: true },
  { token: "[PARENTESCO_REPRESENTANTE]", labelKey: "parentescoRepresentante", soloConsentimiento: true },
  { token: "[LUGAR]", labelKey: "lugar", soloConsentimiento: true },
  { token: "[FECHA]", labelKey: "fecha" },
];

/** Los marcadores que se ofrecen al escribir una plantilla de ese tipo. */
export function marcadoresPara(kind: string): readonly DocumentMarker[] {
  return kind === "CONSENTIMIENTO" ? DOCUMENT_MARKERS : DOCUMENT_MARKERS.filter((m) => !m.soloConsentimiento);
}
