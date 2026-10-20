/**
 * Plantillas de fábrica editables por clínica (ws1-t6).
 *
 * Run: npm run test:plantillas-fabrica
 *
 * Fija, sin base de datos:
 *  - Notas de ortodoncia: editar una de fábrica guarda la VERSIÓN DE ESA CLÍNICA; la
 *    fila de fábrica no se toca, otra clínica sigue viendo la de fábrica, el selector
 *    de la hoja lee la versión, «volver a la de fábrica» la archiva sin borrar.
 *  - Indicaciones y constancia: lo mismo, con el repositorio `conVersiones`.
 *  - Consentimientos: volver al texto del catálogo deja el de la clínica archivado.
 *  - Sin la tabla (falta el SQL): las de fábrica siguen de solo lectura.
 *  - El SQL es aditivo; las rutas piden el permiso de Plantillas; la copia de sede
 *    lleva las versiones; los textos existen en es y en.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoVersionesEnMemoria } from "../en-memoria";
import { difiere } from "../versiones";
import {
  editarPlantillaNota,
  listarPlantillasNota,
  soapVigente,
  versionesVigentes,
  volverAFabricaNota,
  type NotaDb,
} from "@/lib/orthodontics/plantillas-nota-service";
import { conVersiones } from "@/lib/indicaciones/con-versiones";
import { editarHoja, listarHojas, volverAFabricaHoja, type FilaHoja, type FilaNueva, type RepoHojas } from "@/lib/indicaciones/servicio";
import {
  consentimientoModificado,
  consentimientosDeFabrica,
  fabricaDeConsentimiento,
  volverAFabricaConsentimiento,
} from "../consentimiento";
import type { TemplateDb } from "@/lib/document-templates/service";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

// ─── Notas de ortodoncia ────────────────────────────────────────────────────

const FABRICA = ["Cementado de brackets", "Activación de arco", "Control mensual general"];
const SOAP_FABRICA = { S: "fábrica S", O: "fábrica O", A: "fábrica A", P: "fábrica P" };
const SOAP_CLINICA = { S: "mía S", O: "", A: "", P: "mi plan {{currentPhase}}" };

function dobleDb(filas: any[]) {
  const coincide = (f: any, w: any) => Object.entries(w).every(([k, v]) => (k === "deletedAt" ? true : f[k] === v));
  const db = {
    clinicalEvolutionTemplate: {
      findMany: async (a: any) => filas.filter((f) => coincide(f, a.where)),
      findFirst: async (a: any) => filas.find((f) => coincide(f, a.where)) ?? null,
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
  return db as unknown as NotaDb;
}
const fila = (id: string, name: string, clinicId = "c1", extra: any = {}) => ({
  id, clinicId, module: "orthodontics", name, soapTemplate: SOAP_FABRICA, proceduresPrefilled: ["activacion_arco"],
  materialsPrefilled: [], deletedAt: null, createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"), ...extra,
});

test("orto: editar una de fábrica guarda la versión de ESA clínica y no toca la fila de fábrica", async () => {
  const filas = [fila("1", "Cementado de brackets"), fila("2", "Cementado de brackets", "c2")];
  const db = dobleDb(filas);
  const versiones = repoVersionesEnMemoria();
  const r = await editarPlantillaNota(db, "c1", "1", { soap: SOAP_CLINICA }, FABRICA, { versiones, userId: "u1" });
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.plantilla.id, "1", "el id es el de siempre: lo que la referencia sigue valiendo");
  assert.equal(r.ok && r.plantilla.versionDeClinica, true);
  assert.equal(r.ok && r.plantilla.soap.S, "mía S");
  assert.equal(r.ok && r.plantilla.deFabrica, true, "sigue siendo la de fábrica: el nombre no cambia");
  assert.deepEqual(filas[0].soapTemplate, SOAP_FABRICA, "la fila de fábrica NO se reescribe");
  assert.equal(versiones.filas.length, 1);
  assert.equal(versiones.filas[0].clinicId, "c1");
  assert.equal(versiones.filas[0].createdById, "u1");
});

test("orto: otra clínica sigue viendo la de fábrica", async () => {
  const filas = [fila("1", "Cementado de brackets"), fila("2", "Cementado de brackets", "c2")];
  const db = dobleDb(filas);
  const versiones = repoVersionesEnMemoria();
  await editarPlantillaNota(db, "c1", "1", { soap: SOAP_CLINICA }, FABRICA, { versiones, userId: "u1" });
  const c1 = await listarPlantillasNota(db, "c1", FABRICA, versiones);
  const c2 = await listarPlantillasNota(db, "c2", FABRICA, versiones);
  assert.equal(c1[0].soap.S, "mía S");
  assert.equal(c1[0].versionDeClinica, true);
  assert.equal(c2[0].soap.S, "fábrica S");
  assert.equal(c2[0].versionDeClinica, false);
});

test("orto: el selector de la hoja lee la versión de la clínica (soapVigente) y no la de otra", async () => {
  const db = dobleDb([fila("1", "Cementado de brackets")]);
  const versiones = repoVersionesEnMemoria();
  await editarPlantillaNota(db, "c1", "1", { soap: SOAP_CLINICA }, FABRICA, { versiones, userId: "u1" });
  const deC1 = await versionesVigentes(versiones, "c1");
  const deC2 = await versionesVigentes(versiones, "c2");
  assert.deepEqual(soapVigente("Cementado de brackets", SOAP_FABRICA, deC1), { S: "mía S", O: "", A: "", P: "mi plan {{currentPhase}}" });
  assert.deepEqual(soapVigente("Cementado de brackets", SOAP_FABRICA, deC2), SOAP_FABRICA);
  // Una propia (sin versión) nunca se toca.
  assert.deepEqual(soapVigente("Mi nota", SOAP_FABRICA, deC1), SOAP_FABRICA);
});

test("orto: la de fábrica no se renombra; mandar su mismo nombre no estorba", async () => {
  const db = dobleDb([fila("1", "Cementado de brackets")]);
  const versiones = repoVersionesEnMemoria();
  const ctx = { versiones, userId: "u1" };
  const otro = await editarPlantillaNota(db, "c1", "1", { name: "Otro", soap: SOAP_CLINICA }, FABRICA, ctx);
  assert.equal(otro.ok === false && otro.codigo, "FACTORY_READONLY");
  assert.equal(versiones.filas.length, 0, "no se guardó nada a medias");
  const igual = await editarPlantillaNota(db, "c1", "1", { name: " cementado de brackets ", soap: SOAP_CLINICA }, FABRICA, ctx);
  assert.equal(igual.ok, true);
});

test("orto: sin la tabla de versiones la de fábrica sigue de solo lectura", async () => {
  const db = dobleDb([fila("1", "Cementado de brackets")]);
  const sinCtx = await editarPlantillaNota(db, "c1", "1", { soap: SOAP_CLINICA }, FABRICA);
  assert.equal(sinCtx.ok === false && sinCtx.codigo, "FACTORY_READONLY");
  const versiones = repoVersionesEnMemoria({ disponible: false });
  const sinTabla = await editarPlantillaNota(db, "c1", "1", { soap: SOAP_CLINICA }, FABRICA, { versiones, userId: "u1" });
  assert.equal(sinTabla.ok === false && sinTabla.codigo, "VERSIONES_NO_DISPONIBLES");
  assert.equal(sinTabla.ok === false && sinTabla.status, 503);
  // Y apagarla sigue funcionando.
  const off = await editarPlantillaNota(db, "c1", "1", { activa: false }, FABRICA, { versiones, userId: "u1" });
  assert.equal(off.ok && off.plantilla.activa, false);
});

test("orto: volver a la de fábrica ARCHIVA la versión (no la borra) y devuelve el texto de fábrica", async () => {
  const db = dobleDb([fila("1", "Cementado de brackets")]);
  const versiones = repoVersionesEnMemoria();
  const ctx = { versiones, userId: "u1" };
  await editarPlantillaNota(db, "c1", "1", { soap: SOAP_CLINICA }, FABRICA, ctx);
  const r = await volverAFabricaNota(db, "c1", "1", FABRICA, ctx);
  assert.equal(r.ok && r.plantilla.versionDeClinica, false);
  assert.equal(r.ok && r.plantilla.soap.S, "fábrica S");
  assert.equal(versiones.filas.length, 1, "la fila sigue ahí");
  assert.ok(versiones.filas[0].archivedAt instanceof Date);
  // Editar otra vez crea una versión nueva vigente; la archivada se queda.
  await editarPlantillaNota(db, "c1", "1", { soap: { ...SOAP_CLINICA, S: "otra" } }, FABRICA, ctx);
  assert.equal(versiones.filas.length, 2);
  assert.equal(versiones.filas.filter((v) => v.archivedAt === null).length, 1);
});

test("orto: volver a la de fábrica solo vale para las de fábrica y de la propia clínica", async () => {
  const db = dobleDb([fila("1", "Cementado de brackets"), fila("2", "Mía"), fila("3", "Cementado de brackets", "c2")]);
  const ctx = { versiones: repoVersionesEnMemoria(), userId: "u1" };
  const propia = await volverAFabricaNota(db, "c1", "2", FABRICA, ctx);
  assert.equal(propia.ok === false && propia.codigo, "NOT_FACTORY");
  const ajena = await volverAFabricaNota(db, "c1", "3", FABRICA, ctx);
  assert.equal(ajena.ok === false && ajena.codigo, "NOT_FOUND");
});

test("orto: sin clinicId se corta antes de consultar", async () => {
  const db = dobleDb([fila("1", "Cementado de brackets")]);
  await assert.rejects(() => listarPlantillasNota(db, "", FABRICA, repoVersionesEnMemoria()));
  await assert.rejects(() => versionesVigentes(repoVersionesEnMemoria(), ""));
  await assert.rejects(() => repoVersionesEnMemoria().activas("", "ORTO_NOTA"));
});

// ─── Indicaciones y constancia ──────────────────────────────────────────────

function repoHojasEnMemoria() {
  const filas: FilaHoja[] = [];
  let n = 0;
  const reloj = () => new Date(Date.UTC(2026, 9, 3, 12, 0, n++));
  const repo: RepoHojas = {
    async tablaExiste() {
      return true;
    },
    async listar(clinicId, tipo) {
      return filas.filter((f) => f.clinicId === clinicId && (!tipo || f.tipo === tipo)).map((f) => ({ ...f }));
    },
    async obtener(clinicId, id) {
      const f = filas.find((x) => x.id === id && x.clinicId === clinicId);
      return f ? { ...f } : null;
    },
    async insertar(f: FilaNueva) {
      const fila: FilaHoja = { ...f, id: `h${filas.length + 1}`, activa: true, createdAt: reloj(), updatedAt: reloj() };
      filas.push(fila);
      return { ...fila };
    },
    async sembrar(nuevas) {
      for (const f of nuevas) filas.push({ ...f, id: `h${filas.length + 1}`, activa: true, createdAt: reloj(), updatedAt: reloj() });
    },
    async actualizar(clinicId, id, c) {
      const f = filas.find((x) => x.id === id && x.clinicId === clinicId);
      if (!f) return null;
      Object.assign(f, {
        ...(c.nombre !== undefined ? { nombre: c.nombre } : {}),
        ...(c.cuerpo !== undefined ? { cuerpo: c.cuerpo } : {}),
        ...(c.procedureIds !== undefined ? { procedureIds: c.procedureIds } : {}),
        ...(c.activa !== undefined ? { activa: c.activa } : {}),
        updatedAt: reloj(),
      });
      return { ...f };
    },
  };
  return { repo, filas };
}

async function conHojasDeFabrica() {
  const { repo, filas } = repoHojasEnMemoria();
  const versiones = repoVersionesEnMemoria();
  const vigente = conVersiones(repo, versiones);
  const lista = (await listarHojas(vigente, "c1", async () => [])) ?? [];
  await listarHojas(vigente, "c2", async () => []);
  return { repo, filas, versiones, vigente, lista };
}

test("hojas: editar una de fábrica guarda la versión de la clínica; la fila de fábrica queda igual", async () => {
  const { filas, versiones, vigente, lista } = await conHojasDeFabrica();
  const extraccion = lista.find((h) => h.basadaEn === "extraccion" && h.deFabrica)!;
  const textoFabrica = extraccion.cuerpo;
  const r = await editarHoja(vigente, "c1", extraccion.id, { cuerpo: "Mi texto de extracción" }, [], { versiones, userId: "u1" });
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.hoja.cuerpo, "Mi texto de extracción");
  assert.equal(r.ok && r.hoja.versionDeClinica, true);
  assert.equal(r.ok && r.hoja.deFabrica, true);
  assert.equal(filas.find((f) => f.id === extraccion.id)!.cuerpo, textoFabrica, "la fila de fábrica NO se reescribe");
  // La cita (listarHojas por el repo de la clínica) ve la versión; otra clínica, la de fábrica.
  const deC1 = (await listarHojas(vigente, "c1", async () => []))!.find((h) => h.id === extraccion.id)!;
  assert.equal(deC1.cuerpo, "Mi texto de extracción");
  const deC2 = (await listarHojas(vigente, "c2", async () => []))!.find((h) => h.basadaEn === "extraccion")!;
  assert.equal(deC2.cuerpo, textoFabrica);
  assert.equal(deC2.versionDeClinica, false);
});

test("hojas: el nombre de la de fábrica no cambia; sin ctx o sin tabla el texto sigue de solo lectura", async () => {
  const { versiones, vigente, lista } = await conHojasDeFabrica();
  const h = lista.find((x) => x.deFabrica)!;
  const nombre = await editarHoja(vigente, "c1", h.id, { nombre: "Otro nombre", cuerpo: h.cuerpo }, [], { versiones, userId: "u1" });
  assert.equal(nombre.ok === false && nombre.codigo, "FABRICA_NO_SE_EDITA");
  const sinCtx = await editarHoja(vigente, "c1", h.id, { cuerpo: "x" }, []);
  assert.equal(sinCtx.ok === false && sinCtx.codigo, "FABRICA_NO_SE_EDITA");
  const sinTabla = await editarHoja(vigente, "c1", h.id, { cuerpo: "x" }, [], { versiones: repoVersionesEnMemoria({ disponible: false }), userId: "u1" });
  assert.equal(sinTabla.ok === false && sinTabla.codigo, "VERSIONES_NO_DISPONIBLES");
  assert.equal(versiones.filas.length, 0);
});

test("hojas: la liga y «en uso» de la de fábrica siguen en la fila, sin pasar por la versión", async () => {
  const { versiones, vigente, lista } = await conHojasDeFabrica();
  const h = lista.find((x) => x.basadaEn === "extraccion" && x.deFabrica)!;
  const r = await editarHoja(vigente, "c1", h.id, { cuerpo: "Texto mío", activa: false }, [], { versiones, userId: "u1" });
  assert.equal(r.ok && r.hoja.activa, false);
  assert.equal(r.ok && r.hoja.cuerpo, "Texto mío");
});

test("hojas: volver a la de fábrica archiva la versión y repone el texto de fábrica", async () => {
  const { versiones, vigente, lista } = await conHojasDeFabrica();
  const h = lista.find((x) => x.basadaEn === "extraccion" && x.deFabrica)!;
  const fabrica = h.cuerpo;
  await editarHoja(vigente, "c1", h.id, { cuerpo: "Texto mío" }, [], { versiones, userId: "u1" });
  const r = await volverAFabricaHoja(vigente, "c1", h.id, { versiones, userId: "u1" });
  assert.equal(r.ok && r.hoja.cuerpo, fabrica);
  assert.equal(r.ok && r.hoja.versionDeClinica, false);
  assert.equal(versiones.filas.length, 1);
  assert.ok(versiones.filas[0].archivedAt instanceof Date);
  const propia = await vigente.insertar({ clinicId: "c1", tipo: "INDICACIONES", nombre: "Mía", cuerpo: "x", procedureIds: [], factoryKey: null, basadaEn: null, createdById: "u1" });
  const noFabrica = await volverAFabricaHoja(vigente, "c1", (propia as FilaHoja).id, { versiones, userId: "u1" });
  assert.equal(noFabrica.ok === false && noFabrica.codigo, "NO_ES_DE_FABRICA");
  const ajena = await volverAFabricaHoja(vigente, "c9", h.id, { versiones, userId: "u1" });
  assert.equal(ajena.ok === false && ajena.codigo, "NO_ENCONTRADA");
});

test("hojas: la constancia también se edita y se restaura (familia propia)", async () => {
  const { versiones, vigente, lista } = await conHojasDeFabrica();
  const c = lista.find((x) => x.tipo === "CONSTANCIA" && x.deFabrica)!;
  await editarHoja(vigente, "c1", c.id, { cuerpo: "Constancia mía [NOMBRE_PACIENTE]" }, [], { versiones, userId: "u1" });
  assert.equal(versiones.filas[0].familia, "HOJA_CONSTANCIA");
  const r = await volverAFabricaHoja(vigente, "c1", c.id, { versiones, userId: "u1" });
  assert.equal(r.ok && r.hoja.cuerpo, c.cuerpo);
});

// ─── Consentimientos ────────────────────────────────────────────────────────

function dobleTemplates(filas: any[]): TemplateDb {
  return {
    documentTemplate: {
      findFirst: async (a: any) =>
        filas.find((f) => f.id === a.where.id && f.clinicId === a.where.clinicId && f.deletedAt === null) ?? null,
      update: async (a: any) => {
        const f = filas.find((x) => x.id === a.where.id)!;
        Object.assign(f, a.data);
        return f;
      },
    },
  } as unknown as TemplateDb;
}

test("consentimiento: se reconoce la de fábrica por ser precargada y llamarse como la carta del catálogo", () => {
  const f = consentimientosDeFabrica()[0];
  assert.equal(fabricaDeConsentimiento({ name: f.nombre, createdById: null })?.clave, f.clave);
  assert.equal(fabricaDeConsentimiento({ name: f.nombre, createdById: "u1" }), null, "con autor es de la clínica");
  assert.equal(fabricaDeConsentimiento({ name: "Mi carta", createdById: null }), null);
  assert.equal(consentimientoModificado({ name: f.nombre, body: f.cuerpo, createdById: null }), false);
  assert.equal(consentimientoModificado({ name: f.nombre, body: "<p>otro</p>", createdById: null }), true);
});

test("consentimiento: volver a la de fábrica deja el texto de la clínica archivado y repone el del catálogo", async () => {
  const f = consentimientosDeFabrica()[0];
  const filas = [
    { id: "t1", clinicId: "c1", kind: "CONSENTIMIENTO", name: f.nombre, body: "<p>texto de la clínica</p>", createdById: null, deletedAt: null },
  ];
  const versiones = repoVersionesEnMemoria();
  const r = await volverAFabricaConsentimiento(dobleTemplates(filas), versiones, "c1", "t1", "u1");
  assert.equal(r.ok, true);
  assert.ok(!difiere(filas[0].body, f.cuerpo), "la fila quedó con el texto de fábrica");
  assert.equal(versiones.filas.length, 1);
  assert.equal(versiones.filas[0].cuerpo, "<p>texto de la clínica</p>", "el texto de la clínica se conserva");
  assert.ok(versiones.filas[0].archivedAt instanceof Date);
  assert.equal(versiones.filas[0].familia, "CONSENTIMIENTO");
  // Ya está en fábrica: no hay nada que restaurar.
  const otra = await volverAFabricaConsentimiento(dobleTemplates(filas), versiones, "c1", "t1", "u1");
  assert.equal(otra.ok === false && otra.code, "NOT_MODIFIED");
});

test("consentimiento: una propia, una de otra clínica o una nota no se restauran; sin tabla no toca nada", async () => {
  const f = consentimientosDeFabrica()[0];
  const filas = [
    { id: "t1", clinicId: "c1", kind: "CONSENTIMIENTO", name: f.nombre, body: "<p>x</p>", createdById: "u1", deletedAt: null },
    { id: "t2", clinicId: "c2", kind: "CONSENTIMIENTO", name: f.nombre, body: "<p>x</p>", createdById: null, deletedAt: null },
    { id: "t3", clinicId: "c1", kind: "NOTA_EVOLUCION", name: f.nombre, body: "<p>x</p>", createdById: null, deletedAt: null },
    { id: "t4", clinicId: "c1", kind: "CONSENTIMIENTO", name: f.nombre + " ", body: "<p>x</p>", createdById: null, deletedAt: null },
  ];
  const versiones = repoVersionesEnMemoria();
  const db = dobleTemplates(filas);
  assert.equal((await volverAFabricaConsentimiento(db, versiones, "c1", "t1", "u1")).ok, false); // con autor
  assert.equal((await volverAFabricaConsentimiento(db, versiones, "c1", "t2", "u1")).ok, false); // otra clínica
  assert.equal((await volverAFabricaConsentimiento(db, versiones, "c1", "t3", "u1")).ok, false); // una nota
  const sinTabla = await volverAFabricaConsentimiento(db, repoVersionesEnMemoria({ disponible: false }), "c1", "t4", "u1");
  assert.equal(sinTabla.ok === false && sinTabla.code, "VERSIONES_NO_DISPONIBLES");
  assert.equal(filas[3].body, "<p>x</p>", "sin tabla no se cambió el texto");
  await assert.rejects(() => volverAFabricaConsentimiento(db, versiones, "", "t1", "u1"));
});

// ─── SQL, rutas, copia de sede, textos ──────────────────────────────────────

test("el SQL es aditivo e idempotente: tabla nueva, sin DROP, DELETE, UPDATE ni ALTER de lo existente", () => {
  const sql = leer("sql/salamanca-plantillas-orto-versiones.sql")
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "clinic_template_versions"/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS/);
  assert.match(sql, /WHERE "archivedAt" IS NULL/, "una sola vigente por plantilla");
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  for (const prohibido of [/\bDROP\b/i, /(?<!ON )\bDELETE\b/i, /(?<!ON )\bUPDATE\b/i, /\bTRUNCATE\b/i, /ALTER TABLE (?!"clinic_template_versions")/i]) {
    assert.ok(!prohibido.test(sql), `el SQL trae ${prohibido}`);
  }
});

test("el repositorio de producción pregunta si existe la tabla antes de leerla y siempre filtra por clínica", () => {
  const src = leer("src/lib/plantillas-fabrica/db.ts");
  assert.match(src, /to_regclass\('public\.clinic_template_versions'\)/);
  assert.match(src, /Symbol\.for\(/, "la respuesta se recuerda en globalThis");
  const activas = src.slice(src.indexOf("async activas"), src.indexOf("async guardar"));
  assert.ok(activas.indexOf("tablaVersionesExiste") < activas.indexOf("$queryRaw"), "se consulta la tabla sin saber si existe");
  assert.ok(!/DELETE FROM/i.test(src), "nada se borra");
  assert.equal((src.match(/exigirClinica\(/g) ?? []).length >= 5, true);
});

test("las rutas de edición piden el permiso de Plantillas y toman el clinicId de la sesión", () => {
  for (const rel of [
    "src/app/api/orthodontics/note-templates/[id]/route.ts",
    "src/app/api/indicaciones/plantillas/[id]/route.ts",
    "src/app/api/document-templates/[id]/route.ts",
  ]) {
    const src = leer(rel);
    assert.match(src, /volverAFabrica/, `${rel} no ofrece «volver a la de fábrica»`);
    assert.match(src, /denyIfMissingPermission\(ctx, TEMPLATES_WRITE_PERMISSION\)/, rel);
    assert.ok(!/body\??\.clinicId/.test(src), `${rel} lee clinicId del cuerpo`);
    assert.match(src, /ctx\.clinicId/, rel);
  }
});

test("donde se USAN las plantillas sale la versión de la clínica", () => {
  assert.match(leer("src/app/actions/clinical-shared/evolution-templates.ts"), /soapVigente\(/, "el selector de la hoja de control");
  assert.match(leer("src/lib/indicaciones/hojas-de-cita.server.ts"), /repoHojasVigente/, "la cita (indicaciones y constancia)");
  assert.match(leer("src/lib/indicaciones/db.ts"), /conVersiones\(repoHojas, repoVersiones\)/);
  assert.match(leer("src/app/dashboard/plantillas/page.tsx"), /listarPlantillasNota\(prisma, user\.clinicId, fabrica, repoVersiones\)/);
});

test("una sede nueva hereda las versiones de la clínica de origen", () => {
  const src = leer("src/lib/branches/copia-sede.server.ts");
  assert.match(src, /copiarVersiones\(\["ORTO_NOTA"\]\)/);
  assert.match(src, /copiarVersiones\(\["HOJA_INDICACIONES", "HOJA_CONSTANCIA"\]\)/);
  // Las hojas se copian de la tabla tal cual (texto de fábrica), nunca con la versión puesta.
  assert.match(src, /repoHojas\.listar\(origenId\)/);
});

test("las pantallas no traen colores a mano y el botón solo sale con la tabla", () => {
  for (const rel of ["plantillas-orto.tsx", "plantillas-indicaciones.tsx", "plantillas-client.tsx"]) {
    const src = leer(`src/app/dashboard/plantillas/${rel}`);
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(src), `${rel} trae un color a mano`);
    assert.match(src, /versionesDisponibles/, `${rel} no distingue si existe la tabla`);
    assert.match(src, /volverAFabrica/, rel);
  }
});

test("los textos nuevos existen en es y en (diccionarios y textos de indicaciones)", () => {
  const es = JSON.parse(leer("src/i18n/dictionaries/es.json")).pages.plantillas;
  const en = JSON.parse(leer("src/i18n/dictionaries/en.json")).pages.plantillas;
  for (const k of ["versionDeClinica", "volverAFabrica", "confirmarVolverTitulo", "confirmarVolverTexto", "toastVolvioAFabrica"]) {
    assert.ok(es[k] && en[k], `falta pages.plantillas.${k}`);
  }
  assert.ok(es.orto.avisoFabricaEditable && en.orto.avisoFabricaEditable);
  for (const c of ["NOT_FACTORY", "VERSIONES_NO_DISPONIBLES"]) assert.ok(es.orto.errores[c] && en.orto.errores[c], c);
  for (const c of ["NOT_FACTORY", "NOT_MODIFIED", "VERSIONES_NO_DISPONIBLES"]) assert.ok(es.errores[c] && en.errores[c], c);
  const t = leer("src/lib/indicaciones/textos.ts");
  for (const k of ["versionDeClinica", "volverAFabrica", "confirmarVolverTitulo", "avisoFabricaEditable", "NO_ES_DE_FABRICA"]) {
    assert.equal((t.match(new RegExp(`\\b${k}\\b`, "g")) ?? []).length >= 2, true, `${k} no está en es y en`);
  }
});
