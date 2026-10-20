/**
 * Ortodoncia — «Notas internas» del caso: las reglas, con un repo en memoria (sin base).
 *
 *   npm run test:ortho-notas-internas
 *
 * Qué se prueba:
 *  1. Aislamiento por clínica: sin `clinicId` se corta ANTES de tocar el repo; una clínica no ve ni corrige las
 *     notas de otra aunque comparta el id del caso.
 *  2. Texto: obligatorio, con tope (`MAX_CARACTERES_NOTA`), recortado en las puntas; el autor es quien tiene la sesión.
 *  3. Corregir: el texto anterior queda como revisión (quién y cuándo), cada corrección suma una, y solo corrige el
 *     autor o un ADMIN / SUPER_ADMIN.
 *  4. Una nota NO se borra: ni el servicio ni el repo tienen forma de hacerlo.
 *  5. Quién entra a la sección (ver / escribir) con la llave de paciente y la del módulo.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as servicio from "../notas-internas-service";
import {
  MAX_CARACTERES_NOTA,
  aDTO,
  corregirNota,
  crearNota,
  listarNotas,
  puedeCorregirNota,
  validarTextoNota,
  type FilaNotaNueva,
  type NotaInterna,
  type RepoNotasInternas,
} from "../notas-internas-service";
import { puedeNotasInternas } from "../notas-internas-acceso";

const A = "clinica-a";
const B = "clinica-b";
const CASO = "caso-1"; // el MISMO id de caso en las dos clínicas: lo que separa es el clinicId
const PACIENTE = "pac-1";
const ANA = "u-ana"; // doctora, autora
const BETO = "u-beto"; // otro doctor
const ADMIN_A = "u-admin-a";
const ADMIN_B = "u-admin-b";

/** Un repo en memoria con la MISMA semántica que el de verdad: todo por clinicId, corregir guarda revisión. */
function repoEnMemoria(opciones: { tabla?: boolean } = {}) {
  const notas: NotaInterna[] = [];
  const llamadas: string[] = [];
  let reloj = 0;
  let seq = 0;
  const ahora = () => new Date(Date.UTC(2026, 9, 1, 10, 0, reloj++));
  const copia = (n: NotaInterna): NotaInterna => ({ ...n, revisiones: n.revisiones.map((r) => ({ ...r })) });

  const repo: RepoNotasInternas = {
    async tablaExiste() {
      llamadas.push("tablaExiste");
      return opciones.tabla !== false;
    },
    async listar(clinicId, caseId) {
      llamadas.push("listar");
      return notas
        .filter((n) => n.clinicId === clinicId && n.caseId === caseId)
        .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())
        .map(copia);
    },
    async obtener(clinicId, id) {
      llamadas.push("obtener");
      const n = notas.find((x) => x.id === id && x.clinicId === clinicId);
      return n ? copia(n) : null;
    },
    async insertar(f: FilaNotaNueva) {
      llamadas.push("insertar");
      const t = ahora();
      const n: NotaInterna = {
        id: `nota-${++seq}`,
        clinicId: f.clinicId,
        patientId: f.patientId,
        caseId: f.caseId,
        authorId: f.authorId,
        authorNombre: `Nombre de ${f.authorId}`,
        texto: f.texto,
        createdAt: t,
        updatedAt: t,
        revisiones: [],
      };
      notas.push(n);
      return copia(n);
    },
    async corregir(clinicId, id, texto, corregidaPorId) {
      llamadas.push("corregir");
      const n = notas.find((x) => x.id === id && x.clinicId === clinicId);
      if (!n) return null;
      const t = ahora();
      n.revisiones.unshift({
        id: `rev-${++seq}`,
        noteId: n.id,
        textoAnterior: n.texto,
        textoAnteriorDesde: n.updatedAt,
        corregidaPorId,
        corregidaPorNombre: `Nombre de ${corregidaPorId}`,
        corregidaEl: t,
      });
      n.texto = texto;
      n.updatedAt = t;
      return copia(n);
    },
  };
  return { repo, notas, llamadas };
}

const nueva = (repo: RepoNotasInternas, texto: unknown = "Llega siempre 10 minutos tarde.", over: Partial<Parameters<typeof crearNota>[1]> = {}) =>
  crearNota(repo, { clinicId: A, patientId: PACIENTE, caseId: CASO, authorId: ANA, texto, ...over });

