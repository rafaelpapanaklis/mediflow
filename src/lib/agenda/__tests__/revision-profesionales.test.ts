/**
 * Arreglos de la revisión en panel.108 de la Agenda (ws1-t10, 2-oct-2026). Fallos 2, 3 y 4 del REPORTE ws1-t1.
 *
 * Run: npm run test:agenda-revision-profesionales
 *
 *  2. «Nueva cita», «Buscar espacio» y las columnas no distinguían a los profesionales: «Dr. » + la primera
 *     palabra del nombre («Dr. Dr», «Dr. Cuenta» para el dueño, tres «Dr. QA») y columnas con iniciales
 *     repetidas («DC» = «Dr. Con» y «Dr. Cuenta»). Ahora: nombre visible completo en los selectores y nombre
 *     de pila + inicial del apellido en las columnas, únicos dentro del padrón.
 *  3. El `doctor_not_found` hablaba de «Aparece en la agenda» también a una cuenta inactiva o a recepción.
 *     Ahora dice el motivo.
 *  4. Un caso de ortodoncia PLANEADO no proponía a su tratante en «Nueva cita».
 *
 * Con el código viejo fallan todas: no existen `etiqueta-profesional.ts`, `motivoNoRecibeCitas` ni
 * `casoPlaneado`, y las fuentes siguen con `Dr. ${first}` y `d.shortName` en el selector.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { etiquetaCortaProfesional, etiquetasDeProfesionales } from "../etiqueta-profesional";
import {
  FRASE_NO_RECIBE_CITAS,
  cuerpoDoctorNoRecibeCitas,
  fraseNoRecibeCitas,
  motivoNoRecibeCitas,
  puedeRecibirCitas,
} from "../roles-que-atienden";
import { avisarOtroDoctor, doctorAProponer, tratanteFueraDeLaAgenda } from "@/lib/orthodontics/doctor-tratante-cita";
import { TIPO_CITA_CONTROL_ORTO } from "@/lib/orthodontics/agenda-constants";
import { doctorInitials } from "../doctor-color";

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8");
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

// El padrón real de la clínica de prueba (nombres leídos en solo lectura el 2-oct-2026): los que atienden y
// están activos, en el orden de `fetchActiveDoctors` (firstName asc).
const PADRON_QA = [
  ["Alejandro", "Beltrán Ríos"],
  ["Con Orto", "QaT3"],
  ["Cuenta", "de Prueba"], // el dueño (SUPER_ADMIN)
  ["Dental", "Solo T5"],
  ["Dr Import", "Ortodoncista T5"],
  ["Dra Import", "General T5"],
  ["Irma", "QaFix Ortiz"],
  ["Mariana", "Cortés Valdés"],
  ["Orto", "Doctor T5"],
  ["QA t1final", "Restringido"],
  ["QA t1final", "Dental Solo"],
  ["QA t1final", "Ortodoncista"],
  ["Renata", "Solís Aguirre"],
  ["Restringido", "Pacientes T5"],
  ["Sin Respuesta", "QaT3"],
  ["T9final", "Ortodoncista"],
  ["T9final", "SoloDental"],
  ["T9final", "Restringido"],
  ["WS1T2", "Doctor"],
  ["WS1T2H12", "Sd"],
  ["Ws1t5", "SoloDental"],
  ["Ws1t5b", "Panel"],
].map(([firstName, lastName], i) => ({ id: `u${i}`, firstName: firstName!, lastName: lastName! }));

const unicos = (xs: string[]) => new Set(xs.map((x) => x.toLowerCase())).size === xs.length;

// ── 2. Etiquetas ───────────────────────────────────────────────────────────────

test("2 · padrón de la clínica de prueba: nombres y nombres cortos únicos, sin «Dr. Dr» ni «Dr. Cuenta»", () => {
  const et = etiquetasDeProfesionales(PADRON_QA);
  const nombres = PADRON_QA.map((p) => et.get(p.id)!.nombre);
  const cortos = PADRON_QA.map((p) => et.get(p.id)!.corto);
  assert.ok(unicos(nombres), nombres.join(" | "));
  assert.ok(unicos(cortos), cortos.join(" | "));
  for (const s of [...nombres, ...cortos]) assert.doesNotMatch(s, /^Dr\. (Dr|Dra|Cuenta|QA)\b/, s);
  assert.equal(et.get("u2")!.nombre, "Cuenta de Prueba", "el dueño, con su nombre completo");
  assert.equal(et.get("u2")!.corto, "Cuenta D.");
  assert.equal(et.get("u1")!.corto, "Con Q.", "«Con Orto» ya no comparte «DC» con el dueño");
  assert.notEqual(doctorInitials(et.get("u1")!.corto), doctorInitials(et.get("u2")!.corto));
  // Los tres «QA t1final» y los tres «T9final» se distinguen por el apellido.
  assert.deepEqual(["u9", "u10", "u11"].map((id) => et.get(id)!.corto), ["QA R.", "QA D.", "QA O."]);
  assert.deepEqual(["u15", "u16", "u17"].map((id) => et.get(id)!.corto), ["T9final O.", "T9final S.", "T9final R."]);
  // El título que alguien escribió en su nombre se respeta en el nombre completo; no se inventa ninguno.
  assert.equal(et.get("u4")!.nombre, "Dr Import Ortodoncista T5");
  assert.equal(et.get("u5")!.nombre, "Dra Import General T5");
  assert.equal(et.get("u0")!.nombre, "Alejandro Beltrán Ríos");
});

test("2 · los que chocan se alargan solo lo necesario; idénticos, numerados", () => {
  const et = etiquetasDeProfesionales([
    { id: "a", firstName: "Juan", lastName: "Pérez López" },
    { id: "b", firstName: "Juan", lastName: "Paz" },
    { id: "c", firstName: "Juan", lastName: "Pérez Ruiz" },
    { id: "d", firstName: "Ana", lastName: "Ruiz" },
    { id: "e", firstName: "José", lastName: "Mora" },
    { id: "f", firstName: "Jose", lastName: "Mora" },
  ]);
  assert.equal(et.get("d")!.corto, "Ana R.", "quien no choca se queda corto");
  assert.equal(et.get("b")!.corto, "Juan Paz");
  assert.equal(et.get("a")!.corto, "Juan Pérez López");
  assert.equal(et.get("c")!.corto, "Juan Pérez Ruiz");
  // «José Mora» y «Jose Mora» se leen igual: el segundo lleva número.
  assert.equal(et.get("e")!.corto, "José Mora");
  assert.equal(et.get("f")!.corto, "Jose Mora 2");
  assert.equal(et.get("f")!.nombre, "Jose Mora 2");
  const todos = Array.from(et.values());
  assert.ok(unicos(todos.map((x) => x.corto)));
  assert.ok(unicos(todos.map((x) => x.nombre)));
});

test("2 · etiqueta corta suelta (la de la cita): sin título inventado, el título escrito no cuenta como nombre", () => {
  assert.equal(etiquetaCortaProfesional({ firstName: "Mariana", lastName: "Cortés Valdés" }), "Mariana C.");
  assert.equal(etiquetaCortaProfesional({ firstName: "Dr", lastName: "Juan Pérez" }), "Juan P.");
  assert.equal(etiquetaCortaProfesional({ firstName: "Dra.", lastName: "" }), "Dra.");
  assert.equal(etiquetaCortaProfesional({ firstName: "Renata", lastName: "" }), "Renata");
  assert.equal(etiquetaCortaProfesional({ firstName: "", lastName: "" }), "Profesional");
  assert.equal(etiquetaCortaProfesional(null), "Profesional");
});

test("2 · la Agenda usa las etiquetas: selectores con el nombre completo, columnas con el corto único", () => {
  const server = sinComentarios(leer("src/lib/agenda/server.ts"));
  assert.doesNotMatch(server, /`Dr\. \$\{/, "server.ts ya no antepone «Dr.»");
  assert.match(server, /const etiquetas = etiquetasDeProfesionales\(users\)/);
  assert.match(server, /displayName: etiquetas\.get\(u\.id\)!\.nombre/);
  assert.match(server, /shortName: etiquetas\.get\(u\.id\)!\.corto/);
  assert.doesNotMatch(sinComentarios(leer("src/app/api/waitlist/route.ts")), /`Dr\. \$\{/);

  const dialogo = leer("src/components/dashboard/new-appointment/new-appointment-dialog.tsx");
  assert.match(dialogo, /<option key=\{d\.id\} value=\{d\.id\}>\s*\{d\.displayName\}\s*<\/option>/);
  assert.doesNotMatch(dialogo, /\{d\.shortName\}/);
  assert.match(leer("src/components/dashboard/agenda-nueva/panel-huecos.tsx"), /etiqueta=\{r\.nombre\}/);
  assert.match(
    leer("src/components/dashboard/agenda-nueva/vista-dia.tsx"),
    /<div className=\{s\.cabeceraNombre\} title=\{r\.nombre\}>\{r\.nombreCorto\}<\/div>/,
  );
  // La página vieja de Citas: «Dr. » + nombre en sus dos selectores.
  const citas = leer("src/app/dashboard/appointments/appointments-client.tsx");
  assert.doesNotMatch(citas, /<option key=\{d\.id\} value=\{d\.id\}>\{t\("appointments\.doctorPrefix"\)\}/);
});

// ── 3. doctor_not_found con su motivo ─────────────────────────────────────────

test("3 · cada motivo tiene su frase; la cuenta inactiva no habla de «Aparece en la agenda»", () => {
  assert.equal(motivoNoRecibeCitas({ role: "DOCTOR", isActive: false, agendaActive: false }), "inactivo");
  assert.equal(motivoNoRecibeCitas({ role: "DOCTOR", isActive: true, agendaActive: false }), "agenda_apagada");
  assert.equal(motivoNoRecibeCitas({ role: "RECEPTIONIST", isActive: true, agendaActive: true }), "rol");
  assert.equal(motivoNoRecibeCitas({ role: "READONLY", isActive: false, agendaActive: false }), "rol", "el rol primero");
  assert.equal(motivoNoRecibeCitas(null), "no_encontrado");
  assert.equal(motivoNoRecibeCitas({ role: "SUPER_ADMIN", isActive: true, agendaActive: true }), null);
  // La función y la regla dicen lo mismo.
  for (const role of ["SUPER_ADMIN", "ADMIN", "DOCTOR", "RECEPTIONIST", "READONLY"])
    for (const isActive of [true, false])
      for (const agendaActive of [true, false]) {
        const u = { role, isActive, agendaActive };
        assert.equal(motivoNoRecibeCitas(u) === null, puedeRecibirCitas(u), JSON.stringify(u));
      }

  const inactivo = cuerpoDoctorNoRecibeCitas({ role: "DOCTOR", isActive: false, agendaActive: false });
  assert.equal(inactivo.error, "doctor_not_found");
  assert.equal(inactivo.motivo, "inactivo");
  assert.match(inactivo.reason, /cuenta está inactiva/);
  assert.doesNotMatch(inactivo.reason, /Aparece en la agenda/);

  const apagada = cuerpoDoctorNoRecibeCitas({ role: "ADMIN", isActive: true, agendaActive: false });
  assert.match(apagada.reason, /tiene apagada «Aparece en la agenda»/);

  const recepcion = cuerpoDoctorNoRecibeCitas({ role: "RECEPTIONIST", isActive: true, agendaActive: true });
  assert.match(recepcion.reason, /su rol \(Recepción\) no atiende pacientes/);
  assert.doesNotMatch(recepcion.reason, /Aparece en la agenda/);

  const deOtraClinica = cuerpoDoctorNoRecibeCitas(null);
  assert.equal(deOtraClinica.motivo, "no_encontrado");
  assert.match(deOtraClinica.reason, /ya no está en la clínica/);

  const frases = [inactivo.reason, apagada.reason, recepcion.reason, deOtraClinica.reason, FRASE_NO_RECIBE_CITAS];
  assert.equal(new Set(frases).size, frases.length, "cuatro motivos, cuatro frases (y la genérica aparte)");
  for (const f of frases) assert.doesNotMatch(f, /doctor_not_found|_/);
});

test("3 · el tratante de ortodoncia: el arreglo es cambiar el tratante del caso, no «elegir otro»", () => {
  const f = fraseNoRecibeCitas("inactivo", { tratante: true });
  assert.match(f, /^El doctor tratante de este caso no puede recibir citas: su cuenta está inactiva/);
  assert.match(f, /Cambia el doctor tratante del caso/);
  assert.match(fraseNoRecibeCitas("rol", { tratante: true, role: "RECEPTIONIST" }), /su rol \(Recepción\)/);
});

test("3 · todas las puertas contestan con el motivo, leyendo la fila SOLO por id + clínica de la sesión", () => {
  const db = sinComentarios(leer("src/lib/agenda/roles-que-atienden-db.ts"));
  assert.match(db, /if \(!clinicId \|\| !doctorId\) return null;/, "sin clínica no se consulta (clinicId: undefined no filtra)");
  assert.match(db, /where: \{ id: doctorId, clinicId \}/);
  for (const ruta of [
    "src/app/api/appointments/route.ts",
    "src/app/api/appointments/[id]/route.ts",
    "src/app/api/waitlist/route.ts",
    "src/app/api/waitlist/[id]/route.ts",
  ]) {
    const f = sinComentarios(leer(ruta));
    assert.match(f, /await cuerpoDoctorNoRecibeCitasDe\(\s*session\.clinic\.id,/, ruta);
    assert.doesNotMatch(f, /cuerpoDoctorNoRecibeCitas\(\)/, ruta);
  }
  assert.match(leer("src/app/api/treatments/route.ts"), /await cuerpoDoctorNoRecibeCitasDe\(ctx\.clinicId, doctorId\)/);
  for (const accion of [
    "src/app/actions/orthodontics/agendarProximoControlDesdeCard.ts",
    "src/app/actions/orthodontics/agendarRevisionRetencion.ts",
  ]) {
    assert.match(
      leer(accion),
      /res\.error === "doctor_not_found"\) return fail\(await fraseTratanteNoRecibeCitas\(ctx\.clinicId, plan\.treatingDoctorId\)\)/,
      accion,
    );
  }
  // Mover en la agenda nueva: manda la frase del servidor.
  assert.match(leer("src/lib/agenda-nueva/interacciones.ts"), /typeof error\.reason === "string" && error\.reason\.includes\(" "\) \? error\.reason/);
});

// ── 4. Caso de ortodoncia PLANEADO ───────────────────────────────────────────────

test("4 · caso PLANEADO: «Nueva cita» propone a su tratante igual que en uno en curso", () => {
  const e = {
    motivo: TIPO_CITA_CONTROL_ORTO,
    casoActivo: false,
    casoPlaneado: true,
    tratanteId: "dueno",
    doctoresIds: ["alejandro", "dueno"],
    doctorActual: "alejandro",
  };
  assert.equal(doctorAProponer(e), "dueno");
  assert.equal(avisarOtroDoctor(e), true);
  assert.equal(tratanteFueraDeLaAgenda({ ...e, doctoresIds: ["alejandro"] }), true);
  // Sin caso de ningún tipo, nada.
  assert.equal(doctorAProponer({ ...e, casoPlaneado: false }), null);

  const ruta = sinComentarios(leer("src/app/api/orthodontics/context/route.ts"));
  assert.match(ruta, /const planeado = plan\s*\? null\s*: await prisma\.orthodonticTreatmentPlan\.findFirst\(\{\s*where: \{ patientId, clinicId: ctx\.clinicId, deletedAt: null, status: "PLANNED" \}/);
  assert.match(ruta, /hasActivePlan: Boolean\(plan\),\s*hasPlannedPlan: Boolean\(planeado\),/, "planeado NO cuenta como caso activo");
  const dialogo = leer("src/components/dashboard/new-appointment/new-appointment-dialog.tsx");
  assert.match(dialogo, /setOrthoCasoPlaneado\(Boolean\(body\?\.hasPlannedPlan\)\)/);
  assert.match(dialogo, /casoPlaneado: orthoCasoPlaneado,/);
});
