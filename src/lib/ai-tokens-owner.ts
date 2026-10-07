import { prisma } from "@/lib/prisma";
import { sedesDelDueno } from "@/lib/storage-owner";
import { tokensVigentes } from "@/lib/admin/uso-core";

/**
 * El CUPO DE TOKENS DE IA del plan es POR DUEÑO, compartido entre todas sus sedes (decisión de
 * Rafael, 7-oct-2026, igual que el almacenamiento): el consumo de todas las sedes suma contra el cupo
 * del plan. El SALDO IA (monedero prepago) NO se mezcla: sigue siendo por clínica.
 *
 * Cada clínica sigue contando SU consumo en `Clinic.aiTokensUsed`; este helper da lo que gastaron las
 * DEMÁS sedes del dueño este mes, para sumarlo al de la clínica en cada chequeo. Una sola sede: 0 y
 * ninguna consulta extra a clínicas. Un contador de un mes anterior (aún sin reseteo perezoso) vale 0.
 */
export async function tokensDeLasOtrasSedes(clinicId: string, ahora: Date = new Date()): Promise<{ tokens: number; sedes: number }> {
  const ids = await sedesDelDueno(clinicId);
  const otras = ids.filter((i) => i !== clinicId);
  if (otras.length === 0) return { tokens: 0, sedes: ids.length };
  const filas = await prisma.clinic.findMany({
    where: { id: { in: otras } },
    select: { aiTokensUsed: true, aiLastResetAt: true },
  });
  return { tokens: filas.reduce((s, f) => s + tokensVigentes(f.aiTokensUsed ?? 0, f.aiLastResetAt, ahora), 0), sedes: ids.length };
}