function ok<T>(r: servicio.ResultadoNota<T>): T {
  assert.equal(r.ok, true, JSON.stringify(r));
  return (r as { ok: true; valor: T }).valor;
}

/* ───────────── 1 · Aislamiento por clínica ───────────── */

test("🔴 sin clinicId se corta ANTES de tocar el repo (nunca clinicId: undefined)", async () => {
  const { repo, llamadas } = repoEnMemoria();
  for (const clinicId of ["", undefined as unknown as string, null as unknown as string]) {
    const l = await listarNotas(repo, { clinicId, caseId: CASO });
    assert.deepEqual([l.ok, (l as any).codigo], [false, "SIN_CLINICA"]);
    const c = await nueva(repo, "texto", { clinicId });
    assert.deepEqual([c.ok, (c as any).codigo], [false, "SIN_CLINICA"]);
    const k = await corregirNota(repo, { clinicId, id: "nota-1", actor: { userId: ANA, role: "DOCTOR" }, texto: "otro" });
    assert.deepEqual([k.ok, (k as any).codigo], [false, "SIN_CLINICA"]);
  }
  assert.deepEqual(llamadas, [], "el repo no se tocó");
});

test("🔴 una clínica no ve ni corrige las notas de otra, aunque el id del caso sea el mismo", async () => {
  const { repo, notas } = repoEnMemoria();
  const deA = ok(await nueva(repo, "NOTA PRIVADA DE A"));
  ok(await nueva(repo, "nota de B", { clinicId: B, authorId: ADMIN_B }));

  const listaA = ok(await listarNotas(repo, { clinicId: A, caseId: CASO }));
  const listaB = ok(await listarNotas(repo, { clinicId: B, caseId: CASO }));
  assert.deepEqual(listaA.map((n) => n.texto), ["NOTA PRIVADA DE A"]);
  assert.deepEqual(listaB.map((n) => n.texto), ["nota de B"]);
  assert.ok(listaA.every((n) => n.clinicId === A) && listaB.every((n) => n.clinicId === B));

  // El admin de B intenta corregir la nota de A con su id: «no existe».
  const r = await corregirNota(repo, { clinicId: B, id: deA.id, actor: { userId: ADMIN_B, role: "ADMIN" }, texto: "me la adueño" });
  assert.deepEqual([r.ok, (r as any).codigo, (r as any).status], [false, "NO_ENCONTRADA", 404]);
  assert.equal(notas.find((n) => n.id === deA.id)!.texto, "NOTA PRIVADA DE A");
  assert.equal(notas.find((n) => n.id === deA.id)!.revisiones.length, 0);
});

/* ───────────── 2 · Texto y autoría ───────────── */

test("texto: obligatorio, recortado en las puntas y con tope", async () => {
  const { repo, notas } = repoEnMemoria();
  for (const malo of ["", "   \n\t ", null, 42, {}]) {
    const r = await nueva(repo, malo);
    assert.deepEqual([r.ok, (r as any).codigo, (r as any).status], [false, "TEXTO_VACIO", 400], String(malo));
  }
  const sinTexto = await crearNota(repo, { clinicId: A, patientId: PACIENTE, caseId: CASO, authorId: ANA, texto: undefined });
  assert.deepEqual([sinTexto.ok, (sinTexto as any).codigo], [false, "TEXTO_VACIO"]);
  assert.equal(notas.length, 0, "ninguno de los rechazados se guardó");

  assert.equal(MAX_CARACTERES_NOTA, 4000);
  const justo = "a".repeat(MAX_CARACTERES_NOTA);
  assert.equal(ok(await nueva(repo, justo)).texto.length, MAX_CARACTERES_NOTA);
  const pasado = await nueva(repo, "a".repeat(MAX_CARACTERES_NOTA + 1));
  assert.deepEqual([pasado.ok, (pasado as any).codigo], [false, "TEXTO_LARGO"]);

  assert.equal(ok(await nueva(repo, "  con espacios  \n")).texto, "con espacios");
  assert.deepEqual(validarTextoNota("  x "), { ok: true, texto: "x" });
});

