/**
 * Revisión de t2 sobre la v6 (MAYOR): en `periodontics/sites.ts` la guarda de visibilidad
 * (`pacienteOcultoPara`) corría DENTRO de la `$transaction` interactiva y consulta con el cliente GLOBAL de
 * Prisma. Eso pide una segunda conexión mientras la transacción retiene la suya: con `connection_limit=1`
 * (Vercel) se queda esperando para siempre y el periodontograma no se guarda para nadie que no sea admin.
 * Ahora la guarda va ANTES de abrir la transacción.
 *
 * Run: npm run test:seg-archivos-permisos
 *
 *   · comportamiento — un doble de Prisma cuyo cliente global LANZA si se usa con una transacción abierta
 *     (lo que en producción sería el cuelgue); las tres acciones de sites.ts, reales, con un doctor;
 *   · estático — ningún callback de `$transaction` (acciones y lib, sin verticales) llama a los helpers
 *     de guarda que consultan con el cliente global.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const raiz = path.resolve(__dirname, "../../..");

let listaDelPaciente: string[] = [];
let transaccionAbierta = false;
/** Qué consulta de la guarda falla como lo haría la base (P2024: pool agotado). */
let fallaLaBase: "" | "periodontalRecord" | "patient" = "";
const P2024 = () => Object.assign(new Error("Timed out fetching a new connection from the connection pool"), { code: "P2024" });
const escrituras: string[] = [];
let ctx: any = null;

/** Las tablas, sin saber quién las usa. */
const tablas: any = {
  patient: {
    findUnique: async () => {
      if (fallaLaBase === "patient") throw P2024();
      return { visibleUserIds: listaDelPaciente };
    },
  },
  periodontalRecord: {
    findFirst: async () => {
      if (fallaLaBase === "periodontalRecord") throw P2024();
      return { id: "pr1", clinicId: "cA", patientId: "pA", sites: [], toothLevel: [] };
    },
    update: async (a: any) => { escrituras.push("periodontalRecord.update"); return { id: "pr1", updatedAt: new Date(), ...a.data }; },
  },
};
/** El cliente GLOBAL: con una transacción abierta, usarlo es pedir una segunda conexión → aquí, lanza. */
const prisma: any = new Proxy({}, {
  get: (_t, modelo: string) => {
    if (modelo === "$transaction") {
      return async (fn: (tx: any) => Promise<unknown>) => {
        transaccionAbierta = true;
        try {
          return await fn(tablas);
        } finally {
          transaccionAbierta = false;
        }
      };
    }
    return new Proxy({}, {
      get: (_m, op: string) => async (...a: unknown[]) => {
        if (transaccionAbierta) {
          throw new Error(`prisma.${modelo}.${op} GLOBAL dentro de $transaction: con connection_limit=1 se cuelga`);
        }
        return tablas[modelo][op](...a);
      },
    });
  },
});

