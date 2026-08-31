/**
 * Matriz rol × permiso de DaleControl INSTITUCIONAL (Ola 0).
 * Espejo de src/lib/auth/__tests__/permissions-matrix.test.ts.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-permissions.test.ts
 *
 * (No hay `npm run test:edu-permissions`: package.json es un archivo del
 * producto dental y esta ola no lo toca. Cuando el vertical se integre a
 * main, ese script es UNA línea.)
 *
 * Lo que fija este archivo:
 *  1. salud del catálogo — ninguna key fuera de un grupo, ningún default con
 *     un typo, ninguna key sin lector (la regla "cada key la exige de verdad
 *     una pantalla o un endpoint");
 *  2. la semántica del override — REEMPLAZA al default, no se suma, y las
 *     keys inventadas se descartan;
 *  3. que la unión EduRole de src/lib/edu/types.ts no se desincronice del
 *     enum EduRole de Prisma (chequeo de TIPOS, lo verifica `tsc --noEmit`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { EduRole as PrismaEduRole } from "@prisma/client";
import {
  EDU_ALL_PERMISSIONS,
  EDU_ALL_PERMISSION_KEYS,
  EDU_PERMISSION_GROUPS,
  EDU_ROLE_DEFAULTS,
  EduForbiddenError,
  assertEduPermission,
  getEduEffectivePermissions,
  hasEduPermission,
  sanitizeEduPermissionKeys,
  type EduPermissionKey,
} from "../permissions";
import {
  EDU_NAV_ITEMS,
  EDU_NAV_LABELS,
  EDU_ROLES,
  EDU_ROLE_LABELS,
  EDU_UPCOMING_AREAS,
  type EduRole,
} from "../types";

// ─────────────────────────────────────────────────────────────────────
// 0 · Candado de tipos: la unión EduRole == el enum EduRole de Prisma
//     Si una ola agrega un rol al schema y no lo agrega a types.ts (o al
//     revés), `tsc --noEmit` falla aquí. En runtime esto no existe.
// ─────────────────────────────────────────────────────────────────────
type Exacto<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _rolesCoinciden: Exacto<EduRole, PrismaEduRole> = true;
void _rolesCoinciden;

// ─────────────────────────────────────────────────────────────────────
// 1 · Salud del catálogo
// ─────────────────────────────────────────────────────────────────────

test("cada key del catálogo está en EXACTAMENTE un grupo (si no, no se puede encender ni apagar)", () => {
  const vistas = new Map<string, number>();
  for (const g of EDU_PERMISSION_GROUPS) {
    for (const k of g.keys) vistas.set(k, (vistas.get(k) ?? 0) + 1);
  }
  for (const k of EDU_ALL_PERMISSION_KEYS) {
    assert.equal(
      vistas.get(k) ?? 0,
      1,
      `${k} aparece ${vistas.get(k) ?? 0} veces en EDU_PERMISSION_GROUPS (debe ser 1)`,
    );
  }
  for (const [k, n] of Array.from(vistas.entries())) {
    assert.ok(k in EDU_ALL_PERMISSIONS, `grupo con key fuera del catálogo: ${k} (${n})`);
  }
});

test("los defaults por rol solo contienen keys del catálogo (sin typos)", () => {
  const catalogo = new Set<string>(EDU_ALL_PERMISSION_KEYS);
  for (const [rol, keys] of Object.entries(EDU_ROLE_DEFAULTS)) {
    for (const k of keys) {
      assert.ok(catalogo.has(k), `el default de ${rol} trae una key fuera del catálogo: ${k}`);
    }
    assert.equal(new Set(keys).size, keys.length, `el default de ${rol} repite keys`);
  }
});

test("los CUATRO roles existen, tienen etiqueta en español y entran al panel", () => {
  assert.deepEqual([...EDU_ROLES].sort(), ["ALUMNO", "CAJA", "DIRECCION", "DOCENTE"]);
  for (const rol of EDU_ROLES) {
    assert.ok(EDU_ROLE_DEFAULTS[rol], `falta el default de ${rol}`);
    assert.ok(EDU_ROLE_LABELS[rol], `falta la etiqueta en español de ${rol}`);
    assert.equal(
      hasEduPermission({ role: rol, permissionsOverride: [] }, "inicio.view"),
      true,
      `${rol} se quedaría fuera del panel`,
    );
  }
});

test("cada item del menú exige una key que existe en el catálogo", () => {
  for (const item of EDU_NAV_ITEMS) {
    if (item.permission === null) continue;
    assert.ok(
      item.permission in EDU_ALL_PERMISSIONS,
      `el item "${item.key}" del menú exige ${item.permission}, que no está en el catálogo`,
    );
  }
});

test("cada item del menú tiene etiqueta en español (si no, sale la key en el sidebar)", () => {
  for (const item of EDU_NAV_ITEMS) {
    assert.ok(EDU_NAV_LABELS[item.key], `el item "${item.key}" no tiene etiqueta`);
  }
});

/**
 * Ninguna área puede estar en el menú Y en "Próximamente" a la vez: sería
 * una pantalla que existe anunciada como que no existe. Ni en ninguna de
 * las dos, que es cómo se entrega algo y nadie lo encuentra.
 */
test("un área entregada sale de 'Próximamente' (la Ola 1A sacó el padrón)", () => {
  const enMenu = new Set(EDU_NAV_ITEMS.map((i) => i.key));
  for (const area of EDU_UPCOMING_AREAS) {
    assert.equal(
      enMenu.has(area.key),
      false,
      `"${area.key}" está en el menú y sigue anunciada como Próximamente`,
    );
  }
  assert.ok(enMenu.has("padron"), "el padrón ya se entregó: tiene que estar en el menú");
});

// ─────────────────────────────────────────────────────────────────────
// 1b · Las cuatro keys de la Ola 1A (padrón académico)
// ─────────────────────────────────────────────────────────────────────

const KEYS_OLA_1A: EduPermissionKey[] = [
  "padron.view",
  "padron.manage",
  "docentes.view",
  "supervision.assign",
];

