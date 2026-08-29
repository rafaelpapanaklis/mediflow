/**
 * DaleControl INSTITUCIONAL — permisos por rol. Módulo PURO y client-safe
 * (sin prisma, sin "server-only"): lo usan el sidebar (visibilidad de
 * items), las páginas y las APIs (vía assertEduPermission).
 *
 * Mismo mecanismo que src/lib/auth/permissions.ts (dental) y
 * src/lib/barber/permissions.ts (barbería). Las olas que siguen NO inventan
 * su propio check: usan hasEduPermission / assertEduPermission. Punto único.
 *
 * REGLA DEL OVERRIDE (idéntica a User.permissionsOverride del dental): si
 * permissionsOverride trae keys, esas REEMPLAZAN al default del rol — no se
 * suman. Consecuencia que muerde en producción: un permiso NUEVO agregado
 * al default de un rol NO le llega a quien ya tiene override; hay que
 * agregárselo también a su override (por eso cada .sql de una ola que
 * añade keys trae su backfill).
 */
import type { EduRole } from "@/lib/edu/types";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * REGLA DEL CATÁLOGO — léela antes de agregar una key.
 *
 * Cada key de EDU_ALL_PERMISSIONS la tiene que EXIGIR de verdad una
 * pantalla o un endpoint que ya exista. Un interruptor que se guarda y no
 * cambia nada es peor que no tenerlo: la dirección del instituto cree que
 * cerró algo y no cerró nada.
 *
 * Por eso cada ola agrega SUS keys, en el mismo commit que la pantalla que
 * las lee — no las adelanta. La Ola 0 arrancó con UNA sola key real,
 * "inicio.view", porque había UNA sola pantalla. La Ola 1A agrega cuatro
 * y las cuatro tienen dueño: padron.view lo exige /instituto/padron,
 * padron.manage lo exigen /instituto/padron/estructura y TODA mutación del
 * padrón, docentes.view lo exige /instituto/docentes y supervision.assign
 * lo exigen los endpoints de /api/instituto/supervision.
 *
 * El candado no es la buena voluntad: la prueba de
 * __tests__/edu-permissions.test.ts recorre src/app/instituto,
 * src/components/edu y src/lib/edu y falla si una key del catálogo se queda
 * sin lector.
 * ═══════════════════════════════════════════════════════════════════════
 */
export const EDU_ALL_PERMISSIONS = {
  "inicio.view": "Entrar al panel del instituto",
  "padron.view": "Ver el padrón de alumnos",
  "padron.manage": "Dar de alta y de baja alumnos, programas y generaciones",
  "docentes.view": "Ver la lista de docentes",
  "supervision.assign": "Asignar alumnos a un docente supervisor",
  // ── Ola 2 · el piso clínico ──────────────────────────────────────────
  // Cada una la EXIGE una pantalla y un endpoint que ya existen; la prueba
  // de __tests__/edu-permissions.test.ts falla si alguna se queda sin
  // lector de servidor.
  "pacientes.view": "Ver los pacientes de la clínica",
  "pacientes.manage": "Registrar y editar la ficha de un paciente",
  "pacientes.origen": "Marcar CUÁL alumno trajo al paciente",
  "agenda.view": "Ver la agenda de la clínica",
  "agenda.manage": "Agendar, reagendar y cancelar citas",
  "sillones.view": "Ver las unidades dentales y su horario",
  "sillones.manage": "Dar de alta sillones y capturar su horario",
  "casos.view": "Ver los casos clínicos",
  "casos.assign": "Asignar un paciente a un alumno y abrir su caso",
  // ── Ola 3 · el expediente clínico ────────────────────────────────────
  // Las seis las EXIGE una pantalla y un endpoint que ya existen (la
  // prueba de __tests__/edu-permissions.test.ts falla si alguna se queda
  // sin lector de SERVIDOR):
  //   expediente.view    → /instituto/pacientes/[id]/expediente + su GET
  //   expediente.write   → POST de notas y PATCH de estado (enviar/firmar)
  //   odontograma.view   → /instituto/pacientes/[id]/odontograma + su GET
  //   odontograma.edit   → PUT y PATCH del odontograma
  //   estudios.view      → /instituto/pacientes/[id]/estudios + su GET
  //   estudios.upload    → /sign y /confirm de la subida directa
  "expediente.view": "Leer las notas clínicas del expediente",
  "expediente.write": "Escribir, enviar y firmar notas clínicas",
  "odontograma.view": "Ver el odontograma del paciente",
  "odontograma.edit": "Marcar hallazgos en el odontograma",
  "estudios.view": "Ver las radiografías, tomografías y fotos del paciente",
  "estudios.upload": "Subir estudios al expediente del paciente",
  // ── Ola 5 · tarifarios y caja ────────────────────────────────────────
  // Seis keys, todas con dueño: tarifarios.view lo exigen /instituto/
  // tarifarios y /instituto/procedimientos, tarifarios.manage TODA
  // mutación del catálogo y de los precios, y las cuatro de caja las
  // exigen la pantalla de cobro y sus endpoints.
  //
  // 🔴 Ninguna se le da al DOCENTE ni al ALUMNO. Y no basta con no dárselas:
  // el dinero está cerrado DOS veces, aquí y en el ALCANCE
  // (src/lib/edu/visibility.ts, recurso "charges"), para que encenderle
  // "caja.view" a un alumno por error siga sin enseñarle un solo peso.
  "tarifarios.view": "Ver las listas de precios y el catálogo de procedimientos",
  "tarifarios.manage": "Crear listas de precios, capturar precios y editar el catálogo",
  "caja.view": "Ver los cobros y los pagos de la clínica",
  "caja.charge": "Cobrarle a un paciente y registrar sus pagos",
  "caja.refund": "Devolver dinero y cancelar un cobro",
  "caja.corte": "Abrir y cerrar el turno de caja",
} as const;

