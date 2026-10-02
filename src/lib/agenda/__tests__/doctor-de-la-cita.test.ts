/**
 * Quién puede ser el DOCTOR de una cita agendada desde el módulo (ws1-t12, revisión final, punto 1).
 *
 * Run: npm run test:agenda-doctor-de-la-cita
 *
 * «Abrir caso» proponía al dueño que atiende como doctor tratante, pero «Agendar este control» validaba con
 * `role: "DOCTOR"` y decía «el doctor tratante ya no está activo»: dos listas distintas. Ahora las dos leen
 * `roles-que-atienden.ts`. `bot-booking-service.ts` importa `server-only` (inexistente fuera de Next), así que su
 * validación se prueba sobre el código, y la regla de la lista de tratantes sobre su función pura.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLES_QUE_ATIENDEN } from "../roles-que-atienden";
import { atiendePacientes, opcionesDeDoctorTratante, propuestaDeDoctorParaElAlta } from "@/lib/orthodontics/doctores-tratantes";

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8");
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Solo `createBotAppointment` (hasta el siguiente export de tipos de reagendado). */
function crearCita(): string {
  const f = sinComentarios(leer("src/lib/agenda/bot-booking-service.ts"));
  const i = f.indexOf("export async function createBotAppointment");
  const j = f.indexOf("export type RescheduleErrorCode");
  assert.ok(i > 0 && j > i);
  return f.slice(i, j);
}

test("una sola lista de roles que atienden: DOCTOR, ADMIN y SUPER_ADMIN", () => {
  assert.deepEqual([...ROLES_QUE_ATIENDEN], ["DOCTOR", "ADMIN", "SUPER_ADMIN"]);
});

test("el agendado valida al doctor con la regla única de «quién recibe citas» (por clínica), no con `role: \"DOCTOR\"` a secas", () => {
  const c = crearCita();
  assert.match(c, /prisma\.user\.findFirst\(\{\s*where: \{ id: doctorId, clinicId, \.\.\.RECIBE_CITAS_WHERE \}/);
  assert.doesNotMatch(c, /role: "DOCTOR"/);
  assert.match(c, /if \(!doctor\) return \{ ok: false, error: "doctor_not_found" \}/);
});

test("la lista de doctores tratantes y la validación del agendado importan la MISMA constante", () => {
  const agendado = leer("src/lib/agenda/bot-booking-service.ts");
  const tratantes = leer("src/lib/orthodontics/doctores-tratantes-db.ts");
  assert.match(agendado, /import \{ RECIBE_CITAS_WHERE \} from "@\/lib\/agenda\/roles-que-atienden"/);
  assert.match(tratantes, /import \{ ROLES_QUE_ATIENDEN \} from "@\/lib\/agenda\/roles-que-atienden"/);
  assert.match(tratantes, /role: \{ in: \[\.\.\.ROLES_QUE_ATIENDEN\] \}/);
  // Nadie más define su propia lista de «quien atiende» en el módulo (se re-exporta la de agenda).
  const puro = sinComentarios(leer("src/lib/orthodontics/doctores-tratantes.ts"));
  assert.doesNotMatch(puro, /\["DOCTOR", "ADMIN", "SUPER_ADMIN"\]/);
  assert.match(puro, /export \{ ROLES_QUE_ATIENDEN \} from "@\/lib\/agenda\/roles-que-atienden"/);
});

test("todo el que la lista de tratantes puede proponer tiene un rol que el agendado acepta", () => {
  const usuarios = [
    { id: "doc", firstName: "A", lastName: "A", role: "DOCTOR" },
    { id: "dueno", firstName: "B", lastName: "B", role: "SUPER_ADMIN", agendaActive: true },
    { id: "admin", firstName: "C", lastName: "C", role: "ADMIN", specialty: "Ortodoncia" },
    { id: "recep", firstName: "D", lastName: "D", role: "RECEPTIONIST", specialty: "Ortodoncia" },
  ];
  const opciones = opcionesDeDoctorTratante(usuarios);
  const roles = new Map(usuarios.map((u) => [u.id, u.role]));
  assert.ok(opciones.length >= 3);
  for (const o of opciones) assert.ok((ROLES_QUE_ATIENDEN as readonly string[]).includes(roles.get(o.id)!), `${o.id} se propone pero no se podría agendar`);
  assert.equal(atiendePacientes(usuarios[3]!), false, "recepción no se propone");
  // Lo abre el dueño: se propone a sí mismo, y con ese id el agendado ya no dice «ya no está activo».
  assert.equal(propuestaDeDoctorParaElAlta({ quienAbreId: "dueno", opciones }).id, "dueno");
});
