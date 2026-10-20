/**
 * Las RUTAS reales de plantillas, ejecutadas (ws1-t8 · segunda vuelta): se llama al handler con una petición y se
 * mira qué quedó en la base de mentira, qué se archivó, qué se auditó y qué salió por WhatsApp.
 *
 * Run: npm run test:plantillas-fabrica-rutas
 *
 *  · N-P1  PATCH /api/document-templates/[id]: un consentimiento archiva el texto anterior al cambiarse; una pestaña
 *          vieja no pisa lo que otra persona guardó; guardar sin cambios no archiva ni cambia nada.
 *  · N-P2  POST /api/indicaciones/cita/[id]/whatsapp: aunque lleguen dos hojas de la misma indicación (copia vieja +
 *          versión editada) el paciente recibe UNA, una sola vez.
 *  · N-P6  PATCH /api/orthodontics/note-templates/[id]: guardar sin cambios no deja rastro en la bitácora.
 */
process.env.DATABASE_URL = "postgresql://nadie:nada@127.0.0.1:1/ninguna?connection_limit=1";
process.env.DIRECT_URL = process.env.DATABASE_URL;

import { test, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { repoVersionesEnMemoria } from "../en-memoria";
import { consentimientosDeFabrica } from "../consentimiento";
import type { HojaDTO } from "@/lib/indicaciones/tipos";

type Row = Record<string, any>;

// ─── Dobles ────────────────────────────────────────────────────────────────
const sesion = { clinicId: "c1", userId: "u1", role: "ADMIN" };
let versiones = repoVersionesEnMemoria();
const auditorias: Row[] = [];
const movimientos: Row[] = [];
const envios: Row[] = [];
let plantillas: Row[] = [];
let notasOrto: Row[] = [];
let hojasDeLaCita: HojaDTO[] = [];

const copia = (r: Row | undefined | null) => (r ? { ...r } : null);
const fakePrisma = {
  documentTemplate: {
    findFirst: async ({ where }: any) =>
      copia(plantillas.find((p) => p.id === where.id && p.clinicId === where.clinicId && p.deletedAt === null)),
    findMany: async ({ where }: any) => plantillas.filter((p) => p.clinicId === where.clinicId && p.kind === where.kind).map((p) => ({ ...p })),
    update: async ({ where, data }: any) => {
      const p = plantillas.find((x) => x.id === where.id)!;
      Object.assign(p, data, { updatedAt: new Date() });
      return { ...p };
    },
    updateMany: async ({ where, data }: any) => {
      const p = plantillas.find((x) => x.id === where.id && x.clinicId === where.clinicId && x.body === where.body);
      if (!p) return { count: 0 };
      Object.assign(p, data, { updatedAt: new Date() });
      return { count: 1 };
    },
  },
  clinicalEvolutionTemplate: {
    findFirst: async ({ where }: any) => copia(notasOrto.find((n) => n.id === where.id && n.clinicId === where.clinicId)),
    findMany: async ({ where }: any) => notasOrto.filter((n) => n.clinicId === where.clinicId).map((n) => ({ ...n })),
    update: async ({ where, data }: any) => {
      const n = notasOrto.find((x) => x.id === where.id)!;
      Object.assign(n, data);
      return { ...n };
    },
  },
};

mock.module("@/lib/prisma", { namedExports: { prisma: fakePrisma } });
mock.module("@/lib/auth-context", { namedExports: { getAuthContext: async () => sesion } });
mock.module("@/lib/auth/require-permission", { namedExports: { denyIfMissingPermission: () => null } });
mock.module("@/lib/plantillas-fabrica/db", { namedExports: { repoVersiones: new Proxy({}, { get: (_t, k) => (versiones as any)[k] }) } });
mock.module("@/lib/movimientos-paciente/modulos", { namedExports: { anotarFilaDeModulo: async (a: Row) => void movimientos.push(a) } });
mock.module("@/lib/orthodontics/access", { namedExports: { hasActiveOrthodonticsModule: async () => true } });
mock.module("@/lib/clinical-shared/auth/guard", { namedExports: { auditClinicalShared: async (a: Row) => void auditorias.push(a) } });

// WhatsApp de indicaciones: la cita, la biblioteca y el envío son dobles; el resto (envio.ts, servicio.ts) es el real.
const cita = {
  datos: {
    cita: { status: "COMPLETED", motivo: "Extracción", startsAt: new Date("2026-10-19T16:00:00Z"), endsAt: new Date("2026-10-19T17:00:00Z"), checkedInAt: null, startedAt: null, completedAt: new Date("2026-10-19T17:00:00Z") },
    paciente: { nombre: "Ana Pérez" },
    doctor: { nombre: "Dra. Ruiz", cedula: "123" },
    clinica: { nombre: "Clínica Uno", telefono: "5551234567", ciudad: "León", estado: "Guanajuato", direccion: "Calle 1", timezone: "America/Mexico_City" },
    procedimientos: ["Extracción"],
  },
  appointmentId: "cita-1",
  patientId: "p1",
  primerNombre: "Ana",
  telefono: "5214771234567",
  conceptos: [],
  catalogo: [],
  procedimientos: [],
  clinica: {
    id: "c1",
    letterhead: { name: "Clínica Uno", address: null, city: null, state: null, phone: null, email: null, logoUrl: null },
    waConnected: true,
    waPhoneNumberId: "pn",
    waAccessToken: "tok",
    waTemplates: null,
  },
};
mock.module("@/lib/indicaciones/cita.server", {
  namedExports: { PERMISO_EMITIR: "agenda.view", entrarCita: async () => ({ ctx: sesion }), cargarCita: async () => cita },
});
mock.module("@/lib/indicaciones/hojas-de-cita.server", {
  namedExports: {
    hojasDeLaClinica: async () => hojasDeLaCita,
    ultimoEnvioReciente: async () => null,
    anotarEnMovimientos: async (a: Row) => void movimientos.push(a),
    nombrarHojas: (n: string[]) => n.join(", "),
  },
});
mock.module("@/lib/whatsapp/send-and-log", { namedExports: { sendWhatsAppLogged: async (a: Row) => void envios.push(a) } });
mock.module("@/lib/whatsapp/inbox-log", { namedExports: { lastInboundAtForPhone: async () => new Date() } });
mock.module("@/lib/indicaciones/pdf", { namedExports: { construirPdfHoja: async () => Buffer.from("pdf"), nombreDeArchivoHoja: () => "x.pdf" } });

let docPATCH: typeof import("../../../app/api/document-templates/[id]/route").PATCH;
let notaPATCH: typeof import("../../../app/api/orthodontics/note-templates/[id]/route").PATCH;
let waPOST: typeof import("../../../app/api/indicaciones/cita/[id]/whatsapp/route").POST;

before(async () => {
  docPATCH = (await import("../../../app/api/document-templates/[id]/route")).PATCH;
  notaPATCH = (await import("../../../app/api/orthodontics/note-templates/[id]/route")).PATCH;
  waPOST = (await import("../../../app/api/indicaciones/cita/[id]/whatsapp/route")).POST;
});

beforeEach(() => {
  versiones = repoVersionesEnMemoria();
  auditorias.length = 0;
  movimientos.length = 0;
  envios.length = 0;
  plantillas = [];
  notasOrto = [];
  hojasDeLaCita = [];
});

const patch = (url: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

// ─── N-P1 · consentimientos ────────────────────────────────────────────────

function sembrarConsentimiento(body = "<p>texto del lunes</p>", createdById: string | null = null) {
  const f = consentimientosDeFabrica()[0];
  plantillas = [{ id: "t1", clinicId: "c1", kind: "CONSENTIMIENTO", name: f.nombre, body, isActive: true, createdById, deletedAt: null, createdAt: new Date(), updatedAt: new Date() }];
}

test("N-P1: editar el consentimiento ARCHIVA el texto anterior y deja el nuevo", async () => {
  sembrarConsentimiento("<p>texto del lunes</p>");
  const res = await docPATCH(patch("/api/document-templates/t1", { body: "<p>texto del martes</p>", baseBody: "<p>texto del lunes</p>" }), params("t1"));
  assert.equal(res.status, 200);
  assert.equal(plantillas[0].body, "<p>texto del martes</p>");
  assert.equal(versiones.filas.length, 1, "el texto del lunes quedó guardado");
  assert.equal(versiones.filas[0].cuerpo, "<p>texto del lunes</p>");
  assert.ok(versiones.filas[0].archivedAt instanceof Date);
  assert.equal(versiones.filas[0].familia, "CONSENTIMIENTO");
  const out = await res.json();
  assert.equal(out.restaurable, true, "ya se puede volver a la de fábrica sin recargar");
});

test("N-P1: una pestaña vieja que guarda sin cambiar nada NO pisa lo que otra persona guardó", async () => {
  sembrarConsentimiento("<p>texto del martes</p>"); // ya lo cambió la asistente
  // La pestaña se abrió el lunes: no tocó el texto, así que el modal manda solo el nombre.
  const res = await docPATCH(patch("/api/document-templates/t1", { name: plantillas[0].name }), params("t1"));
  assert.equal(res.status, 200);
  assert.equal(plantillas[0].body, "<p>texto del martes</p>");
  assert.equal(versiones.filas.length, 0, "sin cambio de texto no se archiva nada");
});

test("N-P1: una pestaña vieja que SÍ cambia el texto, sobre un texto que ya cambió, recibe 409 y no pisa nada", async () => {
  sembrarConsentimiento("<p>texto del martes</p>");
  const res = await docPATCH(patch("/api/document-templates/t1", { body: "<p>mi versión del lunes</p>", baseBody: "<p>texto del lunes</p>" }), params("t1"));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, "CAMBIO_CONCURRENTE");
  assert.equal(plantillas[0].body, "<p>texto del martes</p>");
  assert.equal(versiones.filas.length, 0);
});

test("N-P1: mandar el mismo texto (aunque llegue como cambio) no archiva ni cambia nada", async () => {
  sembrarConsentimiento("<p>texto del lunes</p>");
  const res = await docPATCH(patch("/api/document-templates/t1", { body: "<p>texto del lunes</p>", baseBody: "<p>texto del lunes</p>" }), params("t1"));
  assert.equal(res.status, 200);
  assert.equal(versiones.filas.length, 0);
});

test("N-P1: también las que escribió la clínica archivan el texto anterior; una nota de evolución no", async () => {
  sembrarConsentimiento("<p>mía v1</p>", "u9");
  await docPATCH(patch("/api/document-templates/t1", { body: "<p>mía v2</p>", baseBody: "<p>mía v1</p>" }), params("t1"));
  assert.equal(versiones.filas.length, 1);
  assert.equal(versiones.filas[0].clave, "propia:t1");
  plantillas = [{ ...plantillas[0], id: "n1", kind: "NOTA_EVOLUCION", name: "Mi nota" }];
  versiones = repoVersionesEnMemoria();
  const res = await docPATCH(patch("/api/document-templates/n1", { body: "<p>mía v3</p>" }), params("n1"));
  assert.equal(res.status, 200);
  assert.equal(versiones.filas.length, 0);
});

test("N-P1: sin la tabla de versiones (falta el SQL) se edita como antes, sin romper", async () => {
  sembrarConsentimiento("<p>texto del lunes</p>");
  versiones = repoVersionesEnMemoria({ disponible: false });
  const res = await docPATCH(patch("/api/document-templates/t1", { body: "<p>texto del martes</p>", baseBody: "<p>texto del lunes</p>" }), params("t1"));
  assert.equal(res.status, 200);
  assert.equal(plantillas[0].body, "<p>texto del martes</p>");
  assert.equal(versiones.filas.length, 0);
});

test("N-P1: la plantilla de otra clínica no existe para esta sesión", async () => {
  sembrarConsentimiento();
  plantillas[0].clinicId = "c2";
  const res = await docPATCH(patch("/api/document-templates/t1", { body: "<p>x</p>" }), params("t1"));
  assert.equal(res.status, 404);
  assert.equal(plantillas[0].body, "<p>texto del lunes</p>");
  assert.equal(versiones.filas.length, 0);
});

// ─── N-P6 · notas de ortodoncia ────────────────────────────────────────────

const SOAP = { S: "s", O: "o", A: "a", P: "p" };
function sembrarNota() {
  notasOrto = [{ id: "n1", clinicId: "c1", module: "orthodontics", name: "Cementado de brackets", soapTemplate: SOAP, proceduresPrefilled: [], materialsPrefilled: [], deletedAt: null, createdAt: new Date(), updatedAt: new Date() }];
}

test("N-P6: guardar la nota de fábrica sin cambiar nada no crea versión ni deja rastro en la bitácora", async () => {
  sembrarNota();
  const res = await notaPATCH(patch("/api/orthodontics/note-templates/n1", { name: "Cementado de brackets", soap: SOAP }), params("n1"));
  assert.equal(res.status, 200);
  assert.equal(versiones.filas.length, 0);
  assert.deepEqual(auditorias, []);
});

test("N-P6: cuando SÍ cambia, queda la versión y UNA fila de bitácora", async () => {
  sembrarNota();
  const res = await notaPATCH(patch("/api/orthodontics/note-templates/n1", { soap: { ...SOAP, S: "nuevo" } }), params("n1"));
  assert.equal(res.status, 200);
  assert.equal(versiones.filas.length, 1);
  assert.equal(auditorias.length, 1);
  assert.equal(auditorias[0].action, "clinical-shared.evolution-template.updated");
  assert.equal(auditorias[0].changes.versionDeClinica, true);
});

// ─── N-P2 · WhatsApp de indicaciones ───────────────────────────────────────

const hoja = (o: Partial<HojaDTO> & { id: string }): HojaDTO => ({
  tipo: "INDICACIONES", nombre: "Después de una extracción", cuerpo: "texto", procedureIds: [], deFabrica: false,
  basadaEn: "extraccion", activa: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...o,
});
const peticion = (hojas: string[]) =>
  new NextRequest("http://localhost/api/indicaciones/cita/cita-1/whatsapp", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hojas }),
  });

