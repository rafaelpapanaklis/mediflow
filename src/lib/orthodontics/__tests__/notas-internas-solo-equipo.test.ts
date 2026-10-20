/**
 * Ortodoncia — «Notas internas»: son SOLO-EQUIPO. Esta prueba lee los FUENTES (sin base) y FALLA si algo que
 * llega al paciente toca las notas internas.
 *
 *   npm run test:ortho-notas-internas
 *
 * Dos redes, para que no baste con esconder el nombre:
 *  A · TEXTO: ningún archivo del portal del paciente, del PDF del expediente (y los PDF del caso), de los
 *      mensajes ni del bot de WhatsApp menciona el servicio, la base, la ruta, la tabla ni la herramienta de
 *      Sabina de las notas internas.
 *  B · GRAFO: partiendo de esos mismos archivos, siguiendo cada `import` / `import()` / `require()` hacia
 *      adentro del repo, NINGÚN módulo de las notas internas es alcanzable. Un import indirecto (portal →
 *      ayudante → servicio) también la tumba.
 *  C · El detector se prueba a sí mismo con fuentes inventadas: si alguien añade el import al portal, esto se pone rojo.
 *  D · El módulo lleva su marca y no hay forma de borrar (ni DELETE en la ruta, ni DELETE FROM en el código).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const RAIZ = resolve(__dirname, "..", "..", "..", "..");
const SRC = join(RAIZ, "src");
const rel = (p: string) => relative(RAIZ, p).split("\\").join("/");

/** Lo que identifica a las notas internas en un fuente (nombres de archivo, tabla, ruta, herramienta, marca). */
const FIRMAS = [
  "notas-internas",
  "notas_internas",
  "NotasInternas",
  "notasInternas",
  "internal-notes",
  "internal_notes",
  "ortho_internal_note",
  "orto_notas_internas",
  "ortoNotasInternas",
  "NOTAS_INTERNAS_SOLO_EQUIPO",
];

/** Los módulos de las notas internas (lo que NO puede alcanzar nada del lado del paciente). */
const MODULOS_SOLO_EQUIPO = [
  "src/lib/orthodontics/notas-internas-service.ts",
  "src/lib/orthodontics/notas-internas-db.ts",
  "src/lib/orthodontics/notas-internas-acceso.ts",
  "src/lib/orthodontics/notas-internas-guarda.ts",
  "src/app/api/orthodontics/internal-notes/route.ts",
  "src/app/api/orthodontics/internal-notes/[id]/route.ts",
  "src/lib/sabina/tools/orto-notas-internas.ts",
  "src/components/specialties/orthodontics/redesign/NotasInternas.tsx",
  "src/components/specialties/orthodontics/redesign/notas-internas-textos.ts",
];

/** Lo que llega al paciente: carpetas (todo lo que cuelga) o archivos sueltos. */
const LADO_PACIENTE: Record<string, { rutas: string[]; minimo: number }> = {
  "portal del paciente": {
    rutas: [
      "src/app/api/paciente",
      "src/app/paciente",
      "src/app/portal",
      "src/app/api/portal",
      "src/lib/patient-portal",
      "src/components/paciente",
    ],
    minimo: 40,
  },
  "PDF del expediente (y los PDF del caso)": {
    rutas: [
      "src/app/api/patients/[id]/expediente-pdf",
      "src/app/api/patients/[id]/export-cda",
      "src/lib/pdf",
      "src/lib/hl7",
      "src/lib/orthodontics/expediente-ortodoncia-db.ts",
      "src/lib/orthodontics/pdf",
      "src/lib/orthodontics/pdf-templates",
      "src/app/api/orthodontics/treatment-plans",
    ],
    minimo: 25,
  },
  "mensajes y bot de WhatsApp": {
    rutas: [
      "src/lib/whatsapp",
      "src/app/api/whatsapp",
      "src/lib/reminders",
      "src/lib/orthodontics/mensaje-mensualidad.ts",
      "src/lib/orthodontics/plantillas-mensaje.ts",
    ],
    minimo: 40,
  },
  // ws1-t8 · P13: lo que sale de la clínica por otros caminos que el portal, el PDF y los mensajes.
  "páginas compartidas, exportación del paciente (ARCO), crons y asistente de IA": {
    rutas: [
      "src/app/share",
      "src/app/r",
      "src/app/api/patients/[id]/export",
      "src/lib/arco",
      "src/app/api/cron",
      "src/lib/ai-assistant",
      // ws1-t8 · N-P9: acciones que generan PDF y documentos que salen de la clínica, y los Excel.
      "src/app/actions/orthodontics/exportComparisonPdf.ts",
      "src/app/actions/orthodontics/exportFinancialAgreementPdf.ts",
      "src/app/actions/orthodontics/exportReferralProgressLetterPdf.ts",
      "src/app/actions/orthodontics/exportTreatmentPlanPdf.ts",
      "src/app/actions/clinical-shared/export-module.ts",
      "src/lib/excel",
    ],
    minimo: 40,
  },
};

