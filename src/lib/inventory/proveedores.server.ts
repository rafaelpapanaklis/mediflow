// Inventario A (WS1-T4) — proveedores PROPIOS de la clínica (nombre, RFC,
// contacto). NO es el Supplier del marketplace B2B (global, sin clinicId).
//
// inventory_providers es tabla NUEVA (sql/inventario-proveedores-compras-t4.sql).
// Mientras no se pegue: listar degrada a [] (la pantalla de Inventario sigue
// cargando, solo sin proveedores que elegir), crear propaga un 503 claro —
// mismo criterio que src/app/api/gastos/route.ts con la tabla expenses.
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

function faltaTabla(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  return code === "P2021" || code === "P2022";
}

export const PROVEEDORES_TABLA_FALTANTE_MSG =
  "La tabla inventory_providers no existe aún. Aplica sql/inventario-proveedores-compras-t4.sql en Supabase.";

export interface Proveedor {
  id: string;
  name: string;
  rfc: string | null;
  contact: string | null;
}

export async function listarProveedores(clinicId: string, db: PrismaClient = prisma): Promise<Proveedor[]> {
  try {
    return await db.inventoryProvider.findMany({
      where:   { clinicId },
      orderBy: { name: "asc" },
      select:  { id: true, name: true, rfc: true, contact: true },
    });
  } catch (e) {
    if (faltaTabla(e)) return [];
    throw e;
  }
}

export interface DatosNuevoProveedor {
  clinicId: string;
  name: string;
  rfc: string | null;
  contact: string | null;
}

export class ProveedoresTablaFaltanteError extends Error {
  code = "PROVEEDORES_TABLA_FALTANTE" as const;
  constructor() { super(PROVEEDORES_TABLA_FALTANTE_MSG); }
}

export async function crearProveedor(data: DatosNuevoProveedor, db: PrismaClient = prisma): Promise<Proveedor> {
  try {
    return await db.inventoryProvider.create({
      data,
      select: { id: true, name: true, rfc: true, contact: true },
    });
  } catch (e) {
    if (faltaTabla(e)) throw new ProveedoresTablaFaltanteError();
    throw e;
  }
}
