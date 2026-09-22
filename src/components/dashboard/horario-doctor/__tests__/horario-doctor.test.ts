/**
 * HORARIO POR DOCTOR — la mitad de la pantalla que se puede probar sin
 * navegador: el contrato con ws1-t2 (`tipos.ts`), el aviso contra la clínica,
 * el resumen de una línea, y los candados de quién ve qué (leyendo el código,
 * como `configuracion-rediseno.test.ts`).
 *
 *     npx tsx --test src/components/dashboard/horario-doctor/__tests__/horario-doctor.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  avisoFueraDeClinica,
  cuerpoPut,
  horaCorta,
  horarioClinica,
  LLAVES_DIA,
  mismoHorario,
  parseDia,
  parseHorarioDoctor,
  rangoInvalido,
  resumenSemana,
  semanaCompleta,
  tramosDeSemana,
  type Dia,
} from "../tipos";
import { parsePolitica, POLITICA_DE_FABRICA } from "../../bloqueos/politica";

const SRC = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const dia = (dayOfWeek: number, openTime: string, closeTime: string, enabled = true): Dia => ({
  dayOfWeek,
  enabled,
  openTime,
  closeTime,
});

/** Clínica de ejemplo: L-V 9-18, sábado 9-14, domingo cerrado. */
const CLINICA: Dia[] = [
  dia(0, "09:00", "18:00"),
  dia(1, "09:00", "18:00"),
  dia(2, "09:00", "18:00"),
  dia(3, "09:00", "18:00"),
  dia(4, "09:00", "18:00"),
  dia(5, "09:00", "14:00"),
  dia(6, "09:00", "18:00", false),
];

// ═══════════════════════════════════════════════════════════════════════════
// 0=Lunes … 6=Domingo — NO el getDay() de JavaScript
// ═══════════════════════════════════════════════════════════════════════════

