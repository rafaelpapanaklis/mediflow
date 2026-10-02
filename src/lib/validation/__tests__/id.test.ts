// ws1-t12 («Invalid uuid» de BEVADENT): el id de un registro de la base se valida con idDeLaBase(), nunca con
// `z.string().uuid()`. Esta prueba fija qué acepta, qué rechaza, y que nadie vuelva a meter un `.uuid()` sobre un id
// de la base sin decir por qué.
// Run: npm run test:ids-de-la-base
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { esIdDeLaBase, idDeLaBase, LARGO_MAXIMO_DE_ID, MENSAJE_ID_INVALIDO } from "../id";

const BUENOS = [
  "cmu8a1b2c3d4e5f6g7h8i9j0k", // cuid del importador (c + 24)
  "cmu7uttes000nq2n003bhxazo", // cuid de Prisma
  "5b0c7a52-3f1e-4c8a-9d2b-6e4f1a0b9c3d", // uuid
  "5B0C7A52-3F1E-4C8A-9D2B-6E4F1A0B9C3D", // uuid en mayúsculas
  "tz4a98xxat96iws9zmbrgj3a", // cuid2 (24)
  "prueba-orto-plan-02", // siembra de «Rafael Clinica»
  "demo-altabrisa-patient-02", // siembra de demo
  "clinica_qa_prueba",
  "x".repeat(LARGO_MAXIMO_DE_ID),
];
const MALOS: unknown[] = [
  "", " ", " cmu8a1b2c3d4e5f6g7h8i9j0k", "cmu8a1b2c3d4e5f6g7h8i9j0k\n", "abc def", "../etc/passwd", "a/b", "a.b", "a'b", 'a"b',
  "1;DROP TABLE patients", "%27", "-x", "x-", "_x", "x".repeat(LARGO_MAXIMO_DE_ID + 1), null, undefined, 42, {}, ["cmu8a1b2c3d4e5f6g7h8i9j0k"],
];

test("acepta uuid, cuid/cuid2 y los ids de siembra", () => {
  for (const id of BUENOS) {
    assert.equal(esIdDeLaBase(id), true, id);
    assert.equal(idDeLaBase().safeParse(id).success, true, id);
  }
});

test("rechaza basura, con un mensaje que no habla de uuid", () => {
  for (const id of MALOS) {
    assert.equal(esIdDeLaBase(id), false, JSON.stringify(id));
    const r = idDeLaBase().safeParse(id);
    assert.equal(r.success, false, JSON.stringify(id));
  }
  const r = idDeLaBase().safeParse("abc def");
  assert.equal(r.success ? null : r.error.issues[0]?.message, MENSAJE_ID_INVALIDO);
  assert.equal(idDeLaBase().nullable().safeParse(null).success, true);
  assert.equal(idDeLaBase().optional().safeParse(undefined).success, true);
});

/**
 * Los `.uuid()` que quedan son valores que genera el SERVIDOR con randomUUID(), nunca ids de la base de un cliente.
 * Uno nuevo se añade aquí solo si es eso; si es un id de la base, va `idDeLaBase()`.
 */
const UUID_PERMITIDOS = new Map<string, string>([
  ["src/lib/sabina/dinero/avisar-saldo.ts", "intento: z.string().uuid()"], // randomUUID() de la propuesta de Sabina
]);

function archivos(dir: string, salida: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n === "__tests__" || n.startsWith(".")) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) archivos(p, salida);
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n)) salida.push(p);
  }
  return salida;
}

test("barrido: ningún `.uuid()` de zod sobre un id de la base fuera de la lista", () => {
  const raiz = join(__dirname, "..", "..", "..", "..");
  const encontrados: string[] = [];
  for (const f of archivos(join(raiz, "src"))) {
    const rel = relative(raiz, f).split("\\").join("/");
    const lineas = readFileSync(f, "utf8").split("\n");
    lineas.forEach((l, i) => {
      if (/^\s*(\/\/|\*)/.test(l)) return; // comentarios
      if (!/\.uuid\(/.test(l)) return;
      const permitido = UUID_PERMITIDOS.get(rel);
      if (permitido && l.includes(permitido)) return;
      encontrados.push(`${rel}:${i + 1}: ${l.trim()}`);
    });
  }
  assert.deepEqual(encontrados, [], "usa idDeLaBase() de src/lib/validation/id.ts");
});
