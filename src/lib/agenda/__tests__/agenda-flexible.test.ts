/**
 * AGENDA FLEXIBLE (WS1-T5 · grupo Salamanca) — la parte pura y el lector de la
 * bandera, sin base.
 *
 * Run: npm run test:salamanca-agenda
 *
 * Lo que fija:
 *  · la bandera nace APAGADA y falla cerrado (sin tabla, sin fila, con error);
 *  · el servidor solo sobreagenda con bandera Y confirmación;
 *  · el aviso dice lo que pide el encargo (doctor, sillón o comida);
 *  · el color por procedimiento casa el motivo con el catálogo y, si no casa,
 *    deja el del doctor;
 *  · la hora de comida cierra el hueco para TODAS las puertas (la misma
 *    `doctorNoAtiende`) y se valida como pide el encargo.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AGENDA_FLEXIBLE_APAGADA,
  confirmacionValida,
  FLAG_AGENDA_FLEXIBLE,
  FLAG_COLOR_POR_PROCEDIMIENTO,
  MARCA_SOBREAGENDADA,
  ajustesDesdeFilas,
  avisoDesdeAgenda,
  avisoDesdeRechazo,
  decidirSobreagenda,
  esSobreagendada,
  ocupaElHueco,
  textoDelAviso,
  tipoDeChoque,
} from "../agenda-flexible";
import { _olvidarAgendaFlexible, leerAgendaFlexible } from "../agenda-flexible.server";
import {
  CLAVES_COLOR_PROCEDIMIENTO,
  claveDeProcedimiento,
  colorDeCita,
  colorPorDefecto,
  cssDeColor,
  indiceDeProcedimientos,
  leyendaDeProcedimientos,
  normalizarNombre,
  procedimientoDelMotivo,
} from "../color-procedimiento";
import {
  HorarioError,
  comidaQuePisa,
  diasQueTraenComida,
  comidaDelDoctor,
  comidaDelDoctorEnFecha,
  doctorNoAtiende,
  doctorNoAtiendeSlot,
  avisoDeHorarioDoctor,
  parseSemana,
  semanaCompleta,
  type DiaHorario,
} from "@/lib/horario-doctor/core";
import { leerHorariosDeDoctores } from "@/lib/horario-doctor/consulta.server";
import es from "@/i18n/dictionaries/es.json";
import en from "@/i18n/dictionaries/en.json";

const TZ = "America/Mexico_City";

beforeEach(() => {
  _olvidarAgendaFlexible();
});

// ═══════════════════════════════════════════════════════════════════════
// LA BANDERA
// ═══════════════════════════════════════════════════════════════════════

test("bandera · sin filas, apagada; con la de color pero sin la principal, apagada", () => {
  assert.deepEqual(ajustesDesdeFilas([]), AGENDA_FLEXIBLE_APAGADA);
  assert.deepEqual(ajustesDesdeFilas(null), AGENDA_FLEXIBLE_APAGADA);
  assert.deepEqual(
    ajustesDesdeFilas([{ flag: FLAG_COLOR_POR_PROCEDIMIENTO, enabled: true }]),
    AGENDA_FLEXIBLE_APAGADA,
    "el color por procedimiento no vale sin la bandera principal",
  );
  assert.deepEqual(
    ajustesDesdeFilas([{ flag: FLAG_AGENDA_FLEXIBLE, enabled: false }]),
    AGENDA_FLEXIBLE_APAGADA,
    "una fila apagada es apagada",
  );
});

test("bandera · encendida con «Doctor» por defecto, y «Procedimiento» con su fila", () => {
  assert.deepEqual(ajustesDesdeFilas([{ flag: FLAG_AGENDA_FLEXIBLE, enabled: true }]), {
    encendida: true,
    modoColor: "doctor",
  });
  assert.deepEqual(
    ajustesDesdeFilas([
      { flag: FLAG_AGENDA_FLEXIBLE, enabled: true },
      { flag: FLAG_COLOR_POR_PROCEDIMIENTO, enabled: true },
    ]),
    { encendida: true, modoColor: "procedimiento" },
  );
  assert.deepEqual(
    ajustesDesdeFilas([
      { flag: FLAG_AGENDA_FLEXIBLE, enabled: true },
      { flag: FLAG_COLOR_POR_PROCEDIMIENTO, enabled: false },
    ]),
    { encendida: true, modoColor: "doctor" },
  );
});

/** Un doble de la base: la tabla existe o no, y las filas por clínica. */
function dbBanderas(opts: { tabla?: boolean; filas?: Record<string, { flag: string; enabled: boolean }[]>; falla?: boolean }) {
  const consultas: any[] = [];
  return {
    consultas,
    db: {
      $queryRaw: async () => [{ existe: opts.tabla !== false }],
      clinicFeatureFlag: {
        findMany: async (args: any) => {
          consultas.push(args);
          if (opts.falla) throw Object.assign(new Error("boom"), { code: "P1001" });
          return (opts.filas?.[args.where.clinicId] ?? []).filter((f) => args.where.flag.in.includes(f.flag));
        },
      },
    },
  };
}