test("N3-P1: lo que la doctora marcó a mano se manda COMPLETO: dos hojas distintas de la misma de fábrica llegan las dos", async () => {
  hojasDeLaCita = [
    hoja({ id: "cordales", nombre: "Cirugía de cordales", basadaEn: "cirugia", cuerpo: "TEXTO CORDALES" }),
    hoja({ id: "injerto", nombre: "Injerto de encía", basadaEn: "cirugia", cuerpo: "TEXTO INJERTO" }),
  ];
  const res = await waPOST(peticion(["cordales", "injerto"]), params("cita-1"));
  assert.equal(res.status, 200);
  assert.equal(envios.length, 1);
  const texto: string = envios[0].body;
  assert.equal(texto.split("TEXTO CORDALES").length - 1, 1);
  assert.equal(texto.split("TEXTO INJERTO").length - 1, 1);
  assert.deepEqual(movimientos[0].hojas, ["cordales", "injerto"], "Movimientos registra las dos");
});

test("N3-P1: copia vieja + versión editada marcadas a mano también salen las dos (la protección está en lo que se PROPONE)", async () => {
  hojasDeLaCita = [
    hoja({ id: "copia", nombre: "Después de una extracción (copia)", cuerpo: "COPIA" }),
    hoja({ id: "fabrica", deFabrica: true, versionDeClinica: true, cuerpo: "VERSIÓN" }),
  ];
  const res = await waPOST(peticion(["copia", "fabrica"]), params("cita-1"));
  assert.equal(res.status, 200);
  assert.deepEqual(movimientos[0].hojas, ["copia", "fabrica"]);
});

