/**
 * `procedimientos_y_precios` — el catálogo de ESTA clínica: qué trata, cuánto
 * cobra por cada cosa y cuánto dura.
 *
 * Es lo que le faltaba a Sabina para dejar de sonar genérica: sabía de
 * odontología, no sabía que AQUÍ la limpieza son $800 y dura 40 minutos.
 *
 * ── DE DÓNDE SALE EL DATO ──────────────────────────────────────────────
 * De `ProcedureCatalog` (tabla `procedure_catalog`), que es exactamente la
 * pantalla Procedimientos del panel y la misma fuente que leen presupuestos,
 * facturas y el odontograma (`lib/quotes/service.ts`, `lib/odontogram/snapshot.ts`).
 * Mismo `where` que `GET /api/procedures` —clínica de la sesión, `isActive`— y
 * mismo orden (categoría, nombre), para que Sabina y la pantalla no listen
 * cosas distintas.
 *
 * 🔴 EL PRECIO NO SE CALCULA NUNCA. Sale de `basePrice` tal cual, y es un
 * precio de LISTA: la factura puede llevar descuento (`billing.edit`). Por eso
 * la herramienta lleva `avisoObligatorio`: si Sabina dio un precio, la respuesta
 * final tiene que decir que es el de lista, aunque el modelo se lo salte. Un
 * precio dicho de más o de menos es dinero mal cobrado.
 *
 * 🔴 Y NO ELIGE. Si «resina» coincide con tres filas, devuelve las tres y el
 * `resumen` le ORDENA al modelo enseñarlas todas y preguntar cuál. El catálogo
 * no tiene una clave única por nombre, así que dos filas casi iguales con
 * precios distintos son un caso real, no un caso raro.
 *
 * ── EL PERMISO, Y POR QUÉ NO ES `procedures.view` ──────────────────────
 * `billing.view`. Parece lo contrario de lo que pide el nombre, así que aquí
 * está el porqué, medido en el código:
 *
 *  · `GET /api/procedures` —la puerta por la que el panel sirve este catálogo—
 *    está abierta a CUALQUIER sesión, y su comentario dice por qué: «es el
 *    catálogo de precios que leen facturas, presupuestos y la consulta, y
 *    doctor/recepción no tienen procedures.view» (src/app/api/procedures/route.ts).
 *  · `procedures.view` gatea la PANTALLA de Configuración → Procedimientos, la
 *    de editar. Por default NO la tienen ni DOCTOR ni RECEPTIONIST
 *    (`ROLE_DEFAULT_PERMISSIONS`), que son justo quienes preguntan «¿cuánto le
 *    cobro por una resina?».
 *  · Un precio es dinero, y el dinero en este producto se gatea con `billing.*`.
 *    `billing.view` la tienen por default los cinco roles que usan el panel, así
 *    que Sabina contesta a quien el panel ya le enseña el precio, y calla ante
 *    quien el SUPER_ADMIN le quitó el acceso al dinero.
 *
 * Con `procedures.view` esta herramienta nacería muerta para el doctor. Si
 * Rafael prefiere la otra lectura, es cambiar esta línea y nada más.
 */

import { z } from "zod";
import {
  dbDe,
  definirHerramienta,
  fraseRecorte,
  lineasDeLista,
  pesos,
  pesosDeLista,
  plural,
  recortar,
  type Lista,
} from "./base";
import { normal } from "./agenda-comun";
import type { SabinaCtx } from "../tipos";

const parametros = z.object({
  /** Texto del procedimiento: «limpieza», «resina», «endodoncia». Sin él, el catálogo entero. */
  busqueda: z.string().min(2).max(60).optional(),
  /** Categoría tal como la guarda la clínica: «dental», «aesthetic», «general». */
  categoria: z.string().min(2).max(40).optional(),
});

export type ParamsProcedimientos = z.infer<typeof parametros>;

/**
 * Cuántas filas del catálogo se leen para filtrarlas aquí.
 *
 * El filtro va EN MEMORIA y no en el `where` a propósito: `mode: "insensitive"`
 * de Prisma es ILIKE, que ignora mayúsculas pero NO acentos (el hallazgo 38 del
 * buscador de pacientes), así que «extraccion» no encontraría «Extracción» —
 * que es como lo escribe un doctor con prisa. `normal()` sí dobla los acentos.
 * El precio de hacerlo aquí es traerse el catálogo: la pantalla ya lo hace sin
 * tope ninguno, y una clínica real tiene decenas, no miles. El tope está por el
 * pooler y por el contexto, y cuando muerde se DICE en el resumen.
 */
