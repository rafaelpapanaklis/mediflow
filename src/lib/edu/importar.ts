/**
 * DaleControl INSTITUCIONAL — IMPORTAR PADRÓN contra la base de datos.
 *
 * SERVIDOR: importa prisma, exceljs y Supabase Auth (a través de
 * `equipo.ts`). Lo puro —el mapeo de columnas, la validación de cada
 * renglón y la simulación— vive en `importar-core.ts` y se prueba sin base
 * de datos.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 LO QUE ESTE ARCHIVO **NO** HACE, Y ES LO MÁS IMPORTANTE
 *
 * NO crea cuentas por su cuenta. Cada renglón pasa por
 * `createEduTeamMember` (equipo.ts) y cada ficha académica por
 * `createEduStudent` (padron.ts) — los mismos que usa el alta de una sola
 * persona. Un importador con su propio camino de escritura es un importador
 * que, dentro de seis meses, no se entera de la regla nueva: se saltaría el
 * guardia del rol DIRECCION (H-16), el índice de búsqueda sin acentos, la
 * marca `mustChangePassword`, el rastro de quién dio de alta y la bitácora.
 * Aquí solo se LEE el archivo, se decide qué se puede crear, y se llama a
 * quien ya sabe crearlo.
 *
 * Y NO escribe `edu_user_campus_access`: eso lo hace `campus.ts`, que es su
 * único escritor, a través del mismo alta.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 DOS PASOS, Y EL DE EN MEDIO ES EL QUE IMPORTA
 *
 *   1. SIMULAR (`eduImportSimular`) — lee el archivo, propone el mapeo de
 *      columnas y contesta, renglón por renglón, qué se crearía y qué
 *      chocaría. No escribe NADA.
 *   2. CONFIRMAR (`eduImportCrear`) — crea, por trozos.
 *
 * Sin la simulación, un archivo con una columna de más crearía doscientas
 * cuentas con el apellido en el correo y no habría forma de deshacerlo: las
 * cuentas de este producto **no se borran** (sus notas clínicas, sus casos y
 * sus cobros las referencian). Ésa es la diferencia con el importador del
 * dental, donde un paciente de más se fusiona después.
 *
 * 🔴 EL SERVIDOR NO SE FÍA DE LA SIMULACIÓN. Al confirmar se vuelve a leer
 * la base y se vuelve a correr `eduImportSimula` sobre lo que llegó: entre
 * el paso 1 y el paso 2 caben otra pestaña y otra persona de dirección
 * llevándose esa matrícula.
 * ═══════════════════════════════════════════════════════════════════════
 */
import * as ExcelJS from "exceljs";
import { Readable } from "stream";
import { prisma } from "@/lib/prisma";
import { validateSpreadsheet } from "@/lib/validate-upload";
import { createEduStudent, EduPadronError } from "@/lib/edu/padron";
import { createEduTeamMember, type EduTeamContext } from "@/lib/edu/equipo";
import { eduAudit, type EduAuditActor } from "@/lib/edu/auditoria";
import { eduTeamFullName } from "@/lib/edu/equipo-core";
import {
  EDU_IMPORT_CAMPOS,
  EDU_IMPORT_CHUNK,
  EDU_IMPORT_ENTIDAD_LABELS,
  EDU_IMPORT_MAX_BYTES,
  EDU_IMPORT_MAX_FILAS,
  eduImportAplicaMapeo,
  eduImportAutodetecta,
  eduImportSaneaMapeo,
  eduImportSimula,
  eduImportValidaMapeo,
  type EduImportEntidad,
  type EduImportExistente,
  type EduImportFila,
  type EduImportMapeo,
  type EduImportResultado,
} from "@/lib/edu/importar-core";

export { EduPadronError as EduImportError };

/** Lo que hace falta de la sesión. Es el mismo de equipo.ts, ni uno nuevo. */
export type EduImportContext = EduTeamContext;

function requireInstitution(ctx: EduImportContext): string {
  const id = ctx?.institutionId;
  if (!id || typeof id !== "string") {
    throw new EduPadronError("Sesión de instituto no válida.", 401);
  }
  return id;
}

