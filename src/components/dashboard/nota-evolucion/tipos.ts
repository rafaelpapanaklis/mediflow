// La forma de lo que devuelve /api/patient-documents, vista desde el cliente
// (las fechas llegan como cadena). El cliente no importa el servicio: ese
// archivo arrastra Prisma.

export type Faltante = "cedula" | "logo";

export interface EncabezadoNota {
  pacienteNombre: string;
  fecha: string;
  clinicaNombre: string;
  logoUrl: string | null;
  doctorNombre: string;
  cedula: string | null;
}

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
  templateId: string;
  title: string;
  body: string;
  encabezado: EncabezadoNota;
  faltantes: Faltante[];
}

export interface PlantillaNota {
  id: string;
  name: string;
}
