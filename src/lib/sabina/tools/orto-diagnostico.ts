/**
 * `orto_diagnostico` — «¿qué diagnóstico de ortodoncia tiene <paciente>?» (ws1-t8).
 *
 * Repite el DIAGNÓSTICO completo del caso tal como está en la ficha: clasificación (Angle, overjet, overbite),
 * características faciales, análisis oclusal, dentoalveolar, funcional/respiratorio/ATM, cefalometría,
 * etiología y el resumen del doctor. La redacción es la MISMA que la ficha y los PDF
 * (`seccionesDelDiagnostico`): aquí no se calcula nada.
 *
 * 🔴 SOLO LECTURA Y NO OPINA. No diagnostica, no interpreta valores, no propone tratamiento: repite lo
 * registrado y da el enlace a la ficha, donde se edita.
 *
 * ── PERMISOS ────────────────────────────────────────────────────────────
 * La key del módulo la mira el runner. El diagnóstico es expediente clínico: sin `medicalRecord.view` no se lee
 * nada y se DICE (`omitidas`).
 *
 * ── EL PACIENTE ─────────────────────────────────────────────────────────
 * Igual que `orto_caso`: `patientId` del contexto de pantalla o `paciente` (nombre, teléfono o folio), resuelto
 * con `resolverPaciente` (clínica de la sesión, visibilidad y `deletedAt`); con varios, se PREGUNTA.
 */

import { z } from "zod";
import type { AgendaDb } from "./agenda-comun";
import { resolverPaciente } from "./agenda-resolvedores";
import { dbDe, definirHerramienta, lineasDeLista } from "./base";
import {
  PERMISO_ORTO,
  anotador,
  avisoEnlace,
  avisoSinModulo,
  enlaceDelCaso,
  fechaCorta,
  fraseOmitidas,
  sinModulo,
  type EstadoModulo,
  type OmitidaOrto,
} from "./orto-comun";
import type { SabinaCtx } from "../tipos";

const parametros = z.object({
  /** El id del paciente, SOLO si lo tienes del contexto de pantalla. Nunca lo inventes. */
  patientId: z.string().min(1).max(64).optional(),
  /** Nombre, teléfono o folio del paciente, tal como lo dijo quien pregunta. */
  paciente: z.string().max(120).optional(),
});

export type ParamsOrtoDiagnostico = z.infer<typeof parametros>;

export interface DatosOrtoDiagnostico {
  modulo: EstadoModulo;
  noEncontrado: string | null;
  aclarar: { pregunta: string; opciones: string[] } | null;
  paciente: string | null;
  /** null = sin diagnóstico de ortodoncia (o sin permiso para verlo: ver `omitidas`). */
  diagnostico: {
    fecha: string;
    secciones: Array<{ titulo: string; lineas: Array<{ etiqueta: string; valor: string }> }>;
    resumen: string | null;
  } | null;
  omitidas: OmitidaOrto[];
  enlace: string;
}

interface DbDelDiagnostico {
  orthodonticDiagnosis: {
    findFirst(args: unknown): Promise<{ id: string; diagnosedAt: Date; clinicalSummary: string | null } | null>;
    findMany(args: unknown): Promise<unknown[]>;
  };
  $queryRaw(query: unknown): Promise<unknown>;
}