test("lector · sin tabla → apagada y NO consulta la tabla", async () => {
  const d = dbBanderas({ tabla: false, filas: { c1: [{ flag: FLAG_AGENDA_FLEXIBLE, enabled: true }] } });
  assert.deepEqual(await leerAgendaFlexible("c1", { db: d.db }), AGENDA_FLEXIBLE_APAGADA);
  assert.equal(d.consultas.length, 0);
});

test("lector · la fila de OTRA clínica no enciende ésta (filtra por clinicId)", async () => {
  const d = dbBanderas({ filas: { otra: [{ flag: FLAG_AGENDA_FLEXIBLE, enabled: true }] } });
  assert.deepEqual(await leerAgendaFlexible("c1", { db: d.db }), AGENDA_FLEXIBLE_APAGADA);
  assert.equal(d.consultas[0].where.clinicId, "c1");
  const e = dbBanderas({ filas: { c1: [{ flag: FLAG_AGENDA_FLEXIBLE, enabled: true }] } });
  assert.equal((await leerAgendaFlexible("c1", { db: e.db })).encendida, true);
});

test("lector · sin clínica no consulta nada (un clinicId vacío no filtra en Prisma)", async () => {
  const d = dbBanderas({ filas: { "": [{ flag: FLAG_AGENDA_FLEXIBLE, enabled: true }] } });
  for (const id of ["", "  ", null, undefined]) {
    assert.deepEqual(await leerAgendaFlexible(id as any, { db: d.db }), AGENDA_FLEXIBLE_APAGADA);
  }
  assert.equal(d.consultas.length, 0);
});

test("lector · un error de la base falla CERRADO (apagada), no tumba nada", async () => {
  const d = dbBanderas({ falla: true });
  assert.deepEqual(await leerAgendaFlexible("c1", { db: d.db }), AGENDA_FLEXIBLE_APAGADA);
});

// ═══════════════════════════════════════════════════════════════════════
// SOBREAGENDAR
// ═══════════════════════════════════════════════════════════════════════

test("decisión · libre si no hay nada encima, con o sin bandera", () => {
  for (const encendida of [true, false]) {
    for (const confirmado of [true, false]) {
      assert.equal(decidirSobreagenda({ encendida, confirmado, hayChoque: false, pisaComida: false }), "libre");
    }
  }
});

test("decisión · SIN bandera, un choque se rechaza aunque la petición diga «sobreagendar»", () => {
  assert.equal(decidirSobreagenda({ encendida: false, confirmado: true, hayChoque: true, pisaComida: false }), "rechazar");
});

test("decisión · con bandera, sin confirmar se rechaza (y la pantalla pregunta); confirmado se sobreagenda", () => {
  assert.equal(decidirSobreagenda({ encendida: true, confirmado: false, hayChoque: true, pisaComida: false }), "rechazar");
  assert.equal(decidirSobreagenda({ encendida: true, confirmado: false, hayChoque: false, pisaComida: true }), "rechazar");
  assert.equal(decidirSobreagenda({ encendida: true, confirmado: true, hayChoque: true, pisaComida: false }), "sobreagendar");
  assert.equal(decidirSobreagenda({ encendida: true, confirmado: true, hayChoque: false, pisaComida: true }), "sobreagendar");
});

