// Ortodoncia — quién sale en las listas de «doctor tratante» y con cuál
// arranca el alta (ws1-t5, ronda 6 · filas 29 y 30 de la revisión de uso).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { faltantesDelAlta, fraseDeFaltantes, type EstadoAlta } from "../alta-caso-formulario";
import {
  atiendePacientes,
  MENSAJE_FALTA_DOCTOR,
  motivoFaltaDoctor,
  propuestaDeDoctorParaElAlta,
  textoDeLaPropuesta,
  esOrtodoncista,
  etiquetaDeDoctor,
  opcionesDeDoctorTratante,
  type UsuarioCandidato,
} from "../doctores-tratantes";

function usuario(parcial: Partial<UsuarioCandidato> & { id: string }): UsuarioCandidato {
  return { firstName: "Nombre", lastName: parcial.id, role: "DOCTOR", ...parcial };
}

test("el dueño que atiende (SUPER_ADMIN en la agenda) sale en la lista", () => {
  const opciones = opcionesDeDoctorTratante([
    usuario({ id: "dueno", firstName: "Rafael", lastName: "Soto", role: "SUPER_ADMIN", agendaActive: true }),
  ]);
  assert.deepEqual(opciones.map((o) => o.id), ["dueno"]);
});

test("recepción y solo lectura nunca salen, aunque marquen especialidad", () => {
  const opciones = opcionesDeDoctorTratante([
    usuario({ id: "recep", role: "RECEPTIONIST", specialty: "Ortodoncia" }),
    usuario({ id: "lector", role: "READONLY" }),
  ]);
  assert.equal(opciones.length, 0);
});

test("la administradora fuera de la agenda no sale; si es ortodoncista, sí", () => {
  assert.equal(atiendePacientes(usuario({ id: "a", role: "ADMIN", agendaActive: false })), false);
  assert.equal(
    atiendePacientes(usuario({ id: "b", role: "ADMIN", agendaActive: false, specialty: "Ortodoncia" })),
    true,
  );
});

test("un usuario dado de baja no sale", () => {
  assert.equal(atiendePacientes(usuario({ id: "x", isActive: false })), false);
});

test("un doctor sale aunque esté fuera de la agenda", () => {
  assert.equal(atiendePacientes(usuario({ id: "d", role: "DOCTOR", agendaActive: false })), true);
});

test("reconoce la especialidad con o sin acentos y en la de la cédula", () => {
  assert.equal(esOrtodoncista({ specialty: "Ortodoncia" }), true);
  assert.equal(esOrtodoncista({ specialty: null, especialidad: "ORTODONCIA Y ORTOPEDIA MAXILAR" }), true);
  assert.equal(esOrtodoncista({ specialty: "Ortodoncista" }), true);
  assert.equal(esOrtodoncista({ specialty: "Endodoncia" }), false);
  assert.equal(esOrtodoncista({ specialty: null, especialidad: null }), false);
});

test("los ortodoncistas van primero y dentro se ordena por nombre", () => {
  const opciones = opcionesDeDoctorTratante([
    usuario({ id: "1", firstName: "Zoe", lastName: "Alba", specialty: "Endodoncia" }),
    usuario({ id: "2", firstName: "Bruno", lastName: "Díaz", specialty: "Ortodoncia" }),
    usuario({ id: "3", firstName: "Ana", lastName: "Paz" }),
    usuario({ id: "4", firstName: "Álvaro", lastName: "Ríos", role: "ADMIN", especialidad: "Ortodoncia" }),
  ]);
  assert.deepEqual(opciones.map((o) => o.id), ["4", "2", "3", "1"]);
  assert.equal(etiquetaDeDoctor(opciones[0]), "Álvaro Ríos · Ortodoncia");
  assert.equal(etiquetaDeDoctor(opciones[2]), "Ana Paz");
});

// ws1-t10 — sin «Doctor tratante por defecto»: el alta se propone sola (a, b, c).
const DOCTORES = () =>
  opcionesDeDoctorTratante([
    usuario({ id: "ana", firstName: "Ana", lastName: "Paz", specialty: "Ortodoncia" }),
    usuario({ id: "beto", firstName: "Beto", lastName: "Ríos" }),
  ]);

test("(a) si quien abre el caso es un doctor con acceso a Ortodoncia, es él mismo", () => {
  assert.deepEqual(propuestaDeDoctorParaElAlta({ quienAbreId: "beto", opciones: DOCTORES() }), { id: "beto", motivo: "quien-abre" });
  // Aunque haya un ortodoncista «de Equipo»: manda quien abre.
  assert.equal(propuestaDeDoctorParaElAlta({ quienAbreId: "ana", opciones: DOCTORES() }).id, "ana");
});

