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

  // ALUMNO: tres permisos de LECTURA, y todo lo que lea va recortado a lo
  // suyo por el ALCANCE, no por el permiso.
  assert.deepEqual(
    [...EDU_ROLE_DEFAULTS.ALUMNO].sort(),
    ["agenda.view", "casos.view", "inicio.view", "pacientes.view"],
  );
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
