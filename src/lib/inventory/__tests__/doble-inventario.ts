// Base en memoria para probar lots.server.ts / recipe.server.ts sin Postgres.
// Mismo espíritu que src/lib/anticipos/__tests__/doble-base.ts, acotado a las
// tablas de WS1-T5. $transaction hace snapshot/rollback DE VERDAD: si el
// callback lanza, ninguna escritura sobrevive — así se prueba que el
// consumo FEFO es atómico.
import { Prisma } from "@prisma/client";

type Fila = Record<string, any>;

function esIgual(a: any, b: any): boolean {
  if (a instanceof Date || b instanceof Date) return new Date(a).getTime() === new Date(b).getTime();
  return a === b;
}

function cumple(valor: any, cond: any): boolean {
  if (cond === null) return valor === null || valor === undefined;
  if (typeof cond !== "object" || cond instanceof Date) return esIgual(valor, cond);
  for (const [op, arg] of Object.entries(cond)) {
    switch (op) {
      case "gt":  if (!(valor > (arg as any))) return false; break;
      case "gte": if (!(valor >= (arg as any))) return false; break;
      case "lt":  if (!(valor < (arg as any))) return false; break;
      case "lte": if (!(valor <= (arg as any))) return false; break;
      case "in":  if (!(arg as any[]).includes(valor)) return false; break;
      case "not": if (arg === null ? (valor !== null && valor !== undefined) : esIgual(valor, arg)) return false; break;
      default: throw new Error(`doble-inventario: operador sin doble «${op}»`);
    }
  }
  return true;
}

function matchWhere(row: Fila, where: Fila = {}): boolean {
  return Object.entries(where).every(([k, cond]) => cumple(row[k], cond));
}

function aplicarData(row: Fila, data: Fila): Fila {
  const next = { ...row };
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && !(v instanceof Date) && ("increment" in v || "decrement" in v)) {
      const delta = "increment" in v ? Number((v as any).increment) : -Number((v as any).decrement);
      next[k] = Number(next[k] ?? 0) + delta;
    } else {
      next[k] = v;
    }
  }
  return next;
}

let contadorId = 0;
const nuevoId = (prefijo: string) => `${prefijo}_${++contadorId}`;

export class DobleInventario {
  tablas: Record<string, Fila[]> = {
    inventoryItem:            [],
    inventoryLot:             [],
    inventoryLotMovement:     [],
    inventoryHistory:         [],
    inventoryAlertSettings:   [],
    procedureCatalog:         [],
    procedureMaterialRecipe:  [],
  };

  private clonar(): Record<string, Fila[]> {
    return Object.fromEntries(Object.entries(this.tablas).map(([k, rows]) => [k, rows.map(r => ({ ...r }))]));
  }

  async $transaction<T>(cb: (tx: this) => Promise<T>): Promise<T> {
    const snapshot = this.clonar();
    try {
      return await cb(this);
    } catch (e) {
      this.tablas = snapshot;
      throw e;
    }
  }

  // Los dos únicos $queryRaw que emite lots.server.ts: el candado del
  // artículo (con SELECT quantity/quantityPrecise reales) y el candado de
  // sus lotes (contenido no usado por el llamador).
  async $queryRaw(strings: TemplateStringsArray, ...values: any[]): Promise<any[]> {
    const sql = strings.join("");
    if (sql.includes("inventory_items")) {
      const [id, clinicId] = values;
      const item = this.tablas.inventoryItem.find(i => i.id === id && i.clinicId === clinicId);
      return item ? [{ quantity: item.quantity, quantityPrecise: item.quantityPrecise }] : [];
    }
    return [{ id: "lock" }];
  }

  // Ajuste 2 — simula el cliente de Prisma VIEJO de dev.108: rechaza con
  // PrismaClientValidationError cualquier `data` que traiga una de estas
  // llaves (campo nuevo en un modelo viejo que ese cliente no reconoce).
  camposDesconocidosParaClienteViejo = new Set<string>();

