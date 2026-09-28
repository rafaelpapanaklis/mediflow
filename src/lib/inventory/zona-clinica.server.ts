// La zona horaria de la clínica, para las reglas de Inventario que van por
// día de calendario (ws1-t5): cuándo caduca un lote y qué día es una compra.
//
// `clinicId` sale SIEMPRE de la sesión (lo pasan las rutas desde
// `getAuthContext`), nunca del cliente. Si falta, no se consulta nada.
//
// Si la zona no se puede leer (la base no contesta, o un doble de pruebas sin
// tabla de clínicas) se usa la zona por defecto del panel: un aviso de
// caducidad con la zona por defecto es mejor que una pantalla caída. Lo que
// venga después de esto y sí necesite la base fallará por su cuenta.
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ZONA_POR_DEFECTO } from "./fecha-calendario";

type Db = Prisma.TransactionClient | PrismaClient;

export async function zonaDeClinica(clinicId: string | null | undefined, db: Db = prisma): Promise<string> {
  if (!clinicId) return ZONA_POR_DEFECTO;
  try {
    const clinica = await (db as PrismaClient).clinic.findUnique({
      where: { id: clinicId },
      select: { timezone: true },
    });
    const zona = typeof clinica?.timezone === "string" ? clinica.timezone.trim() : "";
    return zona || ZONA_POR_DEFECTO;
  } catch (e) {
    console.error("[inventario] no se pudo leer la zona de la clínica; se usa la de por defecto:", (e as Error)?.message ?? e);
    return ZONA_POR_DEFECTO;
  }
}
