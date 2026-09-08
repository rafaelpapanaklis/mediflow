/**
 * DaleControl INSTITUCIONAL — el cerebro del EQUIPO, sin base de datos.
 *
 * Módulo PURO y client-safe (sin prisma, sin "server-only"): la pantalla lo
 * usa para pintar la VISTA PREVIA del pegado antes de crear nada, y el
 * servidor lo usa para volver a validar exactamente lo mismo. Que sean el
 * mismo código no es elegancia: es la única forma de que la vista previa no
 * mienta.
 *
 * 🔴 EL SERVIDOR NO CONFÍA EN LA VISTA PREVIA. El navegador manda filas ya
 * partidas, y el endpoint las vuelve a pasar por `eduTeamMemberInput` antes
 * de tocar Supabase. La vista previa es una cortesía; la validación de
 * verdad ocurre dos veces a propósito.
 *
 * ── POR QUÉ EXISTE ESTA OLA ─────────────────────────────────────────────
 * Hasta la Ola 1B no había ninguna forma de crear un alumno, un docente ni
 * un cajero desde el panel: el padrón decía "las cuentas se dan de alta
 * aparte" y ese "aparte" era INSERT a mano en Supabase. Un producto en el
 * que dar de alta a una generación entera exige SQL no se puede entregar.
 */
import type { EduRole } from "@/lib/edu/types";
import { EDU_ROLES, EDU_ROLE_LABELS } from "@/lib/edu/types";
import { eduRequiredText } from "@/lib/edu/padron-core";
import { normalizeEduEmail, normalizeEduPhone } from "@/lib/edu/pacientes-core";
import { eduNormalizeSearch } from "@/lib/edu/search";

/** Techo de filas de la lista de equipo. Un instituto son decenas o
 *  cientos de personas, no miles; el tope está para que una consulta rota
 *  no se traiga la tabla entera. */
export const EDU_TEAM_MAX_ROWS = 500;

/**
 * Cuántas filas se crean POR PETICIÓN en el alta masiva.
 *
 * 🔴 NO es un límite de cuánta gente se puede dar de alta: la pantalla parte
 * la lista en trozos de este tamaño y los manda uno tras otro, así que una
 * generación de 200 se crea igual que una de 20 (y con barra de progreso).
 * El tope existe porque cada alta es una llamada a Supabase Auth de unos
 * cientos de milisegundos: 200 en una sola petición se comería el tiempo
 * máximo de la función y se caería a la mitad, dejando media generación
 * creada y ninguna contraseña en pantalla.
 */
export const EDU_TEAM_BULK_CHUNK = 25;

/** Lo que hace falta para dar de alta a una persona. */
export interface EduTeamMemberInput {
  firstName: string;
  lastName: string;
  email: string;
  role: EduRole;
  phone: string | null;
}

/** Un renglón del pegado, ya interpretado. `error` null = se puede crear. */
export interface EduTeamParsedRow {
  /** Número de renglón tal como se ve en el cuadro de texto (1 = el primero). */
  line: number;
  raw: string;
  firstName: string;
  lastName: string;
  email: string;
  role: EduRole | null;
  /**
   * H-104 · La QUINTA columna. Se interpretaba y se validaba desde la Ola 1B
   * —un teléfono malo marcaba el renglón en rojo e impedía crear esa
   * cuenta— y después no viajaba a ninguna parte: el alta masiva mandaba
   * cuatro campos y el teléfono se perdía. Se cobraba el precio de validarlo
   * sin quedarse con el dato.
   */
  phone: string | null;
  error: string | null;
  /** Un encabezado de hoja de cálculo pegado sin querer: se ignora, no falla. */
  isHeader: boolean;
}

/** Qué pasó con cada persona del alta (individual o masiva). */
export interface EduTeamAltaResult {
  ok: boolean;
  email: string;
  name: string;
  role: EduRole | null;
  /** La contraseña temporal. `null` cuando se REUSÓ una cuenta que ya
   *  existía: esa persona entra con la contraseña que ya usa. */
  tempPassword: string | null;
  /** true = el correo ya tenía cuenta en DaleControl y se enlazó. */
  reused: boolean;
  id: string | null;
  error: string | null;
}