test("marca · la escribe el servidor y la reconoce el resto; un motivo de administración NO es sobreagendada", () => {
  assert.equal(esSobreagendada(MARCA_SOBREAGENDADA), true);
  assert.equal(esSobreagendada("Urgencia, lo autorizó la doctora"), false);
  assert.equal(esSobreagendada(null), false);
});

test("ocupaElHueco · cuenta las citas normales y las sobreagendadas (para bot y web)", () => {
  assert.deepEqual(ocupaElHueco(), {
    OR: [{ overrideReason: null }, { overrideReason: { startsWith: MARCA_SOBREAGENDADA } }],
  });
});

test("tipo de choque · mismo doctor → doctor; otro doctor y mismo sillón → sillón; sin cita y en comida → comida", () => {
  assert.equal(tipoDeChoque({ conflicto: { doctorId: "d1", resourceId: "s1" }, intento: { doctorId: "d1", resourceId: "s1" } }), "doctor");
  assert.equal(tipoDeChoque({ conflicto: { doctorId: "d2", resourceId: "s1" }, intento: { doctorId: "d1", resourceId: "s1" } }), "sillon");
  assert.equal(tipoDeChoque({ conflicto: null, intento: { doctorId: "d1" }, pisaComida: true }), "comida");
});

test("aviso · del 409 del servidor: paciente y hora EN LA ZONA DE LA CLÍNICA", () => {
  const aviso = avisoDesdeRechazo(
    {
      error: "appointment_overlap",
      sobreagendable: true,
      conflictingAppointment: {
        id: "a9",
        patientName: "Ana García",
        doctorId: "d1",
        resourceId: null,
        // 16:00Z = 10:00 en Ciudad de México (sin horario de verano).
        startsAt: "2026-11-10T16:00:00.000Z",
        endsAt: "2026-11-10T16:30:00.000Z",
      },
      comida: null,
    },
    { doctorId: "d1", resourceId: null },
    TZ,
  );
  assert.ok(aviso);
  assert.equal(aviso!.tipo, "doctor");
  assert.equal(aviso!.paciente, "Ana García");
  assert.equal(aviso!.hora, "10:00–10:30");
  const { clave, vars } = textoDelAviso(aviso!);
  assert.equal(clave, "agenda.flexible.sobreagendar.cuerpoDoctor");
  assert.deepEqual(vars, { paciente: "Ana García", hora: "10:00–10:30" });
});

test("aviso · un 409 SIN `sobreagendable` (clínica sin bandera) no se convierte en pregunta", () => {
  assert.equal(
    avisoDesdeRechazo({ error: "appointment_overlap", conflictingAppointment: { id: "a9" } }, {}, TZ),
    null,
  );
  assert.equal(avisoDesdeRechazo(null, {}, TZ), null);
});

test("aviso · comida: el texto lleva el tramo de la comida", () => {
  const aviso = avisoDesdeRechazo(
    { error: "lunch_overlap", sobreagendable: true, comida: { lunchStart: "14:00", lunchEnd: "15:00" } },
    { doctorId: "d1" },
    TZ,
  );
  assert.equal(aviso?.tipo, "comida");
  assert.deepEqual(textoDelAviso(aviso!), {
    clave: "agenda.flexible.sobreagendar.cuerpoComida",
    vars: { desde: "14:00", hasta: "15:00" },
    extras: [],
  });
  assert.equal(avisoDesdeAgenda({ choque: null, comida: null, intento: {}, timeZone: TZ }), null);
});

test("textos · el aviso del encargo, al pie de la letra, en es y en en", () => {
  const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");
  const f = (es as any).agenda.flexible.sobreagendar;
  assert.equal(
    fill(f.cuerpoDoctor, { paciente: "Ana García", hora: "10:00–10:30" }),
    "Este doctor ya tiene una cita a esa hora (Ana García, 10:00–10:30). Estás sobreagendando: las dos citas quedarán al mismo tiempo. ¿Seguro?",
  );
  assert.equal(f.confirmar, "Sí, sobreagendar");
  assert.equal(f.cancelar, "Cancelar");
  for (const k of ["titulo", "cuerpoDoctor", "cuerpoSillon", "cuerpoComida", "confirmar", "cancelar"]) {
    assert.equal(typeof (en as any).agenda.flexible.sobreagendar[k], "string", `en: ${k}`);
  }
  assert.equal((es as any).agenda.flexible.comida.rotulo, "Comida");
});