test("las cuatro keys de la Ola 1A están en el catálogo, descritas en español", () => {
  for (const k of KEYS_OLA_1A) {
    assert.ok(k in EDU_ALL_PERMISSIONS, `falta ${k} en el catálogo`);
    const desc = EDU_ALL_PERMISSIONS[k];
    assert.ok(desc && desc.length > 8, `${k} sin descripción usable: ${desc}`);
    assert.notEqual(desc, k, `${k} se describe con su propia key`);
  }
});

test("las cuatro keys nuevas viven en el grupo del padrón (y en uno solo)", () => {
  const grupo = EDU_PERMISSION_GROUPS.find((g) => g.keys.includes("padron.view"));
  assert.ok(grupo, "no hay grupo para padron.view");
  for (const k of KEYS_OLA_1A) {
    assert.ok(grupo.keys.includes(k), `${k} no está en el grupo "${grupo.title}"`);
    const cuantos = EDU_PERMISSION_GROUPS.filter((g) => g.keys.includes(k)).length;
    assert.equal(cuantos, 1, `${k} aparece en ${cuantos} grupos`);
  }
});

test("los defaults de la Ola 1A son EXACTAMENTE los del contrato", () => {
  // DIRECCION administra: las cuatro.
  for (const k of KEYS_OLA_1A) {
    assert.equal(
      hasEduPermission({ role: "DIRECCION" }, k),
      true,
      `DIRECCION debería traer ${k} por defecto`,
    );
  }

  // DOCENTE lee el padrón y la lista de docentes; no administra ni reparte.
  assert.equal(hasEduPermission({ role: "DOCENTE" }, "padron.view"), true);
  assert.equal(hasEduPermission({ role: "DOCENTE" }, "docentes.view"), true);
  assert.equal(hasEduPermission({ role: "DOCENTE" }, "padron.manage"), false);
  assert.equal(hasEduPermission({ role: "DOCENTE" }, "supervision.assign"), false);

  // ALUMNO y CAJA: ninguna de las cuatro.
  for (const rol of ["ALUMNO", "CAJA"] as EduRole[]) {
    for (const k of KEYS_OLA_1A) {
      assert.equal(hasEduPermission({ role: rol }, k), false, `${rol} no debería traer ${k}`);
    }
    // …y siguen entrando al panel.
    assert.equal(hasEduPermission({ role: rol }, "inicio.view"), true);
  }
});

test("un permiso NUEVO no le llega solo a quien ya tiene override", () => {
  // Ésta es la regla que muerde en producción y por la que cada .sql de una
  // ola trae su backfill comentado: el override REEMPLAZA al default, así
  // que a quien tenga guardado ["inicio.view"] no le aparece el padrón
  // aunque su rol lo traiga por defecto.
  const conOverrideViejo = { role: "DIRECCION" as EduRole, permissionsOverride: ["inicio.view"] };
  assert.equal(hasEduPermission(conOverrideViejo, "inicio.view"), true);
  assert.equal(hasEduPermission(conOverrideViejo, "padron.view"), false);
  assert.equal(hasEduPermission(conOverrideViejo, "padron.manage"), false);
});

// ─────────────────────────────────────────────────────────────────────
// 1c · Las nueve keys de la Ola 2 (el piso clínico)
// ─────────────────────────────────────────────────────────────────────

const KEYS_OLA_2: EduPermissionKey[] = [
  "pacientes.view",
  "pacientes.manage",
  "pacientes.origen",
  "agenda.view",
  "agenda.manage",
  "sillones.view",
  "sillones.manage",
  "casos.view",
  "casos.assign",
];

test("las nueve keys de la Ola 2 están en el catálogo, descritas en español", () => {
  for (const k of KEYS_OLA_2) {
    assert.ok(k in EDU_ALL_PERMISSIONS, `falta ${k} en el catálogo`);
    const desc = EDU_ALL_PERMISSIONS[k];
    assert.ok(desc && desc.length > 8, `${k} sin descripción usable: ${desc}`);
    assert.notEqual(desc, k, `${k} se describe con su propia key`);
  }
});

test("el piso clínico está repartido en dos grupos, y cada key en uno solo", () => {
  const pacientes = EDU_PERMISSION_GROUPS.find((g) => g.keys.includes("pacientes.view"));
  const agenda = EDU_PERMISSION_GROUPS.find((g) => g.keys.includes("agenda.view"));
  assert.ok(pacientes && agenda, "faltan los grupos del piso clínico");
  assert.notEqual(pacientes.title, agenda.title, "los dos grupos son el mismo");
  for (const k of KEYS_OLA_2) {
    const cuantos = EDU_PERMISSION_GROUPS.filter((g) => g.keys.includes(k)).length;
    assert.equal(cuantos, 1, `${k} aparece en ${cuantos} grupos`);
  }
});