test("el mismo id pedido dos veces sale una vez, en el orden de la biblioteca", async () => {
  hojasDeLaCita = [
    hoja({ id: "a", basadaEn: "extraccion", cuerpo: "UNO" }),
    hoja({ id: "b", nombre: "Limpieza", basadaEn: "limpieza", cuerpo: "DOS" }),
    hoja({ id: "c", nombre: "Mía sin origen", basadaEn: null, cuerpo: "TRES" }),
  ];
  const res = await waPOST(peticion(["c", "a", "a", "b", "c"]), params("cita-1"));
  assert.equal(res.status, 200);
  assert.deepEqual(movimientos[0].hojas, ["a", "b", "c"]);
  const texto: string = envios[0].body;
  for (const t of ["UNO", "DOS", "TRES"]) assert.equal(texto.split(t).length - 1, 1, t);
});

// ─── N3-P2 · todo o nada ───────────────────────────────────────────────────

test("N3-P2: corregir el texto Y renombrar con un nombre que ya existe → 409 y NO queda nada a medias", async () => {
  const f = consentimientosDeFabrica();
  plantillas = [
    { id: "t1", clinicId: "c1", kind: "CONSENTIMIENTO", name: f[0].nombre, body: "<p>texto del lunes</p>", isActive: true, createdById: null, deletedAt: null, createdAt: new Date(), updatedAt: new Date() },
    { id: "t2", clinicId: "c1", kind: "CONSENTIMIENTO", name: "Mi carta", body: "<p>otra</p>", isActive: true, createdById: "u9", deletedAt: null, createdAt: new Date(), updatedAt: new Date() },
  ];
  const res = await docPATCH(
    patch("/api/document-templates/t1", { name: "mi carta", body: "<p>texto del martes</p>", baseBody: "<p>texto del lunes</p>" }),
    params("t1"),
  );
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, "NAME_TAKEN");
  assert.equal(plantillas[0].body, "<p>texto del lunes</p>", "el texto nuevo NO quedó vigente");
  assert.equal(plantillas[0].name, f[0].nombre);
  assert.equal(versiones.filas.length, 0, "ni siquiera se archivó algo que sigue vigente");
});