const TOPE_LECTURA = 500;

/**
 * Con más coincidencias que esto, la descripción no viaja.
 *
 * La descripción contesta «¿qué incluye la limpieza?», que siempre es una
 * pregunta concreta de uno o dos procedimientos. En el listado entero solo
 * multiplica los tokens de salida —y el cobro— sin contestar nada.
 */
const TOPE_CON_DESCRIPCION = 8;

export interface ProcedimientoFila {
  nombre: string;
  /** `basePrice` tal cual. Precio de LISTA: una factura puede descontarlo. */
  precio: number;
  /** `null` = la clínica no le configuró duración. NO se inventa una. */
  duracionMinutos: number | null;
  categoria: string;
  /** Solo si hubo pocas coincidencias (`TOPE_CON_DESCRIPCION`). */
  descripcion?: string | null;
}

export interface DatosProcedimientos {
  procedimientos: Lista<ProcedimientoFila>;
  /** Procedimientos ACTIVOS que tiene la clínica en total, sin filtro. 0 = catálogo vacío. */
  enElCatalogo: number;
  /** Lo que se buscó, para poder citarlo en el resumen. */
  busqueda: string | null;
  categoria: string | null;
  /** El catálogo pasa de `TOPE_LECTURA` y la búsqueda solo miró las primeras. */
  lecturaRecortada: boolean;
}

/** El aviso que la respuesta final tiene que llevar si Sabina dio un precio. */
const AVISO_LISTA = {
  frase: "Es el precio de lista del catálogo; una factura puede llevar descuento.",
  marca: "precio de lista",
};

/** ¿Este texto contiene TODAS las palabras buscadas? Acentos doblados. */
function coincide(heno: string, palabras: string[]): boolean {
  return palabras.every((p) => heno.indexOf(p) !== -1);
}

