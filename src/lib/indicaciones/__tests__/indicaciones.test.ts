/**
 * Indicaciones postoperatorias y constancia de asistencia (ws1-t10, mejora 12).
 *
 * Run: npm run test:indicaciones
 *
 * Fija:
 *  - Los textos de fábrica son prudentes: sin dosis ni medicamentos, y remiten
 *    a «las indicaciones de tu dentista». La constancia lleva paciente, fecha,
 *    hora, doctor con cédula y clínica.
 *  - Marcadores: se rellenan; lo que falta sale como raya; lo desconocido, tal cual.
 *  - La biblioteca: oculta sin la tabla (y sin consultarla), siembra la de fábrica
 *    una sola vez ligada al catálogo, las de fábrica no se editan (se copian), la
 *    copia hereda la liga, los ids ajenos se descartan, nada se borra.
 *  - La cita: qué se propone (por liga y, si no, por palabras), la hora que consta.
 *  - WhatsApp: con la ventana cerrada y sin plantilla NO sale (bloqueado ANTES).
 *  - Los textos de pantalla existen en español e inglés.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TEXTOS_DE_FABRICA, coincideConFabrica, textoDeFabrica } from "../fabrica";
import { MARCADORES_HOJA, RAYA, marcadoresDesconocidos, rellenarHoja } from "../marcadores";
import { bloquesDeHoja, hojaATextoWhatsApp } from "../cuerpo";
import {
  constanciaPorDefecto,
  crearHoja,
  editarHoja,
  hojasSugeridas,
  ligaDeFabrica,
  listarHojas,
  nombreDeCopiaHoja,
  procedimientosDeLaCita,
  type FilaHoja,
  type FilaNueva,
  type RepoHojas,
} from "../servicio";
import {
  KIND_ENVIO_INDICACIONES,
  MAX_TEXTO_WHATSAPP,
  admiteConstancia,
  admiteIndicaciones,
  datosDePlantilla,
  seAcabaDeTerminar,
  horarioQueConsta,
  mensajeDeIndicaciones,
  textoDeProcedimientos,
  valoresDeLaCita,
  vistaWhatsAppIndicaciones,
} from "../envio";
import { textosIndicaciones } from "../textos";
import {
  DEFAULT_CATALOG_KINDS,
  PLANTILLA_INDICACIONES_ENCENDIDA,
  WA_PLANTILLA_INDICACIONES_EN_ESPERA,
  WA_TEMPLATE_CATALOG,
  catalogEntryFor,
  checkCatalogEntry,
} from "@/lib/whatsapp/templates-catalog";
import { parseWaTemplates, renderTemplateBody } from "@/lib/whatsapp/template-config";
import { decideSendMode } from "@/lib/whatsapp/send-mode";
import { WHATSAPP_SEND_KINDS } from "@/lib/whatsapp/system-message";
import type { HojaDTO, ProcedimientoLigable } from "../tipos";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8");

// ─── Textos de fábrica ──────────────────────────────────────────────────────

test("fábrica: indicaciones prudentes — sin dosis ni nombres de medicamentos, y remiten al dentista", () => {
  const indicaciones = TEXTOS_DE_FABRICA.filter((t) => t.tipo === "INDICACIONES");
  assert.ok(indicaciones.length >= 8, "faltan textos de fábrica (extracción, endodoncia, limpieza, cirugía…)");
  for (const clave of ["extraccion", "endodoncia", "limpieza", "cirugia"]) {
    assert.ok(textoDeFabrica(clave), `falta el texto de fábrica «${clave}»`);
  }
  const dosis = /\b\d+\s*(mg|ml|g|gotas?|tabletas?|pastillas?|c[aá]psulas?)\b|cada\s+\d+\s*(h|horas)|ibuprofeno|paracetamol|amoxicilina|ketorolaco|naproxeno|clorhexidina/i;
  for (const t of indicaciones) {
    assert.ok(!dosis.test(t.cuerpo), `«${t.nombre}» indica una dosis o un medicamento`);
    assert.match(t.cuerpo, /indicaciones de tu dentista/, `«${t.nombre}» no remite a las indicaciones del dentista`);
    assert.ok(t.palabras.length > 0, `«${t.nombre}» no se puede ligar a ningún procedimiento`);
  }
});

test("fábrica: la constancia lleva paciente, fecha, hora, doctor con cédula y clínica", () => {
  const c = textoDeFabrica("constancia")!;
  assert.equal(c.tipo, "CONSTANCIA");
  for (const m of ["[NOMBRE_PACIENTE]", "[FECHA_CITA]", "[HORA_INICIO]", "[HORA_FIN]", "[NOMBRE_DOCTOR]", "[CEDULA_DOCTOR]", "[NOMBRE_CLINICA]"]) {
    assert.ok(c.cuerpo.includes(m), `la constancia no lleva ${m}`);
  }
  // Una constancia de asistencia no dice qué se le hizo al paciente.
  assert.ok(!c.cuerpo.includes("[PROCEDIMIENTO]"));
});

test("fábrica: todo marcador que usan los textos existe", () => {
  for (const t of TEXTOS_DE_FABRICA) {
    assert.deepEqual(marcadoresDesconocidos(t.cuerpo), [], `«${t.nombre}» usa un marcador que no existe`);
  }
  const claves = TEXTOS_DE_FABRICA.map((t) => t.clave);
  assert.equal(new Set(claves).size, claves.length, "dos textos de fábrica con la misma llave");
});

test("fábrica: liga por palabras, sin acentos y con exclusiones", () => {
  const f = (k: string) => textoDeFabrica(k)!;
  assert.ok(coincideConFabrica(f("extraccion"), "Extracción simple"));
  assert.ok(coincideConFabrica(f("extraccion"), "EXODONCIA tercer molar"));
  assert.ok(coincideConFabrica(f("endodoncia"), "Endodoncia multirradicular"));
  assert.ok(coincideConFabrica(f("limpieza"), "Profilaxis (limpieza)"));
  assert.ok(coincideConFabrica(f("cirugia"), "Cirugía periodontal"));
  assert.ok(coincideConFabrica(f("corona"), "Corona sobre implante"));
  assert.ok(!coincideConFabrica(f("implante"), "Corona sobre implante"), "la corona sobre implante no es la cirugía del implante");
  assert.ok(coincideConFabrica(f("implante"), "Implante dental"));
  assert.ok(coincideConFabrica(f("cirugia"), "Alargamiento de corona"));
  assert.ok(!coincideConFabrica(f("corona"), "Alargamiento de corona"));
  for (const t of TEXTOS_DE_FABRICA) {
    assert.ok(!coincideConFabrica(t, "Radiografía panorámica"), `«${t.nombre}» se liga a una radiografía`);
    assert.ok(!coincideConFabrica(t, ""));
  }
});

// ─── Marcadores y cuerpo ────────────────────────────────────────────────────

test("marcadores: se rellenan; lo que falta sale como raya; lo desconocido se queda", () => {
  const out = rellenarHoja("Hola [NOMBRE_PACIENTE], cédula [CEDULA_DOCTOR]. [NOTA_LIBRE]", {
    nombrePaciente: "Ana López",
    cedulaDoctor: "  ",
  });
  assert.equal(out, `Hola Ana López, cédula ${RAYA}. [NOTA_LIBRE]`);
  assert.deepEqual(marcadoresDesconocidos("[NOMBRE_PACIENTE] [OTRO] [OTRO]"), ["[OTRO]"]);
  assert.equal(new Set(MARCADORES_HOJA.map((m) => m.token)).size, MARCADORES_HOJA.length);
});

test("cuerpo: viñetas y párrafos, igual en el PDF y en WhatsApp", () => {
  const b = bloquesDeHoja("Hola Ana:\n\n- uno\n• dos\n\nCierre en\ndos líneas");
  assert.deepEqual(b, [
    { tipo: "parrafo", texto: "Hola Ana:" },
    { tipo: "lista", items: ["uno", "dos"] },
    { tipo: "parrafo", texto: "Cierre en dos líneas" },
  ]);
  assert.equal(hojaATextoWhatsApp("Hola:\n- uno\n- dos"), "Hola:\n\n• uno\n• dos");
});

// ─── La biblioteca (repo en memoria) ────────────────────────────────────────

const CATALOGO: ProcedimientoLigable[] = [
  { id: "p-ext", name: "Extracción simple", isActive: true },
  { id: "p-endo", name: "Endodoncia unirradicular", isActive: true },
  { id: "p-rx", name: "Radiografía panorámica", isActive: true },
  { id: "p-viejo", name: "Extracción quirúrgica (vieja)", isActive: false },
];

function repoEnMemoria(opciones: { existe?: boolean } = {}) {
  const filas: FilaHoja[] = [];
  const llamadas = { listar: 0, sembrar: 0, insertar: 0, actualizar: 0, tablaExiste: 0 };
  let n = 0;
  const reloj = () => new Date(Date.UTC(2026, 9, 3, 12, 0, n++));
  const choca = (f: { clinicId: string; tipo: string; nombre: string; factoryKey?: string | null }, exceptoId?: string) =>
    filas.some(
      (x) =>
        x.id !== exceptoId &&
        x.clinicId === f.clinicId &&
        ((x.tipo === f.tipo && x.nombre.toLowerCase() === f.nombre.toLowerCase()) ||
          (!!f.factoryKey && x.factoryKey === f.factoryKey)),
    );
  const repo: RepoHojas = {
    async tablaExiste() {
      llamadas.tablaExiste++;
      return opciones.existe !== false;
    },
    async listar(clinicId, tipo) {
      llamadas.listar++;
      return filas.filter((f) => f.clinicId === clinicId && (!tipo || f.tipo === tipo)).map((f) => ({ ...f }));
    },
    async obtener(clinicId, id) {
      const f = filas.find((x) => x.id === id && x.clinicId === clinicId);
      return f ? { ...f } : null;
    },
    async insertar(f: FilaNueva) {
      llamadas.insertar++;
      if (choca(f)) return "NOMBRE_OCUPADO";
      const fila: FilaHoja = { ...f, id: `h${filas.length + 1}`, activa: true, createdAt: reloj(), updatedAt: reloj() };
      filas.push(fila);
      return { ...fila };
    },
    async sembrar(nuevas) {
      llamadas.sembrar++;
      for (const f of nuevas) if (!choca(f)) filas.push({ ...f, id: `h${filas.length + 1}`, activa: true, createdAt: reloj(), updatedAt: reloj() });
    },
    async actualizar(clinicId, id, c) {
      llamadas.actualizar++;
      const f = filas.find((x) => x.id === id && x.clinicId === clinicId);
      if (!f) return null;
      if (c.nombre && choca({ ...f, nombre: c.nombre, factoryKey: null }, f.id)) return "NOMBRE_OCUPADO";
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
  return { repo, filas, llamadas };
}

test("biblioteca: sin la tabla no hay lista, y la tabla NO se consulta", async () => {
  const { repo, llamadas } = repoEnMemoria({ existe: false });
  let catalogoPedido = 0;
  const r = await listarHojas(repo, "c1", async () => {
    catalogoPedido++;
    return CATALOGO;
  });
  assert.equal(r, null);
  assert.equal(llamadas.listar, 0);
  assert.equal(catalogoPedido, 0);
  const crear = await crearHoja(repo, "c1", "u1", { tipo: "INDICACIONES", nombre: "X", cuerpo: "Y" }, CATALOGO);
  assert.equal(crear.ok, false);
  assert.equal(crear.codigo, "SIN_TABLA");
  assert.equal(llamadas.insertar, 0);
});

test("biblioteca: siembra la de fábrica UNA vez, ligada al catálogo de esa clínica", async () => {
  const { repo, llamadas } = repoEnMemoria();
  const hojas = (await listarHojas(repo, "c1", async () => CATALOGO))!;
  assert.equal(hojas.length, TEXTOS_DE_FABRICA.length);
  assert.ok(hojas.every((h) => h.deFabrica && h.activa));
  const ext = hojas.find((h) => h.basadaEn === "extraccion")!;
  // Solo los procedimientos ACTIVOS que la nombran; la radiografía no.
  assert.deepEqual(ext.procedureIds, ["p-ext"]);
  assert.deepEqual(hojas.find((h) => h.basadaEn === "endodoncia")!.procedureIds, ["p-endo"]);
  assert.deepEqual(hojas.find((h) => h.tipo === "CONSTANCIA")!.procedureIds, []);
  await listarHojas(repo, "c1", async () => CATALOGO);
  assert.equal(llamadas.sembrar, 1, "la segunda vez no vuelve a sembrar");
  // Otra clínica tiene su propia siembra; no ve las de la primera.
  const otra = (await listarHojas(repo, "c2", async () => []))!;
  assert.equal(otra.length, TEXTOS_DE_FABRICA.length);
  assert.ok(otra.every((h) => !hojas.some((x) => x.id === h.id)));
  assert.deepEqual(ligaDeFabrica("constancia", CATALOGO), []);
});

test("biblioteca: la de fábrica no se edita (texto ni nombre); su liga y su «en uso» sí", async () => {
  const { repo } = repoEnMemoria();
  const hojas = (await listarHojas(repo, "c1", async () => CATALOGO))!;
  const ext = hojas.find((h) => h.basadaEn === "extraccion")!;
  const r1 = await editarHoja(repo, "c1", ext.id, { cuerpo: "otro texto" }, CATALOGO);
  assert.equal(r1.codigo, "FABRICA_NO_SE_EDITA");
  const r2 = await editarHoja(repo, "c1", ext.id, { nombre: "Mi extracción" }, CATALOGO);
  assert.equal(r2.codigo, "FABRICA_NO_SE_EDITA");
  // Mismo texto que ya tiene (el editor lo reenvía): no es un cambio.
  const r3 = await editarHoja(repo, "c1", ext.id, { nombre: ext.nombre, cuerpo: ext.cuerpo, procedureIds: ["p-ext", "p-endo", "id-de-otra-clinica"] }, CATALOGO);
  assert.equal(r3.ok, true);
  assert.deepEqual(r3.hoja!.procedureIds, ["p-ext", "p-endo"], "un id que no es del catálogo de la clínica se descarta");
  const r4 = await editarHoja(repo, "c1", ext.id, { activa: false }, CATALOGO);
  assert.equal(r4.hoja!.activa, false);
  // Otra clínica no la encuentra.
  assert.equal((await editarHoja(repo, "c2", ext.id, { activa: true }, CATALOGO)).codigo, "NO_ENCONTRADA");
});

test("biblioteca: «Copiar y editar» crea una propia con el texto y la liga de la original", async () => {
  const { repo } = repoEnMemoria();
  const hojas = (await listarHojas(repo, "c1", async () => CATALOGO))!;
  const ext = hojas.find((h) => h.basadaEn === "extraccion")!;
  const nombre = nombreDeCopiaHoja(ext.nombre, hojas.map((h) => h.nombre));
  assert.equal(nombre, "Después de una extracción (copia)");
  const r = await crearHoja(repo, "c1", "u1", { nombre, cuerpo: `${ext.cuerpo}\n- Dato propio`, copiaDe: ext.id }, CATALOGO);
  assert.equal(r.ok, true);
  assert.equal(r.hoja!.deFabrica, false);
  assert.equal(r.hoja!.tipo, "INDICACIONES");
  assert.equal(r.hoja!.basadaEn, "extraccion");
  assert.deepEqual(r.hoja!.procedureIds, ["p-ext"]);
  // La propia sí se edita.
  const e = await editarHoja(repo, "c1", r.hoja!.id, { cuerpo: "Texto nuevo" }, CATALOGO);
  assert.equal(e.hoja!.cuerpo, "Texto nuevo");
  // El nombre no se repite (sin importar mayúsculas) dentro del tipo.
  const dup = await crearHoja(repo, "c1", "u1", { tipo: "INDICACIONES", nombre: nombre.toUpperCase(), cuerpo: "x" }, CATALOGO);
  assert.equal(dup.codigo, "NOMBRE_OCUPADO");
  // La siguiente copia se numera.
  const todos = [...hojas.map((h) => h.nombre), nombre];
  assert.equal(nombreDeCopiaHoja(nombre, todos), "Después de una extracción (copia 2)");
});

test("biblioteca: validaciones (tipo, nombre, texto, etiquetas fuera)", async () => {
  const { repo } = repoEnMemoria();
  const v = (e: Parameters<typeof crearHoja>[3]) => crearHoja(repo, "c1", "u1", e, CATALOGO);
  assert.equal((await v({ tipo: "RECETA", nombre: "a", cuerpo: "b" })).codigo, "TIPO_INVALIDO");
  assert.equal((await v({ tipo: "INDICACIONES", nombre: "  ", cuerpo: "b" })).codigo, "NOMBRE_REQUERIDO");
  assert.equal((await v({ tipo: "INDICACIONES", nombre: "x".repeat(121), cuerpo: "b" })).codigo, "NOMBRE_LARGO");
  assert.equal((await v({ tipo: "INDICACIONES", nombre: "a", cuerpo: "  " })).codigo, "CUERPO_REQUERIDO");
  assert.equal((await v({ tipo: "INDICACIONES", nombre: "a", cuerpo: "x".repeat(6001) })).codigo, "CUERPO_LARGO");
  const ok = await v({ tipo: "CONSTANCIA", nombre: "Mi constancia", cuerpo: "<b>Hola</b> [NOMBRE_PACIENTE]", procedureIds: ["p-ext"] });
  assert.equal(ok.hoja!.cuerpo, "Hola [NOMBRE_PACIENTE]");
  assert.deepEqual(ok.hoja!.procedureIds, [], "una constancia no se liga a procedimientos");
});

// ─── La cita ────────────────────────────────────────────────────────────────

const hoja = (p: Partial<HojaDTO> & { id: string }): HojaDTO => ({
  tipo: "INDICACIONES",
  nombre: p.id,
  cuerpo: "",
  procedureIds: [],
  deFabrica: false,
  basadaEn: null,
  activa: true,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...p,
});

test("cita: los procedimientos se reconocen por nombre (motivo o concepto de la nota), sin acentos", () => {
  const p = procedimientosDeLaCita(["  extraccion SIMPLE ", "Consulta", null], CATALOGO);
  assert.deepEqual(p.map((x) => x.id), ["p-ext"]);
  assert.deepEqual(procedimientosDeLaCita(["Extracción"], CATALOGO), [], "nunca por parecido");
});

test("cita: se propone por la liga; si nada liga, por palabras; la copia de la clínica gana a la de fábrica", () => {
  const hojas = [
    hoja({ id: "fab-ext", deFabrica: true, basadaEn: "extraccion", procedureIds: [] }),
    hoja({ id: "mia-ext", basadaEn: "extraccion" }),
    hoja({ id: "ligada", procedureIds: ["p-endo"] }),
    hoja({ id: "apagada", procedureIds: ["p-endo"], activa: false }),
    hoja({ id: "fab-limp", deFabrica: true, basadaEn: "limpieza" }),
  ];
  assert.deepEqual(hojasSugeridas(hojas, [CATALOGO[1]], ["Endodoncia unirradicular"]), ["ligada"]);
  assert.deepEqual(hojasSugeridas(hojas, [], ["Extracción de muela"]), ["mia-ext"]);
  assert.deepEqual(hojasSugeridas(hojas, [], ["Revisión"]), []);
});

test("cita: la constancia por defecto es la propia más reciente en uso; si no hay, la de fábrica", () => {
  const fab = hoja({ id: "fab", tipo: "CONSTANCIA", deFabrica: true });
  const vieja = hoja({ id: "vieja", tipo: "CONSTANCIA", updatedAt: "2026-09-01T00:00:00.000Z" });
  const nueva = hoja({ id: "nueva", tipo: "CONSTANCIA", updatedAt: "2026-10-02T00:00:00.000Z" });
  assert.equal(constanciaPorDefecto([fab, vieja, nueva])!.id, "nueva");
  assert.equal(constanciaPorDefecto([fab, { ...nueva, activa: false }])!.id, "fab");
});

test("cita: qué estados admiten indicaciones y constancia", () => {
  assert.ok(admiteIndicaciones("COMPLETED") && admiteIndicaciones("IN_PROGRESS") && admiteIndicaciones("CHECKED_OUT"));
  assert.ok(!admiteIndicaciones("SCHEDULED") && !admiteIndicaciones("CANCELLED") && !admiteIndicaciones("CHECKED_IN"));
  assert.ok(admiteConstancia("CHECKED_IN") && admiteConstancia("COMPLETED"));
  assert.ok(!admiteConstancia("CONFIRMED") && !admiteConstancia("NO_SHOW") && !admiteConstancia("CANCELLED"));
});

test("cita: la oferta sale solo al terminar la consulta con el panel abierto", () => {
  assert.ok(seAcabaDeTerminar("IN_PROGRESS", "COMPLETED"));
  assert.ok(seAcabaDeTerminar("IN_CHAIR", "COMPLETED"));
  assert.ok(!seAcabaDeTerminar(null, "COMPLETED"), "abrir una cita ya completada no ofrece nada");
  assert.ok(!seAcabaDeTerminar("COMPLETED", "COMPLETED"));
  assert.ok(!seAcabaDeTerminar("COMPLETED", "CHECKED_OUT"));
});

const TZ = "America/Mexico_City";
const cita = (p: Partial<Parameters<typeof horarioQueConsta>[0]> = {}) => ({
  status: "COMPLETED",
  motivo: "Extracción simple",
  startsAt: new Date("2026-10-03T16:00:00Z"), // 10:00 en CDMX
  endsAt: new Date("2026-10-03T16:30:00Z"),
  checkedInAt: null,
  startedAt: null,
  completedAt: null,
  ...p,
});

test("constancia (C-60): consta la hora de la AGENDA, no la llegada que alguien marcó tarde en el sistema", () => {
  // La cita del 2-oct de 11:00 a 11:30 con «llegada» marcada a las 14:08: antes decía «de las 14:08 a las 14:38».
  const marcadaTarde = horarioQueConsta(
    cita({ startsAt: new Date("2026-10-02T17:00:00Z"), endsAt: new Date("2026-10-02T17:30:00Z"), checkedInAt: new Date("2026-10-02T20:08:00Z") }),
    TZ,
  );
  assert.equal(marcadaTarde.inicio.toISOString(), "2026-10-02T17:00:00.000Z");
  assert.equal(marcadaTarde.fin.toISOString(), "2026-10-02T17:30:00.000Z");
  const conFinReal = horarioQueConsta(cita({ checkedInAt: new Date("2026-10-03T15:55:00Z"), completedAt: new Date("2026-10-03T16:40:00Z") }), TZ);
  assert.equal(conFinReal.inicio.toISOString(), "2026-10-03T16:00:00.000Z");
  assert.equal(conFinReal.fin.toISOString(), "2026-10-03T16:30:00.000Z");
  // Una cita sin duración no sale «de 10:00 a 10:00».
  const sinDuracion = horarioQueConsta(cita({ endsAt: new Date("2026-10-03T16:00:00Z") }), TZ);
  assert.ok(sinDuracion.fin > sinDuracion.inicio);
});

test("constancia: los valores salen en la zona de la clínica y la cédula que falta, como raya", () => {
  const v = valoresDeLaCita(
    {
      cita: cita({ checkedInAt: new Date("2026-10-03T15:55:00Z"), completedAt: new Date("2026-10-03T16:40:00Z") }),
      paciente: { nombre: "Ana López" },
      doctor: { nombre: "Luis Pérez", cedula: null },
      clinica: { nombre: "Clínica QA", telefono: null, ciudad: "Mérida", estado: "Yucatán", timezone: TZ },
      procedimientos: [],
    },
    new Date("2026-10-04T02:00:00Z"), // 3 de octubre, 20:00 en CDMX
  );
  assert.equal(v.fechaCita, "3 de octubre de 2026");
  assert.equal(v.horaInicio, "10:00");
  assert.equal(v.horaFin, "10:30");
  assert.equal(v.fecha, "3 de octubre de 2026");
  assert.equal(v.lugar, "Mérida, Yucatán");
  // C-60: con una dirección de CDMX el campo ciudad «Mérida» ya no se imprime.
  const cdmx = valoresDeLaCita(
    {
      cita: cita(),
      paciente: { nombre: "Ana López" },
      doctor: { nombre: "Luis Pérez", cedula: "1234567" },
      clinica: {
        nombre: "Clínica QA", telefono: null, ciudad: "Mérida", estado: null, timezone: TZ,
        direccion: "Av. Insurgentes Sur 1234, Col. Del Valle, Benito Juárez, 03100 Ciudad de México, CDMX",
      },
      procedimientos: [],
    },
    new Date("2026-10-04T02:00:00Z"),
  );
  assert.equal(cdmx.lugar, "Ciudad de México");
  assert.equal(v.procedimiento, "Extracción simple", "sin procedimiento reconocido, el motivo");
  const texto = rellenarHoja(textoDeFabrica("constancia")!.cuerpo, v);
  assert.ok(texto.includes("Ana López") && texto.includes("Luis Pérez") && texto.includes(`cédula profesional ${RAYA}`));
  assert.ok(!/\[[A-Z_]+\]/.test(texto), "quedó un marcador sin rellenar");
  assert.equal(textoDeProcedimientos(["Extracción simple", "Resina", "Profilaxis"], null), "Extracción simple, Resina y Profilaxis");
});

// ─── WhatsApp ───────────────────────────────────────────────────────────────

const CONECTADA = { waConnected: true, waPhoneNumberId: "123", conToken: true, waTemplates: {} };
const AHORA = new Date("2026-10-03T18:00:00Z");

test("whatsapp: dentro de la ventana sale el texto; fuera y sin plantilla, NO sale (y se sabe antes)", () => {
  assert.equal(PLANTILLA_INDICACIONES_ENCENDIDA, false, "la plantilla espera la aprobación del texto por Rafael");
  assert.equal(KIND_ENVIO_INDICACIONES, "system", "sin plantilla de indicaciones en el catálogo, el tipo es el de los documentos");
  const dentro = vistaWhatsAppIndicaciones({ clinica: CONECTADA, telefono: "9991234567", ultimoEntrante: new Date("2026-10-03T10:00:00Z"), ahora: AHORA });
  assert.deepEqual(dentro, { modo: "text", motivo: null });
  const fuera = vistaWhatsAppIndicaciones({ clinica: CONECTADA, telefono: "9991234567", ultimoEntrante: null, ahora: AHORA });
  assert.deepEqual(fuera, { modo: "blocked", motivo: "FUERA_DE_VENTANA" });
  assert.equal(vistaWhatsAppIndicaciones({ clinica: { ...CONECTADA, waConnected: false }, telefono: "1", ultimoEntrante: null, ahora: AHORA }).motivo, "WA_SIN_CONECTAR");
  assert.equal(vistaWhatsAppIndicaciones({ clinica: CONECTADA, telefono: " ", ultimoEntrante: AHORA, ahora: AHORA }).motivo, "SIN_TELEFONO");
});

test("whatsapp: con un tipo que SÍ tiene plantilla aprobada, fuera de ventana sale la plantilla (la tubería para cuando t4 la integre)", () => {
  const plantillas = { prescription: { name: "dc_receta_lista", lang: "es_MX", status: "APPROVED" } };
  const v = vistaWhatsAppIndicaciones({
    clinica: { ...CONECTADA, waTemplates: plantillas },
    telefono: "9991234567",
    ultimoEntrante: null,
    ahora: AHORA,
    kind: "prescription",
  });
  assert.deepEqual(v, { modo: "template", motivo: null });
  const enRevision = vistaWhatsAppIndicaciones({
    clinica: { ...CONECTADA, waTemplates: { prescription: { ...plantillas.prescription, status: "PENDING" } } },
    telefono: "9991234567",
    ultimoEntrante: null,
    ahora: AHORA,
    kind: "prescription",
  });
  assert.equal(enRevision.motivo, "PLANTILLA_EN_REVISION");
  // Los tres datos de la plantilla propuesta: nunca vacíos ni con saltos de línea.
  assert.deepEqual(datosDePlantilla(" ", "Clínica\nQA", ""), ["paciente", "Clínica QA", "tu consulta"]);
});

test("whatsapp: el texto lleva las hojas; si no cabe en un mensaje, null (va el aviso + PDF)", () => {
  const corto = mensajeDeIndicaciones([{ titulo: "A", cuerpo: "Hola:\n- uno" }], "Clínica QA")!;
  assert.equal(corto, "Hola:\n\n• uno\n\n— Clínica QA");
  const dos = mensajeDeIndicaciones([{ titulo: "A", cuerpo: "x" }, { titulo: "B", cuerpo: "y" }], "C")!;
  assert.ok(dos.includes("*A*") && dos.includes("*B*"));
  assert.equal(mensajeDeIndicaciones([{ titulo: "A", cuerpo: "x".repeat(MAX_TEXTO_WHATSAPP) }], "C"), null);
});

// ─── Pantalla ───────────────────────────────────────────────────────────────

test("textos: las mismas claves en español e inglés, sin huecos", () => {
  const es = textosIndicaciones("es");
  const en = textosIndicaciones("en");
  const claves = (o: object, pre = ""): string[] =>
    Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? claves(v, `${pre}${k}.`) : [`${pre}${k}`]));
  assert.deepEqual(claves(en).sort(), claves(es).sort());
  for (const k of claves(en)) {
    const v = k.split(".").reduce<any>((o, p) => o[p], en);
    assert.ok(typeof v === "string" && v.trim(), `falta el inglés de ${k}`);
  }
});

test("integración: el panel de la cita monta la ranura con el permiso de agenda.edit", () => {
  const panel = leer("src/components/dashboard/agenda-nueva/panel-cita.tsx");
  assert.match(panel, /<RanuraIndicaciones appointmentId=\{dto\.id\} estado=\{cita\.estado\} puedeEmitir=\{permissions\.canEdit === true\} \/>/);
  // La ficha: «Terminar consulta» ofrece las indicaciones de la cita que acaba de cerrar.
  const ficha = leer("src/app/dashboard/patients/[id]/patient-detail-client.tsx");
  assert.match(ficha, /setCitaTerminada\(activeAppointment\.id\);\n\s*\/\/ Si el server detectó tratamientos/);
  assert.match(ficha, /<OfertaIndicacionesFicha citaTerminada=\{citaTerminada\} \/>/);
  const servidor = leer("src/lib/indicaciones/cita.server.ts");
  assert.match(servidor, /PERMISO_EMITIR: PermissionKey = "agenda\.edit"/);
  assert.match(servidor, /where: \{ id: appointmentId, clinicId: ctx\.clinicId \}/, "la cita se busca con el clinicId de la sesión");
  assert.match(servidor, /assertPatientVisible\(cita\.patientId/);
  for (const r of ["whatsapp", "pdf", "constancia"]) {
    const ruta = leer(`src/app/api/indicaciones/cita/[id]/${r}/route.ts`);
    assert.match(ruta, /entrarCita\(req, PERMISO_EMITIR/, `${r}: emitir pide agenda.edit`);
    assert.match(ruta, /anotarEnMovimientos\(/, `${r}: no queda en Movimientos`);
  }
  const plantillas = leer("src/app/api/indicaciones/plantillas/route.ts") + leer("src/app/api/indicaciones/plantillas/[id]/route.ts");
  assert.equal((plantillas.match(/denyIfMissingPermission\(ctx, TEMPLATES_WRITE_PERMISSION\)/g) ?? []).length, 2);
});

test("integración: «Copiar y editar» desde «Ver» abre otra ventana (nombre «… (copia)»), no la misma", () => {
  // Con la misma instancia, el nombre se quedaba el de la original y guardar chocaba (NOMBRE_OCUPADO). Lo cazó la QA.
  const lista = leer("src/app/dashboard/plantillas/plantillas-indicaciones.tsx");
  assert.match(lista, /<PlantillaIndicacionesModal\s+\/\/[^\n]*\n(?:\s+\/\/[^\n]*\n)*\s+key=\{modal\.modo === "nueva" \? `nueva-\$\{modal\.tipo\}` : `\$\{modal\.modo\}-\$\{modal\.hoja\.id\}`\}/);
});

test("integración: sin colores a mano en las hojas de estilo nuevas", () => {
  for (const css of ["src/components/indicaciones/indicaciones.module.css", "src/app/dashboard/plantillas/plantillas-indicaciones.module.css"]) {
    const limpio = leer(css).replace(/\/\*[\s\S]*?\*\//g, "");
    assert.deepEqual(limpio.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) ?? [], [], `${css} tiene colores escritos a mano`);
  }
});

test("integración: el SQL es idempotente, con RLS, sin DROP ni UPDATE", () => {
  const sql = leer("sql/ws1-t10-indicaciones-y-constancia.sql").replace(/--.*$/gm, "");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "patient_handout_templates"/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  // Sentencias, no las cláusulas «ON DELETE CASCADE» de la llave foránea.
  assert.ok(!/(^|;)\s*(DROP|UPDATE|DELETE|TRUNCATE)\b/i.test(sql), "el SQL borra o reescribe filas");
  assert.ok(!/\bSET\s+(SESSION|LOCAL)?\s*\w/i.test(sql.replace(/SET\s+DEFAULT/gi, "")), "el SQL cambia la sesión");
  assert.equal((sql.match(/CREATE (UNIQUE )?INDEX(?! IF NOT EXISTS)/g) ?? []).length, 0, "un índice sin IF NOT EXISTS");
});

// ─── Plantilla de Meta «dc_indicaciones_cuidado»: redactada y APAGADA ────────

test("plantilla de indicaciones: redactada y válida para Meta, pero fuera del catálogo mientras la bandera esté apagada", () => {
  const e = WA_PLANTILLA_INDICACIONES_EN_ESPERA;
  assert.equal(e.kind, "post_op_instructions");
  assert.equal(e.name, "dc_indicaciones_cuidado");
  assert.equal(e.category, "UTILITY");
  assert.equal(checkCatalogEntry(e), null, "la redacción en espera también debe pasar las reglas de Meta");
  assert.ok(WHATSAPP_SEND_KINDS.includes("post_op_instructions"));
  // Apagada = nadie la da de alta en Meta, la pantalla no la enseña y waTemplates no la lee.
  assert.equal(PLANTILLA_INDICACIONES_ENCENDIDA, false);
  assert.equal(catalogEntryFor("post_op_instructions"), null);
  assert.ok(!WA_TEMPLATE_CATALOG.some((c) => c.name === e.name));
  assert.ok(!DEFAULT_CATALOG_KINDS.includes("post_op_instructions"));
  assert.deepEqual(parseWaTemplates({ post_op_instructions: { name: e.name, lang: "es_MX", status: "APPROVED" } }), {});
});

test("plantilla de indicaciones: sus tres variables son las que prepara datosDePlantilla, en ese orden", () => {
  const e = WA_PLANTILLA_INDICACIONES_EN_ESPERA;
  const datos = datosDePlantilla("Ana", "Clínica Sonrisa", "Extracción simple");
  assert.equal(e.variableKeys.length, datos.length);
  assert.equal(e.sample.length, datos.length);
  const texto = renderTemplateBody(e, datos, "");
  assert.equal(
    texto,
    "Hola Ana, Clínica Sonrisa tiene listas tus indicaciones de cuidado después de tu Extracción simple. " +
      "Responde a este mensaje para recibirlas por aquí, o pídelas impresas en la clínica.",
  );
  assert.ok(!/\{\{\d+\}\}/.test(texto), "quedó una variable sin sustituir");
  // El aviso no lleva indicaciones clínicas: solo dice que están listas.
  assert.ok(!/\d+\s?(mg|ml)|ibuprofeno|paracetamol/i.test(e.body));
});

test("plantilla de indicaciones apagada: todo funciona como hoy — dentro de 24 h texto, fuera NO sale (y el PDF queda)", () => {
  // Aunque la clínica tuviera guardada una entrada, no se lee: sale bloqueado.
  const templates = parseWaTemplates({ post_op_instructions: { name: "dc_indicaciones_cuidado", lang: "es_MX", status: "APPROVED" } });
  assert.equal(decideSendMode({ kind: "post_op_instructions", windowOpen: true, templates }).mode, "text");
  assert.equal(decideSendMode({ kind: "post_op_instructions", windowOpen: false, templates }).mode, "blocked");
  assert.equal(decideSendMode({ kind: KIND_ENVIO_INDICACIONES, windowOpen: false, templates }).mode, "blocked");
});

test("plantilla de indicaciones: con la bandera encendida el catálogo la trae como utilidad no opcional (contrato del código)", () => {
  const origen = leer("src/lib/whatsapp/templates-catalog.ts");
  assert.match(origen, /PLANTILLA_INDICACIONES_ENCENDIDA \? \[WA_PLANTILLA_INDICACIONES_EN_ESPERA\] : \[\]/);
  assert.equal(WA_PLANTILLA_INDICACIONES_EN_ESPERA.optional, false, "UTILITY: la crea sola el cron como las demás al encenderla");
  const envio = leer("src/lib/indicaciones/envio.ts");
  assert.match(envio, /PLANTILLA_INDICACIONES_ENCENDIDA\s*\?\s*"post_op_instructions"\s*:\s*"system"/);
});

test("plantilla de indicaciones: nombre y variables traducidos, y etiqueta del Inbox para su tipo (es/en)", () => {
  const e = WA_PLANTILLA_INDICACIONES_EN_ESPERA;
  const leerClave = (d: any, clave: string) => clave.split(".").reduce((o: any, k: string) => (o ? o[k] : undefined), d);
  for (const lang of ["es", "en"]) {
    const d = JSON.parse(leer(`src/i18n/dictionaries/${lang}.json`));
    for (const clave of [e.labelKey, ...e.variableKeys, "inbox.client.autoLabel.post_op_instructions"]) {
      assert.equal(typeof leerClave(d, clave), "string", `${lang}: «${clave}» se vería sin traducir`);
    }
  }
});

test("C-72 (vuelta 2): en una cita de ortodoncia se propone la hoja PROPIA de la clínica que habla de ortodoncia", async () => {
  const { hojasSugeridas } = await import("../servicio");
  const hoja = (id: string, nombre: string, deFabrica = false) => ({
    id, tipo: "INDICACIONES" as const, nombre, cuerpo: "x", procedureIds: [], deFabrica, basadaEn: null, activa: true,
    createdAt: "2026-10-04T00:00:00Z", updatedAt: "2026-10-04T00:00:00Z",
  });
  const hojas = [hoja("h1", "Después de colocar brackets"), hoja("h2", "Después de una extracción"), hoja("h3", "Cuidado de elásticos")];
  assert.deepEqual(hojasSugeridas(hojas, [], ["Control de ortodoncia"]), ["h1", "h3"]);
  // Fuera de ortodoncia no se propone nada por nombre.
  assert.deepEqual(hojasSugeridas(hojas, [], ["Limpieza dental"]), []);
});
