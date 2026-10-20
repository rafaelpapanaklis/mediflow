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
import { constanciaPorDefecto, editarHoja, hojasSugeridas, listarHojas, volverAFabricaHoja, type FilaHoja, type FilaNueva, type RepoHojas } from "@/lib/indicaciones/servicio";
import {
  consentimientoModificado,
  consentimientosDeFabrica,
  fabricaDeConsentimiento,
  restaurableDe,
  volverAFabricaConsentimiento,
} from "../consentimiento";
import type { TemplateDb } from "@/lib/document-templates/service";
import { cuerpoEdicionHoja, cuerpoEdicionNotaOrto } from "@/app/dashboard/plantillas/cuerpo-edicion";
import { bloquesDeNotas } from "@/components/specialties/orthodontics/redesign/notas-internas-casos";
import { plantillasParaSedeNueva } from "../copia-sede";
import { sinIdsRepetidos, sinRepetirLaMismaHoja } from "@/lib/indicaciones/servicio";
import { fechaCortaDeCaso } from "@/components/specialties/orthodontics/redesign/notas-internas-casos";
import type { HojaDTO } from "@/lib/indicaciones/tipos";

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
      // Una COPIA, como la base: lo leído no cambia solo si otra pestaña guarda después.
      findFirst: async (a: any) => {
        const f = filas.find((x) => x.id === a.where.id && x.clinicId === a.where.clinicId && x.deletedAt === null);
        return f ? { ...f } : null;
      },
      update: async (a: any) => {
        const f = filas.find((x) => x.id === a.where.id)!;
        Object.assign(f, a.data);
        return f;
      },
      updateMany: async (a: any) => {
        const f = filas.find((x) => x.id === a.where.id && x.clinicId === a.where.clinicId && x.body === a.where.body);
        if (!f) return { count: 0 };
        Object.assign(f, a.data);
        return { count: 1 };
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


// ─── Arreglos de la revisión (ws1-t8) ───────────────────────────────────────

test("P1: la página de Plantillas lista con el repositorio de la clínica (la versión), como la cita", () => {
  const pg = leer("src/app/dashboard/plantillas/page.tsx");
  assert.match(pg, /listarHojas\(repoHojasVigente/);
  assert.ok(!/listarHojas\(repoHojas,/.test(pg), "la página lista con el repo a secas y enseña el texto de fábrica");
  // Y el editor solo manda lo que el usuario cambió: una pestaña vieja no pisa con su texto el que otra guardó.
  const modal = leer("src/app/dashboard/plantillas/plantilla-indicaciones-modal.tsx");
  assert.match(modal, /cuerpoEdicionHoja\(/, "el editor construye su petición con cuerpoEdicionHoja (ejecutado en N-P4)");
});

test("P1: cambiar solo la liga de una de fábrica con versión NO toca la versión de la clínica", async () => {
  const { versiones, vigente, lista } = await conHojasDeFabrica();
  const h = lista.find((x) => x.basadaEn === "extraccion" && x.deFabrica)!;
  await editarHoja(vigente, "c1", h.id, { cuerpo: "Texto mío" }, [], { versiones, userId: "u1" });
  // El editor (sin texto en la petición) cambia solo la liga:
  await editarHoja(vigente, "c1", h.id, { procedureIds: [] }, [], { versiones, userId: "u1" });
  assert.equal(versiones.filas.length, 1);
  assert.equal(versiones.filas[0].cuerpo, "Texto mío");
  assert.equal(versiones.filas[0].archivedAt, null);
});

test("P2: editar otra vez ARCHIVA la versión anterior, no la pisa (notas, hojas y repo)", async () => {
  const versiones = repoVersionesEnMemoria();
  const base = { clinicId: "c1", familia: "HOJA_INDICACIONES" as const, clave: "extraccion", userId: "u1" };
  await versiones.guardar({ ...base, cuerpo: "lunes" });
  await versiones.guardar({ ...base, cuerpo: "martes" });
  await versiones.guardar({ ...base, cuerpo: "martes" }); // mismo texto: no hace nada
  assert.equal(versiones.filas.length, 2);
  assert.deepEqual(versiones.filas.map((v) => [v.cuerpo, v.archivedAt !== null]), [["lunes", true], ["martes", false]]);
  const db = dobleDb([fila("1", "Cementado de brackets")]);
  const ctx = { versiones: repoVersionesEnMemoria(), userId: "u1" };
  await editarPlantillaNota(db, "c1", "1", { soap: SOAP_CLINICA }, FABRICA, ctx);
  await editarPlantillaNota(db, "c1", "1", { soap: { ...SOAP_CLINICA, S: "martes" } }, FABRICA, ctx);
  assert.equal(ctx.versiones.filas.length, 2);
  assert.equal(JSON.parse(ctx.versiones.filas[0].cuerpo).S, "mía S", "el texto del lunes sigue guardado");
  const src = leer("src/lib/plantillas-fabrica/db.ts");
  assert.ok(!/DO UPDATE SET "body"/.test(src), "el repositorio de producción sigue pisando el texto");
  assert.match(src, /\$transaction/);
  assert.match(src, /FOR UPDATE/);
});

test("P4: la de fábrica que la clínica editó cuenta como propia en la cita (constancia y sugeridas)", async () => {
  const { versiones, vigente, lista } = await conHojasDeFabrica();
  const copia = await vigente.insertar({
    clinicId: "c1", tipo: "CONSTANCIA", nombre: "Constancia (copia)", cuerpo: "vieja", procedureIds: [],
    factoryKey: null, basadaEn: "constancia", createdById: "u1",
  });
  const c = lista.find((x) => x.tipo === "CONSTANCIA" && x.deFabrica)!;
  await editarHoja(vigente, "c1", c.id, { cuerpo: "Constancia editada de fábrica" }, [], { versiones, userId: "u1" });
  const hojas = (await listarHojas(vigente, "c1", async () => []))!;
  assert.equal((copia as FilaHoja).nombre, "Constancia (copia)");
  assert.equal(constanciaPorDefecto(hojas)?.id, c.id, "la de fábrica editada es LA constancia de la clínica");
  // N3-P3: tocarle «en uso» a la copia le cambia la fecha; no por eso vuelve a ganar la copia vieja.
  await vigente.actualizar("c1", (copia as FilaHoja).id, { activa: false });
  await vigente.actualizar("c1", (copia as FilaHoja).id, { activa: true });
  const despues = (await listarHojas(vigente, "c1", async () => []))!;
  assert.equal(constanciaPorDefecto(despues)?.id, c.id, "la versión sigue ganando aunque la copia se haya tocado después");
  const ext = hojas.find((h) => h.basadaEn === "extraccion" && h.deFabrica)!;
  await editarHoja(vigente, "c1", ext.id, { cuerpo: "Mi extracción" }, [], { versiones, userId: "u1" });
  const de = (await listarHojas(vigente, "c1", async () => []))!;
  assert.ok(hojasSugeridas(de, [], ["extracción de la muela"]).includes(ext.id), "la versión de la clínica se sugiere");
});

test("P5: guardar la de fábrica sin cambiar nada no crea una versión", async () => {
  const db = dobleDb([fila("1", "Cementado de brackets")]);
  const versiones = repoVersionesEnMemoria();
  const ctx = { versiones, userId: "u1" };
  const igual = await editarPlantillaNota(db, "c1", "1", { name: "Cementado de brackets", soap: SOAP_FABRICA }, FABRICA, ctx);
  assert.equal(igual.ok && igual.plantilla.versionDeClinica, false);
  assert.equal(versiones.filas.length, 0);
  await editarPlantillaNota(db, "c1", "1", { soap: SOAP_CLINICA }, FABRICA, ctx);
  await editarPlantillaNota(db, "c1", "1", { soap: SOAP_CLINICA }, FABRICA, ctx); // igual a la vigente
  assert.equal(versiones.filas.length, 1);
});

test("P6: la respuesta de editar un consentimiento dice si ya se puede volver a la de fábrica", () => {
  const f = consentimientosDeFabrica()[0];
  assert.equal(restaurableDe({ kind: "CONSENTIMIENTO", name: f.nombre, body: "<p>x</p>", createdById: null }), true);
  assert.equal(restaurableDe({ kind: "NOTA_EVOLUCION", name: f.nombre, body: "<p>x</p>", createdById: null }), false, "una nota no");
  assert.match(leer("src/app/api/document-templates/[id]/route.ts"), /restaurable: restaurableDe\(r\.template\)/);
  assert.match(leer("src/app/dashboard/plantillas/plantilla-modal.tsx"), /restaurable: data\.restaurable === true/);
  assert.match(leer("src/app/dashboard/plantillas/page.tsx"), /restaurableDe\(/);
});

test("P7: la ayuda de Notas de ortodoncia no promete editar si falta el SQL", () => {
  assert.match(leer("src/app/dashboard/plantillas/plantillas-orto.tsx"), /versionesDisponibles \? "pages\.plantillas\.orto\.ayuda" : "pages\.plantillas\.orto\.ayudaSinVersiones"/);
  const es = JSON.parse(leer("src/i18n/dictionaries/es.json")).pages.plantillas;
  const en = JSON.parse(leer("src/i18n/dictionaries/en.json")).pages.plantillas;
  assert.ok(es.orto.ayudaSinVersiones && en.orto.ayudaSinVersiones);
  assert.ok(!/guardada y archivada/.test(es.confirmarVolverTexto), "promete una pantalla de historial que no existe");
});

test("P8: «volver a la de fábrica» sin versión vigente no cambia nada y avisa para no auditar", async () => {
  const db = dobleDb([fila("1", "Cementado de brackets")]);
  const ctx = { versiones: repoVersionesEnMemoria(), userId: "u1" };
  const nota = await volverAFabricaNota(db, "c1", "1", FABRICA, ctx);
  assert.equal(nota.ok && nota.yaEstabaDeFabrica, true);
  const { versiones, vigente, lista } = await conHojasDeFabrica();
  const h = lista.find((x) => x.deFabrica)!;
  const hoja = await volverAFabricaHoja(vigente, "c1", h.id, { versiones, userId: "u1" });
  assert.equal(hoja.ok && hoja.yaEstabaDeFabrica, true);
  for (const rel of ["src/app/api/orthodontics/note-templates/[id]/route.ts", "src/app/api/indicaciones/plantillas/[id]/route.ts"]) {
    assert.match(leer(rel), /yaEstabaDeFabrica/, rel);
  }
  // Y cuando sí había versión, no es un no-hecho.
  await editarPlantillaNota(db, "c1", "1", { soap: SOAP_CLINICA }, FABRICA, ctx);
  const real = await volverAFabricaNota(db, "c1", "1", FABRICA, ctx);
  assert.equal(real.ok && real.yaEstabaDeFabrica, undefined);
});

test("P9: si alguien guardó otra edición entre la lectura y «volver», esa edición no se pisa", async () => {
  const f = consentimientosDeFabrica()[0];
  const filas = [{ id: "t1", clinicId: "c1", kind: "CONSENTIMIENTO", name: f.nombre, body: "<p>leído</p>", createdById: null, deletedAt: null }];
  const db = dobleTemplates(filas);
  const versiones = repoVersionesEnMemoria();
  // La otra pestaña guarda justo después de que se archiva el texto leído.
  const archivar = versiones.archivarTexto.bind(versiones);
  versiones.archivarTexto = async (v) => {
    const r = await archivar(v);
    filas[0].body = "<p>edición de otra pestaña</p>";
    return r;
  };
  const r = await volverAFabricaConsentimiento(db, versiones, "c1", "t1", "u1");
  assert.equal(r.ok === false && r.code, "CAMBIO_CONCURRENTE");
  assert.equal(filas[0].body, "<p>edición de otra pestaña</p>", "la edición ajena sigue ahí");
  assert.equal(versiones.filas[0].cuerpo, "<p>leído</p>");
});

test("P3: recepción ve las notas internas en la ficha (vista administrativa) con el mismo componente", () => {
  const adm = leer("src/components/specialties/orthodontics/redesign/OrtodonciaAdministrativa.tsx");
  assert.match(adm, /<NotasInternas /);
  assert.match(leer("src/app/dashboard/patients/[id]/page.tsx"), /orthoCasoAdministrativoId=\{orthoPlanAdministrativo\?\.id \?\? null\}/);
  assert.match(leer("src/app/dashboard/patients/[id]/patient-detail-client.tsx"), /casoId=\{orthoCasoAdministrativoId\}/);
});

test("P10-P12: Sabina lee todos los casos y sin módulo vigente; la sonda no confunde un fallo con «no existe»", () => {
  const sab = leer("src/lib/sabina/tools/orto-notas-internas.ts");
  assert.match(sab, /findMany\(\{/);
  assert.match(sab, /modulo === "no_es_dental"/);
  const db = leer("src/lib/orthodontics/notas-internas-db.ts");
  const sonda = db.slice(db.indexOf("export async function tablasNotasInternasExisten"), db.indexOf("function exigirClinica"));
  assert.match(sonda, /throw err/);
});


// ─── Segunda vuelta (ws1-t8): casos ejecutados ──────────────────────────────
// (las rutas reales están en rutas.test.ts y el repositorio de producción en repo-produccion.test.ts)

const dto = (o: Partial<HojaDTO> & { id: string }): HojaDTO => ({
  tipo: "INDICACIONES", nombre: "Después de una extracción", cuerpo: "x", procedureIds: [], deFabrica: false,
  basadaEn: "extraccion", activa: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...o,
});

test("N-P2/N3-P3: copia vieja + versión editada de la misma hoja → se propone la VERSIÓN (por liga y por palabras), aunque la copia sea más nueva", () => {
  const copia = dto({ id: "copia", nombre: "Después de una extracción (copia)", updatedAt: "2026-12-01T00:00:00.000Z", procedureIds: ["p1"] });
  const version = dto({ id: "fab", deFabrica: true, versionDeClinica: true, updatedAt: "2026-10-01T00:00:00.000Z", procedureIds: ["p1"] });
  const proc = [{ id: "p1", name: "Extracción", isActive: true }];
  assert.deepEqual(hojasSugeridas([copia, version], proc, ["extracción"]), ["fab"], "por liga");
  assert.deepEqual(hojasSugeridas([{ ...copia, procedureIds: [] }, { ...version, procedureIds: [] }], [], ["extracción de la muela"]), ["fab"], "por palabras");
  // Indicaciones distintas se quedan todas; las que no vienen de una de fábrica también.
  const otra = dto({ id: "otra", nombre: "Limpieza", basadaEn: "limpieza", procedureIds: ["p1"] });
  const suelta = dto({ id: "suelta", nombre: "Mía", basadaEn: null, procedureIds: ["p1"] });
  assert.deepEqual(hojasSugeridas([copia, version, otra, suelta], proc, []).sort(), ["fab", "otra", "suelta"]);
});

test("N3-P1: dos COPIAS distintas de la misma de fábrica se proponen las dos (hojas hechas a propósito)", () => {
  const cordales = dto({ id: "cordales", nombre: "Cirugía de cordales", basadaEn: "cirugia", procedureIds: ["p1"] });
  const injerto = dto({ id: "injerto", nombre: "Injerto de encía", basadaEn: "cirugia", procedureIds: ["p2"] });
  const pelada = dto({ id: "pelada", nombre: "Después de una cirugía bucal", basadaEn: "cirugia", deFabrica: true, procedureIds: ["p1", "p2"] });
  const proc = [{ id: "p1", name: "Cordales", isActive: true }, { id: "p2", name: "Injerto", isActive: true }];
  assert.deepEqual(hojasSugeridas([cordales, injerto, pelada], proc, []).sort(), ["cordales", "injerto"], "la de fábrica pelada cede; las dos copias se quedan");
  assert.deepEqual(sinRepetirLaMismaHoja([cordales, injerto]).map((h) => h.id), ["cordales", "injerto"]);
  // Con versión editada, las copias viejas ceden (la versión es LA hoja) pero la liga de otras hojas no se toca.
  const version = dto({ id: "fab", deFabrica: true, versionDeClinica: true, basadaEn: "cirugia" });
  assert.deepEqual(sinRepetirLaMismaHoja([cordales, version, dto({ id: "x", basadaEn: "limpieza" })]).map((h) => h.id), ["fab", "x"]);
});

test("N3-P1: lo que la persona marcó se respeta — solo se quitan los ids repetidos y se conserva el orden", () => {
  const a = dto({ id: "a" });
  const b = dto({ id: "b" }); // misma de fábrica que a
  const c = dto({ id: "c", basadaEn: null });
  assert.deepEqual(sinIdsRepetidos([b, a, a, c, b]).map((h) => h.id), ["b", "a", "c"]);
});

test("N-P3: una pestaña vieja que guarda la nota de ortodoncia «sin tocar nada» NO revierte la versión que otra persona guardó", async () => {
  const db = dobleDb([fila("1", "Cementado de brackets")]);
  const versiones = repoVersionesEnMemoria();
  const ctx = { versiones, userId: "u1" };
  const cargadaPorLaPestana = { name: "Cementado de brackets", soap: SOAP_FABRICA }; // se abrió con el texto de fábrica
  await editarPlantillaNota(db, "c1", "1", { soap: SOAP_CLINICA }, FABRICA, { versiones, userId: "u2" }); // otra persona guardó
  const payload = cuerpoEdicionNotaOrto(cargadaPorLaPestana, cargadaPorLaPestana);
  assert.deepEqual(payload, {}, "sin cambios no viaja nada");
  const r = await editarPlantillaNota(db, "c1", "1", payload, FABRICA, ctx);
  assert.equal(r.ok && r.plantilla.soap.S, "mía S", "sigue la versión de la otra persona");
  assert.equal(versiones.filas.length, 1);
  assert.equal(versiones.filas[0].archivedAt, null);
  // Y lo que sí cambió viaja solo:
  assert.deepEqual(cuerpoEdicionNotaOrto(cargadaPorLaPestana, { name: "Cementado de brackets", soap: { ...SOAP_FABRICA, P: "nuevo" } }), { soap: { ...SOAP_FABRICA, P: "nuevo" } });
});

test("N-P4: corregir solo el texto desde una pestaña vieja NO pisa la liga a procedimientos que otra persona cambió", async () => {
  const { versiones, vigente, lista } = await conHojasDeFabrica();
  const catalogo = [{ id: "p1", name: "Extracción", isActive: true }, { id: "p2", name: "Cirugía", isActive: true }];
  const h = lista.find((x) => x.basadaEn === "extraccion" && x.deFabrica)!;
  const cargada = { nombre: h.nombre, cuerpo: h.cuerpo, procedureIds: h.procedureIds }; // la pestaña vieja
  await editarHoja(vigente, "c1", h.id, { procedureIds: ["p1", "p2"] }, catalogo, { versiones, userId: "u2" }); // otra persona
  const payload = cuerpoEdicionHoja(cargada, { ...cargada, cuerpo: "Texto corregido" }, true);
  assert.deepEqual(payload, { cuerpo: "Texto corregido" }, "la liga no viaja si no la tocó");
  const r = await editarHoja(vigente, "c1", h.id, payload, catalogo, { versiones, userId: "u1" });
  assert.deepEqual(r.ok && r.hoja.procedureIds, ["p1", "p2"], "la liga de la otra persona sigue");
  assert.equal(r.ok && r.hoja.cuerpo, "Texto corregido");
  // Si SÍ la tocó, viaja.
  assert.deepEqual(cuerpoEdicionHoja(cargada, { ...cargada, procedureIds: ["p2"] }, true), { procedureIds: ["p2"] });
  // La constancia no tiene liga.
  assert.deepEqual(cuerpoEdicionHoja(cargada, { ...cargada, procedureIds: ["p2"] }, false), {});
});

test("N-P5/N3-P4: recepción ve las notas de TODOS los casos vivos; con uno solo no se rotula; la fecha va en la zona de la clínica", () => {
  const etiqueta = (iso: string) => `caso abierto el ${fechaCortaDeCaso(iso, "es", "America/Mexico_City")}`;
  assert.deepEqual(bloquesDeNotas(undefined, null, etiqueta), [{ caseId: null }]);
  assert.deepEqual(bloquesDeNotas([], "caso-1", etiqueta), [{ caseId: "caso-1" }]);
  assert.deepEqual(bloquesDeNotas([{ id: "caso-1", abierto: "2026-05-05T00:00:00.000Z" }], "caso-1", etiqueta), [{ caseId: "caso-1" }]);
  const dos = bloquesDeNotas([{ id: "nuevo", abierto: "2026-10-06T01:00:00.000Z" }, { id: "viejo", abierto: "2024-01-02T10:00:00.000Z" }], "nuevo", etiqueta);
  assert.deepEqual(dos.map((b) => b.caseId), ["nuevo", "viejo"]);
  // 6 oct 01:00 UTC = 5 oct 19:00 en CDMX (UTC-6): el caso se abrió el 5.
  assert.equal(dos[0].etiquetaCaso, "caso abierto el 5 oct 2026");
  assert.equal(dos[1].etiquetaCaso, "caso abierto el 2 ene 2024");
});

test("N3-P4: la fecha del caso sale en la zona de la clínica y el mes en el idioma de la interfaz", () => {
  const iso = "2026-10-06T01:00:00.000Z"; // 5 oct 19:00 CDMX · 6 oct 01:00 UTC · 6 oct 10:00 Tokio
  assert.equal(fechaCortaDeCaso(iso, "es", "America/Mexico_City"), "5 oct 2026");
  assert.equal(fechaCortaDeCaso(iso, "en", "America/Mexico_City"), "Oct 5, 2026");
  assert.equal(fechaCortaDeCaso(iso, "es", "Asia/Tokyo"), "6 oct 2026", "otra clínica, otro día");
  assert.equal(fechaCortaDeCaso(iso, "es", null), "5 oct 2026", "sin zona: la de México, no UTC");
  assert.equal(fechaCortaDeCaso(iso, "es", "Zona/Inexistente"), "5 oct 2026", "una zona que Intl no conoce no tumba la ficha");
  assert.equal(fechaCortaDeCaso("no es fecha", "es", "America/Mexico_City"), "");
  const es = JSON.parse(leer("src/i18n/dictionaries/es.json")).ortoNotasInternas;
  const en = JSON.parse(leer("src/i18n/dictionaries/en.json")).ortoNotasInternas;
  assert.equal(es.casoAbierto, "caso abierto el {fecha}");
  assert.equal(en.casoAbierto, "case opened on {fecha}");
});

test("N-P10: la sede nueva conserva SIN autor los consentimientos de fábrica, y por eso puede volver a la de fábrica", () => {
  const f = consentimientosDeFabrica()[0];
  const filas = [
    { name: f.nombre, body: "<p>editada</p>", isActive: true, createdById: null },
    { name: "Mi carta", body: "<p>mía</p>", isActive: false, createdById: "u-origen" },
  ];
  const copia = plantillasParaSedeNueva(filas, "CONSENTIMIENTO", "c-nueva", "u-dueño-nuevo");
  assert.deepEqual(copia.map((c) => [c.name, c.createdById, c.clinicId, c.kind]), [
    [f.nombre, null, "c-nueva", "CONSENTIMIENTO"],
    ["Mi carta", "u-dueño-nuevo", "c-nueva", "CONSENTIMIENTO"],
  ]);
  assert.equal(copia[1].isActive, false);
  assert.equal(restaurableDe({ kind: "CONSENTIMIENTO", name: copia[0].name, body: copia[0].body, createdById: copia[0].createdById }), true);
  assert.equal(restaurableDe({ kind: "CONSENTIMIENTO", name: copia[1].name, body: copia[1].body, createdById: copia[1].createdById }), false);
});
