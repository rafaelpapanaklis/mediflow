/**
 * La Agenda acepta al dueño (SUPER_ADMIN) y al administrador que atienden — ws1-t10, 2-oct-2026.
 *
 * Run: npm run test:agenda-quien-recibe-citas
 *
 * El caso real (BEVADENT): los 51 casos de ortodoncia tienen como tratante la cuenta del dueño. «Agendar
 * próxima» abría «Nueva cita» con ese id, la Agenda solo aceptaba rol DOCTOR y el servidor contestaba
 * `doctor_not_found` (que además salía crudo). Ortodoncia y el bot ya aceptaban DOCTOR/ADMIN/SUPER_ADMIN.
 *
 * Ahora hay UNA regla de «quién puede recibir citas» (`roles-que-atienden.ts`): rol que atiende + cuenta activa +
 * «Aparece en la agenda» (User.agendaActive) encendida. Aquí se prueba:
 *  1. la regla con cada rol (dueño con y sin la casilla, admin, doctor, recepción, solo lectura, inactivo);
 *  2. que el filtro de Prisma dice lo mismo que la función (un doble que evalúa el `where`);
 *  3. el caso BEVADENT de punta a punta en lo que es puro: la ventana abre con el tratante SUPER_ADMIN y el
 *     servidor lo encuentra;
 *  4. que TODAS las puertas usan la misma regla (lista de columnas, Nueva cita, POST/PATCH, lista de espera,
 *     huecos, interruptor de la Agenda y bot), sobre el código: las rutas importan `server-only`/Next.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FRASE_NO_RECIBE_CITAS,
  RECIBE_CITAS_WHERE,
  ROLES_QUE_ATIENDEN,
  cuerpoDoctorNoRecibeCitas,
  doctorQueRecibeCitas,
  puedeRecibirCitas,
} from "../roles-que-atienden";
import { fraseTratanteFueraDeLaAgenda, tratanteFueraDeLaAgenda } from "@/lib/orthodontics/doctor-tratante-cita";
import { TIPO_CITA_CONTROL_ORTO } from "@/lib/orthodontics/agenda-constants";
import { hasPermission } from "@/lib/auth/permissions";

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8");
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

type Usuario = { id: string; clinicId: string; role: string; isActive: boolean; agendaActive: boolean };

const CLINICA = "cl-bevadent";
const usuarios: Usuario[] = [
  { id: "dueno", clinicId: CLINICA, role: "SUPER_ADMIN", isActive: true, agendaActive: true },
  { id: "dueno-sin-casilla", clinicId: CLINICA, role: "SUPER_ADMIN", isActive: true, agendaActive: false },
  { id: "admin", clinicId: CLINICA, role: "ADMIN", isActive: true, agendaActive: true },
  { id: "admin-caja", clinicId: CLINICA, role: "ADMIN", isActive: true, agendaActive: false },
  { id: "doctor", clinicId: CLINICA, role: "DOCTOR", isActive: true, agendaActive: true },
  { id: "doctor-fuera", clinicId: CLINICA, role: "DOCTOR", isActive: true, agendaActive: false },
  { id: "doctor-baja", clinicId: CLINICA, role: "DOCTOR", isActive: false, agendaActive: true },
  // agendaActive = true es el valor de fábrica: recepción lo tiene y aun así nunca entra.
  { id: "recep", clinicId: CLINICA, role: "RECEPTIONIST", isActive: true, agendaActive: true },
  { id: "lectura", clinicId: CLINICA, role: "READONLY", isActive: true, agendaActive: true },
  { id: "dueno-otra", clinicId: "cl-otra", role: "SUPER_ADMIN", isActive: true, agendaActive: true },
];
const RECIBEN = ["dueno", "admin", "doctor"];

/** Doble mínimo de `prisma.user.findFirst/findMany`: evalúa exactamente las claves que usa la regla. */
function cumple(u: Usuario, where: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k === "role") {
      const r = v as { in?: string[] } | string;
      if (typeof r === "string" ? u.role !== r : !(r.in ?? []).includes(u.role)) return false;
    } else if (["id", "clinicId", "isActive", "agendaActive"].includes(k)) {
      if ((u as Record<string, unknown>)[k] !== v) return false;
    } else {
      throw new Error(`clave de where no prevista en el doble: ${k}`);
    }
  }
  return true;
}
const findFirst = (where: Record<string, unknown>) => usuarios.find((u) => cumple(u, where)) ?? null;

