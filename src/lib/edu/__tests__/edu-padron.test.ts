/**
 * El PADRÓN de DaleControl INSTITUCIONAL (Ola 1A), probado SIN base de datos.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-padron.test.ts
 *
 * (No hay `npm run test:edu-padron`: package.json es un archivo del producto
 * dental y este vertical no lo toca. Cuando se integre a main, es una línea.)
 *
 * ── QUÉ FIJA ESTE ARCHIVO ───────────────────────────────────────────────
 *  1. el ALCANCE: quién ve qué filas (y que un rol raro no vea todo);
 *  2. la VIGENCIA: una asignación cerrada ayer NO cuenta hoy;
 *  3. el `where` del padrón: que el institutionId SIEMPRE esté, que un
 *     DOCENTE no pueda salirse de sus alumnos vigentes, y que el buscador
 *     no le pase comodines de LIKE a Postgres;
 *  4. el saneo de lo que se escribe (matrícula, semestre, fechas).
 *
 * ── HASTA DÓNDE LLEGA, Y HASTA DÓNDE NO ─────────────────────────────────
 * Aquí no hay Postgres. Para no quedarse en "el objeto tiene estas llaves"
 * —que no prueba nada— este archivo trae un INTÉRPRETE mínimo del `where`
 * (la función `cumple`) y lo corre contra filas de mentira. Eso sí atrapa
 * los errores que importan: olvidar el `startsAt`, escribir `gte` donde va
 * `gt`, o dejar caer el filtro de instituto.
 *
 * Lo que NO prueba: que Prisma traduzca ese objeto al SQL que creemos. Eso
 * solo lo demuestra una base de datos de verdad, y esta ola no se conecta a
 * ninguna a propósito.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { EduStudentStatus as PrismaEduStudentStatus } from "@prisma/client";
import {
  EDU_STUDENT_STATUSES,
  EDU_STUDENT_STATUS_LABELS,
  type EduStudentStatus,
} from "../types";
import {
  EDU_PADRON_EMPTY_FILTERS,
  eduAssignmentIsCurrent,
  eduStudentSearchIndex,
  eduUserSearchIndex,
  eduCurrentAssignmentWhere,
  eduDateInputValue,
  eduPadronScope,
  eduSearchTokens,
  eduStudentWhere,
  formatEduDate,
  normalizeEduMatricula,
  normalizeEduProgramCode,
  parseEduCalendarDate,
  parseEduPadronFilters,
  parseEduSemester,
  parseEduStudentStatus,
} from "../padron-core";

// ─────────────────────────────────────────────────────────────────────
// 0 · Candado de tipos: la unión de types.ts == el enum de Prisma.
//     Si una ola agrega un estado al schema y no aquí (o al revés),
//     `tsc --noEmit` falla en esta línea. En runtime no existe.
// ─────────────────────────────────────────────────────────────────────
type Exacto<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _estadosCoinciden: Exacto<EduStudentStatus, PrismaEduStudentStatus> = true;
void _estadosCoinciden;

const AHORA = new Date("2026-08-28T18:00:00.000Z");
const INST = "inst_uno";
const OTRO_INST = "inst_dos";

// ═══════════════════════════════════════════════════════════════════════
// Un intérprete mínimo del `where` que generamos. NO es Prisma: entiende
// exactamente los operadores que este vertical usa y nada más. Si alguien
// mete uno nuevo en eduStudentWhere sin enseñárselo aquí, el `assert` del
// final de esta sección se lo dice.
// ═══════════════════════════════════════════════════════════════════════
type Cualquiera = Record<string, unknown>;

function cumple(fila: unknown, where: unknown): boolean {
  if (where === null || typeof where !== "object") return fila === where;
  const row = (fila ?? {}) as Cualquiera;

  for (const [clave, cond] of Object.entries(where as Cualquiera)) {
    if (clave === "AND") {
      if (!(cond as unknown[]).every((w) => cumple(row, w))) return false;
      continue;
    }
    if (clave === "OR") {
      if (!(cond as unknown[]).some((w) => cumple(row, w))) return false;
      continue;
    }

    const valor = row[clave];

    if (cond === null) {
      if (valor !== null && valor !== undefined) return false;
      continue;
    }

    if (typeof cond === "object") {
      const op = cond as Cualquiera;
      if ("some" in op) {
        if (!Array.isArray(valor) || !valor.some((x) => cumple(x, op.some))) return false;
        continue;
      }
      if ("in" in op) {
        if (!(op.in as unknown[]).includes(valor)) return false;
        continue;
      }
      if ("contains" in op) {
        const texto = String(valor ?? "");
        const aguja = String(op.contains);
        const ok =
          op.mode === "insensitive"
            ? texto.toLowerCase().includes(aguja.toLowerCase())
            : texto.includes(aguja);
        if (!ok) return false;
        continue;
      }
      if ("lte" in op) {
        if (valor === null || valor === undefined) return false;
        if (!((valor as Date) <= (op.lte as Date))) return false;
        continue;
      }
      if ("gt" in op) {
        // NULL comparado con algo en SQL no es true: la fila NO entra.
        if (valor === null || valor === undefined) return false;
        if (!((valor as Date) > (op.gt as Date))) return false;
        continue;
      }
      // Relación o subobjeto: { user: { firstName: { contains } } }
      if (!cumple(valor, op)) return false;
      continue;
    }

    if (valor !== cond) return false;
  }
  return true;
}

/**
 * La fila de mentira lleva las columnas `searchIndex` construidas con el
 * MISMO código que corre en producción (eduStudentSearchIndex /
 * eduUserSearchIndex), no con un string escrito a mano. Es la diferencia
 * entre probar el buscador y probar que sabemos copiar un string: si
 * mañana el índice deja de llevar el correo, esta prueba lo nota.
 */