test("el día 0 es el LUNES y el 6 el DOMINGO, como ClinicSchedule", () => {
  assert.equal(LLAVES_DIA[0], "settings.clientDays.monday");
  assert.equal(LLAVES_DIA[6], "settings.clientDays.sunday");
  // Y es la MISMA lista que usa Configuración para el horario de la clínica.
  const settings = leer("app/dashboard/settings/settings-client.tsx");
  const days = settings.slice(settings.indexOf("const DAYS"), settings.indexOf("];", settings.indexOf("const DAYS")));
  const orden = [...days.matchAll(/"(settings\.clientDays\.[a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(orden, [...LLAVES_DIA]);
});

test("nada de la carpeta usa getDay(): el índice del arreglo ES el dayOfWeek", () => {
  const dir = join(SRC, "components/dashboard/horario-doctor");
  for (const f of readdirSync(dir)) {
    if (!/\.(ts|tsx)$/.test(f)) continue;
    const codigo = readFileSync(join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.ok(!/\.getDay\(|\.getUTCDay\(/.test(codigo), `${f} usa getDay()`);
  }
});

test("semanaCompleta: siempre 7, ordenados de lunes a domingo, lo que falta cerrado", () => {
  const s = semanaCompleta([dia(4, "10:00", "12:00"), dia(0, "08:00", "15:00")]);
  assert.equal(s.length, 7);
  assert.deepEqual(s.map((d) => d.dayOfWeek), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(s[0].openTime, "08:00");
  assert.equal(s[4].closeTime, "12:00");
  assert.equal(s[1].enabled, false);
  // Repetido: se queda el primero, no el último.
  const r = semanaCompleta([dia(2, "09:00", "10:00"), dia(2, "11:00", "12:00")]);
  assert.equal(r[2].openTime, "09:00");
});

// ═══════════════════════════════════════════════════════════════════════════
// El contrato: lo que entra por red se parsea
// ═══════════════════════════════════════════════════════════════════════════

test("parseDia: descarta el día sin dayOfWeek válido y solo `true` abre", () => {
  assert.equal(parseDia({ dayOfWeek: 7, enabled: true }), null);
  assert.equal(parseDia({ dayOfWeek: -1, enabled: true }), null);
  assert.equal(parseDia({ dayOfWeek: "1", enabled: true }), null);
  assert.equal(parseDia({ dayOfWeek: 1.5, enabled: true }), null);
  assert.equal(parseDia({ dayOfWeek: 1, enabled: "true" })!.enabled, false);
  assert.equal(parseDia({ dayOfWeek: 1, enabled: 1 })!.enabled, false);
  // Horas raras caen a las de por defecto en vez de tumbar la ventana.
  assert.deepEqual(parseDia({ dayOfWeek: 1, enabled: true, openTime: "9", closeTime: null }), dia(1, "09:00", "18:00"));
});

test("parseHorarioDoctor: sin `hereda` booleano no se adivina", () => {
  assert.equal(parseHorarioDoctor({ horario: [] }), null);
  assert.equal(parseHorarioDoctor({ horario: [], hereda: "true" }), null);
  assert.equal(parseHorarioDoctor(null), null);
  const h = parseHorarioDoctor({ hereda: true, horario: [] })!;
  assert.equal(h.hereda, true);
  assert.equal(h.horario.length, 7);
  const p = parseHorarioDoctor({ hereda: false, horario: CLINICA })!;
  assert.equal(p.hereda, false);
  assert.deepEqual(p.horario, CLINICA);
});

test("tras el PUT: una respuesta sin `horario` no se lee como «todo cerrado»", () => {
  const src = leer("components/dashboard/horario-doctor/panel-horario-doctor.tsx");
  const guardar = src.slice(src.indexOf("async function guardar()"), src.indexOf("async function volverAClinica()"));
  assert.ok(!/parseHorarioDoctor\(/.test(guardar), "el PUT no debe pasar por parseHorarioDoctor: sin `horario` inventa 7 días cerrados");
  assert.match(guardar, /Array\.isArray\(devuelto\) && devuelto\.length > 0 \? semanaCompleta\(devuelto\) : semanaCompleta\(borrador\)/);
});

test("cuerpoPut manda SIEMPRE los 7 días, de lunes a domingo, y solo los 4 campos", () => {
  const cuerpo = cuerpoPut([{ ...dia(3, "10:00", "13:00"), extra: "x" } as Dia]);
  assert.equal(cuerpo.horario.length, 7);
  assert.deepEqual(cuerpo.horario.map((d) => d.dayOfWeek), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(Object.keys(cuerpo.horario[3]).sort(), ["closeTime", "dayOfWeek", "enabled", "openTime"]);
  assert.equal(cuerpo.horario[3].enabled, true);
  assert.equal(cuerpo.horario[0].enabled, false);
});

test("horarioClinica: sin filas es «no se sabe» (null), no «todo cerrado»", () => {
  assert.equal(horarioClinica([]), null);
  assert.equal(horarioClinica(undefined), null);
  assert.equal(horarioClinica([{ basura: 1 }]), null);
  // Con filas, el día que falta sí es cerrado — como en Configuración.
  const h = horarioClinica([dia(0, "09:00", "18:00")])!;
  assert.equal(h.length, 7);
  assert.equal(h[6].enabled, false);
});

// ═══════════════════════════════════════════════════════════════════════════
// Validación y aviso: avisar, no prohibir
// ═══════════════════════════════════════════════════════════════════════════

test("rangoInvalido: solo cuenta en días abiertos; salida <= entrada es inválido", () => {
  assert.equal(rangoInvalido(dia(0, "18:00", "09:00")), true);
  assert.equal(rangoInvalido(dia(0, "09:00", "09:00")), true);
  assert.equal(rangoInvalido(dia(0, "", "18:00")), true);
  assert.equal(rangoInvalido(dia(0, "18:00", "09:00", false)), false);
  assert.equal(rangoInvalido(dia(0, "09:00", "18:00")), false);
});

test("aviso: la clínica cierra a las 18:00 y el doctor pone 20:00 → se avisa, con la hora de la clínica", () => {
  const a = avisoFueraDeClinica(dia(0, "09:00", "20:00"), CLINICA);
  assert.deepEqual(a, { tipo: "fuera", abre: "09:00", cierra: "18:00", antes: false, despues: true });
  const b = avisoFueraDeClinica(dia(1, "07:30", "12:00"), CLINICA);
  assert.deepEqual(b, { tipo: "fuera", abre: "09:00", cierra: "18:00", antes: true, despues: false });
  const c = avisoFueraDeClinica(dia(5, "08:00", "15:00"), CLINICA);
  assert.equal(c?.tipo, "fuera");
  assert.ok(c?.tipo === "fuera" && c.antes && c.despues);
});

test("aviso: día que la clínica no abre → «cerrada»; dentro del horario, cerrado o sin clínica → nada", () => {
  assert.deepEqual(avisoFueraDeClinica(dia(6, "10:00", "12:00"), CLINICA), { tipo: "cerrada" });
  assert.equal(avisoFueraDeClinica(dia(0, "10:00", "17:00"), CLINICA), null);
  assert.equal(avisoFueraDeClinica(dia(0, "09:00", "18:00"), CLINICA), null);
  assert.equal(avisoFueraDeClinica(dia(6, "10:00", "12:00", false), CLINICA), null);
  assert.equal(avisoFueraDeClinica(dia(0, "07:00", "22:00"), null), null);
  // Un rango mal escrito ya lleva su error: no se le suma el aviso.
  assert.equal(avisoFueraDeClinica(dia(0, "20:00", "19:00"), CLINICA), null);
});

test("mismoHorario: las horas de un día cerrado no cuentan como cambio", () => {
  assert.equal(mismoHorario(CLINICA, CLINICA.map((d) => ({ ...d }))), true);
  const otro = CLINICA.map((d) => (d.dayOfWeek === 6 ? { ...d, openTime: "11:00" } : d));
  assert.equal(mismoHorario(CLINICA, otro), true);
  const abierto = CLINICA.map((d) => (d.dayOfWeek === 6 ? { ...d, enabled: true } : d));
  assert.equal(mismoHorario(CLINICA, abierto), false);
});

// ═══════════════════════════════════════════════════════════════════════════
// «Lun-Vie 9:00-19:00 · Sáb 9:00-14:00»
// ═══════════════════════════════════════════════════════════════════════════

const ES = JSON.parse(leer("i18n/dictionaries/es.json"));
const EN = JSON.parse(leer("i18n/dictionaries/en.json"));
const tDe = (dic: Record<string, unknown>) => (key: string, vars?: Record<string, string | number>) => {
  let nodo: unknown = dic;
  for (const p of key.split(".")) nodo = (nodo as Record<string, unknown>)?.[p];
  assert.equal(typeof nodo, "string", `falta la llave ${key}`);
  return (nodo as string).replace(/\{(\w+)\}/g, (m, n) => (vars && n in vars ? String(vars[n]) : m));
};

test("el resumen agrupa días seguidos con las mismas horas, en es y en en", () => {
  const semana = [0, 1, 2, 3, 4].map((i) => dia(i, "09:00", "19:00")).concat([dia(5, "09:00", "14:00")]);
  assert.equal(resumenSemana(semana, tDe(ES)), "Lun-Vie 9:00-19:00 · Sáb 9:00-14:00");
  assert.equal(resumenSemana(semana, tDe(EN)), "Mon-Fri 9:00-19:00 · Sat 9:00-14:00");
  // No seguidos, aunque tengan las mismas horas: tramos aparte.
  assert.deepEqual(
    tramosDeSemana([dia(0, "09:00", "13:00"), dia(2, "09:00", "13:00")]).map((t) => [t.desde, t.hasta]),
    [[0, 0], [2, 2]],
  );
  assert.equal(resumenSemana(semanaCompleta([]), tDe(ES)), null);
  assert.equal(horaCorta("09:00"), "9:00");
  assert.equal(horaCorta("19:30"), "19:30");
});

test("cada llave que usa la carpeta existe en es y en en", () => {
  const dir = join(SRC, "components/dashboard/horario-doctor");
  const llaves = new Set<string>();
  for (const f of readdirSync(dir)) {
    if (!/\.(ts|tsx)$/.test(f)) continue;
    const src = readFileSync(join(dir, f), "utf8");
    for (const m of src.matchAll(/"(settings\.(?:horarioDoctor|clientDays|client)\.[a-zA-Z.]+)"/g)) llaves.add(m[1]);
  }
  // Las que se arman con `k()`: la de la administración y la del doctor («Yo»).
  for (const base of ["heredaTitulo", "propioNota", "darPropio", "borradorNota", "sinDiasAbiertos"]) {
    llaves.add(`settings.horarioDoctor.${base}`);
    llaves.add(`settings.horarioDoctor.${base}Yo`);
  }
  assert.ok(llaves.size > 30);
  for (const k of llaves) {
    tDe(ES)(k);
    tDe(EN)(k);
  }
  // «Que la pantalla lo diga con esas palabras.»
  assert.equal(tDe(ES)("settings.horarioDoctor.heredaNota"), "Un doctor sin horario propio sigue el de la clínica.");
});

// ═══════════════════════════════════════════════════════════════════════════
// Quién ve qué — esconder no es permitir, pero tampoco enseñar puertas con 403
// ═══════════════════════════════════════════════════════════════════════════

test("Configuración: cada apartado lleva su guarda además de `TABS` (?tab= no la salta)", () => {
  const src = leer("app/dashboard/settings/settings-client.tsx");
  const condiciones = [...src.matchAll(/\{tab === "([a-z]+)" && ([^\n]*)/g)];
  assert.equal(condiciones.length, 20, "se esperaban 10 apartados × 2 caminos");
  for (const [, id, resto] of condiciones) {
    assert.match(resto, /^(ve\("[a-z]+"\)|isAdminUser|verHorarios) &&/, `el apartado «${id}» se pinta sin guarda`);
    const m = /^ve\("([a-z]+)"\)/.exec(resto);
    if (m) assert.equal(m[1], id, `el apartado «${id}» mira la guarda de otro`);
  }
});

test("Configuración: el DOCTOR entra a Horarios y solo ve esa pestaña", () => {
  const src = leer("app/dashboard/settings/settings-client.tsx");
  // Recortado = DOCTOR sin «Ver configuración» concedido A MANO en su override:
  // el que ya entraba antes de esta tarea sigue viendo lo que veía.
  assert.match(
    src,
    /const doctorRecortado =\s*initUser\.role === "DOCTOR" &&\s*!\(Array\.isArray\(initUser\.permissionsOverride\) && initUser\.permissionsOverride\.includes\("settings\.view"\)\);/,
  );
  assert.match(src, /if \(doctorRecortado\) return "horarios";/);
  const tabs = src.slice(src.indexOf("const TABS = ["), src.indexOf("].filter(item => item.show);"));
  const show = Object.fromEntries([...tabs.matchAll(/\{ id:"([a-z]+)",[^}]*show:([a-zA-Z]+)\s*\}/g)].map((m) => [m[1], m[2]]));
  assert.deepEqual(show, {
    clinica: "verComun", subscription: "isAdminUser", servicios: "isAdminUser", perfil: "verComun",
    facturacion: "isAdminUser", ia: "verComun", integraciones: "verComun", recordatorios: "isAdminUser",
    horarios: "verHorarios", seguridad: "verComun",
  });
  assert.match(src, /const verComun = !doctorRecortado;/);
  // «Mi horario» en los dos caminos, solo para el DOCTOR, con SU id de sesión.
  assert.equal((src.match(/\{esDoctor && \(\s*<SeccionMiHorario\s+doctorId=\{initUser\.id\}/g) ?? []).length, 2);
});

test("Equipo: «Horario» solo para ADMIN/SUPER_ADMIN y solo sobre DOCTOR", () => {
  const src = leer("app/dashboard/team/team-client.tsx");
  assert.match(src, /const puedeHorario = currentUserRole === "ADMIN" \|\| currentUserRole === "SUPER_ADMIN";/);
  assert.match(src, /\{puedeHorario && m\.role === "DOCTOR" && \(/);
  const page = leer("app/dashboard/team/page.tsx");
  assert.match(page, /prisma\.clinicSchedule\.findMany\(\{\s*where: \{ clinicId: user\.clinicId \}/, "el horario de la clínica sin filtro de tenant");
});

// ═══════════════════════════════════════════════════════════════════════════
// El interruptor de recepción
// ═══════════════════════════════════════════════════════════════════════════

test("política: solo un `false` explícito prohíbe; de fábrica, «Sí»", () => {
  assert.deepEqual(POLITICA_DE_FABRICA, { recepcionPuedeAgendar: true, puedoAgendarEncima: true });
  assert.equal(parsePolitica(null), null);
  assert.equal(parsePolitica({}), null);
  assert.deepEqual(parsePolitica({ recepcionPuedeAgendar: false, puedoAgendarEncima: false }), {
    recepcionPuedeAgendar: false,
    puedoAgendarEncima: false,
  });
  assert.deepEqual(parsePolitica({ recepcionPuedeAgendar: false }), {
    recepcionPuedeAgendar: false,
    puedoAgendarEncima: true,
  });
  assert.deepEqual(parsePolitica({ recepcionPuedeAgendar: "no", puedoAgendarEncima: 0 }), {
    recepcionPuedeAgendar: true,
    puedoAgendarEncima: true,
  });
});

test("las tres ventanas que preguntan por un bloqueo obedecen al interruptor", () => {
  const confirmar = leer("components/dashboard/bloqueos/confirmar-bloqueo.tsx");
  assert.match(confirmar, /usePuedoAgendarEncima\(true\)/);
  // Con «No», no hay «Agendar de todas formas»: solo se vuelve a elegir fecha.
  const rama = confirmar.slice(confirmar.indexOf("{prohibido ? (\n              // Una sola salida"));
  assert.ok(rama.length > 0 && rama.indexOf("elegirOtra") < rama.indexOf("agendarIgual"));
  for (const rel of [
    "components/dashboard/agenda/agenda-reschedule-confirm-modal.tsx",
    "components/dashboard/agenda-nueva/confirmar-movimiento.tsx",
  ]) {
    const src = leer(rel);
    assert.match(src, /usePuedoAgendarEncima\([^)]*bloqueo !== null\)/, `${rel}: pregunta aunque no haya bloqueo`);
    assert.match(src, /disabled=\{[a-z]+ \|\| prohibido \|\| esperando\}/, `${rel}: deja confirmar con la clínica en «No»`);
  }
});