// ═══════════════════════════════════════════════════════════════════════
// COLOR POR PROCEDIMIENTO
// ═══════════════════════════════════════════════════════════════════════

const CATALOGO = [
  { id: "p-limp", nombre: "Limpieza dental", color: "verde" as const },
  { id: "p-res", nombre: "Resina", color: "azul" as const },
  { id: "p-res2", nombre: "Resina 2 caras", color: "coral" as const },
  { id: "p-orto", nombre: "Ajuste de brackets", color: "morado" as const },
];

test("color · casa sin mayúsculas ni acentos; prefijo con separador; el nombre más largo gana; plural no", () => {
  const idx = indiceDeProcedimientos(CATALOGO);
  assert.equal(normalizarNombre("  LIMPIEZA   Dentál "), "limpieza dental");
  assert.equal(procedimientoDelMotivo("limpieza DENTAL", idx)?.id, "p-limp");
  assert.equal(procedimientoDelMotivo("Resina — control", idx)?.id, "p-res");
  assert.equal(procedimientoDelMotivo("Resina 2 caras (molar)", idx)?.id, "p-res2", "gana el más concreto");
  assert.equal(procedimientoDelMotivo("Resinas", idx), null, "«Resinas» no es «Resina»");
  assert.equal(procedimientoDelMotivo("Consulta general", idx), null);
  assert.equal(procedimientoDelMotivo("", idx), null);
});

test("color · «Procedimiento» pinta el del catálogo; sin procedimiento, el del doctor; «Doctor», siempre el del doctor", () => {
  const indice = indiceDeProcedimientos(CATALOGO);
  const doc = "#2563eb";
  assert.deepEqual(colorDeCita({ modo: "procedimiento", motivo: "Resina", indice, colorDoctor: doc }), {
    color: cssDeColor("azul"),
    procedimiento: CATALOGO[1],
  });
  assert.equal(colorDeCita({ modo: "procedimiento", motivo: "Valoración", indice, colorDoctor: doc }).color, doc);
  assert.equal(colorDeCita({ modo: "doctor", motivo: "Resina", indice, colorDoctor: doc }).color, doc);
  assert.equal(colorDeCita({ modo: "procedimiento", motivo: "Resina", indice: null, colorDoctor: doc }).color, doc);
});

test("color · tokens del diseño (var(--ag-proc-…)), nunca hex suelto; default estable y nunca gris", () => {
  for (const c of CLAVES_COLOR_PROCEDIMIENTO) assert.match(cssDeColor(c), /^var\(--ag-proc-[a-z]+, oklch\(/);
  for (const id of ["a", "b", "cmuyolu2a", "proc-123", "zz"]) {
    assert.notEqual(colorPorDefecto(id), "gris");
    assert.equal(colorPorDefecto(id), colorPorDefecto(id));
  }
  assert.equal(claveDeProcedimiento({ id: "x", color: "rosa" }), "rosa");
  assert.equal(claveDeProcedimiento({ id: "x", color: "fucsia" }), colorPorDefecto("x"), "una clave rara cae al default");
});

test("leyenda · solo los procedimientos que aparecen, sin repetir, y «sin procedimiento» si alguna cae al doctor", () => {
  const idx = indiceDeProcedimientos(CATALOGO);
  const l = leyendaDeProcedimientos(["Resina", "resina", "Limpieza dental", "Valoración"], idx);
  assert.deepEqual(l.procedimientos.map((p) => p.id), ["p-res", "p-limp"]);
  assert.equal(l.haySinProcedimiento, true);
  assert.equal(leyendaDeProcedimientos(["Resina"], idx).haySinProcedimiento, false);
});

// ═══════════════════════════════════════════════════════════════════════
// HORA DE COMIDA
// ═══════════════════════════════════════════════════════════════════════

/** Lunes a viernes 9–18 con comida 14–15; sábado 9–13 sin comida. */
const SEMANA: DiaHorario[] = [0, 1, 2, 3, 4].map((dayOfWeek) => ({
  dayOfWeek,
  enabled: true,
  openTime: "09:00",
  closeTime: "18:00",
  lunchStart: "14:00",
  lunchEnd: "15:00",
}));
SEMANA.push({ dayOfWeek: 5, enabled: true, openTime: "09:00", closeTime: "13:00" });
const HORARIOS = new Map([["d1", SEMANA]]);

/** Martes 10-nov-2026 a las HH:MM en Ciudad de México (UTC−6). */
function martes(hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 10, 10, h! + 6, m!));
}

