// La forma de lo que devuelve /api/patient-documents, vista desde el cliente
// (las fechas llegan como cadena). El cliente no importa el servicio: ese
// archivo arrastra Prisma.

import type { DatoFaltante } from "@/lib/patient-documents/faltantes";
import type { EncabezadoDocumento } from "@/components/dashboard/documentos-paciente/tipos";

/** El aviso de lo que falta es el común de los documentos del paciente. */
export type Faltante = DatoFaltante;

/** La cabecera de la nota ES la de cualquier documento del paciente. */
export type EncabezadoNota = EncabezadoDocumento;

export interface NotaResumen {
  id: string;
  title: string;
  status: "DRAFT" | "SIGNED" | string;
  signedAt: string | null;
  createdAt: string;
  doctorId: string;
  doctorNombre: string;
  fecha: string;
}

export interface NotaCompleta extends NotaResumen {
  body: string;
  encabezado: EncabezadoNota;
  faltantes: Faltante[];
}

export interface PreviewNota {
  /** `null` = hoja en blanco: no salió de ninguna plantilla. */
  templateId: string | null;
  /** El nombre de la plantilla; vacío en la hoja en blanco. */
  title: string;
  /** El título que llevará la nota si el doctor no escribe uno. */
  tituloPorDefecto: string;
  body: string;
  encabezado: EncabezadoNota;
  faltantes: Faltante[];
}

export interface PlantillaNota {
  id: string;
  name: string;
}