test("N3-P2: si el nombre se toma justo al escribir (carrera), tampoco queda a medias", async () => {
  sembrarConsentimiento("<p>texto del lunes</p>");
  const original = fakePrisma.documentTemplate.updateMany;
  fakePrisma.documentTemplate.updateMany = async () => {
    throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
  };
  try {
    const res = await docPATCH(patch("/api/document-templates/t1", { name: "Nombre nuevo", body: "<p>martes</p>", baseBody: "<p>texto del lunes</p>" }), params("t1"));
    assert.equal(res.status, 409);
    assert.equal(plantillas[0].body, "<p>texto del lunes</p>");
  } finally {
    fakePrisma.documentTemplate.updateMany = original;
  }
});

test("N3-P2: texto, nombre y «en uso» válidos se guardan juntos en una sola operación", async () => {
  sembrarConsentimiento("<p>texto del lunes</p>");
  const res = await docPATCH(patch("/api/document-templates/t1", { name: "Extracción v2", isActive: false, body: "<p>martes</p>", baseBody: "<p>texto del lunes</p>" }), params("t1"));
  assert.equal(res.status, 200);
  assert.deepEqual([plantillas[0].name, plantillas[0].isActive, plantillas[0].body], ["Extracción v2", false, "<p>martes</p>"]);
  assert.equal(versiones.filas.length, 1);
  assert.equal(versiones.filas[0].cuerpo, "<p>texto del lunes</p>");
});