test("comida · el hueco que la pisa no se atiende (motivo «comida»), semiabierto por los dos lados", () => {
  const r = doctorNoAtiende(HORARIOS, martes("14:00"), martes("14:30"), "d1", TZ);
  assert.equal(r?.motivo, "comida");
  assert.equal(r?.lunchStart, "14:00");
  assert.equal(r?.lunchEnd, "15:00");
  assert.equal(doctorNoAtiende(HORARIOS, martes("13:30"), martes("14:00"), "d1", TZ), null, "termina justo al empezar la comida");
  assert.equal(doctorNoAtiende(HORARIOS, martes("15:00"), martes("15:30"), "d1", TZ), null, "empieza justo al acabar");
  assert.equal(doctorNoAtiende(HORARIOS, martes("13:45"), martes("14:15"), "d1", TZ)?.motivo, "comida", "una cita que la cruza");
  assert.equal(doctorNoAtiendeSlot(HORARIOS, martes("14:30"), 30, "d1", TZ)?.motivo, "comida", "el atajo de las calculadoras de huecos");
  assert.equal(doctorNoAtiende(HORARIOS, martes("14:00"), martes("14:30"), "d2", TZ), null, "otro doctor (sin horario propio) no se entera");
});

test("comida · sin comida guardada (o fuera de la jornada, o al revés) no cierra nada", () => {
  const roto = new Map([["d1", [{ dayOfWeek: 1, enabled: true, openTime: "09:00", closeTime: "18:00", lunchStart: "19:00", lunchEnd: "20:00" }]]]);
  assert.equal(doctorNoAtiende(roto, martes("19:00"), martes("19:30"), "d1", TZ)?.motivo, "despues", "fuera de jornada manda el horario");
  const alReves = new Map([["d1", [{ dayOfWeek: 1, enabled: true, openTime: "09:00", closeTime: "18:00", lunchStart: "15:00", lunchEnd: "14:00" }]]]);
  assert.equal(doctorNoAtiende(alReves, martes("14:30"), martes("14:45"), "d1", TZ), null);
  const sinComida = new Map([["d1", [{ dayOfWeek: 1, enabled: true, openTime: "09:00", closeTime: "18:00" }]]]);
  assert.equal(doctorNoAtiende(sinComida, martes("14:00"), martes("14:30"), "d1", TZ), null);
});

test("comida · para pintar: la del día de la semana y la de una fecha concreta", () => {
  assert.deepEqual(comidaDelDoctor(SEMANA, 1), { abre: 14 * 60, cierra: 15 * 60 });
  assert.equal(comidaDelDoctor(SEMANA, 5), null, "el sábado no hay comida");
  assert.deepEqual(comidaDelDoctorEnFecha(HORARIOS, "d1", "2026-11-10", TZ), { abre: 840, cierra: 900 });
  assert.equal(comidaDelDoctorEnFecha(HORARIOS, "d1", "2026-11-15", TZ), null, "domingo: no atiende");
  assert.equal(comidaDelDoctorEnFecha(null, "d1", "2026-11-10", TZ), null, "sin bandera no hay nada que pintar");
});

test("comida · el aviso del staff la nombra", () => {
  const r = doctorNoAtiende(HORARIOS, martes("14:00"), martes("14:30"), "d1", TZ)!;
  assert.match(avisoDeHorarioDoctor(r).message, /hora de comida del doctor \(los martes come de 14:00 a 15:00\)/);
});

function semana(extra: Partial<Record<number, Partial<DiaHorario>>> = {}) {
  return [0, 1, 2, 3, 4, 5, 6].map((d) => ({
    dayOfWeek: d,
    enabled: d < 5,
    openTime: "09:00",
    closeTime: "18:00",
    ...(extra[d] ?? {}),
  }));
}

function codigo(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    assert.ok(e instanceof HorarioError);
    return (e as HorarioError).codigo;
  }
}