test("los defaults de la Ola 2 son EXACTAMENTE los del contrato", () => {
  // DIRECCION: todo.
  for (const k of KEYS_OLA_2) {
    assert.equal(hasEduPermission({ role: "DIRECCION" }, k), true, `DIRECCION sin ${k}`);
  }

  // CAJA: pacientes.* + agenda.* + sillones.view. Recibe, agenda y cobra.
  const deCaja: EduPermissionKey[] = [
    "pacientes.view",
    "pacientes.manage",
    "pacientes.origen",
    "agenda.view",
    "agenda.manage",
    "sillones.view",
  ];
  for (const k of deCaja) {
    assert.equal(hasEduPermission({ role: "CAJA" }, k), true, `CAJA debería traer ${k}`);
  }
  // 🔴 Y NINGÚN caso: es la línea del contrato "caja sin expediente
  // clínico". Está cerrada aquí y otra vez en el helper de visibilidad,
  // que para el recurso "cases" le devuelve alcance "none" aunque alguien
  // le encienda el interruptor por error.
  assert.equal(hasEduPermission({ role: "CAJA" }, "casos.view"), false);
  assert.equal(hasEduPermission({ role: "CAJA" }, "casos.assign"), false);
  assert.equal(hasEduPermission({ role: "CAJA" }, "sillones.manage"), false);

  // DOCENTE: los .view + casos.assign. Mira y reparte; no registra
  // pacientes (eso es recepción) ni mueve la agenda de la escuela.
  const deDocente: EduPermissionKey[] = [
    "pacientes.view",
    "agenda.view",
    "sillones.view",
    "casos.view",
    "casos.assign",
  ];
  for (const k of deDocente) {
    assert.equal(hasEduPermission({ role: "DOCENTE" }, k), true, `DOCENTE debería traer ${k}`);
  }
  const noDelDocente: EduPermissionKey[] = [
    "pacientes.manage",
    "pacientes.origen",
    "agenda.manage",
    "sillones.manage",
  ];
  for (const k of noDelDocente) {
    assert.equal(hasEduPermission({ role: "DOCENTE" }, k), false, `DOCENTE no debería traer ${k}`);
  }

  // ALUMNO: del piso clínico solo LECTURA, y todo lo que lea va recortado a
  // lo suyo por el ALCANCE, no por el permiso. (Las seis del expediente que
  // agregó la Ola 3 se comprueban en su propio bloque, más abajo.)
  const deAlumnoOla2: EduPermissionKey[] = [
    "inicio.view",
    "agenda.view",
    "pacientes.view",
    "casos.view",
  ];
  for (const k of deAlumnoOla2) {
    assert.equal(hasEduPermission({ role: "ALUMNO" }, k), true, `ALUMNO debería traer ${k}`);
  }
  const noDelAlumno: EduPermissionKey[] = [
    "pacientes.manage",
    "pacientes.origen",
    "agenda.manage",
    "sillones.manage",
    "casos.assign",
    "padron.view",
    "padron.manage",
    "docentes.view",
    "supervision.assign",
  ];
  for (const k of noDelAlumno) {
    assert.equal(hasEduPermission({ role: "ALUMNO" }, k), false, `ALUMNO no debería traer ${k}`);
  }
});

// ─────────────────────────────────────────────────────────────────────
// 1d · Las seis keys de la Ola 3 (el expediente clínico)
// ─────────────────────────────────────────────────────────────────────

const KEYS_OLA_3: EduPermissionKey[] = [
  "expediente.view",
  "expediente.write",
  "odontograma.view",
  "odontograma.edit",
  "estudios.view",
  "estudios.upload",
];

test("las seis keys de la Ola 3 están en el catálogo, descritas en español", () => {
  for (const k of KEYS_OLA_3) {
    assert.ok(k in EDU_ALL_PERMISSIONS, `falta ${k} en el catálogo`);
    const desc = EDU_ALL_PERMISSIONS[k];
    assert.ok(desc && desc.length > 8, `${k} sin descripción usable: ${desc}`);
    assert.notEqual(desc, k, `${k} se describe con su propia key`);
  }
});

test("las seis viven en el grupo del expediente, y cada una en uno solo", () => {
  const grupo = EDU_PERMISSION_GROUPS.find((g) => g.keys.includes("expediente.view"));
  assert.ok(grupo, "no hay grupo para expediente.view");
  for (const k of KEYS_OLA_3) {
    assert.ok(grupo.keys.includes(k), `${k} no está en el grupo "${grupo.title}"`);
    const cuantos = EDU_PERMISSION_GROUPS.filter((g) => g.keys.includes(k)).length;
    assert.equal(cuantos, 1, `${k} aparece en ${cuantos} grupos`);
  }
  // Grupo APARTE del de pacientes: la dirección tiene que poder apagarle el
  // expediente a alguien sin apagarle la recepción, y al revés.
  const pacientes = EDU_PERMISSION_GROUPS.find((g) => g.keys.includes("pacientes.view"));
  assert.ok(pacientes);
  assert.notEqual(grupo.title, pacientes.title);
});

test("🔴 CAJA no trae NINGUNA de las seis del expediente (primer candado)", () => {
  // El segundo candado es el ALCANCE (edu-expediente.test.ts): para caja el
  // recurso "cases" devuelve "none" aunque alguien le encienda estas keys a
  // mano. Un solo candado se abre por accidente; dos hay que abrirlos a
  // propósito.
  for (const k of KEYS_OLA_3) {
    assert.equal(hasEduPermission({ role: "CAJA" }, k), false, `CAJA no debería traer ${k}`);
  }
  // Y sigue entrando al panel y trabajando: recibe, agenda y cobra.
  assert.equal(hasEduPermission({ role: "CAJA" }, "inicio.view"), true);
  assert.equal(hasEduPermission({ role: "CAJA" }, "pacientes.view"), true);
  assert.equal(hasEduPermission({ role: "CAJA" }, "agenda.manage"), true);
});

test("DIRECCION, DOCENTE y ALUMNO traen las seis (lo que ven lo recorta el alcance)", () => {
  for (const rol of ["DIRECCION", "DOCENTE", "ALUMNO"] as EduRole[]) {
    for (const k of KEYS_OLA_3) {
      assert.equal(hasEduPermission({ role: rol }, k), true, `${rol} debería traer ${k}`);
    }
  }
});

test("el EXPEDIENTE salió de 'Próximamente' y NO tiene item de menú (vive en la ficha)", () => {
  const enMenu = new Set(EDU_NAV_ITEMS.map((i) => i.key));
  assert.equal(
    EDU_UPCOMING_AREAS.some((a) => a.key === "expediente"),
    false,
    "el expediente ya se entregó y sigue anunciado como Próximamente",
  );
  // Es la EXCEPCIÓN documentada a "un área está en el menú o está en
  // Próximamente": el expediente no es una pantalla suelta, vive dentro de
  // /instituto/pacientes/[id]. Un item de sidebar tendría que abrir una
  // pantalla que solo pregunta "¿de qué paciente?".
  assert.equal(enMenu.has("expediente"), false);
  assert.ok(enMenu.has("pacientes"), "y se llega desde Pacientes, que sí está en el menú");
});

