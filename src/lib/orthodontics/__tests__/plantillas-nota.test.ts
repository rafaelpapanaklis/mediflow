/**
 * Plantillas de nota de ortodoncia editables desde Administración → Plantillas (ws1-t5 · 10b).
 *
 * Run: npm run test:plantillas-orto-nota
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MARCADORES_NOTA,
  MAX_NOMBRE_NOTA,
  esDeFabrica,
  marcadoresDesconocidos,
  nombreDeCopia,
  validarCuerpoNota,
} from "../plantillas-nota";
import { rellenarMarcadores } from "../consulta-ortodoncia";
import { crearPlantillaNota, editarPlantillaNota, listarPlantillasNota, type NotaDb } from "../plantillas-nota-service";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");
const FABRICA = ["Cementado de brackets", "Activación de arco", "Control mensual general"];
const SOAP = { S: "s", O: "", A: "", P: "plan {{currentPhase}}" };

/** Un doble en memoria de prisma.clinicalEvolutionTemplate (lo justo que usa el servicio). */
function dobleDb(filas: any[]) {
  const llamadas: any[] = [];
  const coincide = (f: any, w: any) =>
    Object.entries(w).every(([k, v]) => (k === "deletedAt" ? true : f[k] === v));
  const db = {
    clinicalEvolutionTemplate: {
      findMany: async (a: any) => {
        llamadas.push(a.where);
        return filas.filter((f) => coincide(f, a.where));
      },
      findFirst: async (a: any) => {
        llamadas.push(a.where);
        return filas.find((f) => coincide(f, a.where)) ?? null;
      },
      create: async (a: any) => {
        const f = { id: `n${filas.length}`, deletedAt: null, createdAt: new Date(), updatedAt: new Date(), ...a.data };
        filas.push(f);
        return f;
      },
      update: async (a: any) => {
        const f = filas.find((x) => x.id === a.where.id)!;
        Object.assign(f, a.data);
        return f;
      },
    },
  };
  return { db: db as unknown as NotaDb, llamadas, filas };
}
const fila = (id: string, name: string, extra: any = {}) => ({
  id, clinicId: "c1", module: "orthodontics", name, soapTemplate: SOAP, proceduresPrefilled: ["activacion_arco"],
  materialsPrefilled: [], deletedAt: null, createdAt: new Date(), updatedAt: new Date(), ...extra,
});

test("cada marcador que se enseña lo rellena de verdad la hoja de control", () => {
  const ctx = { mes: 4, duracionMeses: 18, fase: "Alineación", arcoActual: "NiTi .014", arcoNuevo: "NiTi .016" };
  for (const m of MARCADORES_NOTA) {
    const salida = rellenarMarcadores(m.token, ctx);
    assert.ok(salida !== "____" && !salida.includes("{{"), `${m.token} no lo rellena la hoja`);
  }
});

test("marcadores desconocidos: solo los que la hoja no sabe, sin repetir", () => {
  assert.deepEqual(
    marcadoresDesconocidos({ S: "{{arch}} {{ monthInTreatment }}", P: "{{arch}} {{technique}}" }),
    ["arch", "technique"],
  );
});

test("fábrica: se reconoce sin importar mayúsculas ni espacios", () => {
  assert.equal(esDeFabrica("  cementado  de BRACKETS ", FABRICA), true);
  assert.equal(esDeFabrica("Mi control", FABRICA), false);
});

test("nombre de copia: sufijo, numeración y largo máximo", () => {
  assert.equal(nombreDeCopia("Control", []), "Control (copia)");
  assert.equal(nombreDeCopia("Control", ["control (COPIA)"]), "Control (copia 2)");
  const largo = nombreDeCopia("x".repeat(200), []);
  assert.ok(largo.length <= MAX_NOMBRE_NOTA && largo.endsWith(" (copia)"));
});

test("cuerpo: pide texto, al menos una sección con algo, y respeta el largo", () => {
  assert.ok("codigo" in validarCuerpoNota(null));
  assert.deepEqual(validarCuerpoNota({ S: "", O: "", A: "", P: " " }), { codigo: "SOAP_EMPTY" });
  assert.deepEqual(validarCuerpoNota({ S: "a", O: "", A: "", P: 3 }), { codigo: "SOAP_INVALID" });
  assert.deepEqual(validarCuerpoNota({ S: "a".repeat(4001), O: "", A: "", P: "" }), { codigo: "SOAP_TOO_LONG" });
  assert.ok("soap" in validarCuerpoNota(SOAP));
});

test("servicio: sin clinicId se corta antes de consultar", async () => {
  const { db, llamadas } = dobleDb([]);
  await assert.rejects(() => listarPlantillasNota(db, "", FABRICA));
  await assert.rejects(() => crearPlantillaNota(db, undefined as any, "u", { name: "a", soap: SOAP }, FABRICA));
  assert.equal(llamadas.length, 0);
});

test("servicio: lista solo la clínica, con apagadas y la marca de fábrica", async () => {
  const { db } = dobleDb([
    fila("1", "Cementado de brackets"),
    fila("2", "Mía", { deletedAt: new Date() }),
    fila("3", "De otra", { clinicId: "c2" }),
  ]);
  const r = await listarPlantillasNota(db, "c1", FABRICA);
  assert.deepEqual(r.map((x) => [x.name, x.deFabrica, x.activa]), [["Cementado de brackets", true, true], ["Mía", false, false]]);
});

