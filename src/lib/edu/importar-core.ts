/**
 * DaleControl INSTITUCIONAL — el motor de IMPORTAR PADRÓN, sin base de datos.
 *
 * Módulo PURO y client-safe (sin prisma, sin `server-only`, sin un
 * `new Date()` escondido): la pantalla lo usa para pintar la SIMULACIÓN y
 * el servidor lo usa para volver a validar exactamente lo mismo. Que sean
 * el mismo código no es elegancia — es la única forma de que la simulación
 * no mienta, y es la misma decisión que ya sostiene `equipo-core.ts` con el
 * pegado de Excel.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * POR QUÉ EXISTE, Y POR QUÉ NO SE IMPORTA EL MOTOR DEL DENTAL
 *
 * El dental tiene un importador («Importar mi clínica», src/lib/import/) y
 * está bien resuelto: magic bytes, exceljs y no SheetJS, tope de filas,
 * autodetección de encabezados, dry-run que enseña fila por fila qué se
 * crearía. Se leyó ENTERO para no olvidar ninguno de esos casos —y están
 * todos aquí— pero **no se importa una línea**: su `EntityHandler` habla de
 * `clinicId`, de `Patient` y de cupos de plan, y engancharse a él ataría el
 * padrón académico a un contrato que no es el suyo. Esta es la traducción,
 * no una copia.
 *
 * QUÉ HACE DISTINTO, Y NO ES CAPRICHO:
 *
 *  1. Aquí importar NO es insertar filas: es **crear cuentas de acceso**.
 *     Cada renglón bueno se convierte en una cuenta de Supabase Auth con su
 *     contraseña temporal, y eso no se deshace (las cuentas no se borran).
 *     Por eso la simulación es obligatoria y por eso el paso de confirmar
 *     dice cuántas cuentas se van a crear, con esas palabras.
 *
 *  2. El choque que importa no es solo el correo: es la **MATRÍCULA**. Es
 *     única por instituto y es lo que se imprime en la credencial; dos
 *     alumnos con la misma es un problema que aparece meses después.
 *
 *  3. La ESPECIALIDAD, la GENERACIÓN y la SEDE se eligen UNA vez para todo
 *     el archivo, no por renglón. Un archivo de importación de padrón es
 *     una generación entrando, y pedir esas tres columnas en el Excel es
 *     pedirle a quien lo arma que teclee cuarenta veces el mismo dato —y
 *     que se equivoque en una.
 * ═══════════════════════════════════════════════════════════════════════
 */
import type { EduRole } from "@/lib/edu/types";
import { eduTeamMemberInput } from "@/lib/edu/equipo-core";
import { normalizeEduMatricula, parseEduSemester } from "@/lib/edu/padron-core";
import { eduNormalizeSearch } from "@/lib/edu/search";

// ═══════════════════════════════════════════════════════════════════════
// 1 · QUÉ SE PUEDE IMPORTAR
// ═══════════════════════════════════════════════════════════════════════

/**
 * Las dos entidades. Se llaman como se llaman en el panel («alumnos»,
 * «docentes») y no `students`/`teachers`: quien lee este código y quien lee
 * la pantalla tienen que estar hablando de lo mismo.
 */
export const EDU_IMPORT_ENTIDADES = ["alumnos", "docentes"] as const;
export type EduImportEntidad = (typeof EDU_IMPORT_ENTIDADES)[number];

export function eduImportEsEntidad(raw: unknown): raw is EduImportEntidad {
  return typeof raw === "string" && (EDU_IMPORT_ENTIDADES as readonly string[]).includes(raw);
}

/** El rol que se le da a cada cuenta según lo que se esté importando. */
export const EDU_IMPORT_ROL: Record<EduImportEntidad, EduRole> = {
  alumnos: "ALUMNO",
  docentes: "DOCENTE",
};

