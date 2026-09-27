// Base en memoria para probar compras.server.ts sin Postgres. Mismo
// espíritu que doble-inventario.ts (ws1-t5) — acotada a MIS tablas para no
// tocar su archivo. $transaction hace snapshot/rollback de verdad.

type Fila = Record<string, any>;

function matchWhere(row: Fila, where: Fila = {}): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (cond && typeof cond === "object" && "in" in cond) return (cond.in as any[]).includes(row[k]);
    return row[k] === cond;
  });
}

let contador = 0;
const nuevoId = (p: string) => `${p}_${++contador}`;

export class DobleCompras {
  tablas: Record<string, Fila[]> = {
    inventoryItem: [], inventoryPurchase: [], inventoryPurchaseLine: [],
    inventoryHistory: [], expense: [], inventoryProvider: [],
  };
  /** Si true, cualquier operación sobre las tablas nuevas lanza P2021 (SQL no aplicado). */
  tablasNuevasFaltantes = false;

  private clonar() {
    return Object.fromEntries(Object.entries(this.tablas).map(([k, rows]) => [k, rows.map(r => ({ ...r }))]));
  }

  private chequearTablaNueva(nombre: string) {
    if (this.tablasNuevasFaltantes && nombre !== "inventoryItem" && nombre !== "inventoryHistory") {
      throw Object.assign(new Error(`falta tabla ${nombre}`), { code: "P2021" });
    }
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

  get inventoryItem() {
    return {
      findMany: async ({ where, select }: any) => {
        const rows = this.tablas.inventoryItem.filter(r => matchWhere(r, where));
        return select ? rows.map(r => Object.fromEntries(Object.keys(select).map(k => [k, r[k]]))) : rows;
      },
      findFirst: async ({ where, select }: any) => {
        const row = this.tablas.inventoryItem.find(r => matchWhere(r, where));
        if (!row) return null;
        return select ? Object.fromEntries(Object.keys(select).map(k => [k, row[k]])) : row;
      },
      update: async ({ where, data }: any) => {
        const idx = this.tablas.inventoryItem.findIndex(r => matchWhere(r, where));
        if (idx < 0) throw new Error("inventoryItem.update: no encontrado");
        const row = this.tablas.inventoryItem[idx];
        const next = { ...row };
        for (const [k, v] of Object.entries(data) as [string, any][]) {
          next[k] = v && typeof v === "object" && "increment" in v ? Number(row[k] ?? 0) + Number(v.increment) : v;
        }
        this.tablas.inventoryItem[idx] = next;
        return next;
      },
    };
  }

  get inventoryPurchase() {
    return {
      findFirst: async ({ where, select, include }: any) => {
        this.chequearTablaNueva("inventoryPurchase");
        const row = this.tablas.inventoryPurchase.find(r => matchWhere(r, where));
        if (!row) return null;
        if (include?.expense) {
          const expense = this.tablas.expense.find(e => e.purchaseId === row.id) ?? null;
          return { ...row, expense: expense ? { id: expense.id } : null };
        }
        return select ? Object.fromEntries(Object.keys(select).map(k => [k, row[k]])) : row;
      },
      create: async ({ data, select }: any) => {
        this.chequearTablaNueva("inventoryPurchase");
        const existente = this.tablas.inventoryPurchase.find(
          r => r.clinicId === data.clinicId && data.idempotencyKey && r.idempotencyKey === data.idempotencyKey,
        );
        if (existente) throw Object.assign(new Error("unique violation"), { code: "P2002" });
        const row = { id: nuevoId("compra"), createdAt: new Date(), ...data };
        this.tablas.inventoryPurchase.push(row);
        return select ? Object.fromEntries(Object.keys(select).map(k => [k, row[k]])) : row;
      },
    };
  }

  get inventoryPurchaseLine() {
    return {
      create: async ({ data }: any) => {
        this.chequearTablaNueva("inventoryPurchaseLine");
        const row = { id: nuevoId("linea"), ...data };
        this.tablas.inventoryPurchaseLine.push(row);
        return row;
      },
      findMany: async ({ where, select }: any) => {
        const rows = this.tablas.inventoryPurchaseLine.filter(r => matchWhere(r, where));
        return select ? rows.map(r => Object.fromEntries(Object.keys(select).map(k => [k, r[k]]))) : rows;
      },
    };
  }

  get inventoryHistory() {
    return { create: async ({ data }: any) => { const row = { id: nuevoId("hist"), createdAt: new Date(), ...data }; this.tablas.inventoryHistory.push(row); return row; } };
  }

  get expense() {
    return {
      create: async ({ data, select }: any) => {
        const row = { id: nuevoId("gasto"), createdAt: new Date(), ...data };
        this.tablas.expense.push(row);
        return select ? Object.fromEntries(Object.keys(select).map(k => [k, row[k]])) : row;
      },
    };
  }
}
