import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export type CommandGroup =
  | "paciente-activo"
  | "pacientes"
  | "citas"
  | "facturas"
  | "acciones"
  | "ir-a";

export interface CommandItem {
  id: string;
  group: CommandGroup;
  label: string;
  /** Render enriquecido del título (ej. folio en mono + nombre del paciente).
   *  `label` se conserva SIEMPRE como texto plano: es lo que leen el fuzzy y
   *  los lectores de pantalla. */
  labelNode?: ReactNode;
  /** Contenido alineado a la derecha de la fila (importe, estado). */
  trailing?: ReactNode;
  sub?: string;
  icon?: LucideIcon;
  shortcut?: string;
  tone?: "brand" | "success" | "warning" | "danger" | "info" | "neutral";
  run: (ctx: CommandContext) => void | Promise<void>;
  keywords?: string[];
}

export interface CommandContext {
  close: () => void;
  push: (href: string) => void;
  activeConsultPatientId: string | null;
  /** Abren los diálogos MODERNOS (provider en el layout root) en vez de navegar
   *  a la página legacy con ?new=1. Opcionales: si el ctx no los provee, las
   *  acciones caen al push legacy. */
  openNewAppointment?: () => void;
  openNewPatient?: () => void;
}

/** Payload CRUDO de GET /api/dashboard/search — refleja 1:1 lo que devuelve la
 *  ruta. El armado del título, el href y el formato de importe/fecha vive en el
 *  palette, que es quien tiene locale y diccionario. */
export interface RemoteSearchResult {
  patients?: Array<{
    id: string;
    firstName: string;
    lastName: string;
    patientNumber: string | null;
    phone: string | null;
  }>;
  appointments?: Array<{
    id: string;
    /** YYYY-MM-DD ya resuelto en la zona horaria de la clínica. */
    date: string;
    /** HH:MM en la zona de la clínica. */
    startTime: string;
    patientName: string;
    doctorName: string;
    status: string;
  }>;
  invoices?: Array<{
    id: string;
    folio: string;
    amount: number;
    status: string;
    /** ISO completo (createdAt). */
    date: string;
    patientName: string;
  }>;
}
