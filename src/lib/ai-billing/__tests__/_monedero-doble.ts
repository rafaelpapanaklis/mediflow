/**
 * Doble en memoria de las tablas del monedero de IA, para las pruebas de
 * `test:ai-reserva` y `test:ai-reembolsos`. No es una prueba: lo importan.
 *
 * Dos cosas lo hacen servir para dinero y no solo para «que no truene»:
 *
 *  · El `where` se aplica DE VERDAD (igualdad, `gt`/`gte`/`lt`/`lte`/`in`) y un
 *    operador que no conoce LANZA: así una consulta nueva no pasa en verde por
 *    accidente.
 *  · El candado lo toma el CÓDIGO: un `$queryRaw` con `FOR UPDATE` dentro de
 *    `$transaction` bloquea esa clínica hasta que la transacción termina, como
 *    en Postgres. Sin esa línea no hay candado, y como cada operación cede el
 *    turno (`setImmediate`) las llamadas concurrentes se cruzan de verdad: si
 *    alguien quita el FOR UPDATE, las pruebas de concurrencia se ponen en rojo.
 *
 * La prueba con Postgres real (varias conexiones, FOR UPDATE de verdad) vive
 * fuera del repo; ver el reporte de la rama fix/saldo-ia-dinero.
 *
 * Además, `instalarDobles` intercepta `Module._load` para devolver dobles por
 * RUTA ABSOLUTA resuelta (así atrapa también los imports relativos) y un objeto
 * vacío para `server-only`, que no está en node_modules. Se hace sin
 * `--experimental-test-module-mocks`: ese cargador resuelve antes de `_load` y
 * `server-only` muere con MODULE_NOT_FOUND.
 */
import Module from "node:module";
import path from "node:path";

type Fila = Record<string, any>;

const RAIZ = path.resolve(__dirname, "../../../..");

/** Sustituye módulos por su ruta dentro del repo (p. ej. "src/lib/prisma.ts"). */
export function instalarDobles(dobles: Record<string, unknown>): void {
  const M = Module as unknown as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
    _resolveFilename: (request: string, parent: unknown, isMain: boolean) => string;
  };
  const porRuta = new Map(Object.entries(dobles).map(([rel, doble]) => [path.join(RAIZ, rel), doble]));
  const original = M._load;
  M._load = function (request, parent, isMain) {
    if (request === "server-only" || request === "client-only") return {};
    try {
      const resuelto = M._resolveFilename(request, parent, isMain);
      if (porRuta.has(resuelto)) return porRuta.get(resuelto);
    } catch {
      // Lo que no resuelve lo decide el cargador original.
    }
    return original.call(this, request, parent, isMain);
  };
}

const ceder = () => new Promise<void>((r) => setImmediate(r));

function cumple(fila: Fila, where: Fila | undefined): boolean {
  if (!where) return true;
  for (const [campo, cond] of Object.entries(where)) {
    const v = fila[campo];
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      for (const [op, x] of Object.entries(cond as Fila)) {
        const a = v instanceof Date ? v.getTime() : v;
        const b = x instanceof Date ? x.getTime() : x;
        if (op === "gt") { if (!(a > b)) return false; }
        else if (op === "gte") { if (!(a >= b)) return false; }
        else if (op === "lt") { if (!(a < b)) return false; }
        else if (op === "lte") { if (!(a <= b)) return false; }
        else if (op === "in") { if (!(x as unknown[]).includes(v)) return false; }
        else throw new Error(`doble de monedero: operador sin doble «${op}» en ${campo}`);
      }
    } else if (v !== cond) {
      return false;
    }
  }
  return true;
}

let secuencia = 0;
const nuevoId = (p: string) => `${p}_${++secuencia}`;

function aplicarDatos(fila: Fila, data: Fila): void {
  for (const [k, v] of Object.entries(data)) {
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("increment" in v) fila[k] = (fila[k] ?? 0) + v.increment;
      else if ("decrement" in v) fila[k] = (fila[k] ?? 0) - v.decrement;
      else throw new Error(`doble de monedero: actualización sin doble en ${k}`);
    } else {
      fila[k] = v;
    }
  }
  if ("updatedAt" in fila) fila.updatedAt = new Date();
}