export const EDU_IMPORT_ENTIDAD_LABELS: Record<EduImportEntidad, string> = {
  alumnos: "Estudiantes",
  docentes: "Docentes",
};

/** Un campo del archivo que este motor sabe leer. */
export interface EduImportCampo {
  key: string;
  label: string;
  /** Sin él no se puede crear el renglón. */
  requerido: boolean;
  /** Encabezados que se reconocen solos, YA normalizados. */
  variantes: string[];
  ayuda?: string;
}

/**
 * 🔴 LAS VARIANTES SE COMPARAN NORMALIZADAS (sin acentos, sin espacios ni
 * guiones bajos, en minúsculas), así que "Apellido Paterno", "apellido_
 * paterno" y "APELLIDOS" caen todas en el mismo sitio. Lo que NO reconoce
 * se queda sin mapear y la pantalla lo pide a mano: adivinar una columna
 * mal es peor que preguntar.
 */
export const EDU_IMPORT_CAMPOS: Record<EduImportEntidad, EduImportCampo[]> = {
  alumnos: [
    {
      key: "firstName",
      label: "Nombre",
      requerido: true,
      variantes: ["nombre", "nombres", "nombredepila", "firstname", "primernombre"],
    },
    {
      key: "lastName",
      label: "Apellidos",
      requerido: true,
      variantes: [
        "apellido",
        "apellidos",
        "apellidopaterno",
        "apellidos y nombres",
        "lastname",
        "apellidoscompletos",
      ],
    },
    {
      key: "email",
      label: "Correo",
      requerido: true,
      variantes: ["email", "correo", "correoelectronico", "mail", "emailaddress", "correoinstitucional"],
      ayuda: "Es con lo que entra al panel. Tiene que ser único en el instituto.",
    },
    {
      key: "matricula",
      label: "Matrícula",
      requerido: true,
      variantes: ["matricula", "matriculas", "numerodecuenta", "numcuenta", "cuenta", "expediente", "clave", "boleta"],
      ayuda: "Única en todo el instituto. Se guarda en MAYÚSCULAS y sin espacios.",
    },
    {
      key: "semester",
      label: "Semestre",
      requerido: false,
      variantes: ["semestre", "sem", "ciclo", "cuatrimestre", "semester"],
      ayuda: "Un número del 1 al 20. Si falta, se usa el que elijas abajo.",
    },
    {
      key: "phone",
      label: "Teléfono",
      requerido: false,
      variantes: ["telefono", "celular", "whatsapp", "movil", "phone", "tel"],
    },
  ],
  docentes: [
    {
      key: "firstName",
      label: "Nombre",
      requerido: true,
      variantes: ["nombre", "nombres", "nombredepila", "firstname", "primernombre"],
    },
    {
      key: "lastName",
      label: "Apellidos",
      requerido: true,
      variantes: ["apellido", "apellidos", "apellidopaterno", "lastname", "apellidoscompletos"],
    },
    {
      key: "email",
      label: "Correo",
      requerido: true,
      variantes: ["email", "correo", "correoelectronico", "mail", "emailaddress", "correoinstitucional"],
      ayuda: "Es con lo que entra al panel. Tiene que ser único en el instituto.",
    },
    {
      key: "phone",
      label: "Teléfono",
      requerido: false,
      variantes: ["telefono", "celular", "whatsapp", "movil", "phone", "tel"],
    },
  ],
};

/**
 * Techo de renglones de UN archivo.
 *
 * 1 000 y no 5 000 (el del dental) por una razón concreta: aquí cada
 * renglón bueno es una llamada a Supabase Auth de unos cientos de
 * milisegundos, no un `createMany`. Mil cuentas ya son veinte tandas de
 * cincuenta segundos; cinco mil serían una tarde y media generación creada
 * si algo se corta. Una escuela importa generaciones de 20 a 200.
 */
export const EDU_IMPORT_MAX_FILAS = 1000;

