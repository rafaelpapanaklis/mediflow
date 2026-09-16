/**
 * `odontograma` — «¿qué problemas dentales tiene este paciente?».
 *
 * Es la herramienta que pidió Rafael por su nombre. Hasta hoy Sabina sabía
 * leer recetas, estudios y análisis, pero NO el odontograma: la pantalla donde
 * el doctor marca diente por diente lo que ve.
 *
 * ── DÓNDE VIVE EL ODONTOGRAMA ────────────────────────────────────────────
 * `odontogram_entries` (model `OdontogramEntry`), UNA FILA POR HALLAZGO, no
 * por diente: `(patientId, toothNumber, surface, conditionId)` es la unique, y
 * un mismo diente puede tener varias condiciones y varias caras marcadas.
 *   · `toothNumber` es FDI (11-18, 21-28, 31-38, 41-48; 51-85 en temporales).
 *   · `surface` = M | D | V | L | O, y `null` significa «el diente entero»
 *     (corona, ausente, endodoncia…).
 *   · `conditionId` es un id LIBRE del catálogo de 45 hallazgos que vive en
 *     `@/components/dashboard/odontogram-v2/data.ts` (caries, crown, rct,
 *     missing, implant…). No es un enum de Prisma: la columna es texto.
 *   · `"__note__"` es un conditionId RESERVADO: no es un hallazgo, es la nota
 *     clínica por diente, y el texto va en `notes`.
 *   · «Sano» no se guarda: sano = ausencia de fila (lo dejó así
 *     `sql/odontogram-v2.sql` al borrar las marcas SANO).
 * Aparte existe `odontogram_snapshots`, una foto JSON inmutable del
 * odontograma al cerrar cada consulta. Aquí NO se lee: la pregunta es «qué
 * tiene hoy», y el histórico se ve en su pantalla.
 *
 * 🔴 EL AISLAMIENTO DE CLÍNICA NO PUEDE SALIR DE ESTA TABLA
 * `odontogram_entries` NO tiene `clinicId`: cuelga del paciente. Un
 * `where: { patientId }` a secas es exactamente la fuga de la regla (c) de
 * CLAUDE.md con otra cara: no hay clave de tenant que poner. Por eso lo
 * PRIMERO que hace `ejecutar` es `pacienteVisibleYActivo`, que sí filtra por
 * el `clinicId` de la sesión, por la visibilidad del paciente y por
 * `deletedAt: null`. Si eso no pasa, no se consulta esta tabla en absoluto.
 *
 * ── PERMISO: `medicalRecord.view` ────────────────────────────────────────
 * La pestaña Odontograma de la ficha no pide una key propia (solo sesión +
 * paciente de la clínica), pero `@/lib/odontogram/api-auth` lo dice con todas
 * las letras: «el odontograma es expediente clínico». La key del expediente es
 * `medicalRecord.view`, la misma que ya usa `analisis_y_notas_de_estudio`, y
 * la tienen SUPER_ADMIN, ADMIN y DOCTOR. Sabina queda así un punto MÁS
 * estricta que la pantalla (una recepcionista ve la pestaña y aquí recibe
 * «no tienes acceso al expediente clínico»), nunca más laxa: hallazgos
 * clínicos por el chat, solo a quien tiene el expediente.
 *
 * ── QUE RESUMA, NO QUE VUELQUE ───────────────────────────────────────────
 * `datos` viaja ENTERO al modelo en cada tool_result (`resultadoParaModelo`),
 * y se paga. 32 dientes con su estado son ~2 KB que además nadie lee. Así que
 * lo que sale de aquí ya viene agrupado POR HALLAZGO («caries: 16, 26, 37»),
 * que es como se contesta la pregunta.
 *
 * 🔴 NO DIAGNOSTICA. Repite lo que el doctor escribió y nada más. Por eso
 * `avisoObligatorio` obliga a que la respuesta lleve la frase de que es lo
 * registrado y no un diagnóstico: el prompt lo pide, y esto lo garantiza.
 */

import { z } from "zod";
import { COND_BY_ID } from "@/components/dashboard/odontogram-v2/data";
import { dbDe, definirHerramienta, pacienteVisibleYActivo, plural } from "./base";
import type { SabinaCtx } from "../tipos";

/** El conditionId reservado de la nota por diente — no es un hallazgo. */
const CONDICION_NOTA = "__note__";

/** Cuántos grupos de hallazgo caben en la respuesta. Más que esto no se lee. */
const TOPE_HALLAZGOS = 12;
/** Cuántos dientes se enumeran dentro de un grupo antes de decir «y N más». */
const TOPE_DIENTES = 10;
/** Cuántas notas por diente se repiten, y con cuántos caracteres cada una. */
const TOPE_NOTAS = 8;
const TOPE_CHARS_NOTA = 160;
/**
 * Techo de filas que se traen a memoria antes de agrupar. La unique es
 * (paciente, diente, cara, hallazgo), así que el máximo teórico son 52 dientes
 * × 6 caras × 45 hallazgos: una boca real nunca pasa de unas decenas, pero una
 * consulta sin `take` es una consulta sin techo.
 *
 * 🔴 Y SI SE LLEGA AL TECHO, SE DICE. Se piden `TOPE + 1` filas justo para
 * saberlo. Sin ese aviso el corte sería silencioso Y FALSO, no incompleto: el
 * `orderBy` va por número de diente, así que al recortar desaparecerían los
 * cuadrantes de abajo enteros y Sabina contestaría «no hay nada marcado en los
 * molares inferiores» con toda seguridad. Una respuesta a medias se dice; una
 * respuesta falsa no se puede dejar salir.
 */
