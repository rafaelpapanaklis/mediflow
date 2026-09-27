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

/**
 * clinicId SIEMPRE de la sesión, nunca del body — pero el providerId que
 * viaja en el body de POST /api/inventory, PATCH /api/inventory/[id] y POST
 * /api/inventory/purchases sí es un id suelto que el cliente elige de un
 * <select>. Sin este chequeo, nada impide mandar el providerId de OTRA
 * clínica y dejarlo guardado (CLAUDE.md, regla c: aislar TODO por clinicId).
 * null/"" (sin proveedor) siempre se acepta sin consultar la base.
 */
export async function providerPerteneceAClinica(
  providerId: string | null,
  clinicId: string,
  db: PrismaClient = prisma,
): Promise<boolean> {
  if (!providerId) return true;
  try {
    const fila = await db.inventoryProvider.findFirst({ where: { id: providerId, clinicId }, select: { id: true } });
    return !!fila;
  } catch (e) {
    if (faltaTabla(e)) return false; // sin tabla no hay proveedor válido que aceptar
    throw e;
  }
}