test("el autor es quien tiene la sesión y se exige; sin caso o sin paciente no se guarda", async () => {
  const { repo, notas } = repoEnMemoria();
  const n = ok(await nueva(repo, "hola", { authorId: BETO }));
  assert.equal(n.authorId, BETO);
  for (const [over, codigo] of [
    [{ authorId: "" }, "SIN_USUARIO"],
    [{ caseId: "" }, "SIN_CASO"],
    [{ patientId: "" }, "SIN_PACIENTE"],
  ] as const) {
    const r = await nueva(repo, "hola", over);
    assert.equal((r as any).codigo, codigo);
  }
  assert.equal(notas.length, 1);
});

test("sin las tablas (falta pegar el SQL) se dice SIN_TABLA y no se escribe nada", async () => {
  const { repo, notas } = repoEnMemoria({ tabla: false });
  assert.equal((await nueva(repo)).ok, false);
  assert.equal(((await nueva(repo)) as any).codigo, "SIN_TABLA");
  assert.equal(((await listarNotas(repo, { clinicId: A, caseId: CASO })) as any).codigo, "SIN_TABLA");
  assert.equal(notas.length, 0);
});

/* ───────────── 3 · Corregir ───────────── */

test("corregir guarda el texto anterior como revisión (quién y cuándo) y deja el nuevo", async () => {
  const { repo } = repoEnMemoria();
  const original = ok(await nueva(repo, "versión 1"));
  const v2 = ok(await corregirNota(repo, { clinicId: A, id: original.id, actor: { userId: ANA, role: "DOCTOR" }, texto: "versión 2" }));
  assert.equal(v2.texto, "versión 2");
  assert.equal(v2.revisiones.length, 1);
  const rev = v2.revisiones[0];
  assert.equal(rev.textoAnterior, "versión 1");
  assert.equal(rev.corregidaPorId, ANA);
  assert.ok(rev.corregidaEl.getTime() >= original.createdAt.getTime());
  assert.equal(rev.textoAnteriorDesde.getTime(), original.createdAt.getTime(), "el texto anterior estaba vigente desde que se escribió");
  assert.equal(v2.authorId, ANA, "corregir no cambia al autor");
  assert.equal(v2.createdAt.getTime(), original.createdAt.getTime(), "ni la fecha en que se escribió");

  // Una segunda corrección suma otra; la primera sigue ahí. La más reciente va primero.
  const v3 = ok(await corregirNota(repo, { clinicId: A, id: original.id, actor: { userId: ADMIN_A, role: "ADMIN" }, texto: "versión 3" }));
  assert.deepEqual(v3.revisiones.map((r) => r.textoAnterior), ["versión 2", "versión 1"]);
  assert.deepEqual(v3.revisiones.map((r) => r.corregidaPorId), [ADMIN_A, ANA]);

  // Y la lista del caso trae las revisiones.
  const lista = ok(await listarNotas(repo, { clinicId: A, caseId: CASO }));
  assert.equal(lista[0].revisiones.length, 2);
});

test("🔴 corrige el AUTOR o un ADMIN/SUPER_ADMIN; cualquier otro, no (y nada cambia)", async () => {
  const { repo, notas } = repoEnMemoria();
  const n = ok(await nueva(repo, "de Ana"));

  for (const role of ["DOCTOR", "RECEPTIONIST", "READONLY"]) {
    const r = await corregirNota(repo, { clinicId: A, id: n.id, actor: { userId: BETO, role }, texto: "intento de " + role });
    assert.deepEqual([r.ok, (r as any).codigo, (r as any).status], [false, "SOLO_AUTOR_O_ADMIN", 403], role);
  }
  assert.equal(notas[0].texto, "de Ana");
  assert.equal(notas[0].revisiones.length, 0);

  assert.equal(ok(await corregirNota(repo, { clinicId: A, id: n.id, actor: { userId: ANA, role: "RECEPTIONIST" }, texto: "la autora, aunque sea recepción" })).revisiones.length, 1);
  assert.equal(ok(await corregirNota(repo, { clinicId: A, id: n.id, actor: { userId: ADMIN_A, role: "ADMIN" }, texto: "admin" })).revisiones.length, 2);
  assert.equal(ok(await corregirNota(repo, { clinicId: A, id: n.id, actor: { userId: "u-dueno", role: "SUPER_ADMIN" }, texto: "dueño" })).revisiones.length, 3);

  assert.equal(puedeCorregirNota({ authorId: ANA }, { userId: ANA, role: "DOCTOR" }), true);
  assert.equal(puedeCorregirNota({ authorId: ANA }, { userId: BETO, role: "DOCTOR" }), false);
  assert.equal(puedeCorregirNota({ authorId: ANA }, { userId: "", role: "ADMIN" }), false, "sin usuario no corrige nadie");
});