function auditor(ctx: EduImportContext): EduAuditActor {
  return {
    institutionId: ctx.institutionId,
    eduUserId: ctx.eduUserId,
    role: ctx.role,
    user: { firstName: ctx.user?.firstName ?? "", lastName: ctx.user?.lastName ?? "" },
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 1 · LEER EL ARCHIVO
//
// 🔴 exceljs y NO SheetJS, y no es una preferencia: SheetJS arrastra dos
// vulnerabilidades ALTAS sin arreglo y esto recibe un archivo que sube
// cualquiera con `equipo.manage`. Es la misma decisión que tomó el
// importador del dental y por el mismo motivo; está escrita en los dos
// sitios porque se toma en los dos.
//
// 🔴 Y SE VALIDA LA FIRMA REAL DEL CONTENIDO, no la extensión: un `.xlsx`
// que por dentro es un ejecutable se rechaza antes de que exceljs lo abra.
// ═══════════════════════════════════════════════════════════════════════

/**
 * El valor de una celda, SIEMPRE COMO TEXTO (salvo las fechas).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 A1 · UN `.xlsx` DE VERDAD TRAE NÚMEROS, Y AQUÍ SE VOLVÍAN NULL.
 *
 * exceljs devuelve el valor TIPADO de la celda: una matrícula `20260001` y
 * un teléfono `5544332211` llegan como `number`, porque Excel los convierte
 * solo al exportar el padrón de cualquier sistema escolar. Y los tres
 * normalizadores que los reciben —`normalizeEduMatricula`,
 * `normalizeEduPhone` y `eduRequiredText`— cortan por tipo con
 * `if (typeof raw !== "string") return null`. Resultado: la simulación salía
 * al 100 % en rojo con «Falta la matrícula» sobre una matrícula que estaba
 * ahí, y el mensaje mentía.
 *
 * La asimetría probaba que era un descuido y no una decisión: el semestre YA
 * se convertía antes de leerse (`String(crudoSem).trim()` en
 * importar-core.ts) y la rama CSV YA venía protegida (todo llega string).
 * Así que la conversión va donde tenía que ir desde el principio: en el
 * único sitio por el que pasan TODAS las celdas de la rama xlsx.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 OLA C·fin 2 · Y UNA CELDA-FECHA EN UNA COLUMNA QUE NO ES DE FECHA.
 *
 * Aquí las fechas se devolvían como `Date`, con el motivo escrito: no hay
 * ninguna columna de fecha en el padrón, y convertirlas decidiría a
 * escondidas un formato (¿`dd/mm` o `mm/dd`?) para el día que la haya. Solo
 * que Excel AUTOFORMATEA a fecha cualquier celda ambigua —una matrícula
 * tecleada `3/22` se guarda como el 22 de marzo—, así que el `Date` no
 * llegaba a ninguna columna de fecha: llegaba a la de la MATRÍCULA, donde
 * `normalizeEduMatricula` corta por tipo y la fila volvía a salir en rojo
 * con «Falta la matrícula» — el mismo mensaje que mentía antes del arreglo
 * de las celdas numéricas.
 *
 * Se devuelve **lo que Excel enseña en la celda** (`cell.text`), que es lo
 * que la persona escribió y lo que tiene delante cuando lee el error. No es
 * inventarse un formato: es no inventarse ninguno y usar el que el propio
 * archivo trae. El día que exista una columna de fecha de verdad, quien la
 * añada la parsea en su normalizador, que es donde se sabe qué se espera.
 * ═══════════════════════════════════════════════════════════════════════
 */
function celdaATexto(cell: ExcelJS.Cell): unknown {
  const v = cell.value as any;
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return cell.text || v;
  if (typeof v === "object") {
    // Fórmula, hipervínculo o texto enriquecido → el texto ya renderizado.
    // Un `{ formula: "…" }` guardado como matrícula sería una matrícula que
    // nadie puede leer.
    if (v.result !== undefined && v.result !== null && typeof v.result !== "object") {
      // Ídem para el resultado de una fórmula: lo que se ve en la celda.
      return v.result instanceof Date ? cell.text || v.result : String(v.result);
    }
    return cell.text ?? "";
  }
  return typeof v === "string" ? v : String(v);
}

async function hojaDelArchivo(
  bytes: ArrayBuffer,
  ext: string,
): Promise<ExcelJS.Worksheet | undefined> {
  const wb = new ExcelJS.Workbook();
  if (ext === "csv") {
    const buf = Buffer.from(bytes);
    // Excel "CSV UTF-8" antepone BOM; sin quitarlo, el PRIMER encabezado no
    // coincide con nada y la columna del nombre se queda sin mapear.
    const limpio =
      buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf
        ? buf.subarray(3)
        : buf;
    // El separador se olfatea en la primera línea: Excel en español exporta
    // con ";" y nadie lo sabe hasta que el archivo entra con una sola
    // columna gigante.
    const primera =
      limpio.subarray(0, Math.min(limpio.length, 4096)).toString("utf8").split(/\r?\n/, 1)[0] ?? "";
    const delimiter = [",", ";", "\t"].reduce((a, b) =>
      primera.split(b).length > primera.split(a).length ? b : a,
    );
    return wb.csv.read(Readable.from([limpio]), {
      parserOptions: { delimiter },
      map: (val: any) => val,
    });
  }
  await wb.xlsx.load(bytes);
  return wb.worksheets[0];
}

/**
 * Encabezados y filas crudas del archivo.
 *
 * Los encabezados salen de la fila 1. Los repetidos se desambiguan con
 * `_1`, `_2` (el mismo criterio del importador del dental) para que dos
 * columnas «Nombre» no se pisen y la segunda se pueda ver sin asignar.
 */
export async function eduImportLeeArchivo(
  file: File,
): Promise<{ columnas: string[]; filas: Record<string, unknown>[] }> {
  const nombre = typeof file?.name === "string" ? file.name : "";
  if (!/\.(xlsx|csv)$/i.test(nombre)) {
    throw new EduPadronError("El archivo tiene que ser .xlsx o .csv.");
  }
  if (file.size > EDU_IMPORT_MAX_BYTES) {
    throw new EduPadronError(
      `El archivo pasa de ${Math.round(EDU_IMPORT_MAX_BYTES / (1024 * 1024))} MB. Pártelo en dos.`,
      413,
    );
  }

  const ext = (nombre.split(".").pop() ?? "").toLowerCase();
  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    throw new EduPadronError("No se pudo leer el archivo. Vuelve a subirlo.");
  }

  const malaFirma = await validateSpreadsheet(bytes, ext);
  if (malaFirma) {
    throw new EduPadronError(
      `Ese archivo no es una hoja de cálculo: ${malaFirma}. Exporta la lista como .xlsx o .csv desde Excel o Google Sheets.`,
    );
  }

  let hoja: ExcelJS.Worksheet | undefined;
  try {
    hoja = await hojaDelArchivo(bytes, ext);
  } catch (err) {
    throw new EduPadronError(
      `No se pudo abrir el archivo: ${err instanceof Error ? err.message : "formato no reconocido"}.`,
    );
  }
  if (!hoja) throw new EduPadronError("El archivo llegó vacío.");

  const encabezados: { col: number; key: string }[] = [];
  const vistos = new Map<string, number>();
  hoja.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    let key = String(cell.text ?? "").trim();
    if (!key) return;
    const n = vistos.get(key) ?? 0;
    vistos.set(key, n + 1);
    if (n > 0) key = `${key}_${n}`;
    encabezados.push({ col, key });
  });
  if (encabezados.length === 0) {
    throw new EduPadronError(
      "La primera fila del archivo tiene que traer los nombres de las columnas (Nombre, Apellidos, Correo…).",
    );
  }

  const filas: Record<string, unknown>[] = [];
  let excedido = false;
  hoja.eachRow({ includeEmpty: false }, (row, numero) => {
    if (numero === 1 || excedido) return;
    const obj: Record<string, unknown> = {};
    let algo = false;
    for (const h of encabezados) {
      const crudo = celdaATexto(row.getCell(h.col));
      obj[h.key] = crudo;
      if (String(crudo ?? "").trim() !== "") algo = true;
    }
    // DESPUÉS del bucle, no antes: si alguien tuviera una columna llamada
    // `__linea` en su Excel, escribirla primero la dejaría pisada y el
    // "renglón 47" del mensaje de error apuntaría a otro sitio.
    obj.__linea = numero;
    // Una fila en blanco a mitad de la hoja es normal (separadores del
    // Excel de alguien): se salta, no se cuenta y no marca error.
    if (!algo) return;
    filas.push(obj);
    if (filas.length > EDU_IMPORT_MAX_FILAS) excedido = true;
  });

  if (excedido) {
    throw new EduPadronError(
      `El archivo trae más de ${EDU_IMPORT_MAX_FILAS} renglones. Pártelo: cada renglón es una cuenta de acceso que hay que crear una por una.`,
      413,
    );
  }
  if (filas.length === 0) {
    throw new EduPadronError("El archivo no trae ningún renglón con datos debajo del encabezado.");
  }

  return { columnas: encabezados.map((h) => h.key), filas };
}

