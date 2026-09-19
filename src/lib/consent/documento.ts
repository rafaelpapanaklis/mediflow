// ─────────────────────────────────────────────────────────────────────────────
// La carta de consentimiento VISTA COMO DOCUMENTO en el panel.
//
// La hoja, la barra de acciones y la copia que se imprime son las COMUNES de los
// documentos del paciente (`components/dashboard/documentos-paciente`). Aquí solo
// se arma lo que esa hoja necesita a partir de una fila de `consent_forms`, y lo
// que la carta tiene y la nota de evolución no: DOS firmas (más testigos), el
// representante legal, la revocación y la evidencia de la firma electrónica.
//
// Vale para cualquier fila, también las del sistema viejo: sin `contentHash`,
// sin `doctorId`, con el texto escrito a mano y sin secciones numeradas. Ninguna
// de esas ausencias puede tumbar la pantalla ni imprimir "undefined".
//
// Sale de los MISMOS datos que el PDF (`loadConsentDocumento` en
// `consent-pdf.ts`) y con las mismas reglas (`buildSignatureBlocks`), para que lo
// que se ve en pantalla, lo que se imprime y lo que se descarga no discrepen.
//
// PURO: sin Prisma, sin React y sin red.
// ─────────────────────────────────────────────────────────────────────────────

import type { EncabezadoDocumento } from "@/components/dashboard/documentos-paciente/tipos";
import type { ConsentSignatureBlock } from "@/lib/pdf/consent-document";
import {
  RAYA_PARA_LLENAR, datosFaltantes, valorCapturado, type DatoFaltante,
} from "@/lib/patient-documents/faltantes";
import { formatConsentDate, formatConsentDateTime } from "./dates";
import { parseConsentText } from "./render";
import { consentTextToBodyHtml } from "./template-html";
import { consentStatus, type ConsentStatus } from "./types";

/** Lo que se lee de la base para pintar la carta. Todo puede faltar menos el texto. */
export interface ConsentDocumentSource {
  id: string;
  procedure: string;
  content: string;
  createdAt: Date;
  expiresAt: Date;
  timeZone: string;

  clinicName: string;
  clinicAddress: string | null;
  clinicCity: string | null;
  clinicPhone: string | null;
  clinicLogoUrl: string | null;

  patientName: string;
  patientNumber: string | null;
  patientCurp: string | null;
  patientCurpStatus: string | null;

  signerName: string | null;
  signerRelation: string | null;

  /** "" si el doctor ya no existe o la carta vieja no lo guardó. */
  doctorName: string;
  doctorLicense: string | null;
  doctorSpecialtyLicense: string | null;
  doctorSpecialty: string | null;

  signedAt: Date | null;
  doctorSignedAt: Date | null;
  revokedAt: Date | null;
  revokedReason: string | null;
  contentHash: string | null;
  signedIp: string | null;
}

/** Una firma del pie, ya con su fecha formateada en la zona de la clínica. */
export interface ConsentFirmaDTO {
  role: string;
  name: string;
  /** Imagen de la firma (data URL). `null` = línea en blanco. */
  imagen: string | null;
  /** "18/09/2026 09:30 a.m." o `null` si esa persona no ha firmado. */
  firmadoEl: string | null;
}

export interface ConsentDocumentoDTO {
  id: string;
  status: ConsentStatus;
  titulo: string;
  /**
   * El título que trae el PROPIO texto ("CARTA DE CONSENTIMIENTO INFORMADO"), que
   * la hoja pinta de sello sobre el título para que la carta salga íntegra.
   * `null` si el texto no lo trae: la pantalla pone el suyo.
   */
  tipo: string | null;
  encabezado: EncabezadoDocumento;
  /** El texto de la carta como HTML de etiquetas sin atributos y texto escapado. */
  html: string;
  representante: { nombre: string; relacion: string | null } | null;
  firmas: ConsentFirmaDTO[];
  /** Sin firmar: la hoja es la que se imprime para firmar con bolígrafo. */
  paraPapel: boolean;
  firmaPaciente: boolean;
  firmaDoctor: boolean;
  revocado: { fecha: string; motivo: string | null } | null;
  evidencia: { huella: string | null; firmadoEl: string | null; ip: string | null };
  faltantes: DatoFaltante[];
}

