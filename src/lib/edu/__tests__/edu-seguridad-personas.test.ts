/**
 * WS2-T1 · Ola C·1 — SEGURIDAD, CUENTAS Y PERSONAS del instituto.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-seguridad-personas.test.ts
 *
 * ═══════════════════════════════════════════════════════════════════════
 * QUÉ FIJA ESTE ARCHIVO, Y CÓMO SE PRUEBA SIN BASE DE DATOS
 *
 * El vertical no tiene base de pruebas: las pruebas de `test:edu` son de
 * módulos PUROS o de LECTURA DEL FUENTE, y eso es exactamente por lo que
 * ninguno de estos cinco hallazgos tenía quien lo detectara. Así que aquí
 * hay dos clases de prueba, y cada una dice cuál es:
 *
 *  · EJECUTADAS — la decisión vive en un módulo puro a propósito
 *    (equipo-core.ts, api-guard-core.ts, estudiante-core.ts) y se corre de
 *    verdad: quién puede tocar a quién, qué deja sin administración al
 *    instituto, qué se valida al corregir a una persona.
 *  · DE FUENTE — la regla vive dentro de una función que importa prisma o
 *    Supabase y no se puede cargar sin Postgres. Se lee el archivo y se
 *    comprueba que la llamada esté puesta, con los comentarios QUITADOS: un
 *    archivo se juzga por lo que HACE, no por lo que dice su prosa. Sin esa
 *    limpieza, un comentario que mencione `updateMany` haría pasar la
 *    prueba de un archivo que no lo llama.
 *
 * Los cinco 🔴 que cubre:
 *   H-03  la contraseña temporal cierra también la API (y el recorrido de
 *         las 110 rutas de src/app/api/instituto)
 *   H-16  escalada: quién puede tocar a una cuenta de DIRECCION
 *   H-04  corregir nombre, correo, teléfono y ROL + restablecer contraseña
 *   H-02  la baja del padrón apaga la cuenta en la MISMA transacción
 *   H-14  el docente llega a Valoración desde Mi día
 * ═══════════════════════════════════════════════════════════════════════
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  EDU_API_RUTAS_SIN_GUARD,
  EDU_TEMP_PASSWORD_ERROR,
  eduMensajeP2002,
  eduRutaSinGuardMotivo,
} from "../api-guard-core";
import { eduPadronPagina, parseEduPadronFilters } from "../padron-core";
import {
  EDU_ULTIMA_DIRECCION_ERROR,
  eduCambioDeRolAviso,
  eduOverrideDejaSinAdministracion,
  eduTeamGuardDireccion,
  eduTeamPersonaEditInput,
  parseEduTeamPaste,
  type EduTeamAccion,
} from "../equipo-core";
import { eduFichaFecha } from "../estudiante-core";
import { EDU_ROLES, type EduRole } from "../types";
import { EDU_ROLE_DEFAULTS } from "../permissions";

const RAIZ = join(__dirname, "..", "..", "..", "..");

function crudo(...tramos: string[]): string {
  return readFileSync(join(RAIZ, ...tramos), "utf8");
}

/** El archivo, SIN comentarios: se juzga por lo que hace, no por lo que dice. */
function fuente(...tramos: string[]): string {
  return crudo(...tramos)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");
}

/** El cuerpo de UNA función exportada, para no acusar al archivo entero. */
function cuerpoDe(src: string, nombre: string): string {
  const desde = src.indexOf(`export async function ${nombre}`);
  assert.notEqual(desde, -1, `no se encontró ${nombre}: ¿la renombraron?`);
  const siguiente = src.indexOf("\nexport ", desde + 1);
  return src.slice(desde, siguiente === -1 ? undefined : siguiente);
}

// ═══════════════════════════════════════════════════════════════════════
// 1 · H-03 · LA CONTRASEÑA TEMPORAL CIERRA TAMBIÉN LA API
//
// El gate de `mustChangePassword` vivía SOLO en el layout del panel, y un
// layout no protege una API: con una temporal en la mano —y la dirección se
// queda con 40 en una tarde de altas— se podía llamar directo a
// POST /api/instituto/pacientes/{id}/expediente y dejar una nota clínica
// firmada con el nombre de un alumno que nunca ha entrado al sistema.
// ═══════════════════════════════════════════════════════════════════════

/** Todas las `route.ts` bajo src/app/api/instituto, como ruta relativa. */
function rutasDeApiInstituto(): string[] {
  const base = join(RAIZ, "src", "app", "api", "instituto");
  const salida: string[] = [];
  const caminar = (dir: string) => {
    for (const entrada of readdirSync(dir)) {
      const completo = join(dir, entrada);
      if (statSync(completo).isDirectory()) caminar(completo);
      else if (entrada === "route.ts") {
        salida.push(
          relative(base, completo).split(sep).slice(0, -1).join("/"),
        );
      }
    }
  };
  caminar(base);
  return salida.sort();
}