let resultPerio: any = null;
const doblesPorArchivo: Record<string, () => unknown> = {
  [path.join(raiz, "src/app/actions/periodontics/_helpers.ts")]: () => ({
    ...resultPerio,
    PERIODONTICS_MODULE_KEY: "periodontics",
    PERIO_AUDIT_ACTIONS: new Proxy({}, { get: (_t, k) => String(k) }),
    getPerioActionContext: async () => resultPerio.ok({ ctx }),
    auditPerio: async () => undefined,
  }),
};
const dobles: Record<string, unknown> = {
  "server-only": {},
  "next/cache": { revalidatePath: () => undefined, revalidateTag: () => undefined },
  "@/lib/prisma": { prisma },
};
const Mod = Module as unknown as {
  _load: (req: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (req: string, parent: unknown, isMain: boolean) => string;
};
const cargaOriginal = Mod._load;
Mod._load = function (req: string, parent: unknown, isMain: boolean) {
  if (req in dobles) return dobles[req];
  if (req.startsWith(".") && resultPerio) {
    try {
      const f = Mod._resolveFilename(req, parent, isMain);
      if (f in doblesPorArchivo) return doblesPorArchivo[f]();
    } catch { /* lo resuelve la carga original */ }
  }
  return cargaOriginal.call(this, req, parent, isMain);
};

beforeEach(async () => {
  resultPerio ??= await import("@/app/actions/periodontics/result");
  escrituras.length = 0;
  listaDelPaciente = [];
  transaccionAbierta = false;
  fallaLaBase = "";
  ctx = { userId: "uYo", clinicId: "cA", role: "DOCTOR", permissionsOverride: null };
});

const SITIO = { fdi: 16, position: "MV", pdMm: 4, recMm: 1, bop: true, plaque: false, suppuration: false };
async function acciones() {
  const { upsertSiteData, upsertToothData, bulkUpsertSiteData } = await import("@/app/actions/periodontics/sites");
  return {
    upsertSiteData: () => upsertSiteData({ recordId: "pr1", site: SITIO }),
    upsertToothData: () => upsertToothData({ recordId: "pr1", tooth: { fdi: 16, mobility: 1, furcation: 0, absent: false, isImplant: false } }),
    bulkUpsertSiteData: () => bulkUpsertSiteData({ recordId: "pr1", sites: [SITIO, { ...SITIO, position: "DV" }] }),
  } as Record<string, () => Promise<any>>;
}

test("MAYOR: un doctor (no admin) guarda el periodontograma sin consultar con el cliente global dentro de la transacción", async () => {
  for (const lista of [[], ["uYo"]]) {
    listaDelPaciente = lista;
    for (const [nombre, llamar] of Object.entries(await acciones())) {
      escrituras.length = 0;
      const r = await llamar();
      assert.equal(r.ok, true, `${nombre} (lista ${JSON.stringify(lista)}): ${r.error}`);
      assert.deepEqual(escrituras, ["periodontalRecord.update"], nombre);
    }
  }
});

test("la guarda sigue: fuera de la lista del paciente restringido, «no encontrado» y sin escribir", async () => {
  listaDelPaciente = ["uOtro"];
  for (const [nombre, llamar] of Object.entries(await acciones())) {
    const r = await llamar();
    assert.equal(r.ok, false, nombre);
    assert.equal(r.error, "Periodontograma no encontrado", nombre);
  }
  assert.deepEqual(escrituras, []);
});

test("m1 (t12): si la base falla en la guarda, la acción devuelve «No se pudo guardar…» (el panel avisa), no lanza", async () => {
  const MENSAJES: Record<string, string> = {
    upsertSiteData: "No se pudo guardar el sitio",
    upsertToothData: "No se pudo guardar el diente",
    bulkUpsertSiteData: "No se pudo guardar el lote de sitios",
  };
  const silencio = console.error;
  console.error = () => undefined; // el `catch` registra el error; aquí no hace falta verlo
  try {
    for (const donde of ["periodontalRecord", "patient"] as const) {
      fallaLaBase = donde;
      for (const [nombre, llamar] of Object.entries(await acciones())) {
        const r = await llamar().catch((e: Error) => ({ lanzo: e.message }));
        assert.deepEqual(r, { ok: false, error: MENSAJES[nombre] }, `${nombre} con fallo en ${donde}`);
      }
    }
  } finally {
    console.error = silencio;
  }
  assert.deepEqual(escrituras, []);
});

test("estático: ningún callback de $transaction llama a una guarda que consulta con el cliente global", () => {
  const VERTICALES = /src\/app\/api\/(instituto|barber|realty)|src\/lib\/(edu|barber|realty)|actions\/(edu|barber|realty)|__tests__/;
  const GUARDAS_GLOBALES = /pacienteOcultoPara\(|assertPatientFileInClinic\(/;
  const archivos = execFileSync("git", ["ls-files", "src/app/**/*.ts", "src/lib/**/*.ts"], { cwd: raiz, encoding: "utf8" })
    .split("\n").filter((f) => f && !VERTICALES.test(f));
  const dentro: string[] = [];
  let transacciones = 0;
  for (const f of archivos) {
    const src = fs.readFileSync(path.join(raiz, f), "utf8");
    for (const m of src.matchAll(/\$transaction\(\s*async\s*\([^)]*\)\s*=>\s*\{/g)) {
      transacciones++;
      // cuerpo del callback: hasta la llave que cierra la que abre `=> {`
      let i = (m.index ?? 0) + m[0].length;
      let nivel = 1;
      const inicio = i;
      while (i < src.length && nivel > 0) {
        if (src[i] === "{") nivel++;
        else if (src[i] === "}") nivel--;
        i++;
      }
      if (GUARDAS_GLOBALES.test(src.slice(inicio, i))) dentro.push(`${f}:${src.slice(0, m.index).split("\n").length}`);
    }
  }
  assert.ok(transacciones >= 20, `el escaneo dejó de ver transacciones (${transacciones})`);
  assert.deepEqual(dentro, [], "guarda con el cliente global dentro de una transacción interactiva");
});
