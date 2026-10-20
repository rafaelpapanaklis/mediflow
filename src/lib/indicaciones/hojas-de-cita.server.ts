// Las hojas de la clínica vistas desde UNA cita, y el rastro en Movimientos.

import "server-only";
import { prisma } from "@/lib/prisma";
import { registrarMovimientoDelPaciente } from "@/lib/movimientos-paciente/registrar";
import { repoHojasVigente } from "./db";
import { textoDeFabrica } from "./fabrica";
import { listarHojas } from "./servicio";
import type { HojaDTO, ProcedimientoLigable } from "./tipos";

/** `null` = sin la tabla (falta el SQL): no hay biblioteca, solo la constancia de fábrica. */
export async function hojasDeLaClinica(
  clinicId: string,
  catalogo: readonly ProcedimientoLigable[],
): Promise<HojaDTO[] | null> {
  return listarHojas(repoHojasVigente, clinicId, async () => catalogo);
}

/** Id de la constancia de fábrica cuando todavía no hay tabla: no es una fila. */
export const ID_CONSTANCIA_SIN_TABLA = "fabrica:constancia";

/**
 * La constancia de fábrica como si fuera una fila. Sirve ANTES de que se pegue el
 * SQL: la constancia de asistencia funciona desde el primer día; lo que necesita
 * la tabla es poder editarla.
 */
export function constanciaSinTabla(): HojaDTO {
  const f = textoDeFabrica("constancia")!;
  const epoca = new Date(0).toISOString();
  return {
    id: ID_CONSTANCIA_SIN_TABLA,
    tipo: "CONSTANCIA",
    nombre: f.nombre,
    cuerpo: f.cuerpo,
    procedureIds: [],
    deFabrica: true,
    versionDeClinica: false,
    basadaEn: f.clave,
    activa: true,
    createdAt: epoca,
    updatedAt: epoca,
  };
}

/** Lo que se guarda en la bitácora para reconocer un envío por WhatsApp (tope anti-duplicado). */
export const MARCA_ENVIO = "_indicaciones";

/** Si ya se mandaron las indicaciones de esta cita por WhatsApp en los últimos `minutos`. */
export async function ultimoEnvioReciente(
  clinicId: string,
  appointmentId: string,
  minutos = 10,
): Promise<Date | null> {
  if (!clinicId || !appointmentId) return null;
  try {
    const fila = await prisma.auditLog.findFirst({
      where: {
        clinicId,
        entityType: "appointment",
        entityId: appointmentId,
        createdAt: { gte: new Date(Date.now() - minutos * 60_000) },
        changes: { path: [MARCA_ENVIO, "after", "via"], equals: "whatsapp" },
      },
      select: { createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    return fila?.createdAt ?? null;
  } catch (err) {
    console.error("[indicaciones] no se pudo leer el último envío:", err);
    return null;
  }
}

export async function anotarEnMovimientos(m: {
  req: Request;
  clinicId: string;
  userId: string;
  patientId: string;
  appointmentId: string;
  texto: string;
  categoria: "expediente" | "citas";
  via: "whatsapp" | "pdf" | "constancia";
  hojas: string[];
}): Promise<void> {
  await registrarMovimientoDelPaciente({
    req: m.req,
    clinicId: m.clinicId,
    userId: m.userId,
    patientId: m.patientId,
    entityType: "appointment",
    entityId: m.appointmentId,
    action: "update",
    texto: m.texto,
    categoria: m.categoria,
    cambios: { [MARCA_ENVIO]: { before: null, after: { via: m.via, hojas: m.hojas } } },
  });
}

/** «las indicaciones de cuidado «Después de una extracción»» / «… (2 hojas)». */
export function nombrarHojas(nombres: readonly string[]): string {
  if (nombres.length === 1) return `«${nombres[0]}»`;
  return `(${nombres.length} hojas)`;
}
