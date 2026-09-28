// ═══════════════════════════════════════════════════════════════════════════
// CARGADOR de `OrthodonticsClinicSettings` (Ola 1, ws1-t3 · «Acceso y
// permisos») — configuración del submenú "Configuración": doctor tratante
// por defecto, catálogo de tipos de cita (C7) y plantillas de mensaje.
//
// `clinicId` SIEMPRE de la sesión, nunca del cliente. Tolera que la tabla de
// sql/ortodoncia-configuracion.sql todavía no exista: P2021 se lee como "sin
// configuración todavía" y devuelve los defaults del módulo, no tumba la
// pantalla — mismo espíritu que cobranza-db.ts (Ola 0).
// ═══════════════════════════════════════════════════════════════════════════

import { prisma } from "@/lib/prisma";

function esTablaAusente(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2022";
}

export interface OrthoAppointmentTypeOption {
  id: string;
  label: string;
}

/** Catálogo por defecto (C7, alcance-ortodoncia.html): se usa mientras la
 * clínica no guarde el suyo propio en Configuración. */
export const DEFAULT_ORTHO_APPOINTMENT_TYPES: readonly OrthoAppointmentTypeOption[] = [
  { id: "valoracion", label: "Valoración" },
  { id: "toma-registros", label: "Toma de registros" },
  { id: "colocacion", label: "Colocación" },
  { id: "control", label: "Control" },
  { id: "urgencia", label: "Urgencia (bracket despegado, alambre que lastima)" },
  { id: "retiro", label: "Retiro" },
  { id: "control-retencion", label: "Control de retención" },
];

export interface OrthoClinicSettings {
  clinicId: string;
  defaultTreatingDoctorId: string | null;
  appointmentTypes: OrthoAppointmentTypeOption[];
  messageTemplates: Record<string, string>;
  updatedAt: Date | null;
}

function defaults(clinicId: string): OrthoClinicSettings {
  return {
    clinicId,
    defaultTreatingDoctorId: null,
    appointmentTypes: [...DEFAULT_ORTHO_APPOINTMENT_TYPES],
    messageTemplates: {},
    updatedAt: null,
  };
}

function esArrayDeOpciones(v: unknown): v is OrthoAppointmentTypeOption[] {
  return Array.isArray(v) && v.every(
    (o) => o && typeof o === "object" && typeof (o as any).id === "string" && typeof (o as any).label === "string",
  );
}

/** Trae la configuración de la clínica, o los defaults si no hay fila (o la tabla aún no existe). */
export async function loadOrthoClinicSettings(clinicId: string): Promise<OrthoClinicSettings> {
  if (!clinicId) return defaults(clinicId);
  try {
    const row = await prisma.orthodonticsClinicSettings.findUnique({ where: { clinicId } });
    if (!row) return defaults(clinicId);
    return {
      clinicId,
      defaultTreatingDoctorId: row.defaultTreatingDoctorId,
      appointmentTypes: esArrayDeOpciones(row.appointmentTypes)
        ? row.appointmentTypes
        : [...DEFAULT_ORTHO_APPOINTMENT_TYPES],
      messageTemplates: (row.messageTemplates as Record<string, string> | null) ?? {},
      updatedAt: row.updatedAt,
    };
  } catch (e) {
    if (esTablaAusente(e)) return defaults(clinicId);
    throw e;
  }
}

export interface GuardarOrthoClinicSettingsArgs {
  clinicId: string;
  updatedBy: string;
  defaultTreatingDoctorId: string | null;
  appointmentTypes: OrthoAppointmentTypeOption[];
  messageTemplates: Record<string, string>;
}

/** Upsert de la fila. Lanza si la tabla aún no existe — el caller (server
 * action) traduce eso a un mensaje "pega el SQL primero", no a un 500 mudo. */
export async function guardarOrthoClinicSettings(
  args: GuardarOrthoClinicSettingsArgs,
): Promise<void> {
  await prisma.orthodonticsClinicSettings.upsert({
    where: { clinicId: args.clinicId },
    create: {
      clinicId: args.clinicId,
      defaultTreatingDoctorId: args.defaultTreatingDoctorId,
      appointmentTypes: args.appointmentTypes as unknown as object,
      messageTemplates: args.messageTemplates as unknown as object,
      updatedBy: args.updatedBy,
    },
    update: {
      defaultTreatingDoctorId: args.defaultTreatingDoctorId,
      appointmentTypes: args.appointmentTypes as unknown as object,
      messageTemplates: args.messageTemplates as unknown as object,
      updatedBy: args.updatedBy,
    },
  });
}
