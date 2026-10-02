/**
 * «Aparece en la agenda» al NACER una cuenta y el tratante de ortodoncia con la regla de la Agenda
 * (ws1-t10, decisiones finales de Rafael del 2-oct-2026, puntos 1, 2 y 3).
 *
 * Run: npm run test:aparece-en-agenda
 *
 *   1) clínica NUEVA → el dueño nace marcado (registro, registro con Google y sede nueva); las ya creadas
 *      se desmarcan con sql/ws1-t10-dueno-fuera-de-agenda.sql, salvo el dueño de BEVADENT.
 *   2) un ADMIN dado de alta en Equipo (POST /api/team) nace DESMARCADO; el doctor, marcado.
 *   3) el tratante de ortodoncia = quien puede recibir citas en la Agenda (+ acceso al módulo): un Super Admin
 *      desmarcado no es doctor, aunque marque Ortodoncia como especialidad.
 *
 * Con el código de antes fallan: `agendaActiveAlCrear` no existía, POST /api/team no mandaba la casilla (el ADMIN
 * nacía marcado por el default de la base) y `atiendePacientes` dejaba pasar al dueño desmarcado ortodoncista y al
 * doctor desmarcado.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as reglas from "../roles-que-atienden";
import { puedeRecibirCitas } from "../roles-que-atienden";
import { atiendePacientes, opcionesDeDoctorTratante, type UsuarioCandidato } from "@/lib/orthodontics/doctores-tratantes";

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8");
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const agendaActiveAlCrear = (role: string): boolean => {
  const f = (reglas as Record<string, unknown>).agendaActiveAlCrear;
  assert.equal(typeof f, "function", "roles-que-atienden.ts exporta agendaActiveAlCrear");
  return (f as (r: string) => boolean)(role);
};

/** El objeto `data` de la primera llamada `marca(` que aparece tras `desde` (balanceando llaves). */
function bloque(fuente: string, desde: string, marca: string): string {
  const i = fuente.indexOf(desde);
  assert.ok(i >= 0, `no está «${desde}»`);
  const j = fuente.indexOf(marca, i);
  assert.ok(j >= 0, `no está «${marca}» después de «${desde}»`);
  let k = fuente.indexOf("{", j);
  const inicio = k;
  let prof = 0;
  for (; k < fuente.length; k++) {
    if (fuente[k] === "{") prof++;
    else if (fuente[k] === "}" && --prof === 0) break;
  }
  return fuente.slice(inicio, k + 1);
}

// ─── 1 y 2 · con qué casilla nace cada cuenta ────────────────────────────────

test("el ADMIN nuevo nace desmarcado; el dueño y el doctor, marcados", () => {
  assert.equal(agendaActiveAlCrear("ADMIN"), false);
  assert.equal(agendaActiveAlCrear("SUPER_ADMIN"), true);
  assert.equal(agendaActiveAlCrear("DOCTOR"), true);
});

test("POST /api/team escribe la casilla con la regla y con el rol que de verdad se guarda", () => {
  const ruta = sinComentarios(leer("src/app/api/team/route.ts"));
  assert.match(ruta, /const rolNuevo: string = role \?\? "DOCTOR";/);
  const data = bloque(ruta, "export async function POST", "prisma.user.create(");
  assert.match(data, /agendaActive: agendaActiveAlCrear\(rolNuevo\)/, "el alta manda agendaActive");
  // Rol y casilla salen del MISMO valor: nada de `role ?? "DOCTOR"` en un lado y otro rol en el otro.
  assert.match(data, /role:\s+(role \?\? "DOCTOR"|rolNuevo)/);
  assert.match(ruta, /import \{ agendaActiveAlCrear \} from "@\/lib\/agenda\/roles-que-atienden"/);
});

test("registro, registro con Google y sede nueva crean al dueño MARCADO (explícito, no por el default de la base)", () => {
  for (const f of [
    "src/app/api/auth/register/route.ts",
    "src/app/api/auth/register-oauth/route.ts",
    "src/app/api/clinics/route.ts",
  ]) {
    const fuente = sinComentarios(leer(f));
    const dueno = bloque(fuente, "users:", "create:");
    assert.match(dueno, /role: "SUPER_ADMIN"/, f);
    assert.match(dueno, /agendaActive: agendaActiveAlCrear\("SUPER_ADMIN"\)/, f);
  }
});