test("el ORIGEN del paciente solo lo marcan caja y dirección", () => {
  // Decide el precio en la Ola 5: lo pone quien cobra o quien manda. Al
  // alumno se le PINTA su origen, deshabilitado.
  assert.equal(hasEduPermission({ role: "CAJA" }, "pacientes.origen"), true);
  assert.equal(hasEduPermission({ role: "DIRECCION" }, "pacientes.origen"), true);
  assert.equal(hasEduPermission({ role: "DOCENTE" }, "pacientes.origen"), false);
  assert.equal(hasEduPermission({ role: "ALUMNO" }, "pacientes.origen"), false);
});

test("los cuatro roles comparten agenda.view y NO ven lo mismo", () => {
  // El permiso abre la pantalla; el ALCANCE decide las filas. Que los
  // cuatro compartan la key es correcto y no afloja nada — lo que cada uno
  // ve lo fija edu-visibility.test.ts.
  for (const rol of EDU_ROLES) {
    assert.equal(hasEduPermission({ role: rol }, "agenda.view"), true, `${rol} sin agenda.view`);
  }
});

test("la Ola 2 sacó la agenda de 'Próximamente' y la puso en el menú", () => {
  const enMenu = new Set(EDU_NAV_ITEMS.map((i) => i.key));
  for (const key of ["mi-dia", "agenda", "pacientes", "sillones"]) {
    assert.ok(enMenu.has(key), `"${key}" se entregó y no está en el menú`);
  }
  assert.equal(
    EDU_UPCOMING_AREAS.some((a) => a.key === "agenda"),
    false,
    "la agenda existe y sigue anunciada como Próximamente",
  );
  // El tamizaje NO tiene item propio a propósito: se llega desde la
  // Agenda, que es donde está la persona cuando el paciente llega.
  assert.equal(enMenu.has("tamizaje"), false);
});

// ─────────────────────────────────────────────────────────────────────
// 1e · La key de la Ola 1B (el equipo)
//
// UNA sola key, y es la que faltaba para que el producto se pudiera usar:
// hasta esta ola no había forma de crear un alumno, un docente ni un
// cajero desde el panel.
// ─────────────────────────────────────────────────────────────────────

test("equipo.manage está en el catálogo, descrita en español y en un solo grupo", () => {
  assert.ok("equipo.manage" in EDU_ALL_PERMISSIONS, "falta equipo.manage en el catálogo");
  const desc = EDU_ALL_PERMISSIONS["equipo.manage"];
  assert.ok(desc && desc.length > 8, `equipo.manage sin descripción usable: ${desc}`);
  assert.notEqual(desc, "equipo.manage");
  const grupos = EDU_PERMISSION_GROUPS.filter((g) => g.keys.includes("equipo.manage"));
  assert.equal(grupos.length, 1, "equipo.manage tiene que estar en EXACTAMENTE un grupo");
});

test("🔴 equipo.manage es SOLO de DIRECCION", () => {
  // Desde /instituto/equipo se puede crear una cuenta con rol DIRECCION, y
  // quien da el alta se queda con la contraseña temporal en la mano: darle
  // esta key a otro rol por defecto sería regalar la llave de la escuela.
  assert.equal(hasEduPermission({ role: "DIRECCION" }, "equipo.manage"), true);
  for (const rol of ["DOCENTE", "ALUMNO", "CAJA"] as EduRole[]) {
    assert.equal(
      hasEduPermission({ role: rol }, "equipo.manage"),
      false,
      `${rol} no debería poder crear cuentas`,
    );
  }
});

test("el EQUIPO tiene item de menú y no está anunciado como Próximamente", () => {
  const enMenu = new Set(EDU_NAV_ITEMS.map((i) => i.key));
  assert.ok(enMenu.has("equipo"), "la pantalla existe y no está en el menú");
  assert.equal(
    EDU_UPCOMING_AREAS.some((a) => a.key === "equipo"),
    false,
  );
  const item = EDU_NAV_ITEMS.find((i) => i.key === "equipo");
  assert.equal(item?.permission, "equipo.manage");
  // Va en ADMINISTRACIÓN: aquí se dan de alta las cuentas de TODO el
  // instituto (también las de caja), no solo las del padrón académico.
  assert.equal(item?.section, "administracion");
});

// ─────────────────────────────────────────────────────────────────────
// 1f · Las cinco keys de la Ola 6 (evaluación académica)
//
// La línea de esta ola: VER y CALIFICAR son dos keys distintas. El alumno
// lleva la primera y no la segunda — ve su calificación y no la escribe.
// ─────────────────────────────────────────────────────────────────────

const KEYS_OLA_6: EduPermissionKey[] = [
  "rubricas.manage",
  "requisitos.manage",
  "evaluacion.view",
  "evaluacion.grade",
  "traspaso.manage",
];

test("las cinco keys de la Ola 6 están en el catálogo, descritas en español", () => {
  for (const k of KEYS_OLA_6) {
    assert.ok(k in EDU_ALL_PERMISSIONS, `falta ${k} en el catálogo`);
    const desc = EDU_ALL_PERMISSIONS[k];
    assert.ok(desc && desc.length > 8, `${k} sin descripción usable: ${desc}`);
    assert.notEqual(desc, k, `${k} se describe con su propia key`);
  }
});

test("las cinco viven en el grupo de evaluación, y cada una en uno solo", () => {
  const grupo = EDU_PERMISSION_GROUPS.find((g) => g.keys.includes("evaluacion.view"));
  assert.ok(grupo, "no hay grupo para evaluacion.view");
  for (const k of KEYS_OLA_6) {
    assert.ok(grupo.keys.includes(k), `${k} no está en el grupo "${grupo.title}"`);
    assert.equal(
      EDU_PERMISSION_GROUPS.filter((g) => g.keys.includes(k)).length,
      1,
      `${k} aparece en más de un grupo`,
    );
  }
});