test("(a) el dueño que atiende (SUPER_ADMIN en la agenda) se propone a sí mismo", () => {
  const opciones = opcionesDeDoctorTratante([
    usuario({ id: "dueno", role: "SUPER_ADMIN", agendaActive: true }),
    usuario({ id: "otro" }),
  ]);
  assert.equal(propuestaDeDoctorParaElAlta({ quienAbreId: "dueno", opciones }).id, "dueno");
});

test("(b) lo abre recepción y en la sede hay UN SOLO doctor con acceso: ese", () => {
  const opciones = opcionesDeDoctorTratante([
    usuario({ id: "unico" }),
    usuario({ id: "recep", role: "RECEPTIONIST" }),
    usuario({ id: "sin-acceso", permissionsOverride: ["patients.view"] }),
  ]);
  assert.deepEqual(propuestaDeDoctorParaElAlta({ quienAbreId: "recep", opciones }), { id: "unico", motivo: "unico" });
});

test("(b) quien abre no es doctor con acceso y hay uno solo: ese, aunque quien abre sea un usuario sin acceso", () => {
  const opciones = opcionesDeDoctorTratante([usuario({ id: "unico" })]);
  assert.equal(propuestaDeDoctorParaElAlta({ quienAbreId: "sin-acceso", opciones }).id, "unico");
});

test("(c) lo abre recepción y hay varios doctores: vacío, sin adivinar (ni por «ortodoncista» de Equipo)", () => {
  assert.deepEqual(propuestaDeDoctorParaElAlta({ quienAbreId: "recep", opciones: DOCTORES() }), { id: "", motivo: null });
  assert.deepEqual(propuestaDeDoctorParaElAlta({ quienAbreId: null, opciones: DOCTORES() }), { id: "", motivo: null });
  assert.deepEqual(propuestaDeDoctorParaElAlta({ quienAbreId: undefined, opciones: DOCTORES() }), { id: "", motivo: null });
});

test("(c) sin nadie que atienda, queda vacío", () => {
  assert.equal(propuestaDeDoctorParaElAlta({ quienAbreId: "x", opciones: [] }).id, "");
});

test("un doctor sin acceso al módulo no se propone ni para sí mismo (la lista ya lo excluye)", () => {
  const sinAcceso = usuario({ id: "solo-dental", permissionsOverride: ["patients.view"] });
  const opciones = opcionesDeDoctorTratante([sinAcceso, usuario({ id: "a" }), usuario({ id: "b" })]);
  assert.equal(propuestaDeDoctorParaElAlta({ quienAbreId: "solo-dental", opciones }).id, "");
});

test("la pista bajo el selector dice de dónde salió la propuesta", () => {
  assert.match(textoDeLaPropuesta("quien-abre") ?? "", /Eres tú/);
  assert.match(textoDeLaPropuesta("unico") ?? "", /único doctor/);
  assert.equal(textoDeLaPropuesta(null), null);
});

test("no se abre el caso sin doctor tratante, y el mensaje es claro", () => {
  for (const vacio of ["", "  ", null, undefined]) {
    assert.equal(motivoFaltaDoctor({ treatingDoctorId: vacio, columnaExiste: true }), MENSAJE_FALTA_DOCTOR, String(vacio));
  }
  assert.match(MENSAJE_FALTA_DOCTOR, /Elige al doctor tratante/);
  assert.equal(motivoFaltaDoctor({ treatingDoctorId: "ana", columnaExiste: true }), null);
});

test("si la base aún no tiene la columna del doctor, el alta no lo exige (tolera la columna que falta)", () => {
  assert.equal(motivoFaltaDoctor({ treatingDoctorId: null, columnaExiste: false }), null);
});

test("H4: quien no tiene acceso al módulo de Ortodoncia no se ofrece como doctor tratante", () => {
  const conAcceso = { id: "a", firstName: "Con", lastName: "Acceso", role: "DOCTOR", permissionsOverride: [] };
  const sinAcceso = { id: "b", firstName: "Solo", lastName: "Dental", role: "DOCTOR", permissionsOverride: ["patients.view"] };
  const ids = opcionesDeDoctorTratante([conAcceso, sinAcceso]).map((o) => o.id);
  assert.deepEqual(ids, ["a"]);
  assert.equal(atiendePacientes(sinAcceso), false);
});
test("H4: un override que sí trae el permiso deja pasar", () => {
  const u = { id: "c", firstName: "Con", lastName: "Override", role: "DOCTOR", permissionsOverride: ["specialties.orthodontics"] };
  assert.equal(atiendePacientes(u), true);
});

// ═══ ws1-t10 — el alta no abre sin doctor; Configuración ya no lo tiene ni lo borra; nadie más lo lee ═══