/** Tope del archivo. El mismo que el importador del dental. */
export const EDU_IMPORT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Cuántos renglones se CREAN por petición al confirmar.
 *
 * El mismo número que el alta masiva de equipo, y por el mismo motivo
 * (`EDU_TEAM_BULK_CHUNK`): cada alta es una llamada a Supabase Auth, y
 * doscientas en una sola petición se comen el tiempo máximo de la función a
 * mitad de la generación. La pantalla parte la lista y enseña el avance.
 */
export const EDU_IMPORT_CHUNK = 25;

// ═══════════════════════════════════════════════════════════════════════
// 2 · EL MAPEO DE COLUMNAS
// ═══════════════════════════════════════════════════════════════════════

/** encabezado del archivo → campo canónico. "" = no se importa. */
export type EduImportMapeo = Record<string, string>;

/** Normaliza un encabezado para compararlo: sin acentos, sin separadores. */
export function eduImportNormaliza(raw: unknown): string {
  return eduNormalizeSearch(typeof raw === "string" ? raw : String(raw ?? "")).replace(
    /[\s_\-.]/g,
    "",
  );
}

/**
 * Autodetección: qué columna del archivo es cada campo.
 *
 * 🔴 LA PRIMERA GANA. Si el archivo trae dos columnas que se llaman igual
 * (Excel las desambigua con `_1`), la segunda se queda sin mapear en vez de
 * pisar a la primera — y la pantalla la enseña sin asignar, que es
 * exactamente lo que hay que ver.
 */
export function eduImportAutodetecta(
  columnas: string[],
  entidad: EduImportEntidad,
): EduImportMapeo {
  const campos = EDU_IMPORT_CAMPOS[entidad];
  const mapeo: EduImportMapeo = {};
  const usados = new Set<string>();
  for (const col of columnas) {
    const n = eduImportNormaliza(col);
    if (!n) continue;
    for (const campo of campos) {
      if (usados.has(campo.key)) continue;
      if (campo.variantes.includes(n)) {
        mapeo[col] = campo.key;
        usados.add(campo.key);
        break;
      }
    }
  }
  return mapeo;
}

/**
 * Limpia el mapeo que manda el navegador: solo encabezados que existen de
 * verdad en el archivo y campos que este motor sabe escribir.
 *
 * 🔴 NO se confía en el cliente. Sin esto, un mapeo fabricado a mano podría
 * nombrar un campo que no está en el catálogo y colarlo en el `data` del
 * create.
 */
export function eduImportSaneaMapeo(
  crudo: unknown,
  columnas: string[],
  entidad: EduImportEntidad,
): EduImportMapeo {
  if (!crudo || typeof crudo !== "object" || Array.isArray(crudo)) return {};
  const validos = new Set(EDU_IMPORT_CAMPOS[entidad].map((c) => c.key));
  const existentes = new Set(columnas);
  const salida: EduImportMapeo = {};
  const usados = new Set<string>();
  for (const [col, campo] of Object.entries(crudo as Record<string, unknown>)) {
    if (typeof campo !== "string" || !campo) continue;
    if (!existentes.has(col) || !validos.has(campo)) continue;
    // Dos columnas al mismo campo: gana la primera. Si no, el valor que
    // acaba guardado depende del orden de las claves de un objeto JSON, que
    // no es una cosa sobre la que se deba construir un padrón.
    if (usados.has(campo)) continue;
    usados.add(campo);
    salida[col] = campo;
  }
  return salida;
}

/** ¿Falta algún campo obligatorio? Devuelve el texto del "no", o null. */
export function eduImportValidaMapeo(
  mapeo: EduImportMapeo,
  entidad: EduImportEntidad,
): string | null {
  const asignados = new Set(Object.values(mapeo).filter(Boolean));
  const faltan = EDU_IMPORT_CAMPOS[entidad]
    .filter((c) => c.requerido && !asignados.has(c.key))
    .map((c) => c.label);
  if (faltan.length === 0) return null;
  return `Falta decir qué columna es ${faltan.join(", ")}. Sin ${faltan.length === 1 ? "esa columna" : "esas columnas"} no se puede crear a nadie.`;
}

