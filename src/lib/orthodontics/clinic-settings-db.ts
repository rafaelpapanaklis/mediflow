// ═══════════════════════════════════════════════════════════════════════════
// CARGADOR de `OrthodonticsClinicSettings` (Ola 1, ws1-t3 · «Acceso y
// permisos») — configuración del submenú "Configuración": doctor tratante
// por defecto, catálogo de tipos de cita (C7) y plantillas de mensaje.
//
// `clinicId` SIEMPRE de la sesión, nunca del cliente. Tolera dos escenarios
// de "la Configuración todavía no existe":
//   1) SQL sin pegar en Supabase (P2021/P2022 de Prisma).
//   2) `npx prisma generate` sin correr todavía DESPUÉS de este cambio de
//      schema, en un proceso `next dev` que ya estaba arriba: el cliente en
//      memoria de ESE proceso ni siquiera tiene la propiedad
//      `orthodonticsClinicSettings` (no es un error de Prisma con `.code`,
//      es un `TypeError: Cannot read properties of undefined`). Medido en
//      dev.108 el 27-sep-2026 con el server ya arriba desde antes de este
//      commit — se resuelve solo con el próximo reinicio del proceso, pero
//      mientras tanto la pantalla no debe morir.
// En ambos casos: defaults del módulo, no tumba la pantalla — mismo espíritu
// que cobranza-db.ts (Ola 0).
// ═══════════════════════════════════════════════════════════════════════════

import { prisma } from "@/lib/prisma";

function esTablaAusente(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2022";
}

/** `true` si ESTE proceso todavía no tiene el modelo en su Prisma Client
 * (schema nuevo, cliente viejo en memoria — ver comentario de arriba). */
function faltaClienteDeOrtho(): boolean {
  return typeof (prisma as any)?.orthodonticsClinicSettings?.findUnique !== "function";
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
  if (faltaClienteDeOrtho()) return defaults(clinicId);
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
  if (faltaClienteDeOrtho()) {
    // Mismo contrato que un P2021 real (tabla ausente): el caller
    // (updateOrthoClinicSettings) ya sabe traducir ese código a "pega el SQL
    // primero" en vez de un 500 mudo.
    throw Object.assign(new Error("orthodonticsClinicSettings no existe en este cliente de Prisma"), {
      code: "P2021",
    });
  }
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