export type EduPermissionKey = keyof typeof EDU_ALL_PERMISSIONS;

export const EDU_ALL_PERMISSION_KEYS = Object.keys(
  EDU_ALL_PERMISSIONS,
) as EduPermissionKey[];

/**
 * Agrupación visual para la pantalla de permisos del instituto (la
 * construye la ola de Equipo). Cada key del catálogo va en EXACTAMENTE un
 * grupo: si se queda fuera, nadie puede encenderla ni apagarla y el
 * interruptor existe solo en la base de datos.
 */
export const EDU_PERMISSION_GROUPS: { title: string; keys: EduPermissionKey[] }[] = [
  { title: "Panel", keys: ["inicio.view"] },
  {
    title: "Padrón académico",
    keys: ["padron.view", "padron.manage", "docentes.view", "supervision.assign"],
  },
  {
    title: "Pacientes y casos",
    keys: ["pacientes.view", "pacientes.manage", "pacientes.origen", "casos.view", "casos.assign"],
  },
  {
    title: "Agenda y sillones",
    keys: ["agenda.view", "agenda.manage", "sillones.view", "sillones.manage"],
  },
  {
    // Grupo APARTE del de "Pacientes y casos" a propósito: son los seis
    // interruptores que la dirección va a querer apagarle a caja de un
    // vistazo. Mezclados con pacientes.view, apagar el expediente sin
    // apagar la recepción sería un ejercicio de leer catorce casillas.
    title: "Expediente clínico",
    keys: [
      "expediente.view",
      "expediente.write",
      "odontograma.view",
      "odontograma.edit",
      "estudios.view",
      "estudios.upload",
    ],
  },
  {
    title: "Tarifarios y caja",
    keys: [
      "tarifarios.view",
      "tarifarios.manage",
      "caja.view",
      "caja.charge",
      "caja.refund",
      "caja.corte",
    ],
  },
];