const TOPE_FILAS_ODONTOGRAMA = 500;

const parametros = z.object({
  /** Paciente a consultar. Resuélvelo ANTES con buscar_paciente: nunca lo inventes. */
  patientId: z.string().min(1),
});

export type ParamsOdontograma = z.infer<typeof parametros>;

export interface HallazgoOdontograma {
  /** El nombre en español del catálogo ("Caries", "Corona", "Ausente"). */
  hallazgo: string;
  /** Dientes en FDI, de menor a mayor: "16, 26, 37". Con «y N más» si hubo recorte. */
  dientes: string;
  /** Cuántos DIENTES distintos lo tienen (no cuántas filas). */
  cuantosDientes: number;
}

export interface NotaDeDiente {
  diente: number;
  /** Lo que escribió el doctor, recortado. Se repite tal cual; no se interpreta. */
  nota: string;
}

export interface DatosOdontograma {
  dientesConHallazgo: number;
  /** Grupos de hallazgo, del más extendido al menos. Como mucho `TOPE_HALLAZGOS`. */
  hallazgos: HallazgoOdontograma[];
  /** `true` si hubo más tipos de hallazgo de los que caben. */
  truncado: boolean;
  /**
   * `true` si el odontograma tiene MÁS marcas de las que se pueden leer de una
   * vez: lo que sale es de los dientes de numeración más baja y faltan los de
   * abajo. Obliga a decirlo; ver `TOPE_FILAS_ODONTOGRAMA`.
   */
  incompleto: boolean;
  notas: NotaDeDiente[];
  /** Cuántas notas hay DE VERDAD (puede ser mayor que `notas.length`). */
  totalNotas: number;
  /** Última vez que alguien tocó el odontograma, AAAA-MM-DD. `null` si no hay nada. */
  ultimaMarca: string | null;
  /** La pantalla donde se ve entero, para que Sabina no intente pintarlo. */
  enlace: string;
}

/** El nombre en español del catálogo; si el id no está, el id crudo (no se inventa). */
function nombreDeCondicion(conditionId: string): string {
  return COND_BY_ID[conditionId]?.es ?? conditionId;
}