  get inventoryItem() {
    return {
      findFirst: async ({ where }: any) => this.tablas.inventoryItem.find(r => matchWhere(r, where)) ?? null,
      update: async ({ where, data }: any) => {
        for (const k of Object.keys(data)) {
          if (this.camposDesconocidosParaClienteViejo.has(k)) {
            throw new Prisma.PrismaClientValidationError(`Unknown argument \`${k}\`.`, { clientVersion: "5.22.0" });
          }
        }
        const idx = this.tablas.inventoryItem.findIndex(r => matchWhere(r, where));
        if (idx < 0) throw new Error("inventoryItem.update: no encontrado");
        this.tablas.inventoryItem[idx] = aplicarData(this.tablas.inventoryItem[idx], data);
        return this.tablas.inventoryItem[idx];
      },
    };
  }

  get inventoryLot() {
    return {
      findFirst: async ({ where }: any) => this.tablas.inventoryLot.find(r => matchWhere(r, where)) ?? null,
      findMany: async ({ where }: any = {}) => this.tablas.inventoryLot.filter(r => matchWhere(r, where)),
      findUniqueOrThrow: async ({ where }: any) => {
        const row = this.tablas.inventoryLot.find(r => matchWhere(r, where));
        if (!row) throw Object.assign(new Error("No row found"), { code: "P2025" });
        return row;
      },
      create: async ({ data }: any) => {
        const row = { id: nuevoId("lote"), createdAt: new Date(), updatedAt: new Date(), ...data };
        this.tablas.inventoryLot.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const idx = this.tablas.inventoryLot.findIndex(r => matchWhere(r, where));
        if (idx < 0) throw new Error("inventoryLot.update: no encontrado");
        this.tablas.inventoryLot[idx] = aplicarData(this.tablas.inventoryLot[idx], data);
        return this.tablas.inventoryLot[idx];
      },
    };
  }

  get inventoryLotMovement() {
    return {
      create: async ({ data }: any) => {
        const row = { id: nuevoId("mov"), createdAt: new Date(), ...data };
        this.tablas.inventoryLotMovement.push(row);
        return row;
      },
    };
  }

  get inventoryHistory() {
    return {
      create: async ({ data }: any) => {
        const row = { id: nuevoId("hist"), createdAt: new Date(), ...data };
        this.tablas.inventoryHistory.push(row);
        return row;
      },
    };
  }

  get inventoryAlertSettings() {
    return {
      findUnique: async ({ where }: any) => this.tablas.inventoryAlertSettings.find(r => matchWhere(r, where)) ?? null,
      upsert: async ({ where, create, update }: any) => {
        const idx = this.tablas.inventoryAlertSettings.findIndex(r => matchWhere(r, where));
        if (idx < 0) { const row = { ...create }; this.tablas.inventoryAlertSettings.push(row); return row; }
        this.tablas.inventoryAlertSettings[idx] = { ...this.tablas.inventoryAlertSettings[idx], ...update };
        return this.tablas.inventoryAlertSettings[idx];
      },
    };
  }

  get procedureCatalog() {
    return {
      findFirst: async ({ where }: any) => this.tablas.procedureCatalog.find(r => matchWhere(r, where)) ?? null,
    };
  }

  get procedureMaterialRecipe() {
    return {
      findMany: async ({ where, include }: any = {}) => {
        const rows = this.tablas.procedureMaterialRecipe.filter(r => matchWhere(r, where));
        if (!include?.item) return rows;
        return rows.map(r => ({ ...r, item: this.tablas.inventoryItem.find(i => i.id === r.itemId) }));
      },
      upsert: async ({ where, create, update }: any) => {
        const key = where.procedureId_itemId;
        const idx = this.tablas.procedureMaterialRecipe.findIndex(r => r.procedureId === key.procedureId && r.itemId === key.itemId);
        if (idx < 0) { const row = { id: nuevoId("receta"), createdAt: new Date(), updatedAt: new Date(), ...create }; this.tablas.procedureMaterialRecipe.push(row); return row; }
        this.tablas.procedureMaterialRecipe[idx] = { ...this.tablas.procedureMaterialRecipe[idx], ...update };
        return this.tablas.procedureMaterialRecipe[idx];
      },
      deleteMany: async ({ where }: any) => {
        const antes = this.tablas.procedureMaterialRecipe.length;
        this.tablas.procedureMaterialRecipe = this.tablas.procedureMaterialRecipe.filter(r => !matchWhere(r, where));
        return { count: antes - this.tablas.procedureMaterialRecipe.length };
      },
    };
  }
}