test("la regla con cada rol: dueño (con y sin casilla), admin, doctor, recepción, solo lectura, inactivo", () => {
  const ok = usuarios.filter((u) => u.clinicId === CLINICA && puedeRecibirCitas(u)).map((u) => u.id);
  assert.deepEqual(ok, RECIBEN);
  assert.equal(puedeRecibirCitas({ role: "SUPER_ADMIN" }), true, "sin dato de la casilla = encendida (default de la base)");
  assert.equal(puedeRecibirCitas({ role: "RECEPTIONIST", agendaActive: true }), false, "recepción NUNCA");
  assert.deepEqual([...ROLES_QUE_ATIENDEN], ["DOCTOR", "ADMIN", "SUPER_ADMIN"]);
});

test("el filtro de Prisma dice lo mismo que la función, y siempre por clínica", () => {
  for (const u of usuarios) {
    const encontrado = findFirst({ id: u.id, clinicId: CLINICA, ...RECIBE_CITAS_WHERE });
    assert.equal(!!encontrado, u.clinicId === CLINICA && puedeRecibirCitas(u), u.id);
  }
  assert.equal(findFirst({ id: "dueno-otra", clinicId: CLINICA, ...RECIBE_CITAS_WHERE }), null, "el dueño de otra clínica no existe aquí");
  // El filtro no trae clinicId propio (lo pone quien consulta, de la sesión) ni `undefined` que Prisma descarte.
  assert.equal("clinicId" in RECIBE_CITAS_WHERE, false);
  for (const v of Object.values(RECIBE_CITAS_WHERE)) assert.notEqual(v, undefined);
});

test("BEVADENT: «Agendar próxima» con tratante SUPER_ADMIN abre con ÉL y el servidor lo encuentra", () => {
  // Lo que la ventana recibe del servidor: el padrón con su `activeInAgenda`; las opciones son quien recibe citas.
  const padron = usuarios.filter((u) => u.clinicId === CLINICA && u.isActive && (ROLES_QUE_ATIENDEN as readonly string[]).includes(u.role));
  const opciones = padron.filter((u) => u.agendaActive).map((u) => u.id);
  assert.ok(opciones.includes("dueno"));
  assert.ok(!opciones.includes("recep"));

  // «Agendar próxima» manda initialDoctorId = treatingDoctorId del plan.
  const elegido = doctorQueRecibeCitas([undefined, "dueno"], opciones);
  assert.equal(elegido, "dueno");
  // El POST valida con la regla: lo encuentra → no hay doctor_not_found.
  assert.ok(findFirst({ id: elegido, clinicId: CLINICA, ...RECIBE_CITAS_WHERE }));
  // Y no sale el aviso de «tratante fuera de la agenda».
  const entrada = { motivo: TIPO_CITA_CONTROL_ORTO, casoActivo: true, tratanteId: "dueno", doctoresIds: opciones, doctorActual: elegido };
  assert.equal(tratanteFueraDeLaAgenda(entrada), false);
});

test("si el tratante tiene la casilla apagada, la ventana NO lo manda: usa uno de la lista y lo dice", () => {
  const opciones = ["admin", "doctor"];
  const elegido = doctorQueRecibeCitas([undefined, "dueno-sin-casilla"], opciones);
  assert.equal(elegido, "admin", "lo que enseña el <select> es lo que se envía");
  assert.ok(findFirst({ id: elegido, clinicId: CLINICA, ...RECIBE_CITAS_WHERE }));
  const entrada = { motivo: TIPO_CITA_CONTROL_ORTO, casoActivo: true, tratanteId: "dueno-sin-casilla", doctoresIds: opciones, doctorActual: elegido };
  assert.equal(tratanteFueraDeLaAgenda(entrada), true);
  assert.match(fraseTratanteFueraDeLaAgenda("Dr. Johnnifer"), /Dr\. Johnnifer.*no aparece en la agenda.*«Aparece en la agenda»/);
  // Sin motivo de control o sin caso, no se avisa nada.
  assert.equal(tratanteFueraDeLaAgenda({ ...entrada, motivo: "Limpieza" }), false);
  assert.equal(tratanteFueraDeLaAgenda({ ...entrada, casoActivo: false }), false);
});

test("la columna en la que se hizo clic manda; una columna huérfana cae al primero de la lista; sin lista, vacío", () => {
  assert.equal(doctorQueRecibeCitas(["doctor", "dueno"], ["dueno", "doctor"]), "doctor");
  assert.equal(doctorQueRecibeCitas(["doctor-fuera", "dueno"], ["dueno", "doctor"]), "dueno");
  assert.equal(doctorQueRecibeCitas(["x", null], ["admin"]), "admin");
  assert.equal(doctorQueRecibeCitas(["x"], []), "");
});