test("🔴 el ALUMNO VE su evaluación y NO la califica", () => {
  // Es toda la ola en dos líneas. Si "view" y "grade" fueran una sola
  // key, o el alumno no vería su propia evaluación —que es lo que la hace
  // servir para algo— o se la podría escribir.
  assert.equal(hasEduPermission({ role: "ALUMNO" }, "evaluacion.view"), true);
  assert.equal(hasEduPermission({ role: "ALUMNO" }, "evaluacion.grade"), false);
});

test("🔴 el ALUMNO no lleva NINGUNA otra key de la ola", () => {
  for (const k of ["rubricas.manage", "requisitos.manage", "traspaso.manage"] as EduPermissionKey[]) {
    assert.equal(hasEduPermission({ role: "ALUMNO" }, k), false, `un alumno no debería tener ${k}`);
  }
});

test("el DOCENTE califica y traspasa, pero NO diseña la rúbrica ni el plan", () => {
  assert.equal(hasEduPermission({ role: "DOCENTE" }, "evaluacion.view"), true);
  assert.equal(hasEduPermission({ role: "DOCENTE" }, "evaluacion.grade"), true);
  assert.equal(hasEduPermission({ role: "DOCENTE" }, "traspaso.manage"), true);
  // Si cada docente pudiera editar la rúbrica con la que se le mide a su
  // alumno, la rúbrica dejaría de ser un criterio compartido.
  assert.equal(hasEduPermission({ role: "DOCENTE" }, "rubricas.manage"), false);
  assert.equal(hasEduPermission({ role: "DOCENTE" }, "requisitos.manage"), false);
});

test("DIRECCION lleva las cinco; CAJA ninguna", () => {
  for (const k of KEYS_OLA_6) {
    assert.equal(hasEduPermission({ role: "DIRECCION" }, k), true, `dirección sin ${k}`);
    assert.equal(hasEduPermission({ role: "CAJA" }, k), false, `caja no debería tener ${k}`);
  }
});

test("la EVALUACIÓN salió de 'Próximamente' y está en el menú", () => {
  const enMenu = new Set(EDU_NAV_ITEMS.map((i) => i.key));
  assert.equal(
    EDU_UPCOMING_AREAS.some((a) => a.key === "evaluacion"),
    false,
    "la evaluación ya se entregó y sigue anunciada como Próximamente",
  );
  for (const key of ["evaluacion", "rubricas", "requisitos"]) {
    assert.ok(enMenu.has(key), `"${key}" se entregó y no está en el menú`);
  }
  // La BITÁCORA no tiene item propio: se llega desde Evaluación, que es
  // donde uno está cuando se pregunta por un alumno concreto.
  assert.equal(enMenu.has("bitacora"), false);

  // Y con esto la lista de "Próximamente" se quedó vacía: ya no hay
  // ninguna área anunciada que no exista. La pantalla de Inicio deja de
  // pintar el bloque entero (ver src/app/instituto/(panel)/inicio/page.tsx).
  assert.equal(EDU_UPCOMING_AREAS.length, 0);
});

test("Evaluación va en ACADÉMICO; rúbricas y requisitos en ADMINISTRACIÓN", () => {
  const item = (k: string) => EDU_NAV_ITEMS.find((i) => i.key === k);
  assert.equal(item("evaluacion")?.section, "academico");
  assert.equal(item("evaluacion")?.permission, "evaluacion.view");
  // Configuración: se capturan al arrancar el ciclo y casi no se vuelven
  // a tocar, igual que los tarifarios.
  assert.equal(item("rubricas")?.section, "administracion");
  assert.equal(item("rubricas")?.permission, "rubricas.manage");
  assert.equal(item("requisitos")?.section, "administracion");
  assert.equal(item("requisitos")?.permission, "requisitos.manage");
});


// ─────────────────────────────────────────────────────────────────────
// 1g · Las dos keys de la Ola 9 (WhatsApp y recordatorios)
//
// La línea de esta ola: CONFIGURAR no es MANDAR. Las dos keys son de la
// conexión del instituto —entregar un token que manda en su nombre,
// encender un gasto que Meta le cobra a su tarjeta— y solo las tiene la
// dirección. Mandarle un documento a un paciente se abre con el permiso
// DEL DOCUMENTO: la carta con "consentimientos.view" (la tienen los
// cuatro roles) y el recibo con "caja.view" más el alcance del dinero.
// ─────────────────────────────────────────────────────────────────────

const KEYS_OLA_9: EduPermissionKey[] = ["whatsapp.view", "whatsapp.manage"];

test("las dos keys de la Ola 9 están en el catálogo, descritas en español", () => {
  for (const k of KEYS_OLA_9) {
    assert.ok(k in EDU_ALL_PERMISSIONS, `falta ${k} en el catálogo`);
    const desc = EDU_ALL_PERMISSIONS[k];
    assert.ok(desc && desc.length > 8, `${k} sin descripción usable: ${desc}`);
    assert.notEqual(desc, k, `${k} se describe con su propia key`);
  }
});

test("las dos keys de WhatsApp son SOLO de la dirección", () => {
  for (const k of KEYS_OLA_9) {
    assert.equal(
      hasEduPermission({ role: "DIRECCION", permissionsOverride: [] }, k),
      true,
      `la dirección necesita ${k}`,
    );
    for (const rol of ["DOCENTE", "ALUMNO", "CAJA"] as EduRole[]) {
      assert.equal(
        hasEduPermission({ role: rol, permissionsOverride: [] }, k),
        false,
        `${rol} no puede llevar ${k}: conectar la cuenta del instituto y encender un gasto que Meta le cobra a la escuela es una decisión de dirección`,
      );
    }
  }
});

/**
 * 🔴 LA DECISIÓN DE LA OLA, EN UNA PRUEBA. Si mandar exigiera
 * "whatsapp.manage", caja no podría entregar un recibo y el alumno no
 * podría mandarle al paciente la carta que va a firmar en el sillón — que
 * es justo para lo que sirve. Por eso el permiso de mandar es el del
 * DOCUMENTO y no el de la conexión.
 */