test("servicio: crear rechaza nombre repetido (también apagado) y nombre de fábrica", async () => {
  const { db } = dobleDb([fila("2", "Mía", { deletedAt: new Date() })]);
  const a = await crearPlantillaNota(db, "c1", "u", { name: "mía", soap: SOAP }, FABRICA);
  assert.equal(a.ok === false && a.codigo, "NAME_TAKEN");
  const b = await crearPlantillaNota(db, "c1", "u", { name: "Activación de arco", soap: SOAP }, FABRICA);
  assert.equal(b.ok === false && b.codigo, "NAME_TAKEN");
});

test("servicio: la copia hereda procedimientos de la original y no es habitual", async () => {
  const { db, filas } = dobleDb([fila("1", "Activación de arco")]);
  const r = await crearPlantillaNota(db, "c1", "u", { name: "Activación de arco (copia)", soap: SOAP, copiaDe: "1" }, FABRICA);
  assert.equal(r.ok, true);
  const nueva = filas[1];
  assert.deepEqual(nueva.proceduresPrefilled, ["activacion_arco"]);
  assert.equal(nueva.isDefault, false);
  assert.equal(nueva.createdBy, "u");
  const ajena = await crearPlantillaNota(db, "c9", "u", { name: "X", soap: SOAP, copiaDe: "1" }, FABRICA);
  assert.equal(ajena.ok === false && ajena.codigo, "NOT_FOUND");
});

test("servicio: la de fábrica no se edita ni se renombra, pero sí se apaga y se enciende", async () => {
  const { db, filas } = dobleDb([fila("1", "Cementado de brackets")]);
  const e = await editarPlantillaNota(db, "c1", "1", { soap: SOAP }, FABRICA);
  assert.equal(e.ok === false && e.codigo, "FACTORY_READONLY");
  const n = await editarPlantillaNota(db, "c1", "1", { name: "Otro" }, FABRICA);
  assert.equal(n.ok === false && n.codigo, "FACTORY_READONLY");
  const off = await editarPlantillaNota(db, "c1", "1", { activa: false }, FABRICA);
  assert.equal(off.ok === true && off.plantilla.activa, false);
  assert.ok(filas[0].deletedAt instanceof Date);
  const on = await editarPlantillaNota(db, "c1", "1", { activa: true }, FABRICA);
  assert.equal(on.ok === true && on.plantilla.activa, true);
  assert.equal(filas[0].deletedAt, null);
});

test("servicio: editar una propia cambia nombre y texto; de otra clínica no existe", async () => {
  const { db, filas } = dobleDb([fila("1", "Mía"), fila("2", "Otra")]);
  const r = await editarPlantillaNota(db, "c1", "1", { name: " Mía v2 ", soap: SOAP }, FABRICA);
  assert.equal(r.ok === true && r.plantilla.name, "Mía v2");
  assert.equal(filas[0].name, "Mía v2");
  const choque = await editarPlantillaNota(db, "c1", "1", { name: "otra" }, FABRICA);
  assert.equal(choque.ok === false && choque.codigo, "NAME_TAKEN");
  const ajena = await editarPlantillaNota(db, "c9", "1", { name: "Z" }, FABRICA);
  assert.equal(ajena.ok === false && ajena.codigo, "NOT_FOUND");
});

test("las rutas piden el permiso de Plantillas y el módulo, y leen el clinicId de la sesión", () => {
  for (const rel of ["src/app/api/orthodontics/note-templates/route.ts", "src/app/api/orthodontics/note-templates/[id]/route.ts"]) {
    const src = leer(rel);
    assert.match(src, /denyIfMissingPermission\(ctx, TEMPLATES_WRITE_PERMISSION\)/, rel);
    assert.match(src, /hasActiveOrthodonticsModule\(ctx\.clinicId\)/, rel);
    assert.match(src, /ctx\.clinicId/, rel);
    assert.ok(!/body\??\.clinicId/.test(src), `${rel} lee clinicId del cuerpo`);
    assert.match(src, /auditClinicalShared/, `${rel} no deja rastro`);
  }
});

test("la página de Plantillas solo ofrece la pestaña con el módulo y sin colores a mano", () => {
  assert.match(leer("src/app/dashboard/plantillas/page.tsx"), /hasActiveOrthodonticsModule\(user\.clinicId\)/);
  for (const rel of ["plantillas-orto.tsx", "plantilla-orto-modal.tsx"]) {
    const src = leer(`src/app/dashboard/plantillas/${rel}`);
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(src), `${rel} trae un color a mano`);
  }
});

test("los textos nuevos existen en es y en, con los mismos marcadores y errores", () => {
  const es = JSON.parse(leer("src/i18n/dictionaries/es.json")).pages.plantillas;
  const en = JSON.parse(leer("src/i18n/dictionaries/en.json")).pages.plantillas;
  assert.ok(es.tabOrto && en.tabOrto);
  for (const m of MARCADORES_NOTA) {
    assert.ok(es.orto.marcadores[m.labelKey] && en.orto.marcadores[m.labelKey], m.labelKey);
  }
  const claves = (o: any, p = ""): string[] =>
    Object.entries(o).flatMap(([k, v]) => (typeof v === "object" ? claves(v, `${p}${k}.`) : [`${p}${k}`]));
  assert.deepEqual(claves(es.orto).sort(), claves(en.orto).sort());
  for (const codigo of ["NAME_TAKEN", "FACTORY_READONLY", "SOAP_EMPTY", "MODULE_REQUIRED", "NOT_FOUND"]) {
    assert.ok(es.orto.errores[codigo], codigo);
  }
});