test("doctor_not_found sale en español claro, no como código crudo", () => {
  const cuerpo = cuerpoDoctorNoRecibeCitas({ role: "DOCTOR", isActive: true, agendaActive: false });
  assert.equal(cuerpo.error, "doctor_not_found", "el código se queda: lo leen Sabina y las pruebas");
  assert.match(cuerpo.reason, /Aparece en la agenda/);
  assert.doesNotMatch(cuerpo.reason, /doctor_not_found|_/);
  assert.doesNotMatch(FRASE_NO_RECIBE_CITAS, /doctor_not_found|_/);
  const dialogo = leer("src/components/dashboard/new-appointment/new-appointment-dialog.tsx");
  assert.match(dialogo, /errBody\.error === "doctor_not_found"[\s\S]{0,160}FRASE_NO_RECIBE_CITAS/);
  assert.match(leer("src/lib/agenda-nueva/interacciones.ts"), /doctor_not_found[\s\S]{0,400}FRASE_NO_RECIBE_CITAS/);
});

test("aparecer en la agenda NO da permisos: los permisos no leen agendaActive", () => {
  // Los permisos salen del rol + override de Equipo; la casilla no entra en ese cálculo.
  for (const f of ["src/lib/auth/permissions.ts", "src/lib/auth-context.ts", "src/lib/patient-visibility.ts"]) {
    assert.doesNotMatch(leer(f), /agendaActive/, f);
  }
  // Y la regla no toca permisos.
  assert.doesNotMatch(sinComentarios(leer("src/lib/agenda/roles-que-atienden.ts")), /permission/i);
  // Recepción sigue sin poder ser doctor de una cita aunque tenga la casilla en true.
  assert.equal(puedeRecibirCitas({ role: "RECEPTIONIST", isActive: true, agendaActive: true }), false);
  assert.equal(typeof hasPermission, "function");
});

// ── 4. Todas las puertas, la misma regla ──────────────────────────────────────

/** El cuerpo de un handler exportado (hasta el siguiente `export`). */
function handler(ruta: string, metodo: string): string {
  const f = sinComentarios(leer(ruta));
  const i = f.indexOf(`export async function ${metodo}`);
  assert.ok(i >= 0, `${ruta} no exporta ${metodo}`);
  const j = f.indexOf("\nexport ", i + 10);
  return f.slice(i, j < 0 ? undefined : j);
}