test("CAJA y ALUMNO pueden mandar documentos sin tener ninguna key de WhatsApp", () => {
  const caja = { role: "CAJA" as EduRole, permissionsOverride: [] };
  const alumno = { role: "ALUMNO" as EduRole, permissionsOverride: [] };

  // Caja entrega el recibo en el mostrador: lleva caja.view.
  assert.equal(hasEduPermission(caja, "caja.view"), true);
  assert.equal(hasEduPermission(caja, "whatsapp.manage"), false);

  // El alumno explica y manda la carta en el sillón: lleva
  // consentimientos.view. Y NO lleva caja.view — no manda nada de dinero.
  assert.equal(hasEduPermission(alumno, "consentimientos.view"), true);
  assert.equal(hasEduPermission(alumno, "caja.view"), false);
  assert.equal(hasEduPermission(alumno, "whatsapp.view"), false);

  // Los cuatro roles pueden mandar la carta; solo dos pueden mandar dinero.
  const conCarta = EDU_ROLES.filter((r) =>
    hasEduPermission({ role: r, permissionsOverride: [] }, "consentimientos.view"),
  );
  assert.deepEqual([...conCarta].sort(), ["ALUMNO", "CAJA", "DIRECCION", "DOCENTE"]);
  const conRecibo = EDU_ROLES.filter((r) =>
    hasEduPermission({ role: r, permissionsOverride: [] }, "caja.view"),
  );
  assert.deepEqual([...conRecibo].sort(), ["CAJA", "DIRECCION"]);
});

test("WhatsApp va en ADMINISTRACIÓN, con su propio grupo de permisos", () => {
  const item = EDU_NAV_ITEMS.find((i) => i.key === "whatsapp");
  assert.ok(item, "falta el item de menú de WhatsApp");
  assert.equal(item?.section, "administracion");
  assert.equal(item?.permission, "whatsapp.view");
  assert.equal(EDU_NAV_LABELS.whatsapp, "WhatsApp");

  const grupo = EDU_PERMISSION_GROUPS.find((g) => g.title === "WhatsApp");
  assert.ok(grupo, "las dos keys tienen que poder encenderse desde la pantalla de permisos");
  assert.deepEqual([...(grupo?.keys ?? [])].sort(), ["whatsapp.manage", "whatsapp.view"]);
});

// ─────────────────────────────────────────────────────────────────────
// 1i · La key de la Ola 7 (el panel de dirección)
//
//      🔴 Es la PRIMERA key del catálogo que lleva UN SOLO rol, y estas
//      pruebas existen para que siga siéndolo: el día que alguien le
//      agregue "direccion.panel" al default del docente "para que el
//      coordinador lo vea", esto se pone rojo.
// ─────────────────────────────────────────────────────────────────────

test("la key de la Ola 7 está en el catálogo, descrita en español", () => {
  assert.ok("direccion.panel" in EDU_ALL_PERMISSIONS, "falta direccion.panel en el catálogo");
  const desc = EDU_ALL_PERMISSIONS["direccion.panel"];
  assert.ok(desc && desc.length > 8, `direccion.panel sin descripción usable: ${desc}`);
  assert.notEqual(desc, "direccion.panel");
});

test("direccion.panel vive en un grupo PROPIO (no se tilda de pasada con otro bloque)", () => {
  const grupos = EDU_PERMISSION_GROUPS.filter((g) => g.keys.includes("direccion.panel"));
  assert.equal(grupos.length, 1, "direccion.panel tiene que estar en exactamente un grupo");
  assert.deepEqual(
    grupos[0].keys,
    ["direccion.panel"],
    "el grupo de dirección es de UNA sola casilla: metida dentro de otro bloque se encendería sin querer",
  );
});

test("🔴 SOLO DIRECCION lleva direccion.panel por defecto", () => {
  assert.equal(hasEduPermission({ role: "DIRECCION" }, "direccion.panel"), true);
  for (const rol of ["DOCENTE", "ALUMNO", "CAJA"] as EduRole[]) {
    assert.equal(
      hasEduPermission({ role: rol }, "direccion.panel"),
      false,
      `${rol} no debería ver el tablero de dirección`,
    );
  }
});

/**
 * Las keys que lleva UN SOLO rol son las que deciden quién manda en la
 * escuela, y todas son de DIRECCION. La lista va escrita a mano a
 * propósito: agregar una más es una decisión de producto, no un descuido,
 * y esta prueba obliga a escribirla aquí.
 *
 * Ya cobró una pieza: al rebasar esta ola sobre la Ola 11 (las sedes) la
 * lista pasó de ocho a diez, y hubo que decidir a mano que `sedes.view` y
 * `sedes.manage` son de dirección y de nadie más. Eso es exactamente para
 * lo que existe: dos olas que se cruzan no se ponen de acuerdo solas.
 *
 * Y volvió a cobrar en la integración de las olas 8, 9 y 10: pasó de diez
 * a dieciséis, porque el cupo de IA, la conexión de WhatsApp y las dos
 * llaves duras de facturación (cancelar y configurar) son decisiones del
 * contrato o del SAT — de dirección y de nadie más, cada una por su ola.
 */
