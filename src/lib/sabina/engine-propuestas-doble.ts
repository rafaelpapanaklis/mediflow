/**
 * Doble de `audit_logs` para las pruebas de las propuestas de Sabina. SOLO para
 * pruebas: no lo importa ningún archivo de la app.
 *
 * Evalúa los `where` que usa `engine-propuestas.ts` y emula
 * `pg_advisory_xact_lock`: dos transacciones con la misma clave se esperan.
 */
import type { DbPropuestas, TxPropuestas } from "./engine-propuestas";

export interface FilaAuditoria {
  id: string;
  clinicId: string;
  userId: string;
  entityType: string;
  entityId: string;
  action: string;
  changes: any;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

function cumple(f: FilaAuditoria, where: Record<string, any>): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    const valor = (f as any)[k];
    if (k === "changes" && v && typeof v === "object" && "path" in v) {
      if (f.changes?.[v.path[0]] !== v.equals) return false;
    } else if (v && typeof v === "object" && "in" in v) {
      if (!v.in.includes(valor)) return false;
    } else if (v && typeof v === "object" && "gte" in v) {
      if (!(valor >= v.gte)) return false;
    } else if (v && typeof v === "object" && "gt" in v) {
      if (!(valor > v.gt)) return false;
    } else if (valor !== v) {
      return false;
    }
  }
  return true;
}

export function crearBaseDePropuestas(reloj: () => number) {
  const filas: FilaAuditoria[] = [];
  const candados = new Map<string, Promise<void>>();
  let secuencia = 0;

  // Cada operación cede el turno, como una consulta de verdad: sin esto, dos
  // transacciones nunca se intercalan y la prueba de la carrera pasaría también
  // sin candado (se comprobó quitándolo).
  const ceder = () => new Promise((r) => setImmediate(r));
  const auditLog = {
    findMany: async ({ where, orderBy, take }: any) => {
      await ceder();
      let r = filas.filter((f) => cumple(f, where));
      if (orderBy?.createdAt === "desc") r = [...r].reverse();
      return take ? r.slice(0, take) : r;
    },
    create: async ({ data }: any) => {
      await ceder();
      secuencia += 1;
      const fila: FilaAuditoria = { ...data, id: `al_${secuencia}`, createdAt: new Date(reloj() + secuencia) };
      filas.push(JSON.parse(JSON.stringify(fila), (k, v) => (k === "createdAt" ? new Date(v) : v)));
      return fila;
    },
  };

  const db: DbPropuestas = {
    auditLog,
    $executeRaw: async () => {
      throw new Error("el candado solo tiene sentido dentro de una transacción");
    },
    async $transaction(fn) {
      const liberar: Array<() => void> = [];
      const tx: TxPropuestas = {
        auditLog,
        $executeRaw: async (_strings: TemplateStringsArray, ...valores: unknown[]) => {
          const clave = String(valores[0]);
          while (candados.has(clave)) await candados.get(clave);
          let soltar!: () => void;
          candados.set(clave, new Promise<void>((r) => (soltar = r)));
          liberar.push(() => {
            candados.delete(clave);
            soltar();
          });
          return 1;
        },
      };
      try {
        return await fn(tx);
      } finally {
        liberar.forEach((l) => l());
      }
    },
  };
  return { db, filas };
}