test("POST y PATCH de citas, y POST/PATCH de lista de espera, validan con RECIBE_CITAS_WHERE (no `role: \"DOCTOR\"`)", () => {
  const puertas: Array<[string, string]> = [
    ["src/app/api/appointments/route.ts", "POST"],
    ["src/app/api/appointments/[id]/route.ts", "PATCH"],
    ["src/app/api/waitlist/route.ts", "POST"],
    ["src/app/api/waitlist/[id]/route.ts", "PATCH"],
  ];
  for (const [ruta, metodo] of puertas) {
    const h = handler(ruta, metodo);
    assert.match(h, /prisma\.user\.findFirst\(\{\s*where: \{[^}]*clinicId: session\.clinic\.id,\s*\.\.\.RECIBE_CITAS_WHERE,/, `${ruta} ${metodo}`);
    assert.doesNotMatch(h, /role: "DOCTOR"/, `${ruta} ${metodo}`);
    // Revisión de ws1-t10: el 404 dice el motivo (lee la fila por id + clínica de la sesión).
    assert.match(h, /await cuerpoDoctorNoRecibeCitasDe\(\s*session\.clinic\.id,/, `${ruta} ${metodo}`);
    assert.match(h, /\{ status: 404 \}/, `${ruta} ${metodo}`);
  }
});

test("PATCH: reenviar el MISMO doctor no se revalida (mover la hora de una cita vieja sigue funcionando)", () => {
  assert.match(handler("src/app/api/appointments/[id]/route.ts", "PATCH"), /if \(body\.doctorId && body\.doctorId !== existing\.doctorId\)/);
  assert.match(
    handler("src/app/api/waitlist/[id]/route.ts", "PATCH"),
    /parsed\.data\.preferredDoctorId && parsed\.data\.preferredDoctorId !== existing\.preferredDoctorId/,
  );
});

test("el padrón de la Agenda (columnas y Nueva cita) son los roles que atienden; el interruptor de la Agenda también", () => {
  const server = sinComentarios(leer("src/lib/agenda/server.ts"));
  const i = server.indexOf("export async function fetchActiveDoctors");
  const cuerpo = server.slice(i, server.indexOf("\nexport ", i + 10));
  assert.match(cuerpo, /where: \{ clinicId, role: \{ in: \[\.\.\.ROLES_QUE_ATIENDEN\] \}, isActive: true \}/);
  assert.match(cuerpo, /activeInAgenda: u\.agendaActive/);
  assert.match(cuerpo, /if \(!clinicId\) return \[\]/, "sin clínica no se consulta (clinicId: undefined no filtra)");

  const interruptor = handler("src/app/api/agenda/doctors/[id]/route.ts", "PATCH");
  assert.match(interruptor, /role: \{ in: \[\.\.\.ROLES_QUE_ATIENDEN\] \}/);
  assert.match(interruptor, /requireRole\(session, \["SUPER_ADMIN", "ADMIN"\]\)/, "quién puede tocar el interruptor no cambia");

  assert.match(handler("src/app/api/agenda/huecos/route.ts", "GET"), /activos\.filter\(\(d\) => d\.activeInAgenda &&/);

  const dialogo = leer("src/components/dashboard/new-appointment/new-appointment-dialog.tsx");
  assert.match(dialogo, /doctors: padron\.filter\(\(d\) => d\.activeInAgenda !== false\)/);
  assert.match(dialogo, /doctorQueRecibeCitas\(\[initialSlot\?\.doctorId, params\?\.initialDoctorId\], boot\.doctors\.map\(\(d\) => d\.id\)\)/);
  assert.doesNotMatch(dialogo, /setDoctorId\(params\.initialDoctorId\)/, "el id de fuera ya no se acepta a ciegas");
});

test("el bot ofrece y agenda con la misma regla", () => {
  const bot = sinComentarios(leer("src/lib/agenda/bot-booking-service.ts"));
  assert.match(bot, /where: \{ id: doctorId, clinicId, \.\.\.RECIBE_CITAS_WHERE \}/);
  const i = bot.indexOf("export async function listBookableDoctors");
  assert.match(bot.slice(i, i + 400), /where: \{ clinicId, \.\.\.RECIBE_CITAS_WHERE \}/);
});

// ── 5. Plan de tratamiento general (ticket 3, punto 2d) ───────────────────────

test("el plan de tratamiento de la ficha ofrece solo a quien puede atender (antes: todos los activos, recepción incluida)", () => {
  const ficha = sinComentarios(leer("src/app/dashboard/patients/[id]/page.tsx"));
  assert.match(ficha, /prisma\.user\.findMany\(\{\s*where:\s*\{ clinicId: user\.clinicId, \.\.\.RECIBE_CITAS_WHERE \}/);
  assert.doesNotMatch(ficha, /prisma\.user\.findMany\(\{\s*where:\s*\{ clinicId: user\.clinicId, isActive: true \}/);
  // Con la siembra: recepción y solo lectura (agendaActive = true de fábrica) quedan fuera.
  const ofrecidos = usuarios.filter((u) => cumple(u, { clinicId: CLINICA, ...RECIBE_CITAS_WHERE })).map((u) => u.id);
  assert.deepEqual(ofrecidos, RECIBEN);
});

test("POST /api/treatments valida el doctor que llega del navegador: de la clínica y que pueda atender", () => {
  const h = handler("src/app/api/treatments/route.ts", "POST");
  const busca = h.indexOf("where: { id: doctorId, clinicId: ctx.clinicId, ...RECIBE_CITAS_WHERE }");
  assert.ok(busca > 0, "no valida el doctorId");
  assert.ok(busca < h.indexOf("prisma.treatmentPlan.create("), "valida DESPUÉS de crear");
  assert.match(h, /await cuerpoDoctorNoRecibeCitasDe\(ctx\.clinicId, doctorId\)/);
  assert.match(h, /NextResponse\.json\(\{ error: reason, code: "doctor_not_found", motivo \}, \{ status: 404 \}\)/);
  // Un DOCTOR sigue creando planes solo para sí mismo (no se valida su propio id).
  assert.match(h, /if \(!ctx\.isDoctor && typeof doctorId === "string" && doctorId\)/);
  // El doctor de otra clínica no existe aquí.
  assert.equal(findFirst({ id: "dueno-otra", clinicId: CLINICA, ...RECIBE_CITAS_WHERE }), null);
  assert.equal(findFirst({ id: "recep", clinicId: CLINICA, ...RECIBE_CITAS_WHERE }), null);
});