function alumno(over: Partial<Cualquiera> = {}): Cualquiera {
  const matricula = (over.matricula as string) ?? "ENDO-2026-01";
  const user = (over.user as { firstName: string; lastName: string; email?: string }) ?? {
    firstName: "Juan",
    lastName: "Pérez",
  };
  return {
    id: "alu_1",
    institutionId: INST,
    programId: "prog_endo",
    cohortId: "gen_2026a",
    status: "ACTIVE",
    matricula,
    searchIndex: eduStudentSearchIndex({ matricula }),
    supervisors: [],
    ...over,
    user: { ...user, searchIndex: eduUserSearchIndex(user) },
  };
}

function asignacion(over: Partial<Cualquiera> = {}): Cualquiera {
  return {
    institutionId: INST,
    supervisorUserId: "doc_ana",
    startsAt: new Date("2026-01-01T00:00:00.000Z"),
    endsAt: null,
    ...over,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 1 · ALCANCE
// ═══════════════════════════════════════════════════════════════════════

test("DIRECCION ve todo el padrón; DOCENTE solo lo suyo; ALUMNO y CAJA nada", () => {
  assert.deepEqual(eduPadronScope({ role: "DIRECCION", eduUserId: "u1" }), { kind: "all" });
  assert.deepEqual(eduPadronScope({ role: "DOCENTE", eduUserId: "doc_ana" }), {
    kind: "supervised",
    supervisorUserId: "doc_ana",
  });
  assert.deepEqual(eduPadronScope({ role: "ALUMNO", eduUserId: "u3" }), { kind: "none" });
  assert.deepEqual(eduPadronScope({ role: "CAJA", eduUserId: "u4" }), { kind: "none" });
});

test("un rol desconocido o un docente sin id caen en 'none', nunca en 'all'", () => {
  // Lo peligroso sería lo contrario: que un valor inesperado abriera el
  // padrón entero. La opción segura es la que no filtra datos.
  assert.deepEqual(eduPadronScope({ role: "RECTOR" as never, eduUserId: "u9" }), { kind: "none" });
  assert.deepEqual(eduPadronScope({ role: "DOCENTE", eduUserId: "" }), { kind: "none" });
  assert.deepEqual(eduPadronScope(null as never), { kind: "none" });
});

// ═══════════════════════════════════════════════════════════════════════
// 2 · VIGENCIA — el docente rota a media generación
// ═══════════════════════════════════════════════════════════════════════

test("vigente = ya empezó y no se ha cerrado", () => {
  const ayer = new Date(AHORA.getTime() - 86400000);
  const manana = new Date(AHORA.getTime() + 86400000);

  assert.equal(eduAssignmentIsCurrent({ startsAt: ayer, endsAt: null }, AHORA), true);
  assert.equal(eduAssignmentIsCurrent({ startsAt: ayer, endsAt: manana }, AHORA), true);
  // Empieza hoy mismo: cuenta hoy.
  assert.equal(eduAssignmentIsCurrent({ startsAt: AHORA, endsAt: null }, AHORA), true);
});

test("una asignación con endsAt en el PASADO no cuenta como vigente", () => {
  const haceUnMes = new Date("2026-07-01T00:00:00.000Z");
  const cerrada = { startsAt: new Date("2026-01-01T00:00:00.000Z"), endsAt: haceUnMes };
  assert.equal(eduAssignmentIsCurrent(cerrada, AHORA), false);

  // Y el caso que de verdad muerde: se cerró en ESTE instante. Con `>=` en
  // vez de `>`, el docente saliente y el entrante saldrían los dos como
  // vigentes durante ese instante.
  assert.equal(
    eduAssignmentIsCurrent({ startsAt: new Date("2026-01-01T00:00:00.000Z"), endsAt: AHORA }, AHORA),
    false,
  );
});

test("una asignación que todavía no empieza tampoco cuenta", () => {
  const proxima = { startsAt: new Date(AHORA.getTime() + 3600000), endsAt: null };
  assert.equal(eduAssignmentIsCurrent(proxima, AHORA), false);
});

test("fechas ilegibles o basura no se dan por vigentes", () => {
  assert.equal(eduAssignmentIsCurrent({ startsAt: "no-es-fecha", endsAt: null }, AHORA), false);
  assert.equal(eduAssignmentIsCurrent({ startsAt: "2026-01-01", endsAt: "ni-idea" }, AHORA), false);
  assert.equal(eduAssignmentIsCurrent(null as never, AHORA), false);
});

test("el filtro de vigencia de Prisma dice lo MISMO que el predicado", () => {
  const w = eduCurrentAssignmentWhere(AHORA);
  const casos = [
    asignacion({ endsAt: null }),
    asignacion({ endsAt: new Date(AHORA.getTime() + 1000) }),
    asignacion({ endsAt: new Date(AHORA.getTime() - 1000) }),
    asignacion({ endsAt: AHORA }),
    asignacion({ startsAt: new Date(AHORA.getTime() + 1000) }),
  ];
  for (const c of casos) {
    assert.equal(
      cumple(c, w),
      eduAssignmentIsCurrent(c as { startsAt: Date; endsAt: Date | null }, AHORA),
      `el where y el predicado discrepan sobre ${JSON.stringify(c)}`,
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════
// 3 · EL `where` DEL PADRÓN
// ═══════════════════════════════════════════════════════════════════════

test("sin institutionId LANZA (un undefined borraría el filtro de tenant)", () => {
  assert.throws(
    () => eduStudentWhere({ institutionId: "", scope: { kind: "all" } }),
    /institutionId/,
  );
  assert.throws(
    () => eduStudentWhere({ institutionId: undefined as never, scope: { kind: "all" } }),
    /institutionId/,
  );
});

test("el institutionId SIEMPRE está, con cualquier alcance y cualquier filtro", () => {
  const alcances = [
    { kind: "all" as const },
    { kind: "supervised" as const, supervisorUserId: "doc_ana" },
    { kind: "none" as const },
  ];
  for (const scope of alcances) {
    const w = eduStudentWhere({
      institutionId: INST,
      scope,
      filters: { programId: "p", cohortId: "c", status: "ACTIVE", q: "juan" },
      now: AHORA,
    });
    assert.equal((w as Cualquiera).institutionId, INST, `alcance ${scope.kind} sin tenant`);
  }
});

test("un alumno de OTRO instituto no pasa el where ni con alcance total", () => {
  const w = eduStudentWhere({ institutionId: INST, scope: { kind: "all" }, now: AHORA });
  assert.equal(cumple(alumno(), w), true);
  assert.equal(cumple(alumno({ institutionId: OTRO_INST }), w), false);
});

test("DOCENTE: solo salen sus alumnos, y solo con la asignación VIGENTE", () => {
  const w = eduStudentWhere({
    institutionId: INST,
    scope: { kind: "supervised", supervisorUserId: "doc_ana" },
    now: AHORA,
  });

  const mio = alumno({ id: "a1", supervisors: [asignacion()] });
  const deOtroDocente = alumno({
    id: "a2",
    supervisors: [asignacion({ supervisorUserId: "doc_beto" })],
  });
  const sinDocente = alumno({ id: "a3", supervisors: [] });
  const cerrado = alumno({
    id: "a4",
    supervisors: [asignacion({ endsAt: new Date("2026-07-01T00:00:00.000Z") })],
  });
  const aunNoEmpieza = alumno({
    id: "a5",
    supervisors: [asignacion({ startsAt: new Date("2026-12-01T00:00:00.000Z") })],
  });
  const cruzado = alumno({
    id: "a6",
    supervisors: [asignacion({ institutionId: OTRO_INST })],
  });

  assert.equal(cumple(mio, w), true, "no ve al alumno que sí supervisa");
  assert.equal(cumple(deOtroDocente, w), false, "ve alumnos de otro docente");
  assert.equal(cumple(sinDocente, w), false, "ve alumnos sin docente");
  assert.equal(cumple(cerrado, w), false, "una asignación CERRADA lo sigue mostrando");
  assert.equal(cumple(aunNoEmpieza, w), false, "una asignación futura ya lo muestra");
  assert.equal(cumple(cruzado, w), false, "una asignación de otro instituto lo cuela");
});

test("DOCENTE: si su alumno rota a otro docente, deja de verlo", () => {
  const w = eduStudentWhere({
    institutionId: INST,
    scope: { kind: "supervised", supervisorUserId: "doc_ana" },
    now: AHORA,
  });
  // Así queda la fila después de una rotación: la de Ana CERRADA (no
  // borrada, para poder saber quién supervisaba antes) y la de Beto abierta.
  const rotado = alumno({
    supervisors: [
      asignacion({ supervisorUserId: "doc_ana", endsAt: new Date("2026-08-01T00:00:00.000Z") }),
      asignacion({ supervisorUserId: "doc_beto", startsAt: new Date("2026-08-01T00:00:00.000Z") }),
    ],
  });
  assert.equal(cumple(rotado, w), false);

  const wBeto = eduStudentWhere({
    institutionId: INST,
    scope: { kind: "supervised", supervisorUserId: "doc_beto" },
    now: AHORA,
  });
  assert.equal(cumple(rotado, wBeto), true, "el docente nuevo tiene que verlo");
});

test("alcance 'none' no devuelve una sola fila", () => {
  const w = eduStudentWhere({ institutionId: INST, scope: { kind: "none" }, now: AHORA });
  assert.equal(cumple(alumno(), w), false);
});

test("los filtros de programa, generación y estado se aplican de verdad", () => {
  const w = eduStudentWhere({
    institutionId: INST,
    scope: { kind: "all" },
    filters: { programId: "prog_endo", cohortId: "gen_2026a", status: "ACTIVE", q: null },
    now: AHORA,
  });
  assert.equal(cumple(alumno(), w), true);
  assert.equal(cumple(alumno({ programId: "prog_orto" }), w), false);
  assert.equal(cumple(alumno({ cohortId: "gen_2025b" }), w), false);
  assert.equal(cumple(alumno({ status: "GRADUATED" }), w), false);
});

test("el buscador encuentra por matrícula, por nombre y por nombre completo", () => {
  const buscar = (q: string) =>
    eduStudentWhere({
      institutionId: INST,
      scope: { kind: "all" },
      filters: { ...EDU_PADRON_EMPTY_FILTERS, q },
      now: AHORA,
    });

  assert.equal(cumple(alumno(), buscar("endo-2026")), true, "no encuentra por matrícula");
  assert.equal(cumple(alumno(), buscar("juan")), true, "no encuentra por nombre");
  assert.equal(cumple(alumno(), buscar("pérez")), true, "no encuentra por apellido");
  // Nombre y apellido viven en DOS columnas: sin partir el término, un solo
  // `contains` no encontraría a nadie.
  assert.equal(cumple(alumno(), buscar("juan pérez")), true, "no encuentra por nombre completo");
  assert.equal(cumple(alumno(), buscar("beto")), false);
});

test("🔴 el buscador del padrón IGNORA LOS ACENTOS, en las dos direcciones", () => {
  // El mismo bug que se reportó en pacientes: nadie escribe acentos en un
  // buscador. Aquí se prueba sobre el `where` de verdad, no sobre el
  // normalizador suelto.
  const buscar = (q: string) =>
    eduStudentWhere({
      institutionId: INST,
      scope: { kind: "all" },
      filters: { ...EDU_PADRON_EMPTY_FILTERS, q },
      now: AHORA,
    });

  const conAcento = alumno({ user: { firstName: "María Elena", lastName: "Rodríguez" } });
  assert.equal(cumple(conAcento, buscar("Rodriguez")), true, "sin acento no la encuentra");
  assert.equal(cumple(conAcento, buscar("rodríguez")), true, "con acento no la encuentra");
  assert.equal(cumple(conAcento, buscar("MARIA")), true, "en mayúsculas no la encuentra");

  // Y al revés: la que se capturó SIN acento se encuentra tecleando el
  // acento. Es la mitad que se olvida.
  const sinAcento = alumno({ user: { firstName: "Maria Elena", lastName: "Rodriguez" } });
  assert.equal(cumple(sinAcento, buscar("Rodríguez")), true);
});

test("el buscador no le pasa comodines de LIKE a Postgres", () => {
  // 🔴 Prisma NO escapa `contains`: buscar "%" traería la tabla entera.
  assert.deepEqual(eduSearchTokens("%"), []);
  assert.deepEqual(eduSearchTokens("%juan%"), ["juan"]);
  assert.deepEqual(eduSearchTokens("a_b"), ["a", "b"]);
  assert.deepEqual(eduSearchTokens("juan\\"), ["juan"]);
  // Y no se aceptan cien palabras: es un buscador, no un motor de consultas.
  assert.deepEqual(eduSearchTokens("uno dos tres cuatro cinco"), ["uno", "dos", "tres"]);
  assert.deepEqual(eduSearchTokens("   "), []);
  assert.deepEqual(eduSearchTokens(null), []);

  const w = eduStudentWhere({
    institutionId: INST,
    scope: { kind: "all" },
    filters: { ...EDU_PADRON_EMPTY_FILTERS, q: "%" },
    now: AHORA,
  });
  assert.equal("AND" in (w as Cualquiera), false, "un '%' solo no debe generar filtro de texto");
});

// ═══════════════════════════════════════════════════════════════════════
// 4 · LO QUE VIENE DE LA URL
// ═══════════════════════════════════════════════════════════════════════

test("los filtros de la URL se sanean: lo que no se reconoce, se descarta", () => {
  assert.deepEqual(
    parseEduPadronFilters({
      programa: "prog_endo",
      generacion: "gen_2026a",
      estado: "ACTIVE",
      q: "  juan  ",
    }),
    { programId: "prog_endo", cohortId: "gen_2026a", status: "ACTIVE", q: "juan" },
  );

  // Un estado inventado no rompe nada: se queda sin filtro de estado.
  assert.equal(parseEduPadronFilters({ estado: "DROP TABLE" }).status, null);
  // Un id con forma rara se descarta entero.
  assert.equal(parseEduPadronFilters({ programa: "prog'; --" }).programId, null);
  assert.equal(parseEduPadronFilters({ programa: "x".repeat(80) }).programId, null);
  // Un arreglo (?programa=a&programa=b) toma el primero.
  assert.equal(parseEduPadronFilters({ programa: ["uno", "dos"] }).programId, "uno");
  assert.deepEqual(parseEduPadronFilters(undefined), EDU_PADRON_EMPTY_FILTERS);
});

test("🔴 la URL NO puede traer un institutionId: no se lee ni por accidente", () => {
  const f = parseEduPadronFilters({
    institutionId: OTRO_INST,
    institution: OTRO_INST,
    tenant: OTRO_INST,
  } as never);
  assert.deepEqual(f, EDU_PADRON_EMPTY_FILTERS);
  // Y el where lo saca del argumento, que viene de la sesión.
  const w = eduStudentWhere({ institutionId: INST, scope: { kind: "all" }, filters: f });
  assert.equal((w as Cualquiera).institutionId, INST);
});

// ═══════════════════════════════════════════════════════════════════════
// 5 · SANEO DE LO QUE SE ESCRIBE
// ═══════════════════════════════════════════════════════════════════════

test("la matrícula se guarda en mayúsculas y sin espacios", () => {
  // El índice único es (institutionId, matricula) y Postgres distingue
  // mayúsculas: sin normalizar, "a-01" y "A-01" serían dos alumnos con la
  // misma matrícula impresa en la credencial.
  assert.equal(normalizeEduMatricula("  endo-2026-01 "), "ENDO-2026-01");
  assert.equal(normalizeEduMatricula("a 01"), "A01");
  assert.equal(normalizeEduMatricula(""), null);
  assert.equal(normalizeEduMatricula("   "), null);
  assert.equal(normalizeEduMatricula("X".repeat(31)), null);
  assert.equal(normalizeEduMatricula(42), null);
});

test("la clave del programa también se normaliza", () => {
  assert.equal(normalizeEduProgramCode(" endo "), "ENDO");
  assert.equal(normalizeEduProgramCode("X".repeat(21)), null);
});

test("el semestre y el estado no aceptan cualquier cosa", () => {
  assert.equal(parseEduSemester("3"), 3);
  assert.equal(parseEduSemester(3), 3);
  assert.equal(parseEduSemester(0), null);
  assert.equal(parseEduSemester(21), null);
  assert.equal(parseEduSemester(2.5), null);
  assert.equal(parseEduSemester("tres"), null);

  assert.equal(parseEduStudentStatus("GRADUATED"), "GRADUATED");
  assert.equal(parseEduStudentStatus("graduated"), null);
  assert.equal(parseEduStudentStatus("BAJA"), null);
});

test("los CUATRO estados tienen etiqueta en español", () => {
  assert.deepEqual([...EDU_STUDENT_STATUSES].sort(), [
    "ACTIVE",
    "GRADUATED",
    "ON_LEAVE",
    "WITHDRAWN",
  ]);
  for (const s of EDU_STUDENT_STATUSES) {
    assert.ok(EDU_STUDENT_STATUS_LABELS[s], `falta la etiqueta de ${s}`);
    assert.notEqual(EDU_STUDENT_STATUS_LABELS[s], s, `${s} se pinta con el valor del enum`);
  }
});

test("una fecha de calendario se guarda y se pinta EN UTC (el 31 no puede salir 30)", () => {
  const d = parseEduCalendarDate("2026-12-31");
  assert.ok(d);
  assert.equal(d.toISOString(), "2026-12-31T00:00:00.000Z");
  // Ésta es la prueba que importa: en una zona UTC−, formatear en local le
  // resta horas y el 31 de diciembre sale "30 de diciembre".
  assert.match(formatEduDate(d), /31/);
  assert.equal(eduDateInputValue(d), "2026-12-31");
});

test("una fecha imposible se rechaza en vez de 'arreglarse' sola", () => {
  // new Date(2026, 1, 31) devuelve el 3 de marzo sin avisar.
  assert.equal(parseEduCalendarDate("2026-02-31"), null);
  assert.equal(parseEduCalendarDate("2026-13-01"), null);
  assert.equal(parseEduCalendarDate("31/12/2026"), null);
  assert.equal(parseEduCalendarDate(""), null);
  assert.equal(parseEduCalendarDate(null), null);
});
