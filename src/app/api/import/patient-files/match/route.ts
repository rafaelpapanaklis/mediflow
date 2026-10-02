// PASO 1 de "Archivos en bloque": emparejamiento SIN tocar Storage.
//
// POST /api/import/patient-files/match
//   body: { origin?: string|null, files: [{ index, fileName, folderName?, size }] }
//   → { matches: [{ index, patientId, patientName, matchedBy, candidate, ambiguous?, category }] }
//
// Da la vista previa del emparejamiento ANTES de subir un solo byte: por ID
// externo del sistema de origen (mismo `import_external_ids` que ya usan
// pacientes/saldos/citas) o, si no hay, por el nombre de la carpeta o del
// archivo. NUNCA se inventa un emparejamiento con confianza: sin candidato que
// case, el archivo queda "sin emparejar" y la interfaz lo dice claro; el
// usuario puede reasignarlo a mano antes de confirmar la subida (paso 2/3).
//
// Multi-tenant: clinicId SIEMPRE de la sesión. Visibilidad por paciente: solo
// se ofrecen como candidato los pacientes que el que importa puede ver.

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, requireRole } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { rateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { canSeePatient } from "@/lib/patient-visibility";
import { normName } from "@/lib/import/engine";
import { cargarExternos, limpiarId } from "@/lib/import/externos";
import { candidatosDeEmparejamiento, emparejarPorFolio, guessFileCategory } from "@/lib/uploads/patient-bulk-file-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BATCH_FILES = 2000;

interface FileIn {
  index: number;
  fileName: string;
  folderName?: string | null;
  size: number;
}

function pushKey(m: Map<string, string[]>, k: string, id: string) {
  if (!k) return;
  const arr = m.get(k);
  if (arr) arr.push(id);
  else m.set(k, [id]);
}

export async function POST(req: NextRequest) {
  const rl = rateLimit(req, 6, 60_000);
  if (rl) return rl;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const roleGate = requireRole(ctx, "ADMIN", "RECEPTIONIST");
  if (roleGate) return roleGate;
  // Misma llave que registrar el archivo (xrays.upload): esta ruta expone
  // nombre y coincidencia de paciente para el mismo dato que /confirm escribe.
  const deniedPerm = denyIfMissingPermission(ctx, "xrays.upload");
  if (deniedPerm) return deniedPerm;

  const body = await req.json().catch(() => ({}));
  const origin: string | null = typeof body?.origin === "string" ? body.origin : null;
  const files = Array.isArray(body?.files) ? (body.files as FileIn[]) : null;
  if (!files) return NextResponse.json({ error: "Falta la lista de archivos" }, { status: 400 });
  if (files.length === 0) return NextResponse.json({ matches: [] });
  if (files.length > MAX_BATCH_FILES) {
    return NextResponse.json({ error: `Máximo ${MAX_BATCH_FILES} archivos por lote` }, { status: 400 });
  }

  const patients = await prisma.patient.findMany({
    where: { clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, patientNumber: true, visibleUserIds: true },
  });
  const byName = new Map<string, string[]>();
  const nameById = new Map<string, string>();
  const byFolio = new Map<string, string>();
  for (const p of patients) {
    if (!canSeePatient({ userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId }, p.visibleUserIds)) continue;
    const full = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();
    nameById.set(p.id, full);
    pushKey(byName, normName(full), p.id);
    // `patientNumber` es único por clínica: no hay ambigüedad posible.
    if (p.patientNumber) byFolio.set(p.patientNumber.trim().toUpperCase(), p.id);
  }
  // ID externo: solo si se eligió un sistema de origen (mismo criterio que
  // loadPatientIndex del motor de importación) — en "Mi Excel"/"Otro" una
  // carpeta numérica no es un ID de un sistema, así que no se usa esa vía.
  const externos = origin ? await cargarExternos(ctx.clinicId, origin, "patient") : null;

  const matches = files.map((f) => {
    const candidatos = candidatosDeEmparejamiento(f.fileName ?? "", f.folderName);
    let patientId: string | null = null;
    let matchedBy: "externalId" | "folio" | "name" | null = null;
    let candidate: string | null = null;
    let ambiguous = false;

    if (externos?.disponible) {
      for (const c of candidatos) {
        const ext = limpiarId(c);
        const id = ext ? externos.mapa.get(ext) : undefined;
        if (id && nameById.has(id)) { patientId = id; matchedBy = "externalId"; candidate = c; break; }
      }
    }
    if (!patientId) {
      // El folio que la clínica ve en la ficha («P0166_rx.jpg»); no depende del sistema de origen.
      const porFolio = emparejarPorFolio(candidatos, byFolio);
      if (porFolio) { patientId = porFolio.patientId; matchedBy = "folio"; candidate = porFolio.candidate; }
    }
    if (!patientId) {
      for (const c of candidatos) {
        const ids = byName.get(normName(c));
        if (!ids || ids.length === 0) continue;
        if (ids.length === 1) { patientId = ids[0]; matchedBy = "name"; candidate = c; break; }
        ambiguous = true;
        candidate = c;
      }
    }

    return {
      index: f.index,
      patientId,
      patientName: patientId ? nameById.get(patientId) ?? null : null,
      matchedBy,
      candidate,
      ...(ambiguous && !patientId ? { ambiguous: true } : {}),
      category: guessFileCategory(f.fileName ?? ""),
    };
  });

  return NextResponse.json({ matches });
}
