/**
 * Doble de `@/lib/prisma` para las pruebas que corren las funciones REALES de la regla de la suspensión
 * (`reactivacion-tras-suspension.server.ts`) sin base: solo la tabla que esas funciones tocan
 * (`subscription_invoices`). Se importa PRIMERO en la prueba, antes que el código que importa prisma.
 */
import Module from "node:module";
import path from "node:path";

export interface FilaFactura {
  clinicId: string;
  reference: string;
  status: string;
  notes?: string | null;
  [k: string]: unknown;
}

export const filasFactura: FilaFactura[] = [];

const doble = {
  subscriptionInvoice: {
    updateMany: async ({ where, data }: any) => {
      let n = 0;
      for (const f of filasFactura) {
        if (f.clinicId === where.clinicId && f.reference === where.reference && where.status.in.includes(f.status)) {
          Object.assign(f, data);
          n++;
        }
      }
      return { count: n };
    },
    findFirst: async ({ where }: any) => filasFactura.find((f) => f.clinicId === where.clinicId && f.reference === where.reference) ?? null,
    create: async ({ data }: any) => {
      // `reference` es @unique en el esquema: la segunda inserción de la misma factura falla (P2002), como en la base.
      if (filasFactura.some((f) => f.reference === data.reference)) throw Object.assign(new Error("Unique constraint failed on the fields: (`reference`)"), { code: "P2002" });
      filasFactura.push({ ...data });
      return data;
    },
  },
};

type M = typeof Module & { _load: (req: string, parent: unknown, isMain: boolean) => unknown; _resolveFilename: (req: string, parent: unknown, isMain: boolean) => string };
const Mod = Module as M;
const RAIZ = path.resolve(__dirname, "../../../..");
const cargaOriginal = Mod._load;
Mod._load = function (req, parent, isMain) {
  if (req === "server-only" || req === "client-only") return {};
  let resuelto: string | null = null;
  try {
    resuelto = Mod._resolveFilename(req, parent, isMain);
  } catch {
    resuelto = null;
  }
  if (resuelto === path.join(RAIZ, "src/lib/prisma.ts")) return { prisma: doble };
  return cargaOriginal.call(this, req, parent, isMain);
};
