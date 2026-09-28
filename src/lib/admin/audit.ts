/**
 * Consulta de la bitácora (audit_logs) para los paneles de auditoría.
 *
 * La lógica PURA (filtros, normalización, catálogos) vive en `audit-core.ts`
 * y se reexporta aquí, de modo que los consumidores siguen importando todo
 * desde `@/lib/admin/audit`. Este archivo añade lo único que toca BD:
 * `queryAuditLogs`.
 *
 * Multi-tenant: este helper NO decide el aislamiento. Quien lo llama es
 * responsable de pasar `clinicId` cuando corresponda:
 *   - /api/admin/auditoria (super admin de plataforma) → clinicId opcional.
 *   - /api/auditoria (admin de clínica) → clinicId SIEMPRE forzado al de sesión.
 */

import { prisma } from "@/lib/prisma";
import {
  buildAuditWhere,
  clampPage,
  clampPageSize,
  idsDePersonas,
  type AuditQueryFilters,
  type AuditQueryResult,
  type AuditLogRow,
} from "./audit-core";

export * from "./audit-core";

export async function queryAuditLogs(filters: AuditQueryFilters): Promise<AuditQueryResult> {
  const page = clampPage(filters.page);
  const pageSize = clampPageSize(filters.pageSize);
  const where = buildAuditWhere(filters);

  const [rowsRaw, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: {
        user: { select: { firstName: true, lastName: true, role: true, email: true } },
        clinic: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);

  // Personas del equipo que los cambios mencionan por id (el doctor tratante
  // de un caso de ortodoncia): se les pone nombre para que la bitácora diga
  // «de quién a quién». UNA consulta, solo si hay ids, y cada nombre se
  // entrega únicamente a las filas de SU clínica: un id de otra clínica no
  // se resuelve nunca.
  const idsPorFila = rowsRaw.map((r) => idsDePersonas(r.changes));
  const todosLosIds = Array.from(new Set(idsPorFila.flat()));
  const clinicas = Array.from(new Set(rowsRaw.map((r) => r.clinicId).filter(Boolean)));
  const gente = todosLosIds.length > 0 && clinicas.length > 0
    ? await prisma.user
        .findMany({
          where: { id: { in: todosLosIds }, clinicId: { in: clinicas } },
          select: { id: true, clinicId: true, firstName: true, lastName: true },
        })
        .catch(() => [])
    : [];

  const rows: AuditLogRow[] = rowsRaw.map((r, i) => {
    const fullName = `${r.user?.firstName ?? ""} ${r.user?.lastName ?? ""}`.trim();
    const personas: Record<string, string> = {};
    for (const id of idsPorFila[i]) {
      const p = gente.find((g) => g.id === id && g.clinicId === r.clinicId);
      const nombre = p ? `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() : "";
      if (nombre) personas[id] = nombre;
    }
    return {
      id: r.id,
      clinicId: r.clinicId,
      clinicName: r.clinic?.name ?? null,
      userId: r.userId,
      userName: fullName || r.user?.email || r.userId,
      userEmail: r.user?.email ?? null,
      userRole: r.user?.role ?? null,
      entityType: r.entityType,
      entityId: r.entityId,
      action: r.action,
      changes: (r.changes as unknown) ?? null,
      ipAddress: r.ipAddress ?? null,
      userAgent: r.userAgent ?? null,
      createdAt: r.createdAt.toISOString(),
      ...(Object.keys(personas).length > 0 ? { personas } : {}),
    };
  });

  return { rows, total, page, pageSize };
}
