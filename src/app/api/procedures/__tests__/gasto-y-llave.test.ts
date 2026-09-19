/**
 * WS1-T1 · Gasto por procedimiento, y la llave `code` que el panel ya no toca.
 *
 * Run: npm run test:procedimientos-gasto
 *   (--experimental-test-module-mocks: se ejecutan DE VERDAD el POST y el PATCH
 *   de /api/procedures, el permiso `procedures.edit` y `changesToTreatments`
 *   del odontograma. Solo se sustituyen Prisma, la sesión y la revalidación.)
 *
 * Cuatro cosas que no pueden volver atrás:
 *
 * 1. El GASTO de la clínica no sale por ningún camino de cara al paciente
 *    (bot de WhatsApp, reserva, landing pública, Sabina). Es el único fallo
 *    grave de verdad: todo lector del catálogo fuera del panel lleva `select`
 *    explícito y en ese `select` no está `cost`.
 * 2. Un procedimiento SIN gasto no enseña margen: ni 0 ni el precio.
 * 3. El API rechaza un gasto negativo; vacío es null, no 0.
 * 4. FALLO VIVO que se tapa aquí: `code` no es un código SAT, es la llave
 *    `ODO_*` con la que el odontograma encuentra qué cobrar al cerrar una cita.
 *    La pantalla lo editaba bajo el rótulo «Código SAT»: vaciarlo mandaba
 *    `code: null`, rompía el enlace y el siguiente cierre de cita sembraba una
 *    fila DUPLICADA a precio de seed. El PATCH ya no escribe `code` nunca.
 */
import "../../../../lib/sabina/engine-sin-server-only"; // PRIMERO: snapshot.ts importa "server-only" (este shim aguanta los mocks de módulo)
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { margenDe } from "../../../dashboard/procedures/margen";
import { leerGasto } from "../entrada";

const RAIZ = join(__dirname, "..", "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

/* ─── 1. El gasto no sale de cara al paciente ──────────────────────────── */

/** Los únicos sitios que pueden leer la fila entera: el panel de Procedimientos. */
const PANEL = new Set([
  "src/app/api/procedures/route.ts",
  "src/app/api/procedures/[id]/route.ts",
  "src/app/dashboard/procedures/page.tsx",
]);

const CARA_AL_PACIENTE = [
  "src/lib/whatsapp/bot/booking.ts",
  "src/lib/agenda/bot-booking-service.ts",
  "src/app/api/clinic-landing/autocompletar/route.ts",
  "src/lib/sabina/tools/procedimientos-y-precios.ts",
];

/** Texto de los argumentos de cada `procedureCatalog.find*( … )` del archivo. */
function lecturasDelCatalogo(src: string): string[] {
  const out: string[] = [];
  const re = /procedureCatalog\s*\.\s*find\w*\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;
    let hondo = 1;
    const desde = i;
    while (i < src.length && hondo > 0) {
      if (src[i] === "(") hondo++;
      else if (src[i] === ")") hondo--;
      i++;
    }
    out.push(src.slice(desde, i - 1));
  }
  return out;
}

/** Las claves del `select: { … }` de una lectura, o null si no lleva `select`. */
function clavesDelSelect(args: string): string[] | null {
  const m = /\bselect\s*:\s*\{([^{}]*)\}/.exec(args);
  if (!m) return null;
  return m[1].split(",").map((k) => k.split(":")[0].trim()).filter(Boolean);
}

function archivosTs(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) {
      if (n === "node_modules" || n === "__tests__") continue;
      archivosTs(p, out);
    } else if (/\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)) {
      out.push(p);
    }
  }
  return out;
}

for (const rel of CARA_AL_PACIENTE) {
  test(`el gasto no sale por ${rel}`, () => {
    const lecturas = lecturasDelCatalogo(leer(rel));
    assert.ok(lecturas.length > 0, `${rel} ya no lee el catálogo: revisa esta lista`);
    for (const args of lecturas) {
      const claves = clavesDelSelect(args);
      assert.ok(claves, `${rel}: lee procedureCatalog SIN select → devolvería el gasto`);
      assert.ok(!claves.includes("cost"), `${rel}: el select incluye cost`);
    }
  });
}