/** Una persona del equipo, tal como viaja a la pantalla. */
export interface EduTeamRow {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  role: EduRole;
  isActive: boolean;
  /** Es la cuenta de quien está mirando: no se puede dar de baja a sí mismo. */
  isSelf: boolean;
  /**
   * P2-8 · El override de permisos GUARDADO (vacío = usa el default del
   * rol). Viaja a la pantalla de equipo —que solo abre quien tiene
   * equipo.manage— para que el editor de permisos arranque de lo que de
   * verdad hay, y para pintar la marca "personalizado" en la fila.
   */
  permissionsOverride: string[];
  /** Ya tiene ficha académica (solo los ALUMNO la tienen). */
  hasStudentProfile: boolean;
  /**
   * 🔴 El id de **EduStudent**, que NO es `id` (ese es el de EduUser). Es el
   * único que abre /instituto/estudiantes/{id}: pasar el de la cuenta da un
   * 404 mudo. `null` para quien no es alumno.
   */
  studentId: string | null;
  matricula: string | null;
  lastLogin: string | null;
  createdAt: string;
  /**
   * 🔴 H-112 · Las sedes a las que entra. **VACÍO = TODAS**, que es la regla
   * de la ola de sedes y la lectura que sorprende: la ausencia de filas
   * concede MÁS acceso, no menos. Por eso viaja a la pantalla — para que la
   * fila lo pueda DECIR en vez de dejar un hueco que se lee como "ninguna".
   */
  campusIds: string[];
}

export interface EduTeamFilters {
  role: EduRole | null;
  /** "activos" | "inactivos" | null (todos). */
  estado: "activos" | "inactivos" | null;
  q: string | null;
}

export const EDU_TEAM_EMPTY_FILTERS: EduTeamFilters = { role: null, estado: null, q: null };

export function eduHasTeamFilters(f: EduTeamFilters): boolean {
  return Boolean(f.role || f.estado || f.q);
}

// ═══════════════════════════════════════════════════════════════════════
// 1 · SANEO DE UNA PERSONA
// ═══════════════════════════════════════════════════════════════════════

/**
 * El rol, escrito como sea. Se aceptan el valor del enum ("ALUMNO"), la
 * etiqueta en español ("Alumno", "Dirección") y lo que la gente escribe de
 * verdad en una hoja de cálculo ("direccion", "profesor", "cajera").
 *
 * ⚠️ Aceptar sinónimos NO es adivinar: lo que no reconoce devuelve null y
 * el renglón sale marcado en la vista previa, con su número de línea. Lo
 * que no se puede permitir es que un "Docente " con espacio de más se
 * convierta en silencio en un ALUMNO.
 */
const ALIAS_DE_ROL: Record<string, EduRole> = {
  direccion: "DIRECCION",
  directora: "DIRECCION",
  director: "DIRECCION",
  coordinacion: "DIRECCION",
  docente: "DOCENTE",
  profesor: "DOCENTE",
  profesora: "DOCENTE",
  maestro: "DOCENTE",
  maestra: "DOCENTE",
  tutor: "DOCENTE",
  alumno: "ALUMNO",
  alumna: "ALUMNO",
  estudiante: "ALUMNO",
  residente: "ALUMNO",
  caja: "CAJA",
  cajero: "CAJA",
  cajera: "CAJA",
  recepcion: "CAJA",
};

export function parseEduTeamRole(raw: unknown): EduRole | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!v) return null;
  if ((EDU_ROLES as string[]).includes(v)) return v as EduRole;
  // eduNormalizeSearch quita acentos: "Dirección" y "direccion" son el
  // mismo rol, y quien teclea en una hoja de cálculo no pone la tilde.
  return ALIAS_DE_ROL[eduNormalizeSearch(v)] ?? null;
}

/**
 * El resultado de validar a una persona: o `value` o `error`, nunca los dos.
 *
 * ⚠️ NO es una unión discriminada (`{ok:true,…} | {ok:false,…}`) a propósito:
 * este repo compila con `strict: false`, y sin `strictNullChecks` TypeScript
 * NO estrecha una unión por un literal booleano — `if (!check.ok)` no le
 * dice nada y `check.error` no compila. Dos campos anulables sí funcionan
 * en los dos modos.
 */