/** Calle y ciudad en un renglón, o `null` si no hay calle (la ciudad sola no es una dirección). */
export function direccionDeClinica(address: string | null, city: string | null): string | null {
  const calle = valorCapturado(address);
  if (!calle) return null;
  return [calle, valorCapturado(city)].filter(Boolean).join(", ");
}

export function buildConsentDocumento(
  src: ConsentDocumentSource,
  signatures: ConsentSignatureBlock[],
  now: Date = new Date(),
): ConsentDocumentoDTO {
  const tz = src.timeZone;
  // Carta vieja sin doctor guardado, o doctor que ya no está en la clínica.
  const sinDoctor = !valorCapturado(src.doctorName);
  return {
    id: src.id,
    status: consentStatus(src, now),
    titulo: valorCapturado(src.procedure) || "Consentimiento informado",
    tipo: parseConsentText(src.content).title || null,
    encabezado: {
      pacienteNombre: src.patientName,
      fecha: formatConsentDate(src.createdAt, tz),
      clinicaNombre: valorCapturado(src.clinicName) || "Clínica",
      logoUrl: valorCapturado(src.clinicLogoUrl) || null,
      // La hoja común pinta el nombre tal cual: sin doctor iría un hueco MUDO donde
      // el PDF pone la raya. Hoja y PDF no pueden discrepar, así que va la raya.
      doctorNombre: sinDoctor ? RAYA_PARA_LLENAR : valorCapturado(src.doctorName),
      cedula: valorCapturado(src.doctorLicense) || null,
      clinicaDireccion: direccionDeClinica(src.clinicAddress, src.clinicCity),
      clinicaTelefono: valorCapturado(src.clinicPhone) || null,
      doctorEspecialidad: valorCapturado(src.doctorSpecialty) || null,
      doctorCedulaEspecialidad: valorCapturado(src.doctorSpecialtyLicense) || null,
      pacienteNumero: valorCapturado(src.patientNumber) || null,
      pacienteCurp: valorCapturado(src.patientCurp).toUpperCase() || null,
      pacienteSinCurp: src.patientCurpStatus === "FOREIGN",
    },
    html: consentTextToBodyHtml(src.content),
    representante: valorCapturado(src.signerName)
      ? { nombre: valorCapturado(src.signerName), relacion: valorCapturado(src.signerRelation) || null }
      : null,
    firmas: signatures.map((b) => ({
      role: b.role,
      name: b.name,
      imagen: b.dataUrl,
      firmadoEl: b.signedAt ? formatConsentDateTime(b.signedAt, tz) : null,
    })),
    paraPapel: !src.signedAt,
    firmaPaciente: Boolean(src.signedAt),
    firmaDoctor: Boolean(src.doctorSignedAt),
    revocado: src.revokedAt
      ? { fecha: formatConsentDateTime(src.revokedAt, tz), motivo: valorCapturado(src.revokedReason) || null }
      : null,
    evidencia: {
      huella: valorCapturado(src.contentHash) || null,
      firmadoEl: src.signedAt ? formatConsentDateTime(src.signedAt, tz) : null,
      ip: valorCapturado(src.signedIp) || null,
    },
    faltantes: datosFaltantes({
      clinicAddress: src.clinicAddress,
      clinicLogoUrl: src.clinicLogoUrl,
      doctorLicense: src.doctorLicense,
      doctorSpecialty: src.doctorSpecialty,
      patientCurp: src.patientCurp,
      patientCurpStatus: src.patientCurpStatus,
      // Sin doctor en la carta no hay a quién capturarle la cédula en Equipo: ese
      // aviso mandaría a recepción a corregir algo que desde ahí no se corrige.
    }).filter((f) => !(sinDoctor && f.fixIn === "team")),
  };
}