test("validación · comida dentro del horario y fin > inicio; las dos o ninguna", () => {
  const ok = parseSemana(semana({ 1: { lunchStart: "14:00", lunchEnd: "15:00" } }));
  assert.equal(ok[1]!.lunchStart, "14:00");
  assert.equal(ok[0]!.lunchStart, undefined, "un día sin comida no la inventa");
  assert.equal(codigo(() => parseSemana(semana({ 1: { lunchStart: "15:00", lunchEnd: "14:00" } }))), "COMIDA_INVERTIDA");
  assert.equal(codigo(() => parseSemana(semana({ 1: { lunchStart: "14:00", lunchEnd: "14:00" } }))), "COMIDA_INVERTIDA");
  assert.equal(codigo(() => parseSemana(semana({ 1: { lunchStart: "08:00", lunchEnd: "09:30" } }))), "COMIDA_FUERA_DE_HORARIO");
  assert.equal(codigo(() => parseSemana(semana({ 1: { lunchStart: "17:30", lunchEnd: "18:30" } }))), "COMIDA_FUERA_DE_HORARIO");
  assert.equal(codigo(() => parseSemana(semana({ 1: { lunchStart: "14:00" } }))), "COMIDA_INVALIDA");
  assert.equal(codigo(() => parseSemana(semana({ 1: { lunchStart: "2pm", lunchEnd: "3pm" } }))), "COMIDA_INVALIDA");
  assert.equal(codigo(() => parseSemana(semana({ 1: { lunchStart: "", lunchEnd: null } }))), null, "vacías = sin comida");
  const apagado = parseSemana(semana({ 6: { lunchStart: "14:00", lunchEnd: "15:00" } }));
  assert.equal(apagado[6]!.lunchStart, undefined, "un día que no atiende no lleva comida");
  assert.equal(
    codigo(() => parseSemana(semana({ 6: { lunchStart: null, lunchEnd: "15:00" } }))),
    null,
    "en un día apagado, una comida a medias no es error (la pantalla tampoco la valida)",
  );
});

test("semanaCompleta · conserva la comida y no la inventa", () => {
  const s = semanaCompleta([{ dayOfWeek: 1, enabled: true, openTime: "09:00", closeTime: "18:00", lunchStart: "14:00", lunchEnd: "15:00" }]);
  assert.equal(s[1]!.lunchStart, "14:00");
  assert.equal("lunchStart" in s[0]!, false);
});

// ═══════════════════════════════════════════════════════════════════════
// EL LECTOR DE HORARIOS: la comida solo con bandera (y columnas)
// ═══════════════════════════════════════════════════════════════════════

const CLAVE_COLUMNAS = Symbol.for("dalecontrol.horarioDoctor.columnasComida");

function dbHorarios(bandera: boolean) {
  const selects: any[] = [];
  const crudas: string[] = [];
  return {
    selects,
    crudas,
    db: {
      // to_regclass → la tabla existe; la comida va por SQL crudo (A13).
      $queryRaw: async (strings: TemplateStringsArray) => {
        const sql = strings.join("?");
        crudas.push(sql);
        if (sql.includes("lunchStart")) return [{ doctorId: "d1", dayOfWeek: 1, lunchStart: "14:00", lunchEnd: "15:00" }];
        return [{ existe: true }];
      },
      clinicFeatureFlag: {
        findMany: async () => (bandera ? [{ flag: FLAG_AGENDA_FLEXIBLE, enabled: true }] : []),
      },
      doctorSchedule: {
        findMany: async (args: any) => {
          selects.push(args.select);
          return [{ doctorId: "d1", dayOfWeek: 1, enabled: true, openTime: "09:00", closeTime: "18:00" }];
        },
      },
    },
  };
}

test("lector de horarios · SIN bandera no pide la comida (ni en el select ni por SQL crudo) y no la entrega", async () => {
  (globalThis as any)[CLAVE_COLUMNAS] = { existe: true, at: Date.now() };
  const d = dbHorarios(false);
  const mapa = await leerHorariosDeDoctores("c1", { db: d.db });
  assert.equal("lunchStart" in d.selects[0], false);
  assert.equal(d.crudas.some((q) => q.includes("lunchStart")), false);
  assert.equal(mapa.get("d1")![0]!.lunchStart, undefined);
});