test("las keys de UN SOLO rol son todas de DIRECCION, y son estas dieciséis", () => {
  const cuantosRoles = (k: EduPermissionKey) =>
    EDU_ROLES.filter((r) => EDU_ROLE_DEFAULTS[r].includes(k)).length;

  const deUnoSolo = EDU_ALL_PERMISSION_KEYS.filter((k) => cuantosRoles(k) === 1);
  assert.deepEqual(
    deUnoSolo,
    [
      "padron.manage",
      "supervision.assign",
      "sillones.manage",
      "tarifarios.manage",
      "equipo.manage",
      "rubricas.manage",
      "requisitos.manage",
      // Ola 11 · administrar las sedes: darlas de alta y repartir quién
      // entra a cada una. Ojo: NO hacen falta para USAR las sedes ni para
      // cambiar de sede en la barra superior — eso lo decide el ACCESO, que
      // no es un permiso.
      "sedes.view",
      "sedes.manage",
      // Ola 7 · el tablero de dirección.
      "direccion.panel",
      // Ola 8 · el cupo de IA del contrato: verlo y administrarlo es de
      // quien administra el contrato. El alumno ve SU consumo por otra vía.
      "ia.view",
      "ia.manage",
      // Ola 9 · conectar el WhatsApp del instituto y sus plantillas. Son de
      // CONFIGURAR, no de mandar: mandar se abre con el permiso del
      // documento.
      "whatsapp.view",
      "whatsapp.manage",
      // Ola 10 · cancelar ante el SAT y capturar los datos fiscales. Las
      // otras dos de facturación (view/emit) las comparte con CAJA y por
      // eso no aparecen aquí.
      "facturacion.cancel",
      "facturacion.config",
    ],
    `cambió la lista de keys de un solo rol: ${deUnoSolo.join(", ")}`,
  );

  // Y ese único rol es DIRECCION en las dieciséis: si mañana una de ellas
  // quedara solo en manos del docente, sería otro producto.
  for (const k of deUnoSolo) {
    assert.equal(hasEduPermission({ role: "DIRECCION" }, k), true, `${k} no es de dirección`);
  }
});

test("el item «Dirección» está en el menú, exige su key y va en OPERACIÓN", () => {
  const item = EDU_NAV_ITEMS.find((i) => i.key === "direccion");
  assert.ok(item, "falta el item de menú de dirección");
  assert.equal(item?.permission, "direccion.panel");
  // Operación y no Administración: es lo que el director abre cada mañana,
  // no algo que se toca una vez al año.
  assert.equal(item?.section, "operacion");
  assert.equal(item?.href, "/instituto/direccion");
  assert.ok(EDU_NAV_LABELS.direccion, "el item de dirección no tiene etiqueta");
  assert.equal(
    EDU_UPCOMING_AREAS.some((a) => a.key === "direccion"),
    false,
    "el panel de dirección ya existe y no puede seguir anunciado como Próximamente",
  );
});

test("el item «Dirección» va SEGUNDO, justo después de Inicio", () => {
  // La posición no es decorativa: es la pantalla que se abre primero y la
  // que se proyecta en la junta. Enterrada abajo se abriría el día que
  // alguien la buscara.
  assert.equal(EDU_NAV_ITEMS[0]?.key, "inicio");
  assert.equal(EDU_NAV_ITEMS[1]?.key, "direccion");
});

test("un permiso NUEVO no le llega solo a quien ya tiene override (también el de la Ola 7)", () => {
  const conOverrideViejo = {
    role: "DIRECCION" as EduRole,
    permissionsOverride: ["inicio.view", "evaluacion.view"],
  };
  assert.equal(hasEduPermission(conOverrideViejo, "direccion.panel"), false);
});

// ─────────────────────────────────────────────────────────────────────
// 2 · Semántica del override
// ─────────────────────────────────────────────────────────────────────

test("override vacío o ausente cae al default del rol (nunca deniega todo)", () => {
  for (const rol of EDU_ROLES) {
    assert.deepEqual(
      getEduEffectivePermissions({ role: rol, permissionsOverride: [] }),
      EDU_ROLE_DEFAULTS[rol],
    );
    assert.deepEqual(
      getEduEffectivePermissions({ role: rol, permissionsOverride: null }),
      EDU_ROLE_DEFAULTS[rol],
    );
    assert.deepEqual(getEduEffectivePermissions({ role: rol }), EDU_ROLE_DEFAULTS[rol]);
  }
});

/**
 * El override REEMPLAZA: el efectivo es EXACTAMENTE el override saneado, y
 * ninguna key del default que no esté tildada se cuela.
 *
 * La Ola 0 dejó escrito que con UNA sola key "reemplazar" y "sumar" daban
 * el mismo resultado y que la prueba empezaría a morder sola en cuanto
 * hubiera una segunda. Un merge accidental (por ejemplo, un
 * `[...default, ...override]`) falla aquí en el primer subconjunto que no
 * contenga inicio.view.
 *
 * ⚠️ Con las nueve keys de la Ola 2 el catálogo llegó a catorce, y recorrer
 * TODOS los subconjuntos serían 16 383 por rol — 65 532 comprobaciones para
 * demostrar lo mismo. Se recorren los subconjuntos de una MUESTRA fija de
 * cinco keys (una por grupo del catálogo, incluidas las dos que más se
 * confunden: pacientes.origen y agenda.manage) y, aparte, cada key del
 * catálogo entera contra un override que no la trae.
 */
test("el override REEMPLAZA al default: lo que no está tildado, no se tiene", () => {
  const subconjuntos = (keys: EduPermissionKey[]): EduPermissionKey[][] => {
    const out: EduPermissionKey[][] = [[]];
    for (const k of keys) for (const s of [...out]) out.push([...s, k]);
    return out.filter((s) => s.length > 0);
  };

  const MUESTRA: EduPermissionKey[] = [
    "inicio.view",
    "padron.manage",
    "pacientes.origen",
    "agenda.manage",
    "casos.assign",
  ];

  for (const rol of EDU_ROLES) {
    for (const sub of subconjuntos(MUESTRA)) {
      const efectivo = getEduEffectivePermissions({ role: rol, permissionsOverride: sub });
      assert.deepEqual(
        [...efectivo].sort(),
        [...sub].sort(),
        `${rol} con override ${JSON.stringify(sub)} recibió ${JSON.stringify(efectivo)} — se mergeó con el default`,
      );
      for (const k of EDU_ALL_PERMISSION_KEYS) {
        if (sub.includes(k)) continue;
        assert.equal(
          hasEduPermission({ role: rol, permissionsOverride: sub }, k),
          false,
          `${rol}: destildar ${k} no se lo quitó`,
        );
      }
    }
  }
});

