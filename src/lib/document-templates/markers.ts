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
}

export const DOCUMENT_MARKERS: readonly DocumentMarker[] = [
  { token: "[NOMBRE_PACIENTE]", labelKey: "nombrePaciente" },
  { token: "[EDAD_PACIENTE]", labelKey: "edadPaciente" },
  { token: "[EXPEDIENTE_PACIENTE]", labelKey: "expedientePaciente" },
  { token: "[NOMBRE_DOCTOR]", labelKey: "nombreDoctor" },
  { token: "[CEDULA_DOCTOR]", labelKey: "cedulaDoctor" },
  { token: "[NOMBRE_CLINICA]", labelKey: "nombreClinica" },
  { token: "[NOMBRE_REPRESENTANTE]", labelKey: "nombreRepresentante" },
  { token: "[PARENTESCO_REPRESENTANTE]", labelKey: "parentescoRepresentante" },
  { token: "[LUGAR]", labelKey: "lugar" },
  { token: "[FECHA]", labelKey: "fecha" },
];