/** Aplica el mapeo: fila por encabezado → fila por campo canónico. */
export function eduImportAplicaMapeo(
  filas: Record<string, unknown>[],
  mapeo: EduImportMapeo,
): Record<string, unknown>[] {
  const pares = Object.entries(mapeo).filter(([, campo]) => campo);
  return filas.map((cruda) => {
    const out: Record<string, unknown> = {};
    for (const [col, campo] of pares) {
      const v = cruda[col];
      if (v === undefined || v === null || String(v).trim() === "") continue;
      if (out[campo] === undefined) out[campo] = v;
    }
    return out;
  });
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · LA SIMULACIÓN — qué se crearía y qué chocaría
// ═══════════════════════════════════════════════════════════════════════

export type EduImportEstado =
  /** Se va a crear. */
  | "ok"
  /** No se puede crear: le falta algo o está mal escrito. */
  | "error"
  /** Se puede leer pero CHOCA con algo que ya existe. No se crea. */
  | "choca";

export interface EduImportDatos {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  /** Solo alumnos. */
  matricula?: string | null;
  /** Solo alumnos. Ya resuelto contra el semestre por defecto. */
  semester?: number | null;
}

export interface EduImportFila {
  /** Renglón en el ARCHIVO, contando el encabezado (el primer dato es 2). */
  linea: number;
  estado: EduImportEstado;
  datos: EduImportDatos;
  /** Por qué no se crea. Vacío cuando el estado es "ok". */
  problemas: string[];
  /** Se crea igual, pero hay que saberlo antes de darle a confirmar. */
  avisos: string[];
}

export interface EduImportResumen {
  total: number;
  listas: number;
  conError: number;
  chocan: number;
}

export function eduImportResumen(filas: EduImportFila[]): EduImportResumen {
  return {
    total: filas.length,
    listas: filas.filter((f) => f.estado === "ok").length,
    conError: filas.filter((f) => f.estado === "error").length,
    chocan: filas.filter((f) => f.estado === "choca").length,
  };
}

/** Lo que ya existe en la base, para poder decir qué chocaría. */
export interface EduImportExistente {
  /** Correos que YA están en ESTE instituto (en minúsculas). */
  correosDelInstituto: Set<string>;
  /** Matrículas que YA están en ESTE instituto (normalizadas). */
  matriculas: Set<string>;
  /**
   * Correos que tienen cuenta en DaleControl pero NO en este instituto (el
   * panel dental, u otra escuela). No son un choque: son un AVISO, porque
   * a esa persona se le enlaza su cuenta y **no se le enseña ninguna
   * contraseña temporal** — entra con la suya de siempre. Quien importa
   * tiene que saberlo antes, o buscará cuarenta contraseñas y encontrará
   * treinta y ocho.
   */
  correosDeOtroProducto: Set<string>;
}

export function eduImportSinExistentes(): EduImportExistente {
  return {
    correosDelInstituto: new Set(),
    matriculas: new Set(),
    correosDeOtroProducto: new Set(),
  };
}

/**
 * Valida el archivo entero y dice, renglón por renglón, qué pasaría.
 *
 * PURA: lo que ya existe entra por parámetro (`existente`), así que se
 * puede probar sin base de datos y el servidor la vuelve a llamar con los
 * datos frescos antes de crear nada.
 *
 * 🔴 LOS REPETIDOS DENTRO DEL PROPIO ARCHIVO se marcan en el SEGUNDO y
 * siguientes, no en el primero. Sin esto, un archivo con dos veces
 * "ana@…" crearía la cuenta la primera vez y fallaría la segunda con un
 * error de base de datos que nadie relacionaría con el renglón 47.
 *
 * 🔴 UN RENGLÓN QUE CHOCA **NO SE CREA**, y no hay opción de "crearlo
 * igual". En el importador del dental existe `skipDuplicates: false`
 * porque allá un duplicado es un paciente de más y se fusiona después;
 * aquí un duplicado sería una segunda cuenta de acceso para la misma
 * persona, o dos alumnos con la misma matrícula impresa en la credencial.
 */
export function eduImportSimula(opciones: {
  entidad: EduImportEntidad;
  /** Filas ya mapeadas a campos canónicos, en el orden del archivo. */
  filas: Record<string, unknown>[];
  /** Semestre para los renglones que no lo traigan (solo alumnos). */
  semestrePorDefecto?: number;
  existente?: EduImportExistente;
  /** Desde qué renglón del archivo cuenta la primera fila (2 = tras el encabezado). */
  primeraLinea?: number;
}): EduImportFila[] {
  const { entidad, filas } = opciones;
  const existente = opciones.existente ?? eduImportSinExistentes();
  const primeraLinea = opciones.primeraLinea ?? 2;
  const semestrePorDefecto = opciones.semestrePorDefecto ?? 1;

  const correosVistos = new Set<string>();
  const matriculasVistas = new Set<string>();
  const salida: EduImportFila[] = [];

  for (let i = 0; i < filas.length; i++) {
    const cruda = filas[i] ?? {};
    const fila: EduImportFila = {
      linea: primeraLinea + i,
      estado: "ok",
      datos: { firstName: "", lastName: "", email: "", phone: null },
      problemas: [],
      avisos: [],
    };

    // 🔴 LA MISMA validación que el alta individual y que el pegado de
    // Excel (`eduTeamMemberInput`, equipo-core.ts). Tres validaciones
    // distintas para el mismo campo acaban aceptando en un sitio lo que
    // otro rechaza — y en este producto ese "sitio" crea cuentas.
    const check = eduTeamMemberInput({
      firstName: cruda.firstName,
      lastName: cruda.lastName,
      email: cruda.email,
      role: EDU_IMPORT_ROL[entidad],
      phone: cruda.phone,
    });

    if (!check.value) {
      fila.estado = "error";
      fila.problemas.push(check.error ?? "No se pudo leer este renglón.");
      // Se guarda lo que se alcanzó a leer para que la pantalla pueda
      // enseñar de QUIÉN es el renglón malo: una lista de errores sin
      // nombre no se puede corregir.
      fila.datos = {
        firstName: texto(cruda.firstName),
        lastName: texto(cruda.lastName),
        email: texto(cruda.email).toLowerCase(),
        phone: null,
      };
      salida.push(fila);
      continue;
    }

    fila.datos = {
      firstName: check.value.firstName,
      lastName: check.value.lastName,
      email: check.value.email,
      phone: check.value.phone,
    };

    // ── La matrícula, solo para alumnos ────────────────────────────────
    if (entidad === "alumnos") {
      const matricula = normalizeEduMatricula(cruda.matricula);
      if (!matricula) {
        fila.estado = "error";
        fila.problemas.push("Falta la matrícula (máximo 30 caracteres).");
      } else {
        fila.datos.matricula = matricula;
      }

      const crudoSem = cruda.semester;
      if (crudoSem === undefined || crudoSem === null || String(crudoSem).trim() === "") {
        fila.datos.semester = semestrePorDefecto;
      } else {
        const sem = parseEduSemester(String(crudoSem).trim());
        if (!sem) {
          fila.estado = "error";
          fila.problemas.push("El semestre tiene que ser un número entre 1 y 20.");
        } else {
          fila.datos.semester = sem;
        }
      }
    }

    if (fila.estado === "error") {
      salida.push(fila);
      continue;
    }

    // ── Los choques ───────────────────────────────────────────────────
    const email = fila.datos.email;
    const matricula = fila.datos.matricula ?? null;

    if (correosVistos.has(email)) {
      fila.estado = "choca";
      fila.problemas.push("Ese correo aparece dos veces en el archivo.");
    } else if (existente.correosDelInstituto.has(email)) {
      fila.estado = "choca";
      fila.problemas.push("Ya hay alguien con ese correo en este instituto.");
    }

    if (matricula) {
      if (matriculasVistas.has(matricula)) {
        fila.estado = "choca";
        fila.problemas.push(`La matrícula ${matricula} aparece dos veces en el archivo.`);
      } else if (existente.matriculas.has(matricula)) {
        fila.estado = "choca";
        fila.problemas.push(`La matrícula ${matricula} ya está en uso en este instituto.`);
      }
    }

    // Los "vistos" se marcan aunque el renglón choque: si el archivo trae
    // el mismo correo TRES veces, hay que marcar el segundo y el tercero.
    correosVistos.add(email);
    if (matricula) matriculasVistas.add(matricula);

    // ── Los avisos: se crea, pero conviene saberlo ────────────────────
    if (fila.estado === "ok" && existente.correosDeOtroProducto.has(email)) {
      fila.avisos.push(
        "Ese correo ya tiene cuenta en DaleControl (el panel dental u otro instituto): se le enlaza esa cuenta y NO se le genera contraseña temporal — entra con la suya de siempre.",
      );
    }

    salida.push(fila);
  }

  return salida;
}

/** Las que se crearían de verdad. */
export function eduImportFilasListas(filas: EduImportFila[]): EduImportFila[] {
  return filas.filter((f) => f.estado === "ok");
}

function texto(raw: unknown): string {
  if (raw === undefined || raw === null) return "";
  return String(raw).trim().slice(0, 160);
}

// ═══════════════════════════════════════════════════════════════════════
// 4 · EL RESULTADO DE CREAR
// ═══════════════════════════════════════════════════════════════════════

/**
 * Qué pasó con cada renglón al confirmar.
 *
 * `inscrito` distingue el caso que hay que poder ver: la CUENTA se creó y
 * la ficha académica no. Pasa si alguien se lleva la matrícula entre la
 * simulación y el confirmar, y no es una catástrofe —la persona existe en
 * Equipo y se le inscribe a mano— pero tiene que salir en pantalla en vez
 * de contarse como éxito.
 */
export interface EduImportResultado {
  linea: number;
  ok: boolean;
  name: string;
  email: string;
  matricula: string | null;
  /** La temporal, UNA vez. `null` si se reusó una cuenta que ya existía. */
  tempPassword: string | null;
  reused: boolean;
  /** Solo alumnos: ¿quedó también su ficha académica? */
  inscrito: boolean;
  error: string | null;
}

/**
 * La tabla de credenciales en texto, para el botón de «copiar todo».
 *
 * Separada por TABULADORES para que se pegue en columnas en Excel o en
 * Google Sheets — que es exactamente lo que va a hacer quien acaba de dar
 * de alta a una generación entera. Quien reusó cuenta sale con el aviso
 * escrito en vez de una celda vacía: un hueco se lee como "no se creó", y
 * sí se creó.
 */
export function eduImportCredencialesTexto(
  resultados: EduImportResultado[],
  entidad: EduImportEntidad,
): string {
  const conMatricula = entidad === "alumnos";
  const cabecera = [
    "Nombre",
    "Correo",
    ...(conMatricula ? ["Matrícula"] : []),
    "Contraseña temporal",
  ].join("\t");
  const filas = resultados
    .filter((r) => r.ok)
    .map((r) =>
      [
        r.name,
        r.email,
        ...(conMatricula ? [r.matricula ?? ""] : []),
        r.tempPassword ?? "(ya tenía cuenta: entra con su contraseña de siempre)",
      ].join("\t"),
    );
  return [cabecera, ...filas].join("\n");
}