export const ortoDiagnostico = definirHerramienta<ParamsOrtoDiagnostico, DatosOrtoDiagnostico>({
  nombre: "orto_diagnostico",
  descripcion:
    "El DIAGNÓSTICO de ortodoncia de un paciente tal como está registrado: clase de Angle, overjet y overbite, " +
    "características faciales, líneas medias, mordidas, apiñamiento, respiración, ATM, hábitos, cefalometría, " +
    "etiología y el resumen del doctor. Úsala para «¿qué diagnóstico tiene …?», «¿qué clase es …?» o «¿tiene " +
    "mordida cruzada …?», con `paciente` (nombre, teléfono o folio) o con el `patientId` del contexto. Solo " +
    "repite lo registrado: no interpreta ni opina, y no edita; da el enlace a su ficha. Para cómo va el " +
    "tratamiento (fase, controles, pagos) usa orto_caso.",
  parametros,
  permiso: PERMISO_ORTO,

  async ejecutar(ctx: SabinaCtx, params): Promise<DatosOrtoDiagnostico> {
    const motor = await import("./orto-motor");
    const base: DatosOrtoDiagnostico = {
      modulo: "activo",
      noEncontrado: null,
      aclarar: null,
      paciente: null,
      diagnostico: null,
      omitidas: [],
      enlace: "",
    };

    const modulo = await motor.estadoDelModulo(ctx);
    if (modulo !== "activo") return { ...base, ...sinModulo(modulo) };

    const dbPacientes = dbDe(ctx) as unknown as AgendaDb;
    let quien = await resolverPaciente(ctx, dbPacientes, { pacienteId: params.patientId ?? null, paciente: params.paciente ?? null });
    if (quien.tipo === "no" && params.patientId) {
      quien = await resolverPaciente(ctx, dbPacientes, { paciente: (params.paciente ?? "").trim() || params.patientId.trim() });
    }
    if (quien.tipo === "pregunta") {
      return {
        ...base,
        aclarar: {
          pregunta: quien.pregunta.texto,
          opciones: quien.pregunta.opciones.map((o) => `${o.etiqueta}${o.detalle ? ` (${o.detalle})` : ""}`),
        },
      };
    }
    if (quien.tipo !== "ok") return { ...base, noEncontrado: (quien as { frase: string }).frase };
    const patientId = quien.valor.id;
    const paciente = quien.valor.nombre ?? null;
    const enlace = enlaceDelCaso(patientId);

    const omitidas: OmitidaOrto[] = [];
    const puede = anotador(ctx, omitidas);
    if (!puede("diagnóstico de ortodoncia", "medicalRecord.view")) return { ...base, paciente, omitidas, enlace };

    const db = dbDe(ctx) as unknown as DbDelDiagnostico;
    // El diagnóstico del caso más reciente. `clinicId` de la sesión: sin él no se consulta (exigirSesion).
    const dx = await db.orthodonticDiagnosis.findFirst({
      where: { clinicId: ctx.clinicId, patientId, deletedAt: null },
      orderBy: { diagnosedAt: "desc" },
      select: { id: true, diagnosedAt: true, clinicalSummary: true },
    });
    if (!dx) return { ...base, paciente, omitidas, enlace };

    const { cargarDiagnosticosLegibles } = await import("@/lib/orthodontics/diagnostico-detalle-db");
    const legibles = await cargarDiagnosticosLegibles(ctx.clinicId, [dx.id], db as never);
    const secciones = (legibles.get(dx.id) ?? []).map((s) => ({ titulo: s.titulo, lineas: s.lineas.map((l) => ({ etiqueta: l.etiqueta, valor: l.valor })) }));
    const resumen = (dx.clinicalSummary ?? "").trim() || null;
    return { ...base, paciente, diagnostico: { fecha: dx.diagnosedAt.toISOString(), secciones, resumen }, omitidas, enlace };
  },

  vacio: () => false,

  avisoObligatorio(d) {
    if (d.modulo !== "activo") return avisoSinModulo(d.modulo);
    if (d.noEncontrado || d.aclarar) return null;
    return avisoEnlace("editar el diagnóstico", "su ficha de ortodoncia", d.enlace);
  },

  resumir(d) {
    if (d.modulo !== "activo") return avisoSinModulo(d.modulo).frase;
    if (d.noEncontrado) return `${d.noEncontrado} Dilo así: NO digas que no tiene diagnóstico, porque no se llegó a mirar.`;
    if (d.aclarar) {
      const opciones = lineasDeLista(d.aclarar.opciones, (o) => o);
      const una = !opciones && d.aclarar.opciones[0] ? ` ${d.aclarar.opciones[0]}.` : "";
      return `${d.aclarar.pregunta}${una}${opciones}\nPregúntaselo a quien escribe y NO elijas tú; cuando conteste, vuelve a llamar con \`paciente\`.`;
    }
    const ficha = `[su ficha de ortodoncia](${d.enlace})`;
    if (!d.diagnostico) {
      if (d.omitidas.length > 0) return `No puedo mostrarte el diagnóstico de ${d.paciente}.${fraseOmitidas(d.omitidas)}`;
      return `${d.paciente} no tiene diagnóstico de ortodoncia registrado. Se captura en ${ficha}.`;
    }
    const partes = [`Diagnóstico de ortodoncia de ${d.paciente} (valorado el ${fechaCorta(d.diagnostico.fecha)}):`];
    for (const s of d.diagnostico.secciones) {
      partes.push(`${s.titulo}: ${s.lineas.map((l) => `${l.etiqueta.toLowerCase()} ${l.valor}`).join("; ")}.`);
    }
    if (d.diagnostico.resumen) partes.push(`Resumen del doctor: «${d.diagnostico.resumen}».`);
    partes.push(
      `Es lo registrado por el doctor: repítelo tal cual, sin interpretarlo ni opinar del tratamiento. Lo que no aparece aquí no está capturado (no digas que es normal). Se edita en ${ficha}.`,
    );
    return `${partes.join(" ")}${fraseOmitidas(d.omitidas)}`;
  },
});