export const procedimientosYPrecios = definirHerramienta<ParamsProcedimientos, DatosProcedimientos>({
  nombre: "procedimientos_y_precios",
  descripcion:
    "El catálogo de ESTA clínica: qué procedimientos ofrece, cuánto cobra por cada uno y cuánto dura. " +
    "Úsala para «¿cuánto cobramos por una limpieza?», «¿hacemos endodoncia?» o «¿qué tratamientos " +
    "ofrecemos?», y ANTES de agendar un tratamiento por su nombre, para pasarle su duración real a " +
    "agendar_cita. Sin `busqueda` devuelve el catálogo entero.",
  parametros,
  permiso: "billing.view",

  async ejecutar(ctx: SabinaCtx, params): Promise<DatosProcedimientos> {
    const db = dbDe(ctx);
    // 🔴 clinicId de la SESIÓN. `isActive` porque un procedimiento dado de baja
    // no se cobra: es el mismo filtro del GET que alimenta la pantalla.
    const where = { clinicId: ctx.clinicId, isActive: true };

    const [crudas, enElCatalogo] = await Promise.all([
      db.procedureCatalog.findMany({
        where,
        // El orden de `GET /api/procedures`, para listar como lista la pantalla.
        orderBy: [{ category: "asc" }, { name: "asc" }],
        take: TOPE_LECTURA,
        select: { name: true, basePrice: true, duration: true, category: true, description: true },
      }),
      db.procedureCatalog.count({ where }),
    ]);

    const palabras = normal(params.busqueda).split(" ").filter(Boolean);
    const cat = normal(params.categoria);
    const filtradas = crudas.filter((p: any) => {
      if (cat && normal(p.category) !== cat) return false;
      if (palabras.length === 0) return true;
      return coincide(`${normal(p.name)} ${normal(p.description)}`, palabras);
    });

    const conDescripcion = filtradas.length <= TOPE_CON_DESCRIPCION;
    const filas: ProcedimientoFila[] = filtradas.map((p: any) => ({
      nombre: String(p.name ?? "").trim(),
      // El precio se copia, no se redondea ni se recalcula.
      precio: Number(p.basePrice ?? 0),
      duracionMinutos: typeof p.duration === "number" && p.duration > 0 ? p.duration : null,
      categoria: String(p.category ?? "").trim(),
      ...(conDescripcion && p.description ? { descripcion: String(p.description).trim().slice(0, 300) } : {}),
    }));

    return {
      procedimientos: recortar(filas, filas.length),
      enElCatalogo,
      busqueda: params.busqueda ?? null,
      categoria: params.categoria ?? null,
      lecturaRecortada: enElCatalogo > TOPE_LECTURA,
    };
  },

  /**
   * «No hay datos» solo cuando la clínica SÍ tiene catálogo y la búsqueda no
   * encontró nada. Un catálogo VACÍO no es «sin datos»: es una respuesta con
   * contenido («la clínica no ha cargado sus procedimientos»), y confundir las
   * dos es la misma trampa que confundir una lista vacía con un «no tienes
   * acceso». Ojo: la pantalla siembra 26 procedimientos dentales la primera vez
   * que alguien la abre (`GET /api/procedures`); Sabina no siembra nada.
   */
  vacio: (d) => d.enElCatalogo > 0 && d.procedimientos.total === 0,

  // Si Sabina dio un precio, la respuesta lleva de dónde sale. Con el catálogo
  // vacío no hay precio que matizar.
  avisoObligatorio: (d) => (d.procedimientos.total > 0 ? AVISO_LISTA : null),

  resumir(d) {
    if (d.enElCatalogo === 0) {
      return (
        "El catálogo de Procedimientos de esta clínica está vacío: no hay ningún procedimiento activo, " +
        "así que no tengo precios ni duraciones que darte. Se cargan desde Procedimientos, en el panel. " +
        "No inventes ninguno."
      );
    }

    const filas = d.procedimientos.filas;
    // El recorte de lectura se dice en TODAS las ramas. Un catálogo de 620
    // procedimientos deja fuera las últimas categorías, y la peor salida posible
    // es caer en la rama de «uno solo» y dar UN precio con tono de respuesta
    // cerrada cuando había otras tres resinas fuera del corte.
    const recorte = d.lecturaRecortada
      ? ` (el catálogo tiene ${d.enElCatalogo}; miré los primeros ${TOPE_LECTURA} por orden alfabético, puede haber más)`
      : "";
    const monto = pesosDeLista(filas.map((f) => f.precio));
    const linea = (f: ProcedimientoFila) =>
      `${f.nombre} — ${monto(f.precio)}` +
      (f.duracionMinutos === null ? " (sin duración configurada)" : ` · ${f.duracionMinutos} min`) +
      (f.descripcion ? ` — ${f.descripcion}` : "");

    // Uno solo: es la respuesta, y con la duración lista para agendar.
    if (filas.length === 1) {
      const f = filas[0];
      const dur =
        f.duracionMinutos === null
          ? " La clínica no le configuró duración: si vas a agendarlo, pregunta cuánto va a durar; no supongas."
          : ` Dura ${f.duracionMinutos} min: si vas a agendarlo, pásale duracionMinutos: ${f.duracionMinutos} a agendar_cita.`;
      return `${f.nombre}: ${pesos(f.precio)}${f.descripcion ? ` (${f.descripcion})` : ""}.${dur}${recorte}`;
    }

    // 🔴 Varias coincidencias = varios precios. La orden de no elegir vive AQUÍ,
    // en el resumen, y no en la descripción: así se paga cuando hace falta y no
    // en cada una de las preguntas de todas las clínicas.
    if (d.busqueda && filas.length > 1) {
      return (
        `Hay ${plural(d.procedimientos.total, "procedimiento que coincide", "procedimientos que coinciden")} ` +
        `con «${d.busqueda}»${fraseRecorte(d.procedimientos, "procedimientos")}${recorte}, y cada uno tiene SU precio. ` +
        `Enséñaselos todos y pregunta cuál quiere; no elijas tú ni des un precio "aproximado":` +
        lineasDeLista(filas, linea)
      );
    }

    const cab = `${plural(d.procedimientos.total, "procedimiento activo", "procedimientos activos")}` +
      (d.categoria ? ` en la categoría «${d.categoria}»` : " en el catálogo de la clínica") +
      `${fraseRecorte(d.procedimientos, "procedimientos")}${recorte}:`;
    return `${cab}${lineasDeLista(filas, linea)}`;
  },
});