function fecha(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** "16, 26, 37" — y «y 3 más» cuando la lista se pasa de `TOPE_DIENTES`. */
function listaDeDientes(dientes: number[]): string {
  const ordenados = [...dientes].sort((a, b) => a - b);
  if (ordenados.length <= TOPE_DIENTES) return ordenados.join(", ");
  return `${ordenados.slice(0, TOPE_DIENTES).join(", ")} y ${ordenados.length - TOPE_DIENTES} más`;
}

/**
 * Lo que el motor añade a la respuesta si Sabina habló del odontograma sin
 * decir de dónde salen esos hallazgos. La marca es la frase entera a propósito:
 * aquí no vale con haberlo dicho «a su manera» — es la línea que Rafael puso.
 */
export const AVISO_NO_DIAGNOSTICA = {
  frase:
    "Es lo que está registrado en el odontograma; no es un diagnóstico ni una indicación de tratamiento.",
  marca: "no es un diagnóstico",
};

export const odontograma = definirHerramienta<ParamsOdontograma, DatosOdontograma>({
  nombre: "odontograma",
  descripcion:
    "Los hallazgos dentales que ya están marcados en el odontograma de un paciente, agrupados por " +
    "hallazgo y con sus dientes (caries, coronas, ausentes, endodoncias…) más las notas por diente. " +
    "Úsala para «¿qué problemas dentales tiene?». Solo repite lo que el doctor registró: no " +
    "diagnostica, no interpreta y no sugiere tratamiento.",
  parametros,
  permiso: "medicalRecord.view",

  async ejecutar(ctx: SabinaCtx, params): Promise<DatosOdontograma> {
    const { patientId } = params;
    const enlace = `/dashboard/patients/${patientId}?tab=odontograma`;
    const vacio: DatosOdontograma = {
      dientesConHallazgo: 0,
      hallazgos: [],
      truncado: false,
      incompleto: false,
      notas: [],
      totalNotas: 0,
      ultimaMarca: null,
      enlace,
    };

    // 🔴 EL corte de tenant. `odontogram_entries` no tiene clinicId: si esto no
    // pasa, no se consulta. Un paciente de otra clínica, uno que este usuario
    // no puede ver o uno archivado por ARCO sale por aquí, y el resultado es
    // el mismo «sin datos» que un paciente sin hallazgos — nunca una pista de
    // que ese expediente existe.
    if (!(await pacienteVisibleYActivo(ctx, patientId))) return vacio;

    const db = dbDe(ctx);
    const crudas = await db.odontogramEntry.findMany({
      where: { patientId },
      orderBy: [{ toothNumber: "asc" }],
      // Una de más: si vuelve, es que hay más de las que caben, y se dice.
      take: TOPE_FILAS_ODONTOGRAMA + 1,
      select: { toothNumber: true, surface: true, conditionId: true, notes: true, updatedAt: true },
    });

    // Un diente puede tener el mismo hallazgo en varias caras: se agrupa por
    // hallazgo y se cuentan DIENTES distintos, que es lo que contesta la
    // pregunta («caries en 3 dientes», no «caries en 7 caras»).
    const incompleto = crudas.length > TOPE_FILAS_ODONTOGRAMA;
    const filas = incompleto ? crudas.slice(0, TOPE_FILAS_ODONTOGRAMA) : crudas;

    const porHallazgo = new Map<string, Set<number>>();
    const notas: NotaDeDiente[] = [];
    const dientesTocados = new Set<number>();
    let ultima: Date | null = null;

    for (const f of filas as Array<{
      toothNumber: number;
      surface: string | null;
      conditionId: string;
      notes: string | null;
      updatedAt: Date;
    }>) {
      const cuando = f.updatedAt instanceof Date ? f.updatedAt : new Date(f.updatedAt);
      if (!Number.isNaN(cuando.getTime()) && (!ultima || cuando > ultima)) ultima = cuando;

      if (f.conditionId === CONDICION_NOTA) {
        const texto = (f.notes ?? "").trim();
        if (texto) notas.push({ diente: f.toothNumber, nota: texto.slice(0, TOPE_CHARS_NOTA) });
        continue;
      }
      dientesTocados.add(f.toothNumber);
      const nombre = nombreDeCondicion(f.conditionId);
      const set = porHallazgo.get(nombre) ?? new Set<number>();
      set.add(f.toothNumber);
      porHallazgo.set(nombre, set);
    }

    const todos: HallazgoOdontograma[] = Array.from(porHallazgo.entries())
      .map(([hallazgo, dientes]) => ({
        hallazgo,
        dientes: listaDeDientes([...dientes]),
        cuantosDientes: dientes.size,
      }))
      // Del más extendido al menos, y a igualdad por nombre para que dos
      // respuestas seguidas no cambien de orden sin motivo.
      .sort((a, b) => b.cuantosDientes - a.cuantosDientes || a.hallazgo.localeCompare(b.hallazgo, "es"));

    return {
      dientesConHallazgo: dientesTocados.size,
      hallazgos: todos.slice(0, TOPE_HALLAZGOS),
      truncado: todos.length > TOPE_HALLAZGOS,
      incompleto,
      notas: notas.sort((a, b) => a.diente - b.diente).slice(0, TOPE_NOTAS),
      totalNotas: notas.length,
      ultimaMarca: ultima ? fecha(ultima) : null,
      enlace,
    };
  },

  // Sin hallazgos y sin notas = no hay odontograma que contar. Un paciente que
  // no existe en esta clínica cae aquí también, y a propósito: la respuesta es
  // la misma que la de un paciente sano.
  vacio: (d) => d.hallazgos.length === 0 && d.notas.length === 0,

  // 🔴 La línea de Rafael: Sabina lee y repite; no opina. El prompt lo pide y
  // esto lo garantiza aunque el modelo se despiste.
  avisoObligatorio: () => AVISO_NO_DIAGNOSTICA,

  resumir(d) {
    if (d.hallazgos.length === 0) {
      const n = plural(d.totalNotas, "nota", "notas");
      return `Sin hallazgos marcados en el odontograma; solo ${n} por diente. ${AVISO_NO_DIAGNOSTICA.frase}`;
    }
    const partes = d.hallazgos.map(
      (h) => `${h.hallazgo.toLowerCase()} en ${plural(h.cuantosDientes, "diente", "dientes")} (${h.dientes})`,
    );
    const cabecera = `${plural(d.dientesConHallazgo, "diente", "dientes")} con algo marcado en el odontograma: ${partes.join("; ")}.`;
    const mas = d.truncado ? " Hay más tipos de hallazgo; el odontograma completo está en su ficha." : "";
    // 🔴 Si se cortó por filas, lo que falta son dientes ENTEROS de los
    // cuadrantes de abajo. Decir el resto sin avisar sería jurar que esos
    // dientes están sanos.
    const cortado = d.incompleto
      ? " OJO: este odontograma tiene más marcas de las que puedo leer de una vez, así que faltan dientes " +
        "(los de numeración más alta). NO digas que el resto está sano: dile que lo mire en su ficha."
      : "";
    const conNotas =
      d.totalNotas > 0
        ? ` Además, ${plural(d.totalNotas, "nota", "notas")} por diente${d.notas.length < d.totalNotas ? ` (van ${d.notas.length})` : ""}.`
        : "";
    return `${cabecera}${mas}${cortado}${conNotas} ${AVISO_NO_DIAGNOSTICA.frase}`;
  },
});