test("ningún lector del catálogo fuera del panel de Procedimientos lee la fila entera ni el gasto", () => {
  const vistos: string[] = [];
  for (const abs of archivosTs(join(RAIZ, "src"))) {
    const src = readFileSync(abs, "utf8");
    if (!src.includes("procedureCatalog")) continue;
    const rel = relative(RAIZ, abs).split(sep).join("/");
    if (PANEL.has(rel)) continue;
    for (const args of lecturasDelCatalogo(src)) {
      vistos.push(rel);
      const claves = clavesDelSelect(args);
      assert.ok(claves, `${rel}: lee procedureCatalog SIN select → arrastra el gasto de la clínica`);
      assert.ok(!claves.includes("cost"), `${rel}: lee cost fuera del panel de Procedimientos`);
    }
  }
  // Si esto baja a 0 el escáner dejó de ver el código y la prueba no prueba nada.
  assert.ok(vistos.length >= CARA_AL_PACIENTE.length, `solo se vieron ${vistos.length} lecturas`);
});

/* ─── 2. Sin gasto no hay margen ───────────────────────────────────────── */

test("sin gasto no hay margen: ni 0 ni el precio", () => {
  assert.equal(margenDe(1500, null), null);
  assert.equal(margenDe(1500, undefined), null);
});

test("gasto 0 sí es un dato: el margen es el precio; con gasto, precio − gasto", () => {
  assert.equal(margenDe(1500, 0), 1500);
  assert.equal(margenDe(1500, 400), 1100);
  assert.equal(margenDe(500, 800), -300); // se pierde dinero: se enseña, no se esconde
});

test("la pantalla pinta el margen con margenDe y un guion cuando no lo hay; ya no enseña ni envía code", () => {
  const src = leer("src/app/dashboard/procedures/procedures-client.tsx");
  assert.match(src, /const margen = margenDe\(p\.basePrice, p\.cost\)/);
  assert.match(src, /margen != null \? formatCurrency\(margen\) : "—"/);
  assert.match(src, /p\.cost != null \? formatCurrency\(p\.cost\) : "—"/);
  assert.doesNotMatch(src, /colSatCode/);
  assert.doesNotMatch(src, /\bcode\b/);
});

/* ─── 3 y 4. El API de verdad, con un Prisma falso ─────────────────────── */

const CLINICA = "cli_1";

interface Fila {
  id: string; clinicId: string; name: string; code: string | null; category: string;
  basePrice: number; cost: number | null; duration: number | null;
  description: string | null; isActive: boolean;
}

let filas: Fila[] = [];

function cumple(f: Fila, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v !== null && typeof v === "object") throw new Error(`where no soportado: ${k}`);
    if ((f as any)[k] !== v) return false;
  }
  return true;
}
function proyectar(f: Fila, select: any) {
  if (!select) return { ...f };
  const out: any = {};
  for (const k of Object.keys(select)) {
    if (!(k in f)) throw new Error(`select no soportado: ${k}`);
    out[k] = (f as any)[k];
  }
  return out;
}

const prismaFalso: any = {
  procedureCatalog: {
    findFirst: async ({ where, select }: any) => {
      const f = filas.find((x) => cumple(x, where));
      return f ? proyectar(f, select) : null;
    },
    findMany: async ({ where, select }: any) =>
      filas.filter((x) => cumple(x, where)).map((x) => proyectar(x, select)),
    create: async ({ data }: any) => {
      const f: Fila = { id: `proc_${filas.length + 1}`, code: null, cost: null, duration: null,
                        description: null, isActive: true, ...data };
      filas.push(f);
      return { ...f };
    },
    update: async ({ where, data }: any) => {
      const f = filas.find((x) => x.id === where.id);
      if (!f) throw new Error("no existe");
      Object.assign(f, data);
      return { ...f };
    },
  },
};

mock.module("@/lib/prisma", { namedExports: { prisma: prismaFalso } });
mock.module("@/lib/auth-context", {
  namedExports: {
    getAuthContext: async () => ({ clinicId: CLINICA, role: "ADMIN", permissionsOverride: [] }),
  },
});
mock.module("@/lib/cache/revalidate", { namedExports: { revalidateAfter: () => {} } });