const ES_FUENTE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const ES_PRUEBA = /\.(test|spec)\.[a-z]+$/;

function archivosDe(ruta: string): string[] {
  const abs = join(RAIZ, ruta);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return ES_FUENTE.test(abs) ? [abs] : [];
  return readdirSync(abs).flatMap((n) => {
    const p = join(abs, n);
    if (statSync(p).isDirectory()) return n === "__tests__" ? [] : archivosDe(rel(p));
    return ES_FUENTE.test(n) && !ES_PRUEBA.test(n) ? [p] : [];
  });
}

/* ═════════ El detector (puro: recibe cómo leer, así se prueba con fuentes inventadas) ═════════ */

type Lector = (rutaAbsoluta: string) => string | null;

/** Archivos cuyo texto contiene alguna firma de las notas internas. */
function archivosConFirma(archivos: string[], leer: Lector): string[] {
  return archivos.filter((a) => {
    const texto = leer(a);
    return texto !== null && FIRMAS.some((f) => texto.includes(f));
  });
}

const ESPECIFICADORES = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']([^"']+)["']/g;
const EXTENSIONES = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", "/index.ts", "/index.tsx", "/index.js"];

function resolverEspecificador(desde: string, esp: string, leer: Lector): string | null {
  let base: string;
  if (esp.startsWith("@/")) base = join(SRC, esp.slice(2));
  else if (esp.startsWith(".")) base = resolve(dirname(desde), esp);
  else return null; // paquete de npm: no es del repo
  for (const ext of EXTENSIONES) {
    const candidato = base + ext;
    if (ES_FUENTE.test(candidato) && leer(candidato) !== null) return candidato;
  }
  return null;
}

/** Todo lo alcanzable desde `raices` siguiendo imports locales. */
function alcanzables(raices: string[], leer: Lector): Set<string> {
  const vistos = new Set<string>();
  const cola = [...raices];
  while (cola.length) {
    const actual = cola.pop()!;
    if (vistos.has(actual)) continue;
    vistos.add(actual);
    const texto = leer(actual);
    if (texto === null) continue;
    for (const m of texto.matchAll(ESPECIFICADORES)) {
      const destino = resolverEspecificador(actual, m[1], leer);
      if (destino && !vistos.has(destino)) cola.push(destino);
    }
  }
  return vistos;
}

/** De las raíces a un módulo prohibido: el camino (para el mensaje del fallo). */
function caminoHasta(raices: string[], prohibidos: Set<string>, leer: Lector): string[] | null {
  const padre = new Map<string, string | null>();
  const cola: string[] = [];
  for (const r of raices) {
    padre.set(r, null);
    cola.push(r);
  }
  while (cola.length) {
    const actual = cola.shift()!;
    if (prohibidos.has(actual)) {
      const camino: string[] = [];
      for (let p: string | null = actual; p; p = padre.get(p) ?? null) camino.unshift(rel(p));
      return camino;
    }
    const texto = leer(actual);
    if (texto === null) continue;
    for (const m of texto.matchAll(ESPECIFICADORES)) {
      const destino = resolverEspecificador(actual, m[1], leer);
      if (destino && !padre.has(destino)) {
        padre.set(destino, actual);
        cola.push(destino);
      }
    }
  }
  return null;
}

const leerDisco: Lector = (p) => {
  try {
    return statSync(p).isFile() ? readFileSync(p, "utf8") : null;
  } catch {
    return null;
  }
};
const memo = new Map<string, string | null>();
const leerConMemoria: Lector = (p) => {
  if (!memo.has(p)) memo.set(p, leerDisco(p));
  return memo.get(p)!;
};

const prohibidosAbs = new Set(MODULOS_SOLO_EQUIPO.map((m) => join(RAIZ, m)));

/* ═════════ A y B · sobre el repo de verdad ═════════ */

for (const [nombre, { rutas, minimo }] of Object.entries(LADO_PACIENTE)) {
  const archivos = Array.from(new Set(rutas.flatMap(archivosDe)));

  test(`${nombre}: la prueba no se quedó ciega (lee al menos ${minimo} fuentes)`, () => {
    assert.ok(archivos.length >= minimo, `solo ${archivos.length} fuentes en ${rutas.join(", ")}: ¿se movió una carpeta?`);
  });

  test(`🔴 ${nombre}: ningún fuente menciona las notas internas`, () => {
    const culpables = archivosConFirma(archivos, leerConMemoria).map(rel);
    assert.deepEqual(culpables, [], `las notas internas son SOLO-EQUIPO; estos archivos las mencionan:\n  ${culpables.join("\n  ")}`);
  });

  test(`🔴 ${nombre}: ningún módulo de las notas internas es alcanzable por imports`, () => {
    const camino = caminoHasta(archivos, prohibidosAbs, leerConMemoria);
    assert.equal(camino, null, `las notas internas son SOLO-EQUIPO; se llega a ellas por:\n  ${camino?.join("\n  → ")}`);
  });
}

// N-P9 (ws1-t8): una ruta mal escrita no vigila nada y el total mínimo no lo notaría. Cada ruta vigilada tiene que
// existir y aportar al menos una fuente; si la carpeta se mueve, esta prueba avisa en vez de quedarse ciega.
test("cada ruta vigilada existe y aporta fuentes (nada vigilado por un nombre mal escrito)", () => {
  const sinFuentes = Object.values(LADO_PACIENTE)
    .flatMap((g) => g.rutas)
    .filter((r) => !existsSync(join(RAIZ, r)) || archivosDe(r).length === 0);
  assert.deepEqual(sinFuentes, [], `rutas vigiladas que no existen o están vacías:\n  ${sinFuentes.join("\n  ")}`);
});

test("las acciones que generan PDF/Excel que salen de la clínica están vigiladas", () => {
  const vigiladas = new Set(Object.values(LADO_PACIENTE).flatMap((g) => g.rutas));
  for (const r of [
    "src/app/actions/orthodontics/exportTreatmentPlanPdf.ts",
    "src/app/actions/orthodontics/exportComparisonPdf.ts",
    "src/app/actions/orthodontics/exportReferralProgressLetterPdf.ts",
    "src/app/actions/orthodontics/exportFinancialAgreementPdf.ts",
    "src/app/actions/clinical-shared/export-module.ts",
    "src/lib/excel",
  ]) {
    assert.ok(vigiladas.has(r), r);
    assert.ok(archivosDe(r).length > 0, r);
  }
});

/* ═════════ C · el detector puede fallar de verdad ═════════ */

test("🔴 el detector se pone rojo si alguien añade el import (directo, indirecto, dinámico o por nombre)", () => {
  const raiz = "/virtual";
  const archivo = (p: string) => join(RAIZ, p);
  const servicio = archivo("src/lib/orthodontics/notas-internas-service.ts");
  const base: Record<string, string> = {
    [servicio]: "export const MARCA = 1;",
    [archivo("src/lib/patient-portal/limpio.ts")]: `import { x } from "@/lib/otra-cosa";`,
    [archivo("src/lib/otra-cosa.ts")]: "export const x = 1;",
  };
  const leerVirtual = (fuentes: Record<string, string>): Lector => (p) => (p in fuentes ? fuentes[p] : null);
  const prohibidos = new Set([servicio]);
  void raiz;

  // Sano: nada.
  const sano = leerVirtual(base);
  assert.deepEqual(archivosConFirma([archivo("src/lib/patient-portal/limpio.ts")], sano), []);
  assert.equal(caminoHasta([archivo("src/lib/patient-portal/limpio.ts")], prohibidos, sano), null);

  // 1 · import directo del servicio desde el portal.
  const directo = leerVirtual({
    ...base,
    [archivo("src/lib/patient-portal/limpio.ts")]: `import { listarNotas } from "@/lib/orthodontics/notas-internas-service";`,
  });
  assert.deepEqual(archivosConFirma([archivo("src/lib/patient-portal/limpio.ts")], directo), [archivo("src/lib/patient-portal/limpio.ts")]);
  assert.deepEqual(caminoHasta([archivo("src/lib/patient-portal/limpio.ts")], prohibidos, directo), [
    "src/lib/patient-portal/limpio.ts",
    "src/lib/orthodontics/notas-internas-service.ts",
  ]);

  // 2 · import relativo, con el nombre escondido detrás de un ayudante (no hay firma en el portal, pero el grafo la ve).
  const indirecto = leerVirtual({
    ...base,
    [archivo("src/lib/patient-portal/limpio.ts")]: `import { y } from "../otra-cosa";`,
    [archivo("src/lib/otra-cosa.ts")]: `export { listarNotas as y } from "./orthodontics/notas-internas-service";`,
  });
  assert.deepEqual(archivosConFirma([archivo("src/lib/patient-portal/limpio.ts")], indirecto), [], "el portal no nombra nada");
  assert.ok(caminoHasta([archivo("src/lib/patient-portal/limpio.ts")], prohibidos, indirecto), "pero el grafo llega al servicio");

  // 3 · import dinámico y require.
  for (const linea of [
    `const m = await import("@/lib/orthodontics/notas-internas-service");`,
    `const m = require("@/lib/orthodontics/notas-internas-service");`,
  ]) {
    const f = leerVirtual({ ...base, [archivo("src/lib/patient-portal/limpio.ts")]: linea });
    assert.ok(caminoHasta([archivo("src/lib/patient-portal/limpio.ts")], prohibidos, f), linea);
  }

  // 4 · la tabla o la ruta por nombre, sin import.
  for (const linea of [
    `await prisma.$queryRaw\`SELECT * FROM ortho_internal_notes\`;`,
    `fetch("/api/orthodontics/internal-notes?caseId=1");`,
    `const t = "orto_notas_internas";`,
  ]) {
    const f = leerVirtual({ ...base, [archivo("src/lib/patient-portal/limpio.ts")]: linea });
    assert.equal(archivosConFirma([archivo("src/lib/patient-portal/limpio.ts")], f).length, 1, linea);
  }
});

test("el detector sigue los alias y los index (para que un import por carpeta no se escape)", () => {
  const f: Record<string, string> = {
    [join(SRC, "lib/a/index.ts")]: `import "../orthodontics/notas-internas-db";`,
    [join(SRC, "lib/orthodontics/notas-internas-db.ts")]: "export {};",
    [join(SRC, "app/api/paciente/x/route.ts")]: `import { q } from "@/lib/a";`,
  };
  const leer: Lector = (p) => (p in f ? f[p] : null);
  const camino = caminoHasta([join(SRC, "app/api/paciente/x/route.ts")], new Set([join(SRC, "lib/orthodontics/notas-internas-db.ts")]), leer);
  assert.deepEqual(camino, ["src/app/api/paciente/x/route.ts", "src/lib/a/index.ts", "src/lib/orthodontics/notas-internas-db.ts"]);
  assert.ok(alcanzables([join(SRC, "app/api/paciente/x/route.ts")], leer).has(join(SRC, "lib/orthodontics/notas-internas-db.ts")));
});

/* ═════════ D · marca y «nada se borra» ═════════ */

test("los módulos de las notas internas llevan la marca NOTAS_INTERNAS_SOLO_EQUIPO", () => {
  for (const m of MODULOS_SOLO_EQUIPO) {
    const texto = leerDisco(join(RAIZ, m));
    assert.notEqual(texto, null, `falta ${m}`);
    assert.match(texto!, /NOTAS_INTERNAS_SOLO_EQUIPO|SOLO-EQUIPO|solo-equipo/, `${m} no dice que es solo-equipo`);
  }
  assert.match(leerDisco(join(RAIZ, MODULOS_SOLO_EQUIPO[0]))!, /NOTAS_INTERNAS_SOLO_EQUIPO/, "el servicio lleva la marca exacta");
});

test("🔴 nada se borra: las rutas no exportan DELETE/PUT y el código no tiene DELETE FROM", () => {
  for (const m of MODULOS_SOLO_EQUIPO.filter((x) => x.includes("/api/"))) {
    const texto = leerDisco(join(RAIZ, m))!;
    assert.doesNotMatch(texto, /export\s+(async\s+)?function\s+(DELETE|PUT)\b/, `${m} expone DELETE/PUT`);
    assert.doesNotMatch(texto, /export\s+const\s+(DELETE|PUT)\b/, `${m} expone DELETE/PUT`);
  }
  for (const m of MODULOS_SOLO_EQUIPO) {
    const texto = leerDisco(join(RAIZ, m))!;
    assert.doesNotMatch(texto, /DELETE\s+FROM/i, `${m} borra filas`);
    assert.doesNotMatch(texto, /\.(delete|deleteMany)\s*\(/, `${m} borra con Prisma`);
    assert.doesNotMatch(texto, /method:\s*["']DELETE["']/, `${m} manda un DELETE`);
  }
  // Y la tabla, además, lo impide por regla (por si alguien lo intenta a mano).
  const sql = leerDisco(join(RAIZ, "sql/salamanca-plantillas-orto-notas-internas.sql"));
  assert.notEqual(sql, null);
  assert.match(sql!, /ortho_internal_notes_sin_delete[\s\S]*DO INSTEAD NOTHING/);
  assert.match(sql!, /ortho_internal_note_revisions_sin_delete[\s\S]*DO INSTEAD NOTHING/);
  assert.match(sql!, /ortho_internal_note_revisions_sin_update[\s\S]*DO INSTEAD NOTHING/);
  assert.doesNotMatch(sql!.replace(/--.*$/gm, ""), /\bDROP\b|\bTRUNCATE\b|DELETE\s+FROM/i);
  assert.doesNotMatch(sql!, /REFERENCES/i, "sin llaves foráneas: borrar un paciente no arrastra el historial");
});

test("toda consulta de la base lleva clinicId y el código no lo deja pasar vacío", () => {
  const db = leerDisco(join(RAIZ, "src/lib/orthodontics/notas-internas-db.ts"))!;
  assert.match(db, /function exigirClinica/);
  for (const bloque of db.split(/\$queryRaw<|\$executeRaw/).slice(2)) {
    // cada sentencia (salvo la sonda to_regclass, que está antes del corte) filtra por "clinicId"
    const hasta = bloque.slice(0, 900);
    assert.match(hasta, /"clinicId"/, `una consulta sin clinicId:\n${hasta.slice(0, 200)}`);
  }
  // Las rutas sacan el clinicId de la sesión, no del cuerpo ni de la URL.
  for (const r of MODULOS_SOLO_EQUIPO.filter((x) => x.includes("/api/"))) {
    const texto = leerDisco(join(RAIZ, r))!;
    assert.doesNotMatch(texto, /searchParams\.get\(["']clinicId["']\)|body\??\.clinicId/, `${r} lee el clinicId del cliente`);
  }
});