export interface EduTeamInputCheck {
  value: EduTeamMemberInput | null;
  error: string | null;
}

/**
 * Valida una persona y devuelve o el input limpio o el porqué del rechazo.
 *
 * El error va EN ESPAÑOL y listo para pintar: es el mismo texto que sale en
 * la vista previa del pegado y el que contesta el endpoint, así que tiene
 * que servirle a una persona, no a un log.
 */
export function eduTeamMemberInput(input: {
  firstName?: unknown;
  lastName?: unknown;
  email?: unknown;
  role?: unknown;
  phone?: unknown;
}): EduTeamInputCheck {
  const mal = (error: string): EduTeamInputCheck => ({ value: null, error });

  const firstName = eduRequiredText(input.firstName, 80);
  if (!firstName) return mal("Falta el nombre (máximo 80 caracteres).");

  const lastName = eduRequiredText(input.lastName, 80);
  if (!lastName) return mal("Faltan los apellidos (máximo 80 caracteres).");

  const email = normalizeEduEmail(input.email);
  if (!email) return mal("Ese correo no parece un correo.");

  const role = parseEduTeamRole(input.role);
  if (!role) {
    return mal(
      `El rol tiene que ser uno de: ${EDU_ROLES.map((r) => EDU_ROLE_LABELS[r]).join(", ")}.`,
    );
  }

  const crudo = input.phone;
  let phone: string | null = null;
  if (crudo !== undefined && crudo !== null && crudo !== "") {
    phone = normalizeEduPhone(crudo);
    if (!phone) return mal("Ese teléfono no tiene números suficientes.");
  }

  return { value: { firstName, lastName, email, role, phone }, error: null };
}

// ═══════════════════════════════════════════════════════════════════════
// 2 · EL PEGADO — una persona por renglón
// ═══════════════════════════════════════════════════════════════════════

/** Un renglón se parte por TABULADOR si lo trae (es lo que pega Excel) y
 *  por coma si no. Nunca por los dos a la vez: un apellido compuesto
 *  "De la Cruz, Ana" partido por coma dentro de una celda de Excel daría
 *  columnas de más. */
function partirRenglon(linea: string): string[] {
  const sep = linea.includes("\t") ? "\t" : ",";
  return linea.split(sep).map((c) => c.trim());
}

/** ¿Este renglón es el encabezado que se pegó sin querer con la tabla? */
function pareceEncabezado(campos: string[]): boolean {
  const texto = eduNormalizeSearch(campos.join(" "));
  if (texto.includes("@")) return false;
  return (
    (texto.includes("correo") || texto.includes("email") || texto.includes("e-mail")) &&
    (texto.includes("nombre") || texto.includes("apellido"))
  );
}

/**
 * Interpreta el texto pegado. NO crea nada: devuelve, renglón por renglón,
 * qué se entendió y qué está mal, para que la pantalla lo enseñe ANTES de
 * tocar Supabase.
 *
 * Formato: `nombre, apellidos, correo, rol` (o separado por tabuladores).
 * El rol es opcional: si el renglón trae tres columnas se usa `defaultRole`,
 * que es lo que se elige en el diálogo — una generación entera se pega con
 * tres columnas y el rol puesto UNA vez arriba.
 *
 * 🔴 Los correos REPETIDOS dentro del propio pegado se marcan en el segundo
 * y siguientes. Sin esto, la lista con dos "ana@…" crearía la cuenta la
 * primera vez y fallaría la segunda con un error de base de datos que nadie
 * relacionaría con el renglón 47.
 *
 * ⚠️ Sin límite de renglones a propósito: una generación son 20 o 200 y el
 * producto no puede opinar. Quien parte el trabajo en trozos es la pantalla
 * (EDU_TEAM_BULK_CHUNK), no esta función.
 */