/**
 * Defaults por rol. Los cuatro entran al panel: DIRECCION y CAJA porque
 * administran, DOCENTE y ALUMNO porque el panel se usa DE PIE en el piso
 * clínico y es su herramienta de trabajo.
 *
 * Lo que cada rol puede HACER dentro se irá diferenciando ola por ola
 * (autorizar es del docente, cobrar es de caja); mientras esa key no
 * exista, no se escribe aquí.
 *
 * ── Ola 1A · por qué el DOCENTE ve el padrón y no lo administra ─────────
 * El docente necesita la lista para saber a quién trae en el sillón y con
 * quién más la comparte, así que lleva "padron.view" y "docentes.view".
 * Pero lo que VE está recortado a sus alumnos vigentes — eso no lo decide
 * el permiso sino el ALCANCE (eduPadronScope, en padron-core.ts): el
 * permiso abre la pantalla, el alcance decide las filas.
 *
 * "padron.manage" y "supervision.assign" son de DIRECCION: dar de alta,
 * dar de baja y repartir alumnos es administrar la escuela.
 *
 * ALUMNO y CAJA no reciben nada de esto. Un residente no tiene por qué
 * leer el padrón completo de su generación, y caja cobra: no inscribe.
 *
 * ── Ola 2 · el piso clínico ─────────────────────────────────────────────
 * Aquí los cuatro roles SÍ se separan, y el reparto es el del contrato:
 *
 *   CAJA      recibe al paciente, lo agenda y lo cobra: pacientes.*
 *             (incluido el ORIGEN, que decide el precio) + agenda.* +
 *             sillones.view. Ni un caso clínico: no abre expediente.
 *   DOCENTE   mira todo lo suyo y REPARTE: los .view del piso clínico +
 *             casos.assign. No registra pacientes (eso es recepción) ni
 *             mueve la agenda de la escuela.
 *   ALUMNO    agenda.view + pacientes.view + casos.view. Tres permisos de
 *             LECTURA, y todo lo que lea está recortado a lo suyo.
 *
 * 🔴 Los tres roles de abajo comparten esas keys de lectura, y eso NO
 * significa que vean lo mismo. El permiso abre la pantalla; el ALCANCE
 * (src/lib/edu/visibility.ts) decide las filas: con el mismo
 * "pacientes.view", dirección ve todos, el docente ve los de sus alumnos
 * VIGENTES y el alumno ve los suyos. Ensanchar el permiso no ensancha lo
 * que se ve — y ésa es justamente la idea.
 *
 * ⚠️ "pacientes.origen" NO se le da al docente ni al alumno: marcar quién
 * trajo al paciente decide el precio en la Ola 5, así que lo pone quien
 * cobra (caja) o quien manda (dirección). Al alumno se le PINTA su origen,
 * deshabilitado.
 *
 * ── Ola 3 · el expediente clínico ───────────────────────────────────────
 * DIRECCION, DOCENTE y ALUMNO llevan las SEIS keys. CAJA, NINGUNA — y ésta
 * es la línea del contrato que más fácil se rompe, así que está cerrada en
 * DOS sitios, no en uno:
 *
 *   1. aquí, en el default (caja no trae ni expediente.view);
 *   2. en el ALCANCE (src/lib/edu/visibility.ts), porque el expediente se
 *      lee con el recurso "cases", y para caja ese recurso devuelve "none"
 *      aunque alguien le encienda el interruptor por error.
 *
 * Un solo candado se abre por accidente; dos hay que abrirlos a propósito.
 *
 * 🔴 Y otra vez: que los tres roles compartan "expediente.view" NO
 * significa que lean lo mismo. El alumno ve las notas de SUS casos, el
 * docente las de los alumnos que supervisa HOY, la dirección todas.
 * Ensanchar el permiso no ensancha lo que se ve.
 *
 * ── Ola 5 · el dinero ───────────────────────────────────────────────────
 * Aquí el reparto es el más estrecho de todo el vertical, y a propósito:
 *
 *   DIRECCION todo, incluido "tarifarios.manage": poner precios es decidir
 *             cuánto cuesta la escuela, y eso lo decide quien la dirige.
 *   CAJA      todo MENOS "tarifarios.manage". Cobra, devuelve, corta y LEE
 *             el tarifario —tiene que poder consultarlo delante del
 *             paciente— pero no lo escribe: quien cobra no se pone su
 *             propio precio.
 *   DOCENTE   NADA. Ni una key de dinero.
 *   ALUMNO    NADA. Ni el precio, ni el cobro, ni el saldo.
 *
 * 🔴 Que un alumno no vea dinero NO depende de esta lista. Si mañana
 * alguien le enciende "caja.view" desde la pantalla de permisos, seguirá
 * sin ver un peso: el ALCANCE (visibility.ts, recurso "charges") devuelve
 * "none" para DOCENTE y ALUMNO pase lo que pase. El permiso abre la
 * pantalla; el alcance decide las filas — y para el dinero, la decisión
 * está tomada en los dos sitios.
 */