function tabla(filas: Fila[], prefijo: string, porDefecto: () => Fila = () => ({})) {
  const crear = (data: Fila) => {
    const fila = { id: nuevoId(prefijo), createdAt: new Date(), ...porDefecto(), ...data };
    filas.push(fila);
    return fila;
  };
  return {
    filas,
    async findFirst({ where }: Fila = {}) { await ceder(); const f = filas.find((x) => cumple(x, where)); return f ? { ...f } : null; },
    async findUnique({ where }: Fila) { await ceder(); const f = filas.find((x) => cumple(x, where)); return f ? { ...f } : null; },
    async findUniqueOrThrow({ where }: Fila) {
      await ceder();
      const f = filas.find((x) => cumple(x, where));
      if (!f) throw new Error("doble de monedero: findUniqueOrThrow sin fila");
      return { ...f };
    },
    async findMany({ where }: Fila = {}) { await ceder(); return filas.filter((f) => cumple(f, where)).map((f) => ({ ...f })); },
    async create({ data }: Fila) { await ceder(); return { ...crear(data) }; },
    async update({ where, data }: Fila) {
      await ceder();
      const f = filas.find((x) => cumple(x, where));
      if (!f) throw Object.assign(new Error("doble de monedero: update sin fila"), { code: "P2025" });
      aplicarDatos(f, data);
      return { ...f };
    },
    async updateMany({ where, data }: Fila) {
      await ceder();
      const hits = filas.filter((x) => cumple(x, where));
      for (const f of hits) aplicarDatos(f, data);
      return { count: hits.length };
    },
    async upsert({ where, create, update }: Fila) {
      await ceder();
      const f = filas.find((x) => cumple(x, where));
      if (f) { aplicarDatos(f, update); return { ...f }; }
      return { ...crear(create) };
    },
    async deleteMany({ where }: Fila = {}) {
      await ceder();
      let n = 0;
      for (let i = filas.length - 1; i >= 0; i--) {
        if (cumple(filas[i], where)) { filas.splice(i, 1); n++; }
      }
      return { count: n };
    },
    async aggregate({ where, _sum }: Fila) {
      await ceder();
      const hits = filas.filter((f) => cumple(f, where));
      const suma: Fila = {};
      for (const k of Object.keys(_sum ?? {})) {
        suma[k] = hits.length ? hits.reduce((s, f) => s + (f[k] ?? 0), 0) : null;
      }
      return { _sum: suma };
    },
  };
}

export function crearMonederoDoble() {
  const t = {
    aiWallet: tabla([], "wallet", () => ({
      balanceCents: 0, autoRecharge: false, autoRechargeThresholdCents: 0, autoRechargeAmountCents: 0,
      stripePaymentMethodId: null, status: "ACTIVE", lowBalanceNotifiedAt: null, updatedAt: new Date(),
    })),
    aiWalletHold: tabla([], "hold"),
    aiWalletTransaction: tabla([], "tx"),
    aiTopup: tabla([], "topup", () => ({ status: "PENDING", gatewayRef: null, paidAt: null })),
    aiUsageEvent: tabla([], "ev"),
  };

  /** Candados de fila por clínica: la cola de quien espera, como un FOR UPDATE. */
  const candados = new Map<string, Promise<void>>();
  /** Cuántas veces alguien tuvo que esperar un candado: prueba de que hubo cruce. */
  const medidor = { esperas: 0, candadosTomados: 0 };

  async function tomarCandado(clave: string): Promise<() => void> {
    const previo = candados.get(clave);
    let soltar!: () => void;
    const mio = new Promise<void>((r) => (soltar = r));
    candados.set(clave, (previo ?? Promise.resolve()).then(() => mio));
    medidor.candadosTomados++;
    if (previo) {
      medidor.esperas++;
      await previo;
    }
    return soltar;
  }

  const prisma: any = {
    ...t,
    aiPricingConfig: { findMany: async () => [] },
    auditLog: { create: async () => ({}) },
    $queryRaw: async () => { await ceder(); return []; },
    async $transaction(fn: (tx: unknown) => Promise<unknown>) {
      const soltar: Array<() => void> = [];
      const tx = {
        ...prisma,
        // Solo `SELECT … FOR UPDATE` bloquea, y solo hasta el final de ESTA transacción.
        $queryRaw: async (partes: TemplateStringsArray, ...valores: unknown[]) => {
          await ceder();
          if (partes.join("?").includes("FOR UPDATE")) soltar.push(await tomarCandado(String(valores[0])));
          return [];
        },
      };
      try {
        return await fn(tx);
      } finally {
        for (const s of soltar) s();
      }
    },
  };

  return {
    prisma,
    medidor,
    tablas: t,
    monedero: (clinicId: string) => t.aiWallet.filas.find((w) => w.clinicId === clinicId),
    movimientos: (clinicId: string) => t.aiWalletTransaction.filas.filter((m) => m.clinicId === clinicId),
    /** Vacía todo entre pruebas. */
    reiniciar() {
      for (const x of Object.values(t)) x.filas.length = 0;
      candados.clear();
      medidor.esperas = 0; medidor.candadosTomados = 0;
    },
  };
}