// ═══════════════════════════════════════════════════════════════════════
// 2 · QUÉ HAY YA EN LA BASE
// ═══════════════════════════════════════════════════════════════════════

/**
 * Lo que ya existe, para poder decir qué chocaría. Cuatro consultas (menos
 * de las siete que aguanta el pooler por tanda) y todas acotadas a los
 * valores del archivo: no se trae el padrón entero.
 *
 * 🔴 El tenant va en TODAS: `institutionId` de la sesión. La única que mira
 * fuera del instituto es la de "esta cuenta ya existe en DaleControl", y de
 * ahí solo sale el CORREO —que es el dato que quien importa ya tiene
 * escrito en su archivo—, nunca de qué escuela ni de qué clínica es.
 */
async function leeExistente(
  ctx: EduImportContext,
  correos: string[],
  matriculas: string[],
): Promise<EduImportExistente> {
  const institutionId = requireInstitution(ctx);
  const sinCorreos = correos.length === 0;
  const sinMatriculas = matriculas.length === 0;

  const [enInstituto, conMatricula, enOtroInstituto, enDental] = await Promise.all([
    sinCorreos
      ? Promise.resolve([] as { email: string }[])
      : prisma.eduUser.findMany({
          where: { institutionId, email: { in: correos } },
          select: { email: true },
        }),
    sinMatriculas
      ? Promise.resolve([] as { matricula: string }[])
      : prisma.eduStudent.findMany({
          where: { institutionId, matricula: { in: matriculas } },
          select: { matricula: true },
        }),
    sinCorreos
      ? Promise.resolve([] as { email: string }[])
      : prisma.eduUser.findMany({
          where: { email: { in: correos }, NOT: { institutionId } },
          select: { email: true },
        }),
    sinCorreos
      ? Promise.resolve([] as { email: string }[])
      : prisma.user.findMany({
          where: { email: { in: correos } },
          select: { email: true },
        }),
  ]);

  const deOtroProducto = new Set<string>();
  for (const u of enOtroInstituto) deOtroProducto.add(u.email.toLowerCase());
  for (const u of enDental) if (u.email) deOtroProducto.add(u.email.toLowerCase());

  return {
    correosDelInstituto: new Set(enInstituto.map((u) => u.email.toLowerCase())),
    matriculas: new Set(conMatricula.map((s) => s.matricula)),
    correosDeOtroProducto: deOtroProducto,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · SIMULAR
// ═══════════════════════════════════════════════════════════════════════

export interface EduImportSimulacion {
  entidad: EduImportEntidad;
  /** Los encabezados tal como vienen en el archivo. */
  columnas: string[];
  /** Lo que este motor detectó solo. */
  mapeoSugerido: EduImportMapeo;
  /** El que se aplicó (el de quien importa, saneado; o el sugerido). */
  mapeo: EduImportMapeo;
  filas: EduImportFila[];
  /** El nombre del archivo, para poder decirlo en la pantalla y en la bitácora. */
  archivo: string;
}

export async function eduImportSimular(
  ctx: EduImportContext,
  opciones: {
    entidad: EduImportEntidad;
    file: File;
    /** El mapeo que ajustó a mano quien importa. Se sanea. */
    mapeo?: unknown;
    semestrePorDefecto?: number;
  },
): Promise<EduImportSimulacion> {
  requireInstitution(ctx);
  const { entidad, file } = opciones;

  const { columnas, filas: crudas } = await eduImportLeeArchivo(file);
  const mapeoSugerido = eduImportAutodetecta(columnas, entidad);
  const delCliente = eduImportSaneaMapeo(opciones.mapeo, columnas, entidad);
  const mapeo = Object.keys(delCliente).length > 0 ? delCliente : mapeoSugerido;

  const problema = eduImportValidaMapeo(mapeo, entidad);
  if (problema) {
    // Se lanza con el mapeo detectado dentro del mensaje NO: el mensaje
    // dice qué falta, y la pantalla ya tiene las columnas para ofrecerlas.
    throw new EduPadronError(problema);
  }

  const mapeadas = eduImportAplicaMapeo(crudas, mapeo);
  // La línea REAL del archivo, para que el error diga "renglón 47" y ese 47
  // sea el que se ve en Excel — no el índice del array.
  const lineas = crudas.map((f) => Number(f.__linea) || 0);

  // Primera pasada SIN base, solo para saber qué correos y matrículas
  // preguntar. Preguntar por los 1 000 del archivo cuando 300 están mal
  // escritos es traerse trescientas comparaciones de más.
  const previas = eduImportSimula({
    entidad,
    filas: mapeadas,
    semestrePorDefecto: opciones.semestrePorDefecto,
  });
  const correos = [
    ...new Set(previas.filter((f) => f.datos.email).map((f) => f.datos.email)),
  ];
  const matriculas = [
    ...new Set(previas.map((f) => f.datos.matricula).filter(Boolean) as string[]),
  ];

  const existente = await leeExistente(ctx, correos, matriculas);
  const conBase = eduImportSimula({
    entidad,
    filas: mapeadas,
    semestrePorDefecto: opciones.semestrePorDefecto,
    existente,
  });
  // Se le devuelve su número de renglón del archivo.
  for (let i = 0; i < conBase.length; i++) {
    if (lineas[i] > 0) conBase[i].linea = lineas[i];
  }

  return {
    entidad,
    columnas,
    mapeoSugerido,
    mapeo,
    filas: conBase,
    archivo: typeof file?.name === "string" ? file.name.slice(0, 160) : "",
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 4 · CREAR
// ═══════════════════════════════════════════════════════════════════════

/**
 * Crea un TROZO de la importación.
 *
 * 🔴 SERIE Y NO EN PARALELO, como el alta masiva de equipo y por lo mismo:
 * cada renglón es una llamada a Supabase Auth, y lanzarle veinticinco a la
 * vez es la forma más rápida de que empiece a contestar 429 y media
 * generación se quede sin cuenta con un error que no explica nada.
 *
 * 🔴 UN RENGLÓN QUE FALLA NO TIRA EL TROZO. Se devuelve el resultado POR
 * RENGLÓN, en el mismo orden, con su motivo al lado: quien está mirando
 * tiene que poder copiar las contraseñas de los veinticuatro que sí
 * entraron.
 */
export async function eduImportCrear(
  ctx: EduImportContext,
  opciones: {
    entidad: EduImportEntidad;
    /** Los renglones ya leídos y validados en la simulación. */
    filas: unknown;
    institutionName: string;
    /** Solo alumnos: en qué especialidad y generación se inscriben. */
    programId?: unknown;
    cohortId?: unknown;
    /** Las sedes, ya validadas por eduParseCampusIds en el endpoint. */
    campusIds?: string[];
    semestrePorDefecto?: number;
    archivo?: string;
  },
): Promise<EduImportResultado[]> {
  requireInstitution(ctx);
  const { entidad } = opciones;

  if (!Array.isArray(opciones.filas)) {
    throw new EduPadronError("No mandaste ningún renglón que crear.");
  }
  if (opciones.filas.length === 0) {
    throw new EduPadronError("El trozo llegó vacío.");
  }
  if (opciones.filas.length > EDU_IMPORT_CHUNK) {
    throw new EduPadronError(
      `Manda como mucho ${EDU_IMPORT_CHUNK} renglones por vez. La pantalla parte las listas largas sola.`,
    );
  }
  if (entidad === "alumnos") {
    if (typeof opciones.programId !== "string" || !opciones.programId) {
      throw new EduPadronError("Elige la especialidad en la que se inscriben.");
    }
    if (typeof opciones.cohortId !== "string" || !opciones.cohortId) {
      throw new EduPadronError("Elige la generación en la que se inscriben.");
    }
  }

  // ── 🔴 SE VUELVE A VALIDAR TODO, CONTRA LA BASE DE AHORA ─────────────
  // La simulación la vio el navegador hace un minuto. Entre entonces y
  // ahora caben otra pestaña y otra persona de dirección llevándose esa
  // matrícula, y el índice único la rebotaría con un error de base de datos
  // que nadie relacionaría con el renglón 12.
  const entrantes = (opciones.filas as unknown[]).map((f) => {
    const fila = (f ?? {}) as Record<string, unknown>;
    return {
      __linea: Number(fila.linea) || 0,
      firstName: fila.firstName,
      lastName: fila.lastName,
      email: fila.email,
      phone: fila.phone,
      matricula: fila.matricula,
      semester: fila.semester,
    };
  });

  const previas = eduImportSimula({
    entidad,
    filas: entrantes,
    semestrePorDefecto: opciones.semestrePorDefecto,
  });
  const existente = await leeExistente(
    ctx,
    [...new Set(previas.filter((f) => f.datos.email).map((f) => f.datos.email))],
    [...new Set(previas.map((f) => f.datos.matricula).filter(Boolean) as string[])],
  );
  const revisadas = eduImportSimula({
    entidad,
    filas: entrantes,
    semestrePorDefecto: opciones.semestrePorDefecto,
    existente,
  });

  const campusIds = opciones.campusIds ?? [];
  const salida: EduImportResultado[] = [];
  let creadas = 0;

  for (let i = 0; i < revisadas.length; i++) {
    const fila = revisadas[i];
    const linea = entrantes[i].__linea || fila.linea;
    const nombre = eduTeamFullName({
      firstName: fila.datos.firstName,
      lastName: fila.datos.lastName,
      email: fila.datos.email,
    });

    if (fila.estado !== "ok") {
      salida.push({
        linea,
        ok: false,
        name: nombre,
        email: fila.datos.email,
        matricula: fila.datos.matricula ?? null,
        tempPassword: null,
        reused: false,
        inscrito: false,
        error: fila.problemas.join(" ") || "Este renglón no se puede crear.",
      });
      continue;
    }

    // 1 · LA CUENTA — por el MISMO camino que el alta individual.
    const alta = await createEduTeamMember(
      ctx,
      {
        firstName: fila.datos.firstName,
        lastName: fila.datos.lastName,
        email: fila.datos.email,
        phone: fila.datos.phone,
        role: entidad === "alumnos" ? "ALUMNO" : "DOCENTE",
      },
      opciones.institutionName,
      campusIds,
    );

    if (!alta.ok || !alta.id) {
      salida.push({
        linea,
        ok: false,
        name: nombre,
        email: fila.datos.email,
        matricula: fila.datos.matricula ?? null,
        tempPassword: null,
        reused: alta.reused,
        inscrito: false,
        error: alta.error ?? "No se pudo crear la cuenta.",
      });
      continue;
    }

    creadas += 1;

    // 2 · LA FICHA ACADÉMICA (solo alumnos), por el MISMO camino que
    // «Inscribir estudiante». Si esto falla, la CUENTA ya está creada y no
    // se deshace —las cuentas no se borran—, así que el renglón sale
    // marcado con `inscrito: false` y su motivo: esa persona existe en
    // Equipo y hay que inscribirla a mano. Contarlo como éxito sería
    // esconder un alumno sin generación.
    let inscrito = entidad === "docentes";
    let errorFicha: string | null = null;
    if (entidad === "alumnos") {
      try {
        await createEduStudent(ctx, {
          userId: alta.id,
          programId: opciones.programId,
          cohortId: opciones.cohortId,
          matricula: fila.datos.matricula,
          semester: fila.datos.semester,
        });
        inscrito = true;
      } catch (err) {
        errorFicha =
          err instanceof EduPadronError
            ? err.message
            : "No se pudo inscribir a esta persona en la generación.";
        console.error("[instituto] importar padrón: cuenta creada sin ficha académica:", err);
      }
    }

    salida.push({
      linea,
      ok: true,
      name: nombre,
      email: fila.datos.email,
      matricula: fila.datos.matricula ?? null,
      tempPassword: alta.tempPassword,
      reused: alta.reused,
      inscrito,
      error: errorFicha
        ? `Se creó su cuenta pero NO quedó inscrito: ${errorFicha} Inscríbelo a mano desde Estudiantes.`
        : null,
    });
  }

  // Un renglón de bitácora POR TROZO, además del que ya escribe cada alta.
  // El de cada alta contesta "¿quién creó esta cuenta?"; éste contesta la
  // otra pregunta, que es la que se hace de verdad meses después: "¿de
  // dónde salieron estas cuarenta cuentas?".
  await eduAudit(auditor(ctx), {
    action: "create",
    entity: entidad === "alumnos" ? "student" : "user",
    after: {
      importacion: EDU_IMPORT_ENTIDAD_LABELS[entidad],
      archivo: (opciones.archivo ?? "").slice(0, 160) || "(sin nombre)",
      renglones: revisadas.length,
      creadas,
      sedes: campusIds.length === 0 ? "todas" : campusIds.join(","),
      ...(entidad === "alumnos"
        ? { programId: String(opciones.programId), cohortId: String(opciones.cohortId) }
        : {}),
    },
  });

  return salida;
}

/** Los campos que este motor sabe leer, para pintarlos en el paso de mapeo. */
export function eduImportCamposDe(entidad: EduImportEntidad) {
  return EDU_IMPORT_CAMPOS[entidad];
}