export const EDU_ROLE_DEFAULTS: Record<EduRole, EduPermissionKey[]> = {
  DIRECCION: [
    "inicio.view",
    "padron.view",
    "padron.manage",
    "docentes.view",
    "supervision.assign",
    "pacientes.view",
    "pacientes.manage",
    "pacientes.origen",
    "agenda.view",
    "agenda.manage",
    "sillones.view",
    "sillones.manage",
    "casos.view",
    "casos.assign",
    "expediente.view",
    "expediente.write",
    "odontograma.view",
    "odontograma.edit",
    "estudios.view",
    "estudios.upload",
    "tarifarios.view",
    "tarifarios.manage",
    "caja.view",
    "caja.charge",
    "caja.refund",
    "caja.corte",
  ],
  DOCENTE: [
    "inicio.view",
    "padron.view",
    "docentes.view",
    "pacientes.view",
    "agenda.view",
    "sillones.view",
    "casos.view",
    "casos.assign",
    "expediente.view",
    "expediente.write",
    "odontograma.view",
    "odontograma.edit",
    "estudios.view",
    "estudios.upload",
  ],
  ALUMNO: [
    "inicio.view",
    "agenda.view",
    "pacientes.view",
    "casos.view",
    "expediente.view",
    "expediente.write",
    "odontograma.view",
    "odontograma.edit",
    "estudios.view",
    "estudios.upload",
  ],
  CAJA: [
    "inicio.view",
    "pacientes.view",
    "pacientes.manage",
    "pacientes.origen",
    "agenda.view",
    "agenda.manage",
    "sillones.view",
    "tarifarios.view",
    "caja.view",
    "caja.charge",
    "caja.refund",
    "caja.corte",
  ],
};

/** Forma mínima que necesita cualquier check: rol + override. */
export interface EduPermissionUser {
  role: EduRole;
  permissionsOverride?: string[] | null;
}

/**
 * Permisos efectivos: override vacío o ausente → default del rol; override
 * con keys → esas REEMPLAZAN al default (no se mergean). Las keys que ya no
 * existen en el catálogo se descartan, para que un cambio de catálogo no
 * deje a nadie con permisos fantasma guardados en BD.
 */
export function getEduEffectivePermissions(user: EduPermissionUser): EduPermissionKey[] {
  // Cinturón: si llega algo casteado (`ctx.role as any`) que no es un
  // usuario, se niega todo en vez de adivinar.
  if (typeof user !== "object" || user === null) return [];
  const override = (user.permissionsOverride ?? []).filter(
    (k): k is EduPermissionKey => typeof k === "string" && k in EDU_ALL_PERMISSIONS,
  );
  if (override.length > 0) return override;
  return EDU_ROLE_DEFAULTS[user.role] ?? [];
}

/** ¿El usuario (rol + override) tiene esta key? */
export function hasEduPermission(user: EduPermissionUser, key: EduPermissionKey): boolean {
  return getEduEffectivePermissions(user).includes(key);
}

/** Error tipado que lanzan los asserts; las APIs lo mapean a 403. */
export class EduForbiddenError extends Error {
  readonly permission: EduPermissionKey;
  constructor(permission: EduPermissionKey) {
    super(`Permiso requerido: ${permission}`);
    this.name = "EduForbiddenError";
    this.permission = permission;
  }
}

/**
 * Assert de permiso para route handlers / server actions del vertical.
 * Recibe el CONTEXTO de sesión (nunca un rol suelto: sin usuario no hay
 * override que consultar).
 *
 *   const ctx = await getEduContext();
 *   if (!ctx) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
 *   try { assertEduPermission(ctx, "inicio.view"); }
 *   catch { return NextResponse.json({ error: "Sin permiso" }, { status: 403 }); }
 */
export function assertEduPermission(
  ctx: { role: EduRole; user: { permissionsOverride?: string[] | null } },
  key: EduPermissionKey,
): void {
  const ok = hasEduPermission(
    { role: ctx.role, permissionsOverride: ctx.user?.permissionsOverride },
    key,
  );
  if (!ok) throw new EduForbiddenError(key);
}

/**
 * Devuelve solo las keys válidas y sin repetir; descarta las inventadas.
 * Es lo que tiene que pasar TODO lo que venga del cliente antes de
 * guardarse en EduUser.permissionsOverride.
 */
export function sanitizeEduPermissionKeys(input: unknown): EduPermissionKey[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<EduPermissionKey>();
  for (const k of input) {
    if (typeof k === "string" && k in EDU_ALL_PERMISSIONS) seen.add(k as EduPermissionKey);
  }
  return Array.from(seen);
}