async function pedir(metodo: "POST" | "PATCH", cuerpo: unknown, id?: string) {
  const { NextRequest } = await import("next/server");
  const req = new NextRequest(`http://localhost/api/procedures${id ? `/${id}` : ""}`, {
    method: metodo,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  const res = id
    ? await (await import("../[id]/route")).PATCH(req, { params: { id } })
    : await (await import("../route")).POST(req);
  return { status: res.status, json: await res.json() };
}

beforeEach(() => {
  filas = [
    // La fila que siembra el odontograma (ensureDentalCatalog).
    { id: "proc_resina", clinicId: CLINICA, name: "Restauración con resina", code: "ODO_RESINA",
      category: "dental", basePrice: 1500, cost: null, duration: 45, description: null, isActive: true },
  ];
});

test("leerGasto: vacío es null, 0 es 0, negativo y basura se rechazan", () => {
  assert.deepEqual(leerGasto(undefined), { ok: true, value: null });
  assert.deepEqual(leerGasto(null), { ok: true, value: null });
  assert.deepEqual(leerGasto("  "), { ok: true, value: null });
  assert.deepEqual(leerGasto(0), { ok: true, value: 0 });
  assert.deepEqual(leerGasto("250.5"), { ok: true, value: 250.5 });
  for (const malo of [-1, "-0.01", "abc", NaN, Infinity, true, {}, []]) {
    assert.equal(leerGasto(malo).ok, false, `debió rechazar ${String(malo)}`);
  }
});

test("POST rechaza un gasto negativo con 400 y no guarda nada", async () => {
  const r = await pedir("POST", { name: "Corona", basePrice: 4500, cost: -10 });
  assert.equal(r.status, 400);
  assert.equal(filas.length, 1);
});

test("PATCH rechaza un gasto negativo con 400 y deja la fila como estaba", async () => {
  const r = await pedir("PATCH", { basePrice: 9999, cost: -1 }, "proc_resina");
  assert.equal(r.status, 400);
  assert.equal(filas[0].basePrice, 1500);
  assert.equal(filas[0].cost, null);
});

test("POST guarda el gasto; sin gasto queda null (no 0); y crea SIN code aunque venga", async () => {
  const con = await pedir("POST", { name: "Corona", basePrice: 4500, cost: 1800, code: "ODO_CORONA" });
  assert.equal(con.status, 201);
  assert.equal(filas[1].cost, 1800);
  assert.equal(filas[1].code, null);

  const sin = await pedir("POST", { name: "Consulta", basePrice: 400, cost: "" });
  assert.equal(sin.status, 201);
  assert.equal(filas[2].cost, null);
});

test("PATCH con code en el body NO cambia el code guardado (ni a null ni a otro valor)", async () => {
  // Lo que mandaba la pantalla vieja al vaciar «Código SAT».
  const vacio = await pedir("PATCH", { name: "Resina", code: null }, "proc_resina");
  assert.equal(vacio.status, 200);
  assert.equal(filas[0].code, "ODO_RESINA");

  const otro = await pedir("PATCH", { code: "85121800" }, "proc_resina");
  assert.equal(otro.status, 200);
  assert.equal(filas[0].code, "ODO_RESINA");
});

test("una fila ODO_RESINA sigue emparejando con el odontograma tras editarle nombre, precio y gasto", async () => {
  // Exactamente lo que envía la pantalla nueva al guardar el modal.
  const r = await pedir("PATCH", {
    name: "Resina compuesta", category: "dental", basePrice: 1900, cost: 350,
    duration: 45, description: null, isActive: true,
  }, "proc_resina");
  assert.equal(r.status, 200);

  const { changesToTreatments } = await import("../../../../lib/odontogram/snapshot");
  const sugeridos = await changesToTreatments(
    [{ toothNumber: 16, surface: "O", conditionId: "restoration", type: "added" }] as any,
    CLINICA,
  );
  assert.equal(sugeridos.length, 1);
  // Empareja con la fila de la clínica (su id y su precio nuevo), no cae al seed.
  assert.equal(sugeridos[0].procedureCatalogId, "proc_resina");
  assert.equal(sugeridos[0].unitPrice, 1900);
  assert.equal(sugeridos[0].name, "Resina compuesta");
  // Y el gasto no viaja en la sugerencia.
  assert.ok(!("cost" in sugeridos[0]));
});