export function parseEduTeamPaste(
  text: unknown,
  defaultRole: EduRole | null = null,
): EduTeamParsedRow[] {
  if (typeof text !== "string") return [];
  const lineas = text.split(/\r?\n/);
  const vistos = new Set<string>();
  const filas: EduTeamParsedRow[] = [];

  for (let i = 0; i < lineas.length; i++) {
    const raw = lineas[i];
    if (!raw.trim()) continue;

    const campos = partirRenglon(raw);
    const base: EduTeamParsedRow = {
      line: i + 1,
      raw,
      firstName: campos[0] ?? "",
      lastName: campos[1] ?? "",
      email: campos[2] ?? "",
      role: null,
      phone: null,
      error: null,
      isHeader: false,
    };

    if (filas.length === 0 && pareceEncabezado(campos)) {
      filas.push({ ...base, isHeader: true });
      continue;
    }

    if (campos.length < 3) {
      filas.push({
        ...base,
        error: "Faltan columnas. Cada renglón va: nombre, apellidos, correo, rol.",
      });
      continue;
    }

    const rolTexto = campos[3] ?? "";
    const rol = rolTexto ? parseEduTeamRole(rolTexto) : defaultRole;

    const check = eduTeamMemberInput({
      firstName: campos[0],
      lastName: campos[1],
      email: campos[2],
      role: rol,
      phone: campos[4],
    });

    const limpio = check.value;
    if (!limpio) {
      filas.push({ ...base, role: rol, error: check.error });
      continue;
    }

    if (vistos.has(limpio.email)) {
      filas.push({
        ...base,
        role: rol,
        email: limpio.email,
        error: "Ese correo aparece dos veces en la lista.",
      });
      continue;
    }
    vistos.add(limpio.email);

    filas.push({
      line: i + 1,
      raw,
      firstName: limpio.firstName,
      lastName: limpio.lastName,
      email: limpio.email,
      role: limpio.role,
      // H-104: el teléfono ya venía saneado por eduTeamMemberInput. Antes se
      // tiraba aquí y el alta masiva mandaba cuatro campos.
      phone: limpio.phone,
      error: null,
      isHeader: false,
    });
  }

  return filas;
}

