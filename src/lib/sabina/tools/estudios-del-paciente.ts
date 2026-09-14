/**
 * `estudios_del_paciente` — qué radiografías y archivos tiene un paciente.
 *
 * Solo lectura, y solo la lista: nombre, categoría, fecha y diente, y si ya
 * tiene análisis de IA guardado (sin enseñar el contenido — eso es
 * `analisis_y_notas_de_estudio`, detrás de `medicalRecord.view`, MAPA-clinico
 * hallazgo N16). No firma URLs de Supabase (eso es un POST fuera del candado
 * de solo lectura, MAPA-clinico §0.7): en vez de la imagen, da el enlace a la
 * pantalla, igual que hace Sabina con el PDF de una receta.
 */

import { z } from "zod";
import { dbDe, definirHerramienta, fraseRecorte, pacienteVisibleYActivo, plural, recortar, TOPE_FILAS, type Lista } from "./base";
import type { SabinaCtx } from "../tipos";

const parametros = z.object({
  /** Paciente a consultar. Resuélvelo ANTES con buscar_paciente. */
  patientId: z.string().min(1),
});

export type ParamsEstudios = z.infer<typeof parametros>;

export interface EstudioFila {
  nombre: string;
  categoria: string;
  fecha: string;
  diente: number | null;
  tieneAnalisis: boolean;
}

export interface DatosEstudios {
  estudios: Lista<EstudioFila>;
  enlace: string;
}

export const estudiosDelPaciente = definirHerramienta<ParamsEstudios, DatosEstudios>({
  nombre: "estudios_del_paciente",
  descripcion:
    "Qué radiografías y archivos tiene un paciente: nombre, categoría, fecha, diente y si ya tiene " +
    "análisis de IA guardado. Úsala para «¿qué radiografías tiene Juan?». No sube ni analiza nada.",
  parametros,
  permiso: "xrays.view",

  async ejecutar(ctx: SabinaCtx, params): Promise<DatosEstudios> {
    const { patientId } = params;
    const enlace = `/dashboard/xrays/${patientId}`;
    const activo = await pacienteVisibleYActivo(ctx, patientId);
    if (!activo) return { estudios: recortar<EstudioFila>([], 0), enlace };

    const db = dbDe(ctx);
    // 🔴 `deletedAt: null` — igual que GET /api/xrays: un archivo borrado
    // lógicamente (NOM-004/024) no debe aparecer en un listado activo.
    const where = { clinicId: ctx.clinicId, patientId, deletedAt: null };
    const [total, crudos] = await Promise.all([
      db.patientFile.count({ where }),
      db.patientFile.findMany({ where, orderBy: { createdAt: "desc" }, take: TOPE_FILAS }),
    ]);

    const ids = crudos.map((f: any) => f.id);
    const analisis = ids.length
      ? await db.xrayAnalysis.findMany({ where: { clinicId: ctx.clinicId, patientId, fileId: { in: ids } } })
      : [];
    const conAnalisis = new Set(analisis.map((a: any) => a.fileId));

    const filas: EstudioFila[] = crudos.map((f: any) => ({
      nombre: f.name,
      categoria: f.category,
      fecha: (f.takenAt ?? f.createdAt).toISOString().slice(0, 10),
      diente: f.toothNumber ?? null,
      tieneAnalisis: conAnalisis.has(f.id),
    }));

    return { estudios: recortar(filas, total), enlace };
  },

  vacio: (d) => d.estudios.total === 0,

  resumir(d) {
    const conIA = d.estudios.filas.filter((f) => f.tieneAnalisis).length;
    return (
      `${plural(d.estudios.total, "estudio", "estudios")}` +
      (conIA > 0 ? `, ${conIA} con análisis de IA guardado` : "") +
      `${fraseRecorte(d.estudios, "estudios")}. Ver ${d.enlace}.`
    );
  },
});
