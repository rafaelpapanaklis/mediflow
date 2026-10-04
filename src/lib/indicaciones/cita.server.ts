// Lo que las rutas de /api/indicaciones/cita/[id] necesitan de UNA cita: la cita,
// su paciente, su doctor (con cédula), la clínica y su catálogo. Todo con el
// `clinicId` de la sesión; el paciente restringido se oculta igual que en el
// resto (404). Tres consultas a la vez, no más (el pooler).

import "server-only";
import { lugarDeLaClinica } from "@/lib/clinica/lugar-de-la-clinica";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthContext, type AuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import type { PermissionKey } from "@/lib/auth/permissions";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { rateLimit } from "@/lib/rate-limit";
import { CLINIC_LETTERHEAD_SELECT } from "@/lib/pdf/clinic-letterhead";
import { catalogoLigable } from "./db";
import { procedimientosDeLaCita } from "./servicio";
import type { DatosParaHoja } from "./envio";
import type { ProcedimientoLigable } from "./tipos";

/** Ver qué se puede dar en una cita: quien ve la agenda. */
export const PERMISO_VER: PermissionKey = "agenda.view";
/**
 * Sacar algo del sistema (WhatsApp, PDF, constancia): quien puede trabajar la
 * agenda (recepción, doctor, dueño). Solo lectura no emite documentos.
 */
export const PERMISO_EMITIR: PermissionKey = "agenda.edit";

export async function entrarCita(
  req: NextRequest,
  permiso: PermissionKey,
  limite: number,
): Promise<{ ctx: AuthContext } | { res: Response }> {
  const limited = rateLimit(req, limite);
  if (limited) return { res: limited };
  const ctx = await getAuthContext();
  if (!ctx) return { res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const denied = denyIfMissingPermission(ctx, permiso);
  if (denied) return { res: denied };
  return { ctx };
}

export interface CitaCargada {
  datos: DatosParaHoja;
  appointmentId: string;
  patientId: string;
  primerNombre: string;
  telefono: string | null;
  /** Conceptos de la nota de cobro de la cita (para reconocer procedimientos). */
  conceptos: string[];
  catalogo: ProcedimientoLigable[];
  procedimientos: ProcedimientoLigable[];
  clinica: {
    id: string;
    letterhead: {
      name: string;
      address: string | null;
      city: string | null;
      state: string | null;
      phone: string | null;
      email: string | null;
      logoUrl: string | null;
    };
    waConnected: boolean | null;
    waPhoneNumberId: string | null;
    waAccessToken: string | null;
    waTemplates: unknown;
  };
}

function conceptosDeLaNota(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((i) => (i && typeof i === "object" ? String((i as { description?: unknown }).description ?? "") : ""))
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50);
}

export async function cargarCita(ctx: AuthContext, appointmentId: string): Promise<CitaCargada | { res: Response }> {
  if (!ctx.clinicId) return { res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const [cita, clinica, catalogo] = await Promise.all([
    prisma.appointment.findFirst({
      where: { id: appointmentId, clinicId: ctx.clinicId },
      select: {
        id: true,
        status: true,
        type: true,
        startsAt: true,
        endsAt: true,
        checkedInAt: true,
        startedAt: true,
        completedAt: true,
        patientId: true,
        patient: { select: { firstName: true, lastName: true, phone: true } },
        doctor: { select: { firstName: true, lastName: true, cedulaProfesional: true } },
        invoice: { select: { items: true } },
      },
    }),
    prisma.clinic.findUnique({
      where: { id: ctx.clinicId },
      select: {
        id: true,
        ...CLINIC_LETTERHEAD_SELECT,
        timezone: true,
        waConnected: true,
        waPhoneNumberId: true,
        waAccessToken: true,
        waTemplates: true,
      },
    }),
    catalogoLigable(ctx.clinicId),
  ]);
  if (!cita || !clinica) return { res: NextResponse.json({ error: "Cita no encontrada", code: "NO_ENCONTRADA" }, { status: 404 }) };

  const oculto = await assertPatientVisible(cita.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
  if (oculto) return { res: oculto };

  const conceptos = conceptosDeLaNota(cita.invoice?.items);
  const procedimientos = procedimientosDeLaCita([cita.type, ...conceptos], catalogo);
  const nombre = (a?: string | null, b?: string | null) => `${a ?? ""} ${b ?? ""}`.replace(/\s+/g, " ").trim();

  return {
    appointmentId: cita.id,
    patientId: cita.patientId,
    primerNombre: (cita.patient?.firstName ?? "").trim(),
    telefono: cita.patient?.phone?.trim() || null,
    conceptos,
    catalogo,
    procedimientos,
    clinica: {
      id: clinica.id,
      letterhead: {
        name: clinica.name,
        address: clinica.address,
        // C-60: el membrete no dice «Mérida» bajo una dirección de CDMX.
        city: lugarDeLaClinica({ ciudad: clinica.city, direccion: clinica.address }).ciudad || clinica.city,
        state: clinica.state,
        phone: clinica.phone,
        email: clinica.email,
        logoUrl: clinica.logoUrl,
      },
      waConnected: clinica.waConnected,
      waPhoneNumberId: clinica.waPhoneNumberId,
      waAccessToken: clinica.waAccessToken,
      waTemplates: clinica.waTemplates,
    },
    datos: {
      cita: {
        status: String(cita.status),
        motivo: cita.type ?? null,
        startsAt: cita.startsAt,
        endsAt: cita.endsAt,
        checkedInAt: cita.checkedInAt,
        startedAt: cita.startedAt,
        completedAt: cita.completedAt,
      },
      paciente: { nombre: nombre(cita.patient?.firstName, cita.patient?.lastName) },
      doctor: {
        nombre: nombre(cita.doctor?.firstName, cita.doctor?.lastName),
        cedula: cita.doctor?.cedulaProfesional?.trim() || null,
      },
      clinica: {
        nombre: clinica.name,
        telefono: clinica.phone,
        ciudad: clinica.city,
        estado: clinica.state,
        direccion: clinica.address,
        timezone: clinica.timezone,
      },
      procedimientos: procedimientos.map((p) => p.name),
    },
  };
}