/** Las que se van a crear de verdad (ni encabezados ni renglones con error). */
export function eduTeamRowsListas(filas: EduTeamParsedRow[]): EduTeamParsedRow[] {
  return filas.filter((f) => !f.isHeader && !f.error);
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · LA CONTRASEÑA TEMPORAL
// ═══════════════════════════════════════════════════════════════════════

/**
 * Alfabeto SIN caracteres que se confunden al dictar por teléfono: no hay
 * 0/O, ni 1/I/L. Son 32 letras, y 32 divide a 256, así que tomar
 * `byte % 32` no favorece a ninguna — un alfabeto de, digamos, 30 sí
 * inclinaría la balanza hacia las primeras dos.
 */
const ALFABETO_PASS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** Ocho dígitos, mismo criterio: sin 0 ni 1. */
const DIGITOS_PASS = "23456789";

/** Cuántos bytes aleatorios necesita `eduTempPasswordFromBytes`. */
export const EDU_TEMP_PASSWORD_BYTES = 8;

/**
 * La contraseña temporal, a partir de bytes aleatorios que le pasa quien
 * llama (en el servidor, `crypto.randomBytes`).
 *
 * Es una función PURA y recibe los bytes en vez de generarlos para que se
 * pueda probar: una contraseña que se genera sola dentro de la función solo
 * se puede comprobar "a ojo".
 *
 * Forma: `Edu-XXXX-XXXY` — 13 caracteres, con mayúsculas, minúsculas, un
 * guion y AL MENOS un dígito (el último se fuerza). Lo del dígito no es
 * estética: si la instancia de Supabase tiene encendida una política de
 * complejidad, una contraseña que salga solo con letras la rechazaría y el
 * alta fallaría una de cada tantas veces, que es la peor clase de fallo.
 *
 * 🔴 No se guarda en ninguna parte. Se enseña UNA vez en pantalla y quien
 * dio de alta a la persona se la pasa. Si se pierde, la dirección tiene que
 * restablecerla desde Supabase — no hay "volver a verla".
 */
export function eduTempPasswordFromBytes(bytes: ArrayLike<number>): string {
  if (!bytes || bytes.length < EDU_TEMP_PASSWORD_BYTES) {
    throw new Error(
      `eduTempPasswordFromBytes necesita ${EDU_TEMP_PASSWORD_BYTES} bytes aleatorios`,
    );
  }
  const c = (i: number) => ALFABETO_PASS[bytes[i] % ALFABETO_PASS.length];
  const bloque1 = `${c(0)}${c(1)}${c(2)}${c(3)}`;
  const bloque2 = `${c(4)}${c(5)}${c(6)}`;
  const digito = DIGITOS_PASS[bytes[7] % DIGITOS_PASS.length];
  return `Edu-${bloque1}-${bloque2}${digito}`;
}

/**
 * La tabla de credenciales en texto, para el botón de "copiar todo".
 *
 * Va separada por TABULADORES para que se pegue en columnas en Excel o en
 * Google Sheets, que es lo que va a hacer quien da de alta a una generación
 * entera. Quien reusó cuenta sale con el aviso en vez de una contraseña en
 * blanco: una celda vacía se lee como "no se creó", y sí se creó.
 */
export function eduTeamCredentialsText(resultados: EduTeamAltaResult[]): string {
  const cabecera = ["Nombre", "Correo", "Rol", "Contraseña temporal"].join("\t");
  const filas = resultados
    .filter((r) => r.ok)
    .map((r) =>
      [
        r.name,
        r.email,
        r.role ? EDU_ROLE_LABELS[r.role] : "",
        r.tempPassword ?? "(ya tenía cuenta: entra con su contraseña de siempre)",
      ].join("\t"),
    );
  return [cabecera, ...filas].join("\n");
}

/** Nombre completo sin el espacio de más cuando falta el apellido. */
export function eduTeamFullName(p: { firstName: string; lastName: string; email?: string }): string {
  return [p.firstName, p.lastName].filter(Boolean).join(" ").trim() || p.email || "Sin nombre";
}

// ═══════════════════════════════════════════════════════════════════════
// 4 · LOS FILTROS DE LA URL
// ═══════════════════════════════════════════════════════════════════════

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value.length > 0 ? String(value[0]) : null;
  if (typeof value === "string") return value;
  return null;
}

/**
 * Lee los filtros de la query string (?rol=&estado=&q=). Lo que no reconoce
 * se descarta: un `?rol=RECTOR` se convierte en "sin filtro de rol", no en
 * un 500.
 *
 * 🔴 Aquí NO se lee ningún institutionId. El tenant sale de la sesión y de
 * ningún otro lado; si esta función lo aceptara, bastaría con teclear
 * `?institutionId=…` para listar el equipo de otra escuela.
 */