test("lector de horarios · CON bandera y columnas, la comida llega a todas las puertas", async () => {
  (globalThis as any)[CLAVE_COLUMNAS] = { existe: true, at: Date.now() };
  const d = dbHorarios(true);
  const mapa = await leerHorariosDeDoctores("c1", { db: d.db });
  assert.equal("lunchStart" in d.selects[0], false, "el modelo de Prisma no la declara (A13)");
  assert.ok(d.crudas.some((q) => q.includes('"lunchStart"') && q.includes('"clinicId" =')), "SQL crudo, con clinicId");
  assert.equal(mapa.get("d1")![0]!.lunchStart, "14:00");
});

test("lector de horarios · con bandera pero SIN columnas (SQL sin pegar) no las pide: nada de P2022", async () => {
  (globalThis as any)[CLAVE_COLUMNAS] = { existe: false, at: Date.now() };
  const d = dbHorarios(true);
  await leerHorariosDeDoctores("c1", { db: d.db });
  assert.equal(d.crudas.some((q) => q.includes("lunchStart")), false);
});

// ═══════════════════════════════════════════════════════════════════════
// EL BOT, LA WEB Y SABINA NUNCA SOBREAGENDAN
// ═══════════════════════════════════════════════════════════════════════


const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8");

test("puertas · el bot y la reserva web cuentan una SOBREAGENDADA como ocupada (ocupaElHueco)", () => {
  for (const ruta of [
    "src/lib/agenda/bot-booking-service.ts",
    "src/app/api/public/availability/route.ts",
    "src/app/api/public/book/route.ts",
  ]) {
    const src = leer(ruta);
    assert.match(src, /ocupaElHueco\(\)/, `${ruta}: usa ocupaElHueco`);
  }
  // En el bot, las dos consultas de choque (doctor y sillón).
  assert.equal(leer("src/lib/agenda/bot-booking-service.ts").match(/ocupaElHueco\(\)/g)?.length, 2);
});

test("puertas · el bot y la web escriben sus citas SIN overrideReason (nunca la marca)", () => {
  assert.doesNotMatch(leer("src/lib/agenda/bot-booking-service.ts"), /MARCA_SOBREAGENDADA|sobreagendar/);
  assert.doesNotMatch(leer("src/app/api/public/book/route.ts"), /MARCA_SOBREAGENDADA|sobreagendar:/);
});

test("puertas · Sabina no puede mandar `sobreagendar` (su ejecutor lo rechaza como overrideReason)", () => {
  assert.match(leer("src/lib/sabina/acciones-agenda.ts"), /"sobreagendar" in cuerpo/);
});

test("confirmación · vale para la cita enseñada; sin choque basta con `sobreagendar: true` (la comida)", () => {
  assert.equal(confirmacionValida({ sobreagendar: true, sobreagendarCita: "a1", choqueId: "a1" }), true);
  assert.equal(confirmacionValida({ sobreagendar: true, sobreagendarCita: "a2", choqueId: "a1" }), false);
  assert.equal(confirmacionValida({ sobreagendar: true, sobreagendarCita: undefined, choqueId: "a1" }), false);
  assert.equal(confirmacionValida({ sobreagendar: true, sobreagendarCita: null, choqueId: null }), true);
  assert.equal(confirmacionValida({ sobreagendar: "true", sobreagendarCita: "a1", choqueId: "a1" }), false);
});