const RAIZ = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const codigo = (rel: string) => sinComentarios(leer(rel));

const COMPLETA: EstadoAlta = {
  necesitaDiagnostico: false,
  enObservacion: false,
  resumen: "",
  proximaRevision: "",
  retencion: "Retenedor fijo lingual 3-3 inferior y Hawley superior.",
  costoTotal: "36000",
  modoResponsable: "none",
  tutorElegidoId: "",
  tutorNombre: "",
  tutorTelefono: "",
};

test("el alta dice que falta el doctor tratante y no deja abrir el caso", () => {
  const faltan = faltantesDelAlta({ ...COMPLETA, sinDoctor: true });
  assert.deepEqual(faltan, ["el doctor tratante (elige quién lleva el caso)"]);
  assert.match(fraseDeFaltantes(faltan, false) ?? "", /Para abrir el caso falta: el doctor tratante/);
  assert.deepEqual(faltantesDelAlta({ ...COMPLETA, sinDoctor: false }), []);
});

test("un paciente en observación no lleva plan: no se le pide doctor", () => {
  assert.deepEqual(faltantesDelAlta({ ...COMPLETA, enObservacion: true, sinDoctor: true }), []);
});

test("el cajón del alta calcula «sin doctor» con la regla compartida y pinta el mensaje", () => {
  const cajon = codigo("src/components/specialties/orthodontics/redesign/drawers/DrawerNewCase.tsx");
  assert.match(cajon, /sinDoctor: motivoFaltaDoctor\(\{ treatingDoctorId, columnaExiste: columnsExist\.treatingDoctorId \}\) !== null/);
  assert.match(cajon, /MENSAJE_FALTA_DOCTOR/);
  assert.match(cajon, /suggestedTreatingDoctorId/);
  assert.doesNotMatch(cajon, /Configuración de Ortodoncia/, "ya no se dice que lo propone la Configuración");
});

test("el asistente viejo también pide y manda el doctor tratante", () => {
  const w = codigo("src/components/specialties/orthodontics/plan/TreatmentPlanWizard.tsx");
  assert.match(w, /treatingDoctorId: treatingDoctorId \|\| null,/);
  assert.match(w, /step === 3 \? retention\.length >= 20 && !sinDoctor/);
  assert.match(w, /suggestedTreatingDoctorId/);
});

test("el servidor tampoco abre un caso sin doctor (la columna que falta se tolera)", () => {
  const a = codigo("src/app/actions/orthodontics/createTreatmentPlan.ts");
  assert.match(a, /motivoFaltaDoctor\(\{\s*treatingDoctorId: parsed\.data\.treatingDoctorId,\s*columnaExiste: await existeColumnaDoctorTratante\(\)/);
  // Antes de validar personas y de tocar la base.
  assert.ok(a.indexOf("motivoFaltaDoctor(") < a.indexOf("validarPersonasDelCaso({"));
  assert.ok(a.indexOf("motivoFaltaDoctor(") < a.indexOf("prisma.$transaction"));
});

test("las opciones del alta salen de la SESIÓN: quien abre es ctx.userId, nunca el cliente", () => {
  const o = codigo("src/app/actions/orthodontics/getCaseIntakeOptions.ts");
  assert.match(o, /propuestaDeDoctorParaElAlta\(\{ quienAbreId: ctx\.userId, opciones: doctorsRaw \}\)/);
  assert.match(o, /cargarDoctoresTratantes\(ctx\.clinicId\)/);
  assert.doesNotMatch(o, /defaultTreatingDoctorId|doctorPorDefecto/);
});

test("Configuración ya no muestra «Doctor tratante por defecto» ni lo manda al guardar", () => {
  const c = codigo("src/components/specialties/orthodontics/configuracion/OrthoConfiguracionClient.tsx");
  assert.doesNotMatch(c, /Doctor tratante por defecto|defaultTreatingDoctorId|Sin doctor por defecto/);
  const p = codigo("src/app/dashboard/orthodontics/configuracion/page.tsx");
  assert.doesNotMatch(p, /doctors=/);
});

test("guardar Configuración NO toca el dato guardado (ni lo borra): la columna se deja como está", () => {
  const u = codigo("src/app/actions/orthodontics/updateOrthoClinicSettings.ts");
  assert.doesNotMatch(u, /defaultTreatingDoctorId\s*[:,]/, "ni se valida ni se escribe ni va a la bitácora");
  const db = codigo("src/lib/orthodontics/clinic-settings-db.ts");
  assert.doesNotMatch(db, /defaultTreatingDoctorId/, "ni el upsert lo escribe ni la lectura lo devuelve");
  assert.match(leer("prisma/schema.prisma"), /defaultTreatingDoctorId String\?/, "la columna sigue en el modelo: no se borra el dato");
});

/** Todo el código de src/ (sin pruebas) que aún nombre el dato viejo: solo se admite lo histórico. */
function fuentes(dir: string, salida: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) {
      if (nombre === "__tests__" || nombre === "node_modules" || nombre.startsWith("vista-previa")) continue;
      fuentes(ruta, salida);
    } else if (/\.(ts|tsx)$/.test(nombre) && !/\.test\./.test(nombre)) salida.push(ruta);
  }
  return salida;
}