// ─── 3 · el tratante de ortodoncia sigue la regla de la Agenda ───────────────

function usuario(p: Partial<UsuarioCandidato> & { id: string; role: string }): UsuarioCandidato {
  return { firstName: "N", lastName: p.id, ...p };
}

test("un Super Admin desmarcado no es doctor tratante, ni siquiera si marcó Ortodoncia", () => {
  const dueno = usuario({ id: "dueno", role: "SUPER_ADMIN", agendaActive: false, specialty: "Ortodoncia" });
  assert.equal(atiendePacientes(dueno), false);
  assert.deepEqual(opcionesDeDoctorTratante([dueno]).map((o) => o.id), []);
  // Marcado, sí (BEVADENT: Johnnifer lleva sus 51 casos).
  assert.equal(atiendePacientes({ ...dueno, agendaActive: true }), true);
});

test("tratante ⇔ puede recibir citas en la Agenda (para quien tiene el módulo), en todas las combinaciones", () => {
  for (const role of ["DOCTOR", "ADMIN", "SUPER_ADMIN", "RECEPTIONIST", "READONLY"])
    for (const isActive of [true, false, null])
      for (const agendaActive of [true, false, null])
        for (const specialty of [null, "Ortodoncia"]) {
          const u = usuario({ id: "x", role, isActive, agendaActive, specialty });
          // Sin override: el permiso del módulo es el default del rol (recepción y lectura no lo traen).
          const conModulo = role === "DOCTOR" || role === "ADMIN" || role === "SUPER_ADMIN";
          assert.equal(
            atiendePacientes(u),
            conModulo && puedeRecibirCitas(u),
            JSON.stringify({ role, isActive, agendaActive, specialty }),
          );
        }
});

test("la regla del tratante IMPORTA la de la Agenda (no tiene su propia copia de la casilla)", () => {
  const puro = sinComentarios(leer("src/lib/orthodontics/doctores-tratantes.ts"));
  assert.match(puro, /import \{ puedeRecibirCitas \} from "@\/lib\/agenda\/roles-que-atienden"/);
  const cuerpo = bloque(puro, "export function atiendePacientes", "(u: UsuarioCandidato): boolean");
  assert.match(cuerpo, /puedeRecibirCitas\(u\)/);
  assert.doesNotMatch(cuerpo, /esOrtodoncista/, "la especialidad ordena la lista, no deja entrar a nadie");
});

// ─── el SQL de las clínicas ya creadas ───────────────────────────────────────

test("el SQL solo desmarca SUPER_ADMIN de clínicas ya creadas, deja a Johnnifer y no borra nada", () => {
  const sql = leer("sql/ws1-t10-dueno-fuera-de-agenda.sql");
  const activo = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  const updates = activo.match(/\bUPDATE\b[\s\S]*?;/gi) ?? [];
  assert.equal(updates.length, 1, "un solo UPDATE activo (el «deshacer» va comentado)");
  const u = updates[0]!;
  assert.match(u, /UPDATE public\.users u/);
  assert.match(u, /SET "agendaActive" = false,\s+"updatedAt"\s+= now\(\)/);
  assert.match(u, /u\.role = 'SUPER_ADMIN'/);
  assert.match(u, /u\.id <> 'cmu7uttet000oq2n0g0ucee1q'/, "Johnnifer (BEVADENT) se queda marcado");
  assert.match(u, /c\."createdAt" < TIMESTAMPTZ '2026-10-02 00:00:00-06'/, "solo clínicas ya creadas");
  assert.match(u, /RETURNING/, "devuelve la lista de clínicas afectadas");
  assert.doesNotMatch(activo, /\b(DELETE|DROP|TRUNCATE|ALTER|INSERT)\b/i);
  // Antes y después: dos SELECT de solo lectura.
  assert.equal((activo.match(/^SELECT\b/gim) ?? []).length, 2);
});