test("aviso · lo que ADEMÁS hay que saber: más citas encima y que también cae en la comida", () => {
  const aviso = avisoDesdeRechazo(
    {
      error: "appointment_overlap",
      sobreagendable: true,
      conflictingAppointment: {
        id: "a9", patientName: "Ana García", doctorId: "d1", resourceId: null,
        startsAt: "2026-11-10T20:00:00.000Z", endsAt: "2026-11-10T20:30:00.000Z", otras: 2,
      },
      comida: { lunchStart: "14:00", lunchEnd: "15:00" },
    },
    { doctorId: "d1" },
    TZ,
  )!;
  assert.equal(aviso.citaId, "a9");
  const txt = textoDelAviso(aviso);
  assert.equal(txt.clave, "agenda.flexible.sobreagendar.cuerpoDoctor", "la frase del encargo, primero");
  assert.deepEqual(txt.extras.map((e) => e.clave), [
    "agenda.flexible.sobreagendar.otras",
    "agenda.flexible.sobreagendar.tambienComida",
  ]);
  assert.deepEqual(txt.extras[0]!.vars, { n: "2" });
  for (const k of ["otras", "tambienComida"]) {
    assert.equal(typeof (es as any).agenda.flexible.sobreagendar[k], "string", `es: ${k}`);
    assert.equal(typeof (en as any).agenda.flexible.sobreagendar[k], "string", `en: ${k}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// REVISIÓN t8
// ═══════════════════════════════════════════════════════════════════════

test("t8 · A2 · la comida se ve aunque la cita además se salga del horario", () => {
  // 13:00–18:30: doctorNoAtiende dice «despues» (primer motivo)…
  assert.equal(doctorNoAtiende(HORARIOS, martes("13:00"), martes("18:30"), "d1", TZ)?.motivo, "despues");
  // …pero la comida está pisada y el equipo tiene que confirmarla.
  assert.deepEqual(comidaQuePisa(HORARIOS, martes("13:00"), martes("18:30"), "d1", TZ), { lunchStart: "14:00", lunchEnd: "15:00" });
  assert.deepEqual(comidaQuePisa(HORARIOS, martes("08:30"), martes("14:30"), "d1", TZ), { lunchStart: "14:00", lunchEnd: "15:00" });
  assert.equal(comidaQuePisa(HORARIOS, martes("15:00"), martes("19:00"), "d1", TZ), null);
  assert.equal(comidaQuePisa(null, martes("14:00"), martes("14:30"), "d1", TZ), null, "sin bandera no hay comida");
});

test("t8 · A7 · la confirmación también cuenta cuántas citas se enseñaron", () => {
  assert.equal(confirmacionValida({ sobreagendar: true, sobreagendarCita: "a1", choqueId: "a1", otrasEnsenadas: 1, otrasServidor: 1 }), true);
  assert.equal(confirmacionValida({ sobreagendar: true, sobreagendarCita: "a1", choqueId: "a1", otrasEnsenadas: 0, otrasServidor: 1 }), false, "entró otra más mientras se decidía");
  assert.equal(confirmacionValida({ sobreagendar: true, sobreagendarCita: "a1", choqueId: "a1", otrasServidor: 0 }), true, "una pantalla que no manda el número cuenta 0");
});

test("t8 · A8 · la comida solo se escribe en los días que la TRAEN en el cuerpo", () => {
  const dias = diasQueTraenComida([
    { dayOfWeek: 0, enabled: true, openTime: "09:00", closeTime: "18:00" },
    { dayOfWeek: 1, enabled: true, openTime: "09:00", closeTime: "18:00", lunchStart: null, lunchEnd: null },
    { dayOfWeek: 2, enabled: true, openTime: "09:00", closeTime: "18:00", lunchStart: "14:00", lunchEnd: "15:00" },
  ]);
  assert.deepEqual([...dias].sort(), [1, 2], "el lunes (sin llave) conserva la que tenga en la base");
  assert.equal(diasQueTraenComida(null).size, 0);
});

// A3 (reabrir) ya no se prueba buscando texto: lo EJECUTA
// src/app/api/appointments/__tests__/reabrir-sobreagendada.test.ts.
test("t8 · A13/A11 · las columnas de comida fuera del modelo; sin texto técnico", () => {
  const schema = leer("prisma/schema.prisma");
  const modelo = schema.slice(schema.indexOf("model DoctorSchedule {"), schema.indexOf('@@map("doctor_schedules")'));
  assert.doesNotMatch(modelo, /^\s+lunchStart\s/m, "lunchStart no se declara en DoctorSchedule");
  assert.doesNotMatch(modelo, /^\s+lunchEnd\s/m);
  assert.doesNotMatch(leer("src/lib/horario-doctor/service.ts"), /salamanca-agenda\.sql; avisa/);
  assert.match(leer("src/lib/horario-doctor/service.ts"), /La hora de comida todavía no está disponible\. Avisa a soporte\./);
});

// A10 y N-A4 (el freno del SQL de encendido) ya no se prueban buscando texto:
// los EJECUTA src/lib/agenda/__tests__/encender-agenda-sql.test.ts en PGlite.