test("🔴 H-03: TODAS las rutas de src/app/api/instituto pasan por eduApiGuard, o están declaradas con su motivo", () => {
  const rutas = rutasDeApiInstituto();
  // Si el descubrimiento devuelve cero, esta prueba pasaría sin probar nada.
  assert.ok(rutas.length > 50, `se descubrieron ${rutas.length} rutas: ¿se movió la carpeta?`);

  const sinDeclarar: string[] = [];
  for (const ruta of rutas) {
    const src = fuente("src", "app", "api", "instituto", ...ruta.split("/"), "route.ts");
    if (/\beduApiGuard\s*\(/.test(src)) continue;
    if (eduRutaSinGuardMotivo(ruta)) continue;
    sinDeclarar.push(ruta);
  }

  assert.deepEqual(
    sinDeclarar,
    [],
    `estas rutas ni pasan por eduApiGuard ni están en EDU_API_RUTAS_SIN_GUARD (api-guard-core.ts): ${sinDeclarar.join(", ")}`,
  );
});

test("🔴 H-03: la lista de exentas no tiene entradas fantasma (todas existen y ninguna usa el guardia)", () => {
  for (const ruta of Object.keys(EDU_API_RUTAS_SIN_GUARD)) {
    const archivo = join(RAIZ, "src", "app", "api", "instituto", ...ruta.split("/"), "route.ts");
    assert.ok(existsSync(archivo), `EDU_API_RUTAS_SIN_GUARD declara ${ruta} y ese archivo no existe`);
    const src = fuente("src", "app", "api", "instituto", ...ruta.split("/"), "route.ts");
    assert.equal(
      /\beduApiGuard\s*\(/.test(src),
      false,
      `${ruta} está declarada como exenta pero SÍ usa eduApiGuard: quítala de la lista`,
    );
    assert.ok(
      EDU_API_RUTAS_SIN_GUARD[ruta].length > 40,
      `la exención de ${ruta} no explica por qué`,
    );
  }
});

test("🔴 H-03: la allowlist MÍNIMA es cambiar contraseña, cerrar sesión y el sí/no del login", () => {
  // Las tres de auth/ son la salida de la temporal. Si alguien añadiera una
  // cuarta ruta de auth sin guardia, esta prueba lo diría.
  const deAuth = Object.keys(EDU_API_RUTAS_SIN_GUARD)
    .filter((r) => r.startsWith("auth/"))
    .sort();
  assert.deepEqual(deAuth, ["auth/cambiar-contrasena", "auth/logout", "auth/session"]);

  // Y las otras dos exentas no son del panel: una es pública (el paciente
  // firma su carta) y la otra la llama el cron.
  const resto = Object.keys(EDU_API_RUTAS_SIN_GUARD)
    .filter((r) => !r.startsWith("auth/"))
    .sort();
  assert.deepEqual(resto, ["consentimientos/publico/[token]", "cron/recordatorios"]);
});

test("🔴 H-03 (fuente): eduApiGuard corta con 403 por mustChangePassword ANTES de mirar el permiso", () => {
  const src = fuente("src", "lib", "edu", "api-guard.ts");
  const cuerpo = cuerpoDe(src, "eduApiGuard");

  assert.match(
    cuerpo,
    /ctx\.user\.mustChangePassword/,
    "eduApiGuard no lee mustChangePassword: el gate volvió a quedarse solo en el layout",
  );
  assert.match(cuerpo, /EDU_TEMP_PASSWORD_ERROR/);

  const iBandera = cuerpo.indexOf("mustChangePassword");
  const iPermiso = cuerpo.indexOf("assertEduPermission");
  assert.notEqual(iPermiso, -1);
  assert.ok(
    iBandera < iPermiso,
    "el corte por contraseña temporal tiene que ir ANTES del permiso: no es qué puede hacer la cuenta, es que la cuenta todavía no es de quien dice ser",
  );

  // Y el 401 de sesión sigue yendo primero que todo.
  assert.ok(cuerpo.indexOf("getEduContext") < iBandera);
});

test("H-03: el mensaje de la temporal dice QUÉ hacer, no qué falló", () => {
  assert.match(EDU_TEMP_PASSWORD_ERROR, /Cambiar contraseña/);
  assert.equal(/error|fall|403|token/i.test(EDU_TEMP_PASSWORD_ERROR), false);
});

// ═══════════════════════════════════════════════════════════════════════
// 2 · H-107 · EL CHOQUE DE ÍNDICE ÚNICO SE LEE
// ═══════════════════════════════════════════════════════════════════════

test("H-107: un P2002 se traduce a un texto que una persona puede arreglar", () => {
  // Prisma manda unas veces la lista de columnas y otras el nombre del
  // índice: las dos formas tienen que dar el mismo mensaje.
  assert.match(eduMensajeP2002(["institutionId", "matricula"]), /matrícula/i);
  assert.match(eduMensajeP2002("edu_students_institutionId_matricula_key"), /matrícula/i);
  assert.match(eduMensajeP2002(["institutionId", "code"]), /clave/i);
  assert.match(eduMensajeP2002(["institutionId", "programId", "name"]), /nombre/i);
  assert.match(eduMensajeP2002(["supabaseId", "institutionId"]), /correo/i);

  // Lo que no reconoce NO se inventa: dice lo único que se sabe seguro.
  const generico = eduMensajeP2002(undefined);
  assert.match(generico, /Alguien más acaba de guardar/);
  assert.equal(/matrícula|folio|clave/i.test(generico), false);
});

test("H-107 (fuente): eduApiError mapea P2002 a 409 y no al 500 genérico", () => {
  const src = fuente("src", "lib", "edu", "api-guard.ts");
  assert.match(src, /P2002/);
  assert.match(src, /eduMensajeP2002/);
  const i2002 = src.indexOf("P2002");
  const i500 = src.indexOf("No se pudo completar la operación");
  assert.ok(i2002 < i500, "el P2002 tiene que atraparse ANTES de caer al 500 genérico");
});

// ═══════════════════════════════════════════════════════════════════════
// 3 · H-16 · LA ESCALADA, CERRADA
// ═══════════════════════════════════════════════════════════════════════

const ACCIONES: EduTeamAccion[] = [
  "crear",
  "baja",
  "reactivar",
  "permisos",
  "datos",
  "contrasena",
];

test("🔴 H-16: solo una DIRECCION puede crear, dar de baja o editar a otra DIRECCION", () => {
  for (const accion of ACCIONES) {
    assert.equal(
      eduTeamGuardDireccion("DIRECCION", "DIRECCION", accion),
      null,
      `una dirección tiene que poder ${accion} sobre otra dirección`,
    );
    for (const actor of ["DOCENTE", "ALUMNO", "CAJA"] as EduRole[]) {
      const motivo = eduTeamGuardDireccion(actor, "DIRECCION", accion);
      assert.ok(
        motivo,
        `un ${actor} con equipo.manage prestado NO puede ${accion} sobre una dirección`,
      );
      assert.match(motivo!, /Dirección/);
    }
  }
});

test("H-16: el guardia NO opina sobre los otros tres roles — eso lo deciden los permisos", () => {
  for (const actor of EDU_ROLES) {
    for (const objetivo of EDU_ROLES.filter((r) => r !== "DIRECCION")) {
      for (const accion of ACCIONES) {
        assert.equal(
          eduTeamGuardDireccion(actor, objetivo, accion),
          null,
          `${actor} → ${objetivo} (${accion}) no es asunto de este guardia`,
        );
      }
    }
  }
});

test("🔴 H-16: a la ÚLTIMA dirección activa no se le puede quitar «Administrar el equipo»", () => {
  // El caso del informe: se le deja solo inicio.view y pierde equipo.manage,
  // que no puede recuperar porque para recuperarlo hace falta tenerlo.
  assert.equal(eduOverrideDejaSinAdministracion(["inicio.view"], true), true);
  assert.equal(
    eduOverrideDejaSinAdministracion(["inicio.view", "equipo.manage"], true),
    false,
    "si conserva equipo.manage puede deshacerlo ella misma: eso sí se permite",
  );
  // Con otra dirección activa, la cadena todavía tiene salida.
  assert.equal(eduOverrideDejaSinAdministracion(["inicio.view"], false), false);
});

test("H-16: restaurar el rol SIEMPRE es una salida (el default de DIRECCION lleva equipo.manage)", () => {
  assert.ok(
    EDU_ROLE_DEFAULTS.DIRECCION.includes("equipo.manage"),
    "si DIRECCION dejara de traer equipo.manage por defecto, «Restaurar el rol» dejaría de ser la salida de emergencia y esta regla se quedaría sin puerta trasera",
  );
  assert.equal(
    eduOverrideDejaSinAdministracion([...EDU_ROLE_DEFAULTS.DIRECCION], true),
    false,
  );
});

test("H-16: el mensaje de la última dirección dice qué hacer antes de recortarle nada", () => {
  assert.match(EDU_ULTIMA_DIRECCION_ERROR, /Da de alta a otra dirección/i);
});

test("🔴 H-16 (fuente): las cinco escrituras de equipo pasan por eduTeamGuardDireccion", () => {
  const src = fuente("src", "lib", "edu", "equipo.ts");
  for (const fn of [
    "createEduTeamMember",
    "setEduTeamMemberActive",
    "setEduTeamMemberPermissions",
    "updateEduTeamMember",
    "resetEduTeamMemberPassword",
  ]) {
    assert.match(
      cuerpoDe(src, fn),
      /eduTeamGuardDireccion\s*\(/,
      `${fn} no llama al guardia de DIRECCION: la escalada se vuelve a abrir por ahí`,
    );
  }
});

test("🔴 H-16 (fuente): setEduTeamMemberPermissions comprueba la ÚLTIMA dirección activa", () => {
  const cuerpo = cuerpoDe(fuente("src", "lib", "edu", "equipo.ts"), "setEduTeamMemberPermissions");
  assert.match(cuerpo, /eduOverrideDejaSinAdministracion/);
  // El conteo excluye a la propia persona: si se contara a sí misma, nunca
  // sería "la última" y la regla no dispararía jamás.
  assert.match(cuerpo, /NOT:\s*\{\s*id:\s*persona\.id\s*\}/);
  assert.match(cuerpo, /role:\s*"DIRECCION"/);
  assert.match(cuerpo, /isActive:\s*true/);
});

test("🔴 H-16 (fuente): nadie edita sus propios permisos ni se da de baja a sí mismo", () => {
  const src = fuente("src", "lib", "edu", "equipo.ts");
  for (const fn of ["setEduTeamMemberActive", "setEduTeamMemberPermissions"]) {
    assert.match(
      cuerpoDe(src, fn),
      /persona\.id === ctx\.eduUserId/,
      `${fn} dejó de comprobar el auto-bloqueo`,
    );
  }
  // Y tampoco se cambia el rol a sí mismo (H-04 + H-16).
  assert.match(cuerpoDe(src, "updateEduTeamMember"), /persona\.id === ctx\.eduUserId/);
});

test("🔴 H-16 (tercera llave, fuente): nadie se asigna estudiantes a sí mismo", () => {
  const cuerpo = cuerpoDe(fuente("src", "lib", "edu", "padron.ts"), "assignEduSupervisor");
  assert.match(
    cuerpo,
    /supervisor\.id === ctx\.eduUserId/,
    "assignEduSupervisor no compara el supervisor con quien llama: con supervision.assign prestado, un docente se asigna a cualquier alumno y gana su expediente",
  );
});

// ═══════════════════════════════════════════════════════════════════════
// 4 · H-04 · CORREGIR A UNA PERSONA DESPUÉS DEL ALTA
// ═══════════════════════════════════════════════════════════════════════

test("🔴 H-04: se corrigen los cinco campos del alta, uno a uno o todos juntos", () => {
  const r = eduTeamPersonaEditInput({
    firstName: "  María  Elena ",
    lastName: "Rodríguez",
    email: "  MARIA@Instituto.MX ",
    phone: "55 4433 2211",
    role: "DIRECCION",
  });
  assert.equal(r.error, null);
  assert.deepEqual(r.value, {
    firstName: "María Elena",
    lastName: "Rodríguez",
    email: "maria@instituto.mx",
    phone: "5544332211",
    role: "DIRECCION",
  });
});

test("H-04: solo viaja lo que se manda (un PATCH parcial no borra lo que no toca)", () => {
  const r = eduTeamPersonaEditInput({ lastName: "De la Cruz" });
  assert.equal(r.error, null);
  assert.deepEqual(r.value, { lastName: "De la Cruz" });
  assert.equal("email" in r.value!, false);
  assert.equal("phone" in r.value!, false);
});

test("🔴 H-04: `phone` vacío BORRA el teléfono, y eso es distinto de no mandarlo", () => {
  for (const vacio of ["", null]) {
    const r = eduTeamPersonaEditInput({ phone: vacio });
    assert.equal(r.error, null, `falló con phone=${String(vacio)}`);
    assert.deepEqual(r.value, { phone: null });
  }
  // No mandarlo no lo toca.
  const sinTelefono = eduTeamPersonaEditInput({ firstName: "Ana" });
  assert.equal("phone" in sinTelefono.value!, false);
});

test("H-04: un cambio vacío se rechaza en vez de escribir un UPDATE sin datos", () => {
  const r = eduTeamPersonaEditInput({});
  assert.equal(r.value, null);
  assert.match(r.error!, /ningún cambio/i);
});

test("H-04: cada campo mal capturado devuelve un error EN ESPAÑOL, no un código", () => {
  const casos: [Record<string, unknown>, RegExp][] = [
    [{ firstName: "   " }, /nombre/i],
    [{ lastName: "" }, /apellidos/i],
    [{ email: "no-es-un-correo" }, /correo/i],
    [{ phone: "sin dígitos" }, /teléfono/i],
    [{ role: "RECTOR" }, /rol/i],
  ];
  for (const [entrada, esperado] of casos) {
    const r = eduTeamPersonaEditInput(entrada);
    assert.equal(r.value, null, `${JSON.stringify(entrada)} debería rebotar`);
    assert.match(r.error!, esperado);
  }
});

test("H-04: el aviso del cambio de rol dice que los permisos personalizados SE BORRAN", () => {
  const con = eduCambioDeRolAviso("Ana Ruiz", "DOCENTE", "DIRECCION", true);
  assert.match(con, /Ana Ruiz/);
  assert.match(con, /se BORRAN|se borran/);
  assert.match(con, /apúntalos|Apúntalos/);
  // Y no lo dice cuando no había nada personalizado: un aviso que sale
  // siempre es un aviso que nadie lee.
  const sin = eduCambioDeRolAviso("Ana Ruiz", "DOCENTE", "DIRECCION", false);
  assert.equal(/se BORRAN|se borran/.test(sin), false);
  // Las dos versiones prometen lo mismo sobre el historial.
  for (const texto of [con, sin]) {
    assert.match(texto, /no se toca/i);
  }
});

test("🔴 H-04 (fuente): el correo se escribe en Auth PRIMERO y se REVIERTE si Prisma falla", () => {
  const cuerpo = cuerpoDe(fuente("src", "lib", "edu", "equipo.ts"), "updateEduTeamMember");

  const iAuth = cuerpo.indexOf("admin.auth.admin.updateUserById");
  const iPrisma = cuerpo.indexOf("prisma.$transaction");
  assert.notEqual(iAuth, -1, "no se toca Supabase Auth: el correo dejaría de ser el login");
  assert.notEqual(iPrisma, -1);
  assert.ok(iAuth < iPrisma, "Auth es la fuente de verdad del login: se escribe primero");

  // Y hay reversión: sin ella queda Auth con el correo nuevo y el panel con
  // el viejo, que es el estado imposible de depurar.
  assert.match(cuerpo, /catch/);
  assert.match(cuerpo, /email:\s*persona\.email/);
  assert.match(cuerpo, /DESINCRONIZADAS|revertError/);
});

test("🔴 H-04 (fuente): corregir a alguien REESCRIBE su índice de búsqueda", () => {
  const cuerpo = cuerpoDe(fuente("src", "lib", "edu", "equipo.ts"), "updateEduTeamMember");
  assert.match(
    cuerpo,
    /eduUserSearchIndex/,
    "sin reescribir searchIndex, corregir un apellido deja a la persona buscable por el viejo y no por el nuevo",
  );
});

test("🔴 H-04 (fuente): cambiar de rol BORRA el override y lo devuelve para que se apunte", () => {
  const cuerpo = cuerpoDe(fuente("src", "lib", "edu", "equipo.ts"), "updateEduTeamMember");
  assert.match(cuerpo, /roleChanged && \{ role: cambios\.role, permissionsOverride: \[\] \}/);
  assert.match(cuerpo, /overrideDescartado/);
});

test("🔴 H-04 (fuente): restablecer la contraseña es el MISMO camino que el alta", () => {
  const cuerpo = cuerpoDe(fuente("src", "lib", "edu", "equipo.ts"), "resetEduTeamMemberPassword");
  // La misma generadora que el alta: mismo alfabeto sin caracteres que se
  // confundan al dictarlos, y siempre con un dígito.
  assert.match(cuerpo, /eduTempPasswordFromBytes\(randomBytes\(EDU_TEMP_PASSWORD_BYTES\)\)/);
  // Auth primero, la marca después.
  const iAuth = cuerpo.indexOf("updateUserById");
  const iMarca = cuerpo.indexOf("data: { mustChangePassword: true }");
  assert.ok(iAuth !== -1 && iMarca !== -1 && iAuth < iMarca);
  // Y el estado leído va en el where.
  assert.match(cuerpo, /updateMany\(\{[\s\S]*?isActive:\s*true/);
});

test("🔴 H-04 (fuente): la ruta de restablecer existe y exige equipo.manage", () => {
  const src = fuente(
    "src", "app", "api", "instituto", "equipo", "[id]", "restablecer", "route.ts",
  );
  assert.match(src, /eduApiGuard\("equipo\.manage"\)/);
  assert.match(src, /resetEduTeamMemberPassword/);
  assert.match(src, /export async function POST/);
});

test("🔴 H-04 (fuente): el PATCH de equipo admite los cinco campos de la persona", () => {
  const src = fuente("src", "app", "api", "instituto", "equipo", "[id]", "route.ts");
  for (const campo of ["firstName", "lastName", "email", "phone", "role"]) {
    assert.match(src, new RegExp(`\\b${campo}\\b`), `el PATCH no admite ${campo}`);
  }
  assert.match(src, /updateEduTeamMember/);
  // El orden importa: los datos (que pueden cambiar el ROL) van ANTES que
  // los permisos, o el cambio de rol borraría un override recién guardado.
  // Se mira el CUERPO del handler, no el archivo: arriba están los imports,
  // que van en orden alfabético y dirían lo contrario.
  const handler = src.slice(src.indexOf("export async function PATCH"));
  const iDatos = handler.indexOf("await updateEduTeamMember");
  const iPermisos = handler.indexOf("await setEduTeamMemberPermissions");
  const iEstado = handler.indexOf("await setEduTeamMemberActive");
  assert.ok(iDatos !== -1 && iPermisos !== -1 && iEstado !== -1);
  assert.ok(iDatos < iPermisos, "los datos se aplican antes que los permisos");
  assert.ok(iPermisos < iEstado, "el estado de la cuenta va al final");
});

// ═══════════════════════════════════════════════════════════════════════
// 5 · H-02 · LA BAJA DEL PADRÓN APAGA LA CUENTA
// ═══════════════════════════════════════════════════════════════════════

test("🔴 H-02 (fuente): la baja del padrón y la de la cuenta van en la MISMA transacción", () => {
  const cuerpo = cuerpoDe(fuente("src", "lib", "edu", "padron.ts"), "updateEduStudent");

  assert.match(cuerpo, /prisma\.\$transaction/);
  assert.match(
    cuerpo,
    /tx\.eduUser\.updateMany/,
    "updateEduStudent no toca la cuenta: el egresado sigue entrando con su contraseña",
  );
  // Solo se apaga la cuenta del ALUMNO de ESTA ficha y de ESTE instituto.
  assert.match(cuerpo, /id:\s*current\.userId/);
  assert.match(cuerpo, /institutionId,\s*isActive:\s*true,\s*role:\s*"ALUMNO"/);
  // Explícito, nunca a espaldas de quien guarda.
  assert.match(cuerpo, /deactivateAccount/);
});

test("🔴 H-02 (fuente): las dos escrituras llevan el estado leído en el `where` y contestan 409", () => {
  const cuerpo = cuerpoDe(fuente("src", "lib", "edu", "padron.ts"), "updateEduStudent");
  assert.match(cuerpo, /tx\.eduStudent\.updateMany/);
  assert.match(cuerpo, /status:\s*current\.status/);
  // Dos comprobaciones de count, una por escritura.
  const cuentas = cuerpo.match(/count === 0/g) ?? [];
  assert.equal(cuentas.length, 2, "falta el 409 de alguna de las dos escrituras");
  // Y las dos lo contestan como 409 (conflicto), no como 500.
  const transaccion = cuerpo.slice(cuerpo.indexOf("prisma.$transaction"));
  assert.equal((transaccion.match(/409/g) ?? []).length, 2);
});

test("🔴 H-02 (fuente): una cuenta inactiva no resuelve contexto — así que no entra a NADA", () => {
  // Ésta es la comprobación que pedía el encargo: "el egresado ya no ve
  // pacientes desde la Ola A; comprueba que tampoco entra a nada más si la
  // cuenta queda inactiva". La respuesta no está en visibility.ts sino en la
  // puerta: getEduContext solo resuelve usuarios con isActive true, y sin
  // contexto el layout redirige al login y eduApiGuard contesta 401.
  const auth = fuente("src", "lib", "edu-auth.ts");
  assert.match(
    cuerpoDe(auth, "getEduContext"),
    /where:\s*\{\s*supabaseId:\s*user\.id,\s*isActive:\s*true\s*\}/,
    "getEduContext dejó de exigir isActive: una cuenta dada de baja volvería a entrar",
  );

  const guard = cuerpoDe(fuente("src", "lib", "edu", "api-guard.ts"), "eduApiGuard");
  assert.match(guard, /if \(!ctx\)/);
  assert.match(guard, /status:\s*401/);

  const layout = fuente("src", "app", "instituto", "(panel)", "layout.tsx");
  assert.match(layout, /if \(!ctx\) redirect\("\/instituto\/login"\)/);
});

test("🔴 H-02 (fuente): la pantalla ofrece la baja de la cuenta MARCADA y avisa si se desmarca", () => {
  const src = crudo("src", "components", "edu", "padron", "padron-screen.tsx");
  // Marcada por defecto.
  assert.match(src, /useState\(true\)[^\n]*\n?/);
  assert.match(src, /const \[bajarCuenta, setBajarCuenta\] = useState\(true\)/);
  // Y el aviso cuando se desmarca usa `edu-alert` (el rojo del vertical),
  // no el `edu-banner--warn` ámbar de los avisos informativos.
  assert.match(src, /!bajarCuenta &&[\s\S]{0,200}edu-alert/);
  assert.match(src, /seguirá entrando al panel/);
  // Y conserva, palabra por palabra, la garantía que puso la Ola A: el
  // padrón no apaga una cuenta por su cuenta. Lo que cambia es que ese
  // aviso ya solo sale cuando de verdad va a pasar.
  assert.match(src, /Su cuenta seguirá activa/);
});

// ═══════════════════════════════════════════════════════════════════════
// 6 · H-14 · EL DOCENTE LLEGA A VALORACIÓN
// ═══════════════════════════════════════════════════════════════════════

test("🔴 H-14 (fuente): Mi día enlaza a Valoración cuando la cuenta tiene casos.assign", () => {
  const src = fuente("src", "app", "instituto", "(panel)", "mi-dia", "page.tsx");
  assert.match(src, /hasEduPermission\(permUser, "casos\.assign"\)/);
  assert.match(src, /href="\/instituto\/agenda\/tamizaje"/);
  // El enlace cuelga del permiso, no del rol: un override que encienda
  // casos.assign a otra cuenta también la lleva.
  assert.match(src, /puedeValorar &&[\s\S]{0,200}agenda\/tamizaje/);
});

test("H-14: `casos.assign` sigue siendo un default del DOCENTE (si no, este enlace no arregla nada)", () => {
  assert.ok(EDU_ROLE_DEFAULTS.DOCENTE.includes("casos.assign"));
  assert.ok(EDU_ROLE_DEFAULTS.DIRECCION.includes("casos.assign"));
  // Y caja NO: ve Agenda pero la valoración es una decisión académica.
  assert.equal(EDU_ROLE_DEFAULTS.CAJA.includes("casos.assign"), false);
});

test("H-14 (fuente): la pantalla de Valoración sigue exigiendo casos.assign en el servidor", () => {
  // El enlace nuevo no es el candado: la pantalla vuelve a exigir la llave.
  const src = fuente("src", "app", "instituto", "(panel)", "agenda", "tamizaje", "page.tsx");
  assert.match(src, /hasEduPermission\(permUser, "casos\.assign"\)/);
});

// ═══════════════════════════════════════════════════════════════════════
// 7 · LOS 🟠 DEL BLOQUE «PADRÓN · EQUIPO · FICHAS»
// ═══════════════════════════════════════════════════════════════════════

test("H-104: el teléfono del pegado masivo llega hasta el alta en vez de tirarse", () => {
  const filas = parseEduTeamPaste(
    "Ana,Ruiz,ana@x.mx,Docente,55 4433 2211\nLuis,Paz,luis@x.mx,Alumno",
    "ALUMNO",
  );
  assert.equal(filas.length, 2);
  assert.equal(filas[0].error, null);
  assert.equal(filas[0].phone, "5544332211", "el teléfono se validaba y se tiraba");
  // Sin quinta columna, null (no "" ni undefined).
  assert.equal(filas[1].phone, null);
});

test("H-104 (fuente): el alta masiva MANDA el teléfono al servidor", () => {
  const src = fuente("src", "components", "edu", "equipo", "equipo-screen.tsx");
  assert.match(
    src,
    /rows:\s*trozo\.map\([\s\S]{0,300}phone:\s*f\.phone/,
    "el alta masiva sigue mandando cuatro campos: el teléfono se valida y se pierde",
  );
});

test("H-99 (fuente): dar de baja a un docente CIERRA sus supervisiones vigentes, sin borrarlas", () => {
  const cuerpo = cuerpoDe(fuente("src", "lib", "edu", "equipo.ts"), "setEduTeamMemberActive");
  assert.match(cuerpo, /eduSupervisorAssignment\.updateMany/);
  assert.match(cuerpo, /data:\s*\{\s*endsAt:\s*now\s*\}/);
  assert.match(cuerpo, /eduCurrentAssignmentWhere\(now\)/);
  // Solo al dar de baja, y solo a un DOCENTE.
  assert.match(cuerpo, /!isActive && persona\.role === "DOCENTE"/);
  // Y NUNCA un delete: la respuesta a "quién supervisaba a este alumno el 3
  // de marzo" tiene que seguir existiendo dentro de un año.
  assert.equal(/eduSupervisorAssignment\.delete/.test(cuerpo), false);
});

test("H-99 (fuente): la baja de equipo escribe con el estado leído en el where y contesta 409", () => {
  const cuerpo = cuerpoDe(fuente("src", "lib", "edu", "equipo.ts"), "setEduTeamMemberActive");
  assert.match(cuerpo, /eduUser\.updateMany/);
  assert.match(cuerpo, /isActive:\s*!isActive/);
  assert.match(cuerpo, /count === 0/);
  assert.match(cuerpo, /409/);
});

test("H-109 (fuente): no se inscribe a nadie en una especialidad o generación cerrada", () => {
  const src = fuente("src", "lib", "edu", "padron.ts");
  const i = src.indexOf("async function resolvePair");
  assert.notEqual(i, -1);
  const cuerpo = src.slice(i, src.indexOf("\nexport ", i));
  assert.match(cuerpo, /exigirActiva/);
  assert.match(cuerpo, /program\.isActive/);
  assert.match(cuerpo, /cohort\.isActive/);
});

test("H-111 (fuente): no se le asigna docente a un alumno egresado o dado de baja", () => {
  const cuerpo = cuerpoDe(fuente("src", "lib", "edu", "padron.ts"), "assignEduSupervisor");
  assert.match(cuerpo, /student\.status !== "ACTIVE"/);
});

test("H-110 (fuente): la lista del padrón distingue al TITULAR de un docente de apoyo", () => {
  const src = fuente("src", "components", "edu", "padron", "padron-screen.tsx");
  // El titular es el `isPrimary`, y si no lo hay, lo que queda es apoyo — no
  // el primero de la lista pintado como si fuera el responsable.
  assert.match(src, /const titular = r\.supervisors\.find\(\(s\) => s\.isPrimary\) \?\? null/);
  assert.match(src, /Sin titular/);
});

test("H-101 (fuente): el modal de baja avisa de los casos abiertos y las citas futuras", () => {
  const pantalla = fuente("src", "components", "edu", "padron", "padron-screen.tsx");
  assert.match(pantalla, /student\.casosAbiertos/);
  assert.match(pantalla, /student\.citasFuturas/);

  // Y los números salen de la BASE, en la misma consulta de la lista: no de
  // 300 consultas sueltas para pintar una tabla.
  const servidor = cuerpoDe(fuente("src", "lib", "edu", "padron.ts"), "listEduStudents");
  assert.match(servidor, /_count/);
  assert.match(servidor, /cases:\s*\{\s*where/);
  assert.match(servidor, /appointments:\s*\{[\s\S]{0,120}startsAt:\s*\{\s*gte:\s*now\s*\}/);
});

test("H-105 (fuente): la lista de estudiantes de un docente DICE cuándo se cortó", () => {
  const src = fuente("src", "components", "edu", "padron", "docentes-screen.tsx");
  assert.match(src, /alumnos\.length < t\.currentStudents/);
  assert.match(src, /No es un permiso/);
});

test("H-108 (fuente): desactivar una especialidad con alumnos dentro pide confirmación", () => {
  const src = fuente("src", "components", "edu", "padron", "estructura-screen.tsx");
  assert.match(src, /p\.isActive && p\.students > 0/);
  assert.match(src, /setConfirmar\(p\.id\)/);
  // El id y no un booleano: con dos filas, un booleano confirmaría la que no era.
  assert.match(src, /const \[confirmar, setConfirmar\] = useState<string \| null>\(null\)/);
});

test("H-103: la fecha de una ficha se formatea en UTC y no se corre un día", () => {
  assert.equal(eduFichaFecha("2026-09-07T00:00:00.000Z"), "7 de septiembre de 2026");
  assert.equal(eduFichaFecha("2026-01-31"), "31 de enero de 2026");
  // Lo que no es fecha no revienta la ficha entera.
  for (const malo of [null, undefined, "", "ayer", "2026-13-99x"]) {
    assert.equal(eduFichaFecha(malo as string), "—", `falló con ${String(malo)}`);
  }
});

test("H-103 (fuente): la ficha del estudiante PINTA el correo, el teléfono y las fechas", () => {
  const src = fuente(
    "src", "app", "instituto", "(panel)", "estudiantes", "[id]", "layout.tsx",
  );
  assert.match(src, /alumno\.email/);
  assert.match(src, /alumno\.phone/);
  assert.match(src, /eduFichaFecha\(alumno\.(enrolledAt|graduatedAt)\)/);
});

test("H-159 (fuente): «última entrada» se ESCRIBE, y la ficha ya no la explica con un permiso", () => {
  const sesion = fuente("src", "app", "api", "instituto", "auth", "session", "route.ts");
  assert.match(
    sesion,
    /lastLogin:\s*new Date\(\)/,
    "lastLogin se leía en cuatro sitios y no se escribía en ninguno",
  );
  // El tenant en el where, como todo lo demás del vertical.
  assert.match(sesion, /institutionId:\s*ctx\.institutionId/);
  // Y no puede dejar a nadie en la puerta si falla.
  assert.match(sesion, /catch/);

  const ficha = fuente("src", "app", "instituto", "(panel)", "docentes", "[id]", "page.tsx");
  assert.match(ficha, /!docente\.veUltimaEntrada/);
  assert.match(ficha, /Sin registro de entrada todavía/);
});

test("🔴 H-106: la página se sanea — una inventada cae en la primera, nunca en un vacío que miente", () => {
  assert.equal(eduPadronPagina(undefined), 1);
  assert.equal(eduPadronPagina(null), 1);
  assert.equal(eduPadronPagina("abc"), 1);
  assert.equal(eduPadronPagina("0"), 1);
  assert.equal(eduPadronPagina("-3"), 1);
  assert.equal(eduPadronPagina("2"), 2);
  assert.equal(eduPadronPagina(3), 3);
  assert.equal(eduPadronPagina("2.9"), 2);
  // Techo: sin él, ?pagina=999999999 se traduce en un OFFSET que Postgres
  // recorre entero antes de devolver cero filas.
  assert.equal(eduPadronPagina("999999999"), 1000);
});

test("🔴 H-106: los filtros de la URL leen la página, y sin ella es la primera", () => {
  assert.equal(parseEduPadronFilters({ pagina: "4" }).page, 4);
  // La primera NO se escribe en el objeto: es el espejo de la query string,
  // y `?pagina=1` no aparece en una URL. Quien la lee la resuelve.
  assert.equal("page" in parseEduPadronFilters({}), false);
  assert.equal(eduPadronPagina(parseEduPadronFilters({}).page), 1);
  assert.equal("page" in parseEduPadronFilters({ pagina: "1" }), false);
  // Y sigue sin leer un institutionId por ninguna puerta.
  const f = parseEduPadronFilters({ institutionId: "otro", pagina: "2" } as never);
  assert.equal(JSON.stringify(f).includes("otro"), false);
});

test("🔴 H-106 (fuente): listEduStudents SALTA las páginas anteriores", () => {
  const cuerpo = cuerpoDe(fuente("src", "lib", "edu", "padron.ts"), "listEduStudents");
  assert.match(cuerpo, /skip:\s*\(page - 1\) \* EDU_PADRON_MAX_ROWS/);
  assert.match(cuerpo, /eduPadronPagina\(filters\.page\)/);
  // El orden es por matrícula, que es única por instituto: sin un orden
  // total, el OFFSET repetiría filas entre una página y la siguiente.
  assert.match(cuerpo, /orderBy:\s*\[\{ matricula: "asc" \}\]/);
});

test("🔴 H-106 (fuente): cambiar un filtro vuelve a la página 1", () => {
  const src = fuente("src", "components", "edu", "padron", "padron-screen.tsx");
  assert.match(
    src,
    /if \(next\.pagina === undefined\) delete merged\.pagina/,
    "filtrar estando en la página 3 daría una pantalla vacía que se lee como «no hay ninguno»",
  );
  assert.match(src, /Siguientes/);
  assert.match(src, /Anteriores/);
});

test("H-102 (fuente): la pestaña de casos del docente explica el vacío en vez de mentir", () => {
  const src = fuente(
    "src", "app", "instituto", "(panel)", "docentes", "[id]", "casos", "page.tsx",
  );
  // El vacío ya no se lee como "no llevó ninguno".
  assert.match(src, /estudiantes que supervisas hoy/);
  assert.match(src, /scope\.kind === "all"/);
  // Y NO se ensanchó el alcance clínico compartido para taparlo: esta
  // pantalla sigue usando el mismo listEduCasosPanel de /instituto/casos.
  assert.match(src, /listEduCasosPanel/);
});