test("corregir con el mismo texto, vacío o demasiado largo no deja revisión", async () => {
  const { repo, notas } = repoEnMemoria();
  const n = ok(await nueva(repo, "igual"));
  const actor = { userId: ANA, role: "DOCTOR" };
  assert.equal(((await corregirNota(repo, { clinicId: A, id: n.id, actor, texto: "  igual " })) as any).codigo, "SIN_CAMBIOS");
  assert.equal(((await corregirNota(repo, { clinicId: A, id: n.id, actor, texto: "   " })) as any).codigo, "TEXTO_VACIO");
  assert.equal(((await corregirNota(repo, { clinicId: A, id: n.id, actor, texto: "x".repeat(MAX_CARACTERES_NOTA + 1) })) as any).codigo, "TEXTO_LARGO");
  assert.equal(((await corregirNota(repo, { clinicId: A, id: "no-existe", actor, texto: "otro" })) as any).codigo, "NO_ENCONTRADA");
  assert.equal(notas[0].revisiones.length, 0);
});

/* ───────────── 4 · Nada se borra ───────────── */

test("🔴 no hay forma de borrar: ni el servicio ni el repo exponen un «borrar»", async () => {
  const { repo } = repoEnMemoria();
  const nombres = [...Object.keys(servicio), ...Object.keys(repo)];
  const sospechosos = nombres.filter((n) => /borrar|eliminar|delete|remove|destroy|quitar/i.test(n));
  assert.deepEqual(sospechosos, []);
  assert.deepEqual(Object.keys(repo).sort(), ["corregir", "insertar", "listar", "obtener", "tablaExiste"]);
});

/* ───────────── 5 · DTO y acceso ───────────── */

test("el DTO lleva ISO, la bandera de corrección y si ESTA persona puede corregir; nunca el clinicId", async () => {
  const { repo } = repoEnMemoria();
  const n = ok(await nueva(repo, "uno"));
  const corregida = ok(await corregirNota(repo, { clinicId: A, id: n.id, actor: { userId: ANA, role: "DOCTOR" }, texto: "dos" }));
  const d = aDTO(corregida, { userId: BETO, role: "DOCTOR" });
  assert.equal(d.corregida, true);
  assert.equal(d.puedeCorregir, false);
  assert.equal(aDTO(corregida, { userId: ANA, role: "DOCTOR" }).puedeCorregir, true);
  assert.match(d.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(d.revisiones[0].textoAnterior, "uno");
  assert.ok(!JSON.stringify(d).includes(A), "el clinicId no viaja al navegador");
  assert.equal("clinicId" in d, false);
});

test("acceso: ver = patients.view + módulo; escribir = patients.edit + módulo", () => {
  const u = (role: string, permissionsOverride: string[] = []) => ({ role, permissionsOverride });
  for (const r of ["SUPER_ADMIN", "ADMIN", "DOCTOR", "RECEPTIONIST"]) {
    assert.equal(puedeNotasInternas(u(r), "ver"), true, `${r} ve`);
    assert.equal(puedeNotasInternas(u(r), "escribir"), true, `${r} escribe`);
  }
  // Solo lectura: no escribe.
  assert.equal(puedeNotasInternas(u("READONLY"), "escribir"), false);
  // Sin la llave del módulo de Ortodoncia (override por persona), no entra.
  const sinModulo = ["patients.view", "patients.edit"];
  assert.equal(puedeNotasInternas(u("DOCTOR", sinModulo), "ver"), false);
  // Con el módulo pero sin ver pacientes, tampoco.
  assert.equal(puedeNotasInternas(u("DOCTOR", ["specialties.orthodontics"]), "ver"), false);
  assert.equal(puedeNotasInternas(u("DOCTOR", ["specialties.orthodontics", "patients.view"]), "escribir"), false);
  assert.equal(puedeNotasInternas(u("DOCTOR", ["specialties.orthodontics", "patients.view", "patients.edit"]), "escribir"), true);
  // Sin usuario o con rol suelto: se niega.
  assert.equal(puedeNotasInternas(null, "ver"), false);
  assert.equal(puedeNotasInternas(undefined, "escribir"), false);
});
