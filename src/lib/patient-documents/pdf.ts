// El PDF de un documento del paciente, a partir de DATOS PLANOS.
//
// Este archivo no sabe de Prisma ni de qué tabla salió el documento: recibe la
// foto congelada (cabecera + cuerpo guardado) y devuelve el archivo. Quien lo
// llama —la nota de evolución hoy, el consentimiento después— es quien lee su
// fila CON su `clinicId` y comprueba la visibilidad del paciente.

import { createElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { fetchClinicLogo } from "@/lib/pdf/clinic-letterhead";
import { PatientDocument, type PatientDocumentProps } from "@/lib/pdf/patient-document";

/** Lo que hace falta para imprimir un documento. Todo sale de SU foto guardada. */
export interface DocumentoParaPdf {
  id: string;
  /** "Nota de evolución", "Consentimiento informado"… */
  tipo: string;
  titulo: string;
  fecha: string;
  clinicaNombre: string;
  clinicaDireccion: string | null;
  clinicaTelefono: string | null;
  logoUrl: string | null;
  pacienteNombre: string;
  pacienteNumero: string | null;
  pacienteCurp: string | null;
  pacienteSinCurp: boolean;
  doctorNombre: string;
  cedula: string | null;
  doctorCedulaEspecialidad: string | null;
  doctorEspecialidad: string | null;
  /** HTML saneado, tal y como se guardó (y, si está firmado, como se firmó). */
  cuerpoHtml: string;
  firmado: boolean;
  /** Fecha-hora de la firma ya formateada en la zona de la clínica. */
  firmadoEl: string | null;
}

export type LogoDescargado = { dataUrl: string; aspect: number } | null;

/** De los datos a las props del PDF. Pura: la prueba la usa sin red. */
export function propsDelPdf(doc: DocumentoParaPdf, logo: LogoDescargado): PatientDocumentProps {
  return {
    clinicName: doc.clinicaNombre.trim() || "Clínica",
    // La dirección de la foto ya trae ciudad y estado: no se vuelven a pasar.
    clinicAddress: doc.clinicaDireccion,
    clinicPhone: doc.clinicaTelefono,
    clinicLogoDataUrl: logo?.dataUrl ?? null,
    clinicLogoAspect: logo?.aspect ?? null,
    kindLabel: doc.tipo,
    title: doc.titulo,
    date: doc.fecha,
    patientName: doc.pacienteNombre,
    patientNumber: doc.pacienteNumero,
    patientCurp: doc.pacienteCurp,
    patientHasNoCurp: doc.pacienteSinCurp,
    doctorName: doc.doctorNombre,
    doctorLicense: doc.cedula,
    doctorSpecialtyLicense: doc.doctorCedulaEspecialidad,
    doctorSpecialty: doc.doctorEspecialidad,
    bodyHtml: doc.cuerpoHtml,
    signed: doc.firmado,
    signedAtLabel: doc.firmadoEl,
  };
}

/** Nombre de archivo sin acentos ni espacios: viaja en una cabecera HTTP y por WhatsApp. */
export function nombreDeArchivo(doc: Pick<DocumentoParaPdf, "id" | "titulo">): string {
  const base = doc.titulo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "documento"}-${doc.id.slice(0, 8)}.pdf`;
}

export async function renderizarPdf(doc: DocumentoParaPdf, logo: LogoDescargado): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mismo cast que quote-pdf: los tipos de @react-pdf piden DocumentProps
  return renderToBuffer(createElement(PatientDocument, propsDelPdf(doc, logo)) as any);
}

/** El PDF listo para descargar o adjuntar. El logo se baja de la URL de la FOTO. */
export async function construirPdfDeDocumento(
  doc: DocumentoParaPdf,
): Promise<{ buffer: Buffer; fileName: string }> {
  const logo = await fetchClinicLogo(doc.logoUrl);
  return { buffer: await renderizarPdf(doc, logo), fileName: nombreDeArchivo(doc) };
}