export function parseEduTeamFilters(
  searchParams: Record<string, string | string[] | undefined> | undefined | null,
): EduTeamFilters {
  const sp = searchParams ?? {};
  // Aquí SÍ se exige el valor exacto del enum: este filtro lo pone un
  // <select> de la propia pantalla, no una persona tecleando. Los sinónimos
  // de parseEduTeamRole ("profesora", "cajero") son para el PEGADO, que es
  // donde sí escribe una persona.
  const rol = firstParam(sp.rol) ?? "";
  const estado = firstParam(sp.estado);
  const q = firstParam(sp.q);
  return {
    role: (EDU_ROLES as string[]).includes(rol) ? (rol as EduRole) : null,
    estado: estado === "activos" || estado === "inactivos" ? estado : null,
    q: typeof q === "string" && q.trim() ? q.trim().slice(0, 60) : null,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 5 · QUIÉN PUEDE TOCAR A QUIÉN (H-16) — la escalada, cerrada por escrito
//
// `equipo.manage` es la llave de la escuela: crea cuentas, las da de baja y
// escribe permisos. Es de DIRECCION por defecto, pero el producto invita a
// prestarla por override («a sabiendas y una por una», permissions.ts), y
// ése es el caso de un coordinador académico. Hasta esta ola, con esa llave
// prestada se podía:
//
//   · CREAR una cuenta con rol DIRECCION y el correo propio —el <select>
//     del alta ofrecía los cuatro roles—, entrar con la temporal que la
//     propia pantalla enseña, y ya se era dirección; y
//   · VACIARLE los permisos a la dirección que había (dejarle solo
//     `inicio.view`): esa cuenta perdía `equipo.manage` y no podía
//     recuperarlo, porque para recuperarlo hace falta tenerlo.
//
// Las reglas de abajo cierran las dos, y viven aquí —puras, sin base— para
// que se puedan probar de verdad y para que la pantalla y el servidor no
// las escriban dos veces distintas.
//
// ⚠️ Lo que estas reglas NO deciden: quién tiene `equipo.manage`. Eso lo
// decide el editor de permisos, y prestar la llave sigue siendo una
// decisión de la dirección. Lo que cambia es que la llave prestada ya no
// alcanza al rol que la reparte.
// ═══════════════════════════════════════════════════════════════════════

/** Las tres cosas que se le pueden hacer a la cuenta de otra persona. */
export type EduTeamAccion = "crear" | "baja" | "reactivar" | "permisos" | "datos" | "contrasena";

const ACCION_TEXTO: Record<EduTeamAccion, string> = {
  crear: "crear una cuenta de Dirección",
  baja: "dar de baja a una cuenta de Dirección",
  reactivar: "reactivar una cuenta de Dirección",
  permisos: "editar los permisos de una cuenta de Dirección",
  datos: "cambiar los datos de una cuenta de Dirección",
  contrasena: "restablecer la contraseña de una cuenta de Dirección",
};

/**
 * ¿Puede `actorRole` hacer `accion` sobre alguien con rol `targetRole`?
 *
 * Devuelve el motivo del rechazo (en español, para pintarlo) o `null` si se
 * puede. La regla es una sola: **a una cuenta de DIRECCION solo la toca otra
 * cuenta de DIRECCION**. Con cualquier otro rol destino no opina — para eso
 * están los permisos.
 *
 * Se usa también al CREAR: ahí `targetRole` es el rol que se va a crear.
 */
export function eduTeamGuardDireccion(
  actorRole: EduRole,
  targetRole: EduRole,
  accion: EduTeamAccion,
): string | null {
  if (targetRole !== "DIRECCION") return null;
  if (actorRole === "DIRECCION") return null;
  return `Solo una cuenta de Dirección puede ${ACCION_TEXTO[accion]}. Pídeselo a quien dirige el instituto.`;
}

/**
 * ¿Este override deja a la ÚLTIMA dirección activa sin poder administrar?
 *
 * `keys` es lo que se va a guardar (ya saneado). `esUltimaDireccion` lo sabe
 * el servidor contando filas. Si la última dirección se queda sin
 * `equipo.manage`, el instituto se queda sin nadie que pueda dar de alta, dar
 * de baja ni devolverle el permiso a nadie —ni a sí misma—: es una puerta que
 * se cierra desde dentro con la llave puesta fuera, y no hay pantalla que la
 * abra.
 *
 * `null` (restaurar el rol) nunca cae aquí: el default de DIRECCION lleva
 * `equipo.manage`, así que restaurar siempre es una salida.
 */
export function eduOverrideDejaSinAdministracion(
  keys: string[],
  esUltimaDireccion: boolean,
): boolean {
  if (!esUltimaDireccion) return false;
  return !keys.includes("equipo.manage");
}

export const EDU_ULTIMA_DIRECCION_ERROR =
  "Es la única cuenta de Dirección activa del instituto: no puedes dejarla sin «Administrar el equipo», porque entonces nadie podría devolvérselo. Da de alta a otra dirección antes de recortarle los permisos.";

// ═══════════════════════════════════════════════════════════════════════
// 6 · CORREGIR A UNA PERSONA DESPUÉS DEL ALTA (H-04)
//
// Hasta esta ola, los CUATRO únicos escritores de EduUser en todo el repo
// eran `isActive`, `permissionsOverride`, la cédula profesional (como efecto
// secundario de expedir una receta) y `mustChangePassword`. El alta capturaba
// cinco campos y ninguno se podía corregir: un correo mal tecleado dejaba a
// esa persona fuera para siempre, una alumna que se casaba se quedaba con el
// apellido viejo impreso en cada nota clínica que firmara el resto de su
// carrera, y un docente que ascendía a coordinación necesitaba OTRA cuenta
// —con su historial clínico colgando del id viejo—.
// ═══════════════════════════════════════════════════════════════════════

/** Los campos corregibles de una persona. Solo viaja lo que se manda. */
export interface EduTeamPersonaEdit {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string | null;
  role?: EduRole;
}

export interface EduTeamPersonaEditCheck {
  value: EduTeamPersonaEdit | null;
  error: string | null;
}

/**
 * Valida una CORRECCIÓN: solo los campos presentes, con las mismas reglas
 * que el alta (los mismos helpers, no una copia — dos validaciones distintas
 * para el mismo campo acaban aceptando en un sitio lo que el otro rechaza).
 *
 * `phone: null` o `""` significa BORRAR el teléfono, y eso es legítimo: se
 * capturó mal y no hay otro. Por eso `phone` se distingue de "no lo mandes".
 *
 * ⚠️ El correo se normaliza a minúsculas igual que en el alta: Supabase
 * trata el login como insensible a mayúsculas y guardar "Ana@x.mx" haría que
 * la comparación "¿cambió?" diera true en cada guardado.
 */
export function eduTeamPersonaEditInput(input: {
  firstName?: unknown;
  lastName?: unknown;
  email?: unknown;
  phone?: unknown;
  role?: unknown;
}): EduTeamPersonaEditCheck {
  const mal = (error: string): EduTeamPersonaEditCheck => ({ value: null, error });
  const value: EduTeamPersonaEdit = {};

  if (input.firstName !== undefined) {
    const firstName = eduRequiredText(input.firstName, 80);
    if (!firstName) return mal("Falta el nombre (máximo 80 caracteres).");
    value.firstName = firstName;
  }

  if (input.lastName !== undefined) {
    const lastName = eduRequiredText(input.lastName, 80);
    if (!lastName) return mal("Faltan los apellidos (máximo 80 caracteres).");
    value.lastName = lastName;
  }

  if (input.email !== undefined) {
    const email = normalizeEduEmail(input.email);
    if (!email) return mal("Ese correo no parece un correo.");
    value.email = email;
  }

  if (input.phone !== undefined) {
    if (input.phone === null || input.phone === "") {
      value.phone = null;
    } else {
      const phone = normalizeEduPhone(input.phone);
      if (!phone) return mal("Ese teléfono no tiene números suficientes.");
      value.phone = phone;
    }
  }

  if (input.role !== undefined) {
    const role = parseEduTeamRole(input.role);
    if (!role) {
      return mal(
        `El rol tiene que ser uno de: ${EDU_ROLES.map((r) => EDU_ROLE_LABELS[r]).join(", ")}.`,
      );
    }
    value.role = role;
  }

  if (Object.keys(value).length === 0) return mal("No mandaste ningún cambio.");
  return { value, error: null };
}

/**
 * El aviso que la pantalla enseña ANTES de confirmar un cambio de rol.
 *
 * Cambiar de rol no es editar una columna: reescribe qué ve y qué puede
 * hacer esa persona en todo el panel, y —porque el override REEMPLAZA al
 * default del rol— un override viejo escrito para el rol anterior seguiría
 * mandando sobre el rol nuevo. Por eso el cambio de rol lo BORRA, y por eso
 * este texto lo dice antes y no después.
 */
export function eduCambioDeRolAviso(
  nombre: string,
  from: EduRole,
  to: EduRole,
  teniaOverride: boolean,
): string {
  const base = `${nombre} deja de ser ${EDU_ROLE_LABELS[from]} y pasa a ser ${EDU_ROLE_LABELS[to]}. Lo que ya hizo —notas, casos, cobros, calificaciones— no se toca: sigue siendo suyo.`;
  if (!teniaOverride) {
    return `${base} Sus permisos pasan a ser los de ${EDU_ROLE_LABELS[to]}.`;
  }
  return `${base} Tenía permisos personalizados y se BORRAN: pasa a los de ${EDU_ROLE_LABELS[to]}. Si los necesitas, apúntalos antes — no se guardan en ninguna parte.`;
}
