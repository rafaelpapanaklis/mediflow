/**
 * Seguridad ola 2b · v2 · menores m1 y m2 de la revisión t5 — la reserva del
 * cupo de IA en el cambio de mes.
 *
 * m1: el reseteo perezoso era un update a secas. Dos peticiones el día 1 leían
 *     el mes viejo; la primera reseteaba y apartaba su reserva, y la segunda
 *     volvía a poner 0 y BORRABA esa reserva (el contador cuenta de menos).
 * m2: una reserva apartada el 31 y liquidada después del reseteo descontaba
 *     lo que sobró del mes NUEVO.
 *
 * Run: npm run test:seg-ola2b
 */
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";

const RAIZ = process.cwd();
const MES_PASADO = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15);

const clinica = { id: "c1", aiTokensUsed: 0, aiTokensLimit: 1_000_000, aiLastResetAt: MES_PASADO };
/** Si está puesta, las primeras N lecturas esperan a que lleguen N (las dos peticiones leen el mes viejo). */
let barrera: { faltan: number; soltar: Array<() => void> } | null = null;

function cumple(v: any, cond: any): boolean {
  if (cond instanceof Date) return v instanceof Date && v.getTime() === cond.getTime();
  if (typeof cond !== "object") return v === cond;
  if (cond.lte !== undefined && !(v <= cond.lte)) return false;
  if (cond.gte !== undefined && !(v >= cond.gte)) return false;
  return true;
}
function aplicar(data: any) {
  for (const [k, v] of Object.entries<any>(data)) {
    if (v && typeof v === "object" && !(v instanceof Date) && "increment" in v) (clinica as any)[k] += v.increment;
    else if (v && typeof v === "object" && !(v instanceof Date) && "decrement" in v) (clinica as any)[k] -= v.decrement;
    else (clinica as any)[k] = v;
  }
}
const prismaFalso = {
  clinic: {
    findUnique: async () => {
      const foto = { ...clinica };
      if (barrera && barrera.faltan > 0) {
        barrera.faltan--;
        await new Promise<void>((res) => {
          barrera!.soltar.push(res);
          // Las dos ya leyeron el mes viejo: la primera sigue YA; la segunda, cuando la primera ya apartó.
          if (barrera!.faltan === 0) {
            const [primera, segunda] = barrera!.soltar;
            primera();
            setTimeout(segunda, 30);
          }
        });
      }
      return foto;
    },
    update: async ({ data }: any) => { aplicar(data); return { ...clinica }; },
    updateMany: async ({ where, data }: any) => {
      for (const [k, c] of Object.entries(where)) {
        if (k === "id") continue;
        if (!cumple((clinica as any)[k], c)) return { count: 0 };
      }
      aplicar(data);
      return { count: 1 };
    },
  },
  aiQuotaUsage: { create: async ({ data }: any) => data },
};

const dobles = new Map<string, unknown>([
  [path.join(RAIZ, "src/lib/prisma.ts"), { prisma: prismaFalso }],
  [path.join(RAIZ, "src/lib/ai-tokens-owner.ts"), { tokensDeLasOtrasSedes: async () => ({ tokens: 0, sedes: 1 }) }],
]);
const M = Module as unknown as {
  _load: (req: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (req: string, parent: unknown, isMain: boolean) => string;
};
const cargaOriginal = M._load;
M._load = function (req, parent, isMain) {
  if (req === "server-only" || req === "client-only") return {};
  let resuelto: string | null = null;
  try { resuelto = M._resolveFilename(req, parent, isMain); } catch { resuelto = null; }
  if (resuelto && dobles.has(resuelto)) return dobles.get(resuelto);
  return cargaOriginal.call(this, req, parent, isMain);
};

let T: typeof import("@/lib/ai-tokens");
before(async () => {
  T = await import("@/lib/ai-tokens");
});
beforeEach(() => {
  clinica.aiTokensUsed = 900_000;
  clinica.aiLastResetAt = MES_PASADO;
  barrera = null;
});

test("🔴 m1: dos reservas el día 1 que leyeron el mes viejo cuentan LAS DOS (el segundo reseteo no borra la primera)", async () => {
  barrera = { faltan: 2, soltar: [] };
  const [a, b] = await Promise.all([T.reservarCupoIa("c1", 1000), T.reservarCupoIa("c1", 1000)]);
  assert.ok(a.reserva && b.reserva, "las dos caben en el mes nuevo");
  assert.equal(clinica.aiTokensUsed, 2000, "contador = las dos reservas, no una");
  assert.ok(clinica.aiLastResetAt.getTime() > MES_PASADO.getTime(), "el mes se reseteó");
});

test("🔴 m2: una reserva del mes viejo liquidada tras el reseteo no le descuenta su sobrante al mes nuevo", async () => {
  clinica.aiLastResetAt = new Date();
  const { reserva } = await T.reservarCupoIa("c1", 5000);
  assert.ok(reserva);
  // Cambia el mes entre reservar y liquidar: otro reseteo y 10 000 gastados ya en el mes nuevo.
  clinica.aiLastResetAt = new Date(Date.now() + 1000);
  clinica.aiTokensUsed = 10_000;
  await T.liquidarCupoIa(reserva!, 1000, "chat");
  assert.equal(clinica.aiTokensUsed, 10_000, "el sobrante (4 000) era del mes viejo");
});

test("m2: si lo real fue MÁS que lo reservado, la diferencia sí se suma (al mes en curso)", async () => {
  clinica.aiLastResetAt = new Date();
  const { reserva } = await T.reservarCupoIa("c1", 5000);
  clinica.aiLastResetAt = new Date(Date.now() + 1000);
  clinica.aiTokensUsed = 10_000;
  await T.liquidarCupoIa(reserva!, 7000, "chat");
  assert.equal(clinica.aiTokensUsed, 12_000);
});

test("control: sin cambio de mes, el sobrante se devuelve como siempre", async () => {
  clinica.aiLastResetAt = new Date();
  clinica.aiTokensUsed = 0;
  const { reserva } = await T.reservarCupoIa("c1", 5000);
  assert.equal(clinica.aiTokensUsed, 5000);
  await T.liquidarCupoIa(reserva!, 1000, "chat");
  assert.equal(clinica.aiTokensUsed, 1000);
});