test("nadie más lee el «doctor por defecto»: bot, reserva web, Sabina y Controles usan el doctor DEL CASO", () => {
  const lectores = fuentes(join(RAIZ, "src"))
    .filter((f) => /defaultTreatingDoctorId|doctorPorDefecto/.test(sinComentarios(readFileSync(f, "utf8"))))
    .map((f) => f.slice(RAIZ.length + 1).replaceAll("\\", "/"));
  // audit-core solo rotula entradas VIEJAS de la bitácora (historia, no lectura del dato).
  assert.deepEqual(lectores, ["src/lib/admin/audit-core.ts"]);

  // Los que agendan con el doctor: el tratante del CASO.
  assert.match(codigo("src/lib/whatsapp/bot/booking-core.ts"), /caso\.treatingDoctorId/);
  assert.match(codigo("src/lib/orthodontics/whatsapp-bot-booking.ts"), /treatingDoctorId: plan\.treatingDoctorId/);
  assert.match(codigo("src/app/[slug]/_shared/booking-modal.tsx"), /casoActivo\?\.treatingDoctorId/);
  assert.match(codigo("src/app/reservar/[slug]/booking-client.tsx"), /casoActivo\?\.treatingDoctorId/);
  assert.match(codigo("src/lib/sabina/tools/agendar-cita.ts"), /orto\?\.caso\?\.treatingDoctorId \?\? null/);
});

test("los primeros pasos ya no piden elegir doctor por defecto", () => {
  const p = codigo("src/lib/orthodontics/primeros-pasos.ts");
  assert.doesNotMatch(p, /doctor-tratante|doctorTratanteElegido/);
});

// ── ws1-t12 (revisión final, #1): lo que se ve seleccionado es lo que se guarda ─────────────────

test("el dueño SIN acceso a Ortodoncia no sale en la lista ni se propone: no queda de tratante para luego bloquear «Agendar este control»", () => {
  const opciones = opcionesDeDoctorTratante([
    usuario({ id: "dueno", role: "SUPER_ADMIN", agendaActive: true, permissionsOverride: ["patients.view", "agenda.view"] }),
    usuario({ id: "ana", firstName: "Ana", specialty: "Ortodoncia" }),
  ]);
  assert.deepEqual(opciones.map((o) => o.id), ["ana"]);
  // Lo abre el dueño sin acceso: no se propone él; hay un solo ortodoncista con acceso: ese.
  assert.deepEqual(propuestaDeDoctorParaElAlta({ quienAbreId: "dueno", opciones }), { id: "ana", motivo: "unico" });
});

test("si nadie tiene acceso a Ortodoncia, no se propone a nadie y el alta pide elegir (con aviso hacia Equipo)", () => {
  const opciones = opcionesDeDoctorTratante([
    usuario({ id: "dueno", role: "SUPER_ADMIN", permissionsOverride: ["patients.view"] }),
    usuario({ id: "otro", permissionsOverride: ["agenda.view"] }),
  ]);
  assert.equal(opciones.length, 0);
  assert.deepEqual(propuestaDeDoctorParaElAlta({ quienAbreId: "dueno", opciones }), { id: "", motivo: null });
  assert.equal(motivoFaltaDoctor({ treatingDoctorId: "", columnaExiste: true }), MENSAJE_FALTA_DOCTOR);
  for (const f of [
    "src/components/specialties/orthodontics/redesign/drawers/DrawerNewCase.tsx",
    "src/components/specialties/orthodontics/plan/TreatmentPlanWizard.tsx",
  ]) {
    const c = codigo(f);
    assert.match(c, /Ningún doctor de esta clínica tiene acceso a Ortodoncia/, f);
    assert.match(c, /href="\/dashboard\/team"/, f);
  }
});

test("un caso cuyo doctor perdió Ortodoncia se ve con lo que hay guardado, no como «— elige al doctor —»", () => {
  assert.match(
    codigo("src/components/specialties/orthodontics/redesign/drawers/DrawerNewCase.tsx"),
    /Doctor actual del caso \(sin acceso a Ortodoncia\)/,
  );
});
