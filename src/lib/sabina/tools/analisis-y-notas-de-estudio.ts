/**
 * `analisis_y_notas_de_estudio` — lee el análisis de IA YA GUARDADO de una
 * placa y las notas del doctor sobre ella. NUNCA lanza un análisis nuevo
 * (eso cuesta tokens del cupo del plan; es una acción, y ni siquiera está en
 * el encargo de hoy — MAPA-clinico §0.7 y §B-subir).
 *
 * ── EL CANDADO QUE NO REPITE N16 ──────────────────────────────────────────
 * Hoy `GET /api/xrays` y `GET /api/xrays/[id]/analyze` devuelven `doctorNotes`
 * y el análisis IA con solo `xrays.view` — recepción los tiene y por tanto
 * los lee, aunque no tenga `medicalRecord.view` (MAPA-clinico N16). Puede ser
 * deliberado en esa pantalla; en Sabina NO se repite: esta herramienta exige
 * `medicalRecord.view`, así que quien no lo tenga recibe `sin_permiso`, no una
 * lista vacía. `estudios_del_paciente` (solo `xrays.view`) sigue sirviendo la
 * lista pelada, sin interpretación clínica.
 */

import { z } from "zod";
import { dbDe, definirHerramienta, fraseRecorte, pacienteVisibleYActivo, plural, recortar, type Lista } from "./base";
import type { SabinaCtx } from "../tipos";

/** Tope defensivo de archivos a traer por paciente antes de filtrar a los que tienen notas/análisis. */
const TOPE_ARCHIVOS = 200;

const parametros = z.object({
  /** Paciente a consultar. Resuélvelo ANTES con buscar_paciente. */
  patientId: z.string().min(1),
  /** Un archivo concreto (de estudios_del_paciente). Sin él, lista los que YA tienen notas o análisis. */
  archivoId: z.string().min(1).optional(),
});

export type ParamsAnalisis = z.infer<typeof parametros>;

export interface AnalisisFila {
  archivoId: string;
  nombre: string;
  fecha: string;
  notasDelDoctor: string | null;
  analisis: {
    modo: string;
    resumen: string;
    severidad: string;
    confianza: number;
    fecha: string;
  } | null;
}

export interface DatosAnalisis {
  estudios: Lista<AnalisisFila>;
}

function construirFila(f: any, analisis: any): AnalisisFila {
  return {
    archivoId: f.id,
    nombre: f.name,
    fecha: (f.takenAt ?? f.createdAt).toISOString().slice(0, 10),
    notasDelDoctor: f.doctorNotes ?? null,
    analisis: analisis
      ? {
          modo: analisis.mode,
          resumen: analisis.summary,
          severidad: analisis.severity,
          confianza: analisis.confidence,
          fecha: analisis.createdAt.toISOString().slice(0, 10),
        }
      : null,
  };
}

export const analisisYNotasDeEstudio = definirHerramienta<ParamsAnalisis, DatosAnalisis>({
  nombre: "analisis_y_notas_de_estudio",
  descripcion:
    "Lee el análisis de IA YA GUARDADO de una radiografía (resumen, severidad) y las notas del " +
    "doctor sobre ella. Con archivoId, esa una; sin él, los estudios del paciente que YA tienen " +
    "notas o análisis. Nunca lanza un análisis nuevo: eso lo hace el doctor en su pantalla, porque cobra tokens.",
  parametros,
  permiso: "medicalRecord.view",

  async ejecutar(ctx: SabinaCtx, params): Promise<DatosAnalisis> {
    const { patientId, archivoId } = params;
    const activo = await pacienteVisibleYActivo(ctx, patientId);
    if (!activo) return { estudios: recortar<AnalisisFila>([], 0) };

    const db = dbDe(ctx);
    const whereArchivos: Record<string, any> = { clinicId: ctx.clinicId, patientId, deletedAt: null };
    if (archivoId) whereArchivos.id = archivoId;

    const [archivos, analisisTodos] = await Promise.all([
      db.patientFile.findMany({
        where: whereArchivos,
        orderBy: { createdAt: "desc" },
        take: archivoId ? 1 : TOPE_ARCHIVOS,
      }),
      db.xrayAnalysis.findMany({ where: { clinicId: ctx.clinicId, patientId } }),
    ]);

    const analisisPorArchivo: Record<string, any> = {};
    for (const a of analisisTodos) analisisPorArchivo[a.fileId] = a;

    let filas = archivos.map((f: any) => construirFila(f, analisisPorArchivo[f.id]));
    // Sin archivoId: solo los que de verdad tienen algo clínico que leer —
    // si no, esta herramienta repetiría estudios_del_paciente sin añadir nada.
    if (!archivoId) filas = filas.filter((f: AnalisisFila) => f.notasDelDoctor || f.analisis);

    return { estudios: recortar(filas, filas.length) };
  },

  vacio: (d) => d.estudios.total === 0,

  resumir(d, params) {
    if (params.archivoId) {
      const f = d.estudios.filas[0];
      const partes: string[] = [];
      if (f.notasDelDoctor) partes.push(`notas del doctor: "${f.notasDelDoctor.slice(0, 140)}"`);
      if (f.analisis) {
        partes.push(
          `análisis IA (${f.analisis.modo}, severidad ${f.analisis.severidad}): ${f.analisis.resumen.slice(0, 160)}`,
        );
      }
      return `${f.nombre} del ${f.fecha} — ${partes.join("; ")}.`;
    }
    return `${plural(d.estudios.total, "estudio con notas o análisis", "estudios con notas o análisis")}${fraseRecorte(d.estudios, "estudios")}.`;
  },
});