test("keys inválidas se descartan sin romper las válidas", () => {
  assert.deepEqual(sanitizeEduPermissionKeys(["inicio.view"]), ["inicio.view"]);
  assert.deepEqual(sanitizeEduPermissionKeys(["clave.inventada", "*", ""]), []);
  // ⚠️ Ojo al elegir la key "inventada": "agenda.view" servía en la Ola 1A
  // y dejó de servir en la Ola 2, cuando entró al catálogo de verdad. Se
  // usa una que no va a existir nunca.
  assert.deepEqual(
    sanitizeEduPermissionKeys(["clave.inventada", "inicio.view", "agenda.borrar-todo"]),
    ["inicio.view"],
  );
  // Repetidas → una sola vez.
  assert.deepEqual(sanitizeEduPermissionKeys(["inicio.view", "inicio.view"]), ["inicio.view"]);
  // Basura que no es un arreglo de strings.
  assert.deepEqual(sanitizeEduPermissionKeys(null), []);
  assert.deepEqual(sanitizeEduPermissionKeys("inicio.view"), []);
  assert.deepEqual(sanitizeEduPermissionKeys([1, {}, null, undefined]), []);

  // Y lo mismo dentro del resolvedor: un override que solo trae basura NO
  // deja a nadie sin permisos — cae al default del rol.
  assert.deepEqual(
    getEduEffectivePermissions({ role: "ALUMNO", permissionsOverride: ["clave.inventada"] }),
    EDU_ROLE_DEFAULTS.ALUMNO,
  );
});

test("hasEduPermission no adivina: un rol suelto o un usuario nulo se niegan", () => {
  // Si llega algo casteado (`ctx.role as any`), se niega en vez de caer al
  // default de un rol que nadie comprobó.
  assert.equal(hasEduPermission("DIRECCION" as any, "inicio.view"), false);
  assert.equal(hasEduPermission(null as any, "inicio.view"), false);
  // Un rol que no existe en el catálogo de defaults → sin permisos.
  assert.equal(hasEduPermission({ role: "RECTOR" as any }, "inicio.view"), false);
});

test("assertEduPermission lanza EduForbiddenError con la key que faltó", () => {
  const ctx = { role: "ALUMNO" as EduRole, user: { permissionsOverride: [] as string[] } };
  assert.doesNotThrow(() => assertEduPermission(ctx, "inicio.view"));

  // Un override que sanea a "solo lo inventado" no concede nada nuevo, así
  // que forzamos el caso negativo con un rol desconocido.
  const ajeno = { role: "RECTOR" as unknown as EduRole, user: { permissionsOverride: [] as string[] } };
  assert.throws(
    () => assertEduPermission(ajeno, "inicio.view"),
    (err: unknown) => {
      assert.ok(err instanceof EduForbiddenError);
      assert.equal((err as EduForbiddenError).permission, "inicio.view");
      assert.match((err as Error).message, /inicio\.view/);
      return true;
    },
  );
});

// ─────────────────────────────────────────────────────────────────────
// 3 · Ningún interruptor muerto (la regla del catálogo)
//     Cada key tiene que leerla ALGUIEN del vertical fuera del catálogo, y
//     al menos uno de esos lectores tiene que ser servidor (página, layout,
//     route handler o lib) — no solo el sidebar, que esconde pero no cierra.
// ─────────────────────────────────────────────────────────────────────

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const CATALOGO = join(REPO_ROOT, "src", "lib", "edu", "permissions.ts");
const RAICES_DEL_VERTICAL = [
  join(REPO_ROOT, "src", "app", "instituto"),
  join(REPO_ROOT, "src", "app", "api", "instituto"),
  join(REPO_ROOT, "src", "components", "edu"),
  join(REPO_ROOT, "src", "lib", "edu"),
];
const ARCHIVOS_SUELTOS = [join(REPO_ROOT, "src", "lib", "edu-auth.ts")];

function recorrer(dir: string, out: string[]): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name === ".next" || name === "__tests__") continue;
      recorrer(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

const fuentes = (() => {
  const files = [...ARCHIVOS_SUELTOS.filter(existsSync)];
  for (const raiz of RAICES_DEL_VERTICAL) recorrer(raiz, files);
  return files
    .filter((f) => f !== CATALOGO)
    .map((f) => ({ rel: relative(REPO_ROOT, f).split(sep).join("/"), text: readFileSync(f, "utf8") }));
})();

function lectoresDe(key: string): string[] {
  const re = new RegExp(`["'\`]${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`]`);
  return fuentes.filter((s) => re.test(s.text)).map((s) => s.rel);
}

/** ¿Ese archivo EXIGE de verdad (servidor), o solo esconde (cliente)? */
function esServidor(rel: string): boolean {
  return (
    rel.startsWith("src/app/api/instituto/") ||
    rel.startsWith("src/lib/edu/") ||
    rel === "src/lib/edu-auth.ts" ||
    /^src\/app\/instituto\/.*\/(page|layout)\.tsx?$/.test(rel)
  );
}

test("el escáner encuentra el vertical (si no, los dos tests de abajo pasarían en falso)", () => {
  assert.ok(fuentes.length > 0, "no se encontró un solo archivo del vertical: revisa las rutas del test");
});

test("cada key del catálogo la lee ALGUIEN fuera de permissions.ts (ningún interruptor muerto)", () => {
  const muertas = EDU_ALL_PERMISSION_KEYS.filter((k) => lectoresDe(k).length === 0);
  assert.deepEqual(
    muertas,
    [],
    `keys que no lee nadie: ${muertas.join(", ")} — o se cablean, o se sacan del catálogo`,
  );
});

test("cada key la exige un archivo de SERVIDOR (esconder el menú no es cerrar la puerta)", () => {
  const soloUi = EDU_ALL_PERMISSION_KEYS.filter(
    (k) => lectoresDe(k).filter(esServidor).length === 0,
  );
  assert.deepEqual(
    soloUi,
    [],
    `keys que solo lee la UI: ${soloUi.join(", ")} — falta el guard en la página o el endpoint`,
  );
});
