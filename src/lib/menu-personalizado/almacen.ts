import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { crearAlmacen } from "./almacen-core";

/**
 * El menú personal, contra la base. Toda consulta filtra por `clinicId` ADEMÁS
 * de por `userId`, y los dos salen SIEMPRE de la sesión (getCurrentUser), nunca
 * del cliente. Las reglas (sin tabla no se cae nada, tope de espera, dos
 * pestañas no se pisan) viven en almacen-core.ts, que se prueba sin base.
 */
export const almacenMenuPersonal = crearAlmacen({
  // to_regclass devuelve NULL si la tabla no existe: no lanza ni ensucia el log
  // con un prisma:error por cada carga del panel mientras falte el SQL.
  tablaExiste: async () => {
    const filas = await prisma.$queryRaw<{ existe: boolean }[]>`
      SELECT to_regclass('public.user_menu_layouts') IS NOT NULL AS existe`;
    return filas[0]?.existe === true;
  },
  leerFila: (userId, clinicId) =>
    prisma.userMenuLayout.findFirst({
      where: { userId, clinicId },
      select: { layout: true, revision: true },
    }),
  crearFila: async (userId, clinicId, layout, revision) => {
    const { count } = await prisma.userMenuLayout.createMany({
      data: { userId, clinicId, layout: layout as unknown as Prisma.InputJsonValue, revision },
      skipDuplicates: true,
    });
    return count;
  },
  actualizarFila: async (userId, clinicId, layout, revision, revisionEsperada) => {
    const { count } = await prisma.userMenuLayout.updateMany({
      where: { userId, clinicId, revision: revisionEsperada },
      data: { layout: layout as unknown as Prisma.InputJsonValue, revision, updatedAt: new Date() },
    });
    return count;
  },
  borrarFila: async (userId, clinicId) => {
    await prisma.userMenuLayout.deleteMany({ where: { userId, clinicId } });
  },
});
