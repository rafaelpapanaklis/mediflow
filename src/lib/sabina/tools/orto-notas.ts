/**
 * `orto_notas` — «¿qué escribió el doctor en las notas del caso de ortodoncia de <paciente>?» (ws1-t9).
 *
 * El TEXTO LIBRE que el doctor teclea o dicta en los campos largos del módulo y que ninguna otra herramienta
 * repetía: las notas y los objetivos del plan (técnica, anclaje, prescripción, metas del paciente, plan de
 * retención), el motivo de la pausa o del abandono, lo anotado en las últimas hojas de control (S/O/A/P,
 * activaciones, indicaciones) y el motivo de cada reevaluación. El diagnóstico (observaciones, hábitos, ATM,
 * etiología, resumen) ya lo lee `orto_diagnostico`, y las interconsultas del plan, `orto_caso`.
 *
 * 🔴 SOLO LECTURA Y NO OPINA. Repite lo anotado, resumido si es largo (cada campo se recorta a `TOPE_CAMPO`
 * letras y se dice que se recortó); el texto completo se lee en la ficha, de donde también se edita.
 *
 * ── PERMISOS ────────────────────────────────────────────────────────────
 * Todo esto es expediente clínico: la key del módulo la mira el runner y, dentro, `medicalRecord.view`.
 * Recepción no la tiene por defecto: no recibe nada y se le DICE (`omitidas`).
 *
 * ── EL PACIENTE Y LA CLÍNICA ────────────────────────────────────────────
 * Igual que `orto_diagnostico`: `resolverPaciente` (clínica de la sesión, visibilidad y `deletedAt`; con varios,
 * se PREGUNTA). Cada consulta lleva el `clinicId` de la sesión.
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

/** Cuántas letras de cada campo se repiten. Más largo se recorta: el resto se lee en la ficha. */
export const TOPE_CAMPO = 400;
/** Cuántas hojas de control (las más recientes) y cuántas reevaluaciones se leen. */
export const TOPE_HOJAS = 3;
export const TOPE_REEVALUACIONES = 5;

const parametros = z.object({
  /** El id del paciente, SOLO si lo tienes del contexto de pantalla. Nunca lo inventes. */
  patientId: z.string().min(1).max(64).optional(),
  /** Nombre, teléfono o folio del paciente, tal como lo dijo quien pregunta. */
  paciente: z.string().max(120).optional(),
});

export type ParamsOrtoNotas = z.infer<typeof parametros>;

export interface CampoDeTexto {
  etiqueta: string;
  texto: string;
  /** El texto original era más largo y se recortó. */
  recortado: boolean;
}

export interface DatosOrtoNotas {
  modulo: EstadoModulo;
  noEncontrado: string | null;
  aclarar: { pregunta: string; opciones: string[] } | null;
  paciente: string | null;
  /** false = el paciente no tiene caso de ortodoncia (o no se pudo leer por falta de permiso: ver `omitidas`). */
  hayCaso: boolean;
  plan: CampoDeTexto[];
  hojas: Array<{ numero: number; fecha: string; borrador: boolean; campos: CampoDeTexto[] }>;
  reevaluaciones: Array<{ version: number; fecha: string; motivo: CampoDeTexto }>;
  omitidas: OmitidaOrto[];
  enlace: string;
}

/** Recorta un texto libre; `null` si no hay nada escrito. */
export function campoDeTexto(etiqueta: string, crudo: unknown): CampoDeTexto | null {
  const t = typeof crudo === "string" ? crudo.replace(/\s+/g, " ").trim() : "";
  if (!t) return null;
  return t.length > TOPE_CAMPO
    ? { etiqueta, texto: `${t.slice(0, TOPE_CAMPO).trimEnd()}…`, recortado: true }
    : { etiqueta, texto: t, recortado: false };
}

const sinNulos = (xs: Array<CampoDeTexto | null>): CampoDeTexto[] => xs.filter((x): x is CampoDeTexto => x !== null);

const iso = (d: unknown): string => (d instanceof Date ? d.toISOString() : String(d ?? ""));

export const ortoNotas = definirHerramienta<ParamsOrtoNotas, DatosOrtoNotas>({
  nombre: "orto_notas",
  descripcion:
    "Las NOTAS escritas del caso de ortodoncia de un paciente: notas y objetivos del plan (técnica, anclaje, " +
    "prescripción, metas del paciente, plan de retención), motivo de pausa o abandono, lo anotado en las últimas " +
    "hojas de control (subjetivo, objetivo, análisis, plan, activaciones e indicaciones) y el motivo de cada " +
    "reevaluación. Úsala para «¿qué indicaciones le dieron …?», «¿qué anotó el doctor en su último control?», " +
    "«¿qué objetivos tiene …?» o «¿por qué se reevaluó …?», con `paciente` (nombre, teléfono o folio) o con el " +
    "`patientId` del contexto. Solo repite lo anotado (resumido si es largo): no interpreta ni opina, y no edita. " +
    "El diagnóstico lo da orto_diagnostico; cómo va el tratamiento (fase, controles, pagos), orto_caso.",
  parametros,
  permiso: PERMISO_ORTO,

  async ejecutar(ctx: SabinaCtx, params): Promise<DatosOrtoNotas> {
    const motor = await import("./orto-motor");
    const base: DatosOrtoNotas = {
      modulo: "activo",
      noEncontrado: null,
      aclarar: null,
      paciente: null,
      hayCaso: false,
      plan: [],
      hojas: [],
      reevaluaciones: [],
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
    if (!puede("notas del caso de ortodoncia", "medicalRecord.view")) return { ...base, paciente, omitidas, enlace };

    const db = dbDe(ctx);
    // 🔴 `clinicId` de la sesión en cada lectura; sin él no se consulta (exigirSesion).
    const caso = await db.orthodonticTreatmentPlan?.findFirst({
      where: { clinicId: ctx.clinicId, patientId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        techniqueNotes: true,
        anchorageNotes: true,
        prescriptionNotes: true,
        patientGoals: true,
        retentionPlanText: true,
        onHoldReason: true,
        droppedOutReason: true,
      },
    });
    if (!caso) return { ...base, paciente, omitidas, enlace };

    const plan = sinNulos([
      campoDeTexto("Notas de la técnica", caso.techniqueNotes),
      campoDeTexto("Notas del anclaje", caso.anchorageNotes),
      campoDeTexto("Notas de la prescripción", caso.prescriptionNotes),
      campoDeTexto("Objetivos / metas del paciente", caso.patientGoals),
      campoDeTexto("Plan de retención", caso.retentionPlanText),
      campoDeTexto("Motivo de la pausa", caso.onHoldReason),
      campoDeTexto("Motivo del abandono", caso.droppedOutReason),
    ]);

    const cartas = await db.orthoTreatmentCard.findMany({
      where: { treatmentPlanId: caso.id, clinicId: ctx.clinicId, deletedAt: null },
      orderBy: { cardNumber: "desc" },
      take: TOPE_HOJAS,
      select: {
        cardNumber: true,
        visitDate: true,
        status: true,
        soapS: true,
        soapO: true,
        soapA: true,
        soapP: true,
        activationsNote: true,
        indications: true,
      },
    });
    const hojas = (cartas as Array<Record<string, unknown>>)
      .map((h) => ({
        numero: Number(h.cardNumber),
        fecha: iso(h.visitDate),
        borrador: h.status !== "SIGNED",
        campos: sinNulos([
          campoDeTexto("Subjetivo", h.soapS),
          campoDeTexto("Objetivo", h.soapO),
          campoDeTexto("Análisis", h.soapA),
          campoDeTexto("Plan", h.soapP),
          campoDeTexto("Activaciones", h.activationsNote),
          campoDeTexto("Indicaciones al paciente", h.indications),
        ]),
      }))
      .filter((h) => h.campos.length > 0);

    // Las reevaluaciones (versiones cerradas del caso): el motivo de cada una. Sin la tabla, no hay línea de tiempo.
    const { listarVersionesDelCaso } = await import("@/lib/orthodontics/versiones-caso-db");
    const versiones = (await listarVersionesDelCaso(ctx.clinicId, caso.id).catch(() => null)) ?? [];
    const reevaluaciones = versiones
      .slice(-TOPE_REEVALUACIONES)
      .map((v) => ({ version: v.numero, fecha: iso(v.cerradaEl), motivo: campoDeTexto("Motivo", v.motivo) }))
      .filter((v): v is { version: number; fecha: string; motivo: CampoDeTexto } => v.motivo !== null);

    return { ...base, paciente, hayCaso: true, plan, hojas, reevaluaciones, omitidas, enlace };
  },

  vacio: () => false,

  avisoObligatorio(d) {
    if (d.modulo !== "activo") return avisoSinModulo(d.modulo);
    if (d.noEncontrado || d.aclarar) return null;
    return avisoEnlace("editar las notas", "su ficha de ortodoncia", d.enlace);
  },

  resumir(d) {
    if (d.modulo !== "activo") return avisoSinModulo(d.modulo).frase;
    if (d.noEncontrado) return `${d.noEncontrado} Dilo así: NO digas que no tiene notas, porque no se llegó a mirar.`;
    if (d.aclarar) {
      const opciones = lineasDeLista(d.aclarar.opciones, (o) => o);
      const una = !opciones && d.aclarar.opciones[0] ? ` ${d.aclarar.opciones[0]}.` : "";
      return `${d.aclarar.pregunta}${una}${opciones}\nPregúntaselo a quien escribe y NO elijas tú; cuando conteste, vuelve a llamar con \`paciente\`.`;
    }
    const ficha = `[su ficha de ortodoncia](${d.enlace})`;
    if (!d.hayCaso) {
      if (d.omitidas.length > 0) return `No puedo mostrarte las notas de ${d.paciente}.${fraseOmitidas(d.omitidas)}`;
      return `${d.paciente} no tiene un caso de ortodoncia registrado, así que no hay notas que leer.`;
    }
    const partes: string[] = [];
    let recortado = false;
    const dice = (c: CampoDeTexto) => {
      if (c.recortado) recortado = true;
      return `${c.etiqueta}: «${c.texto}»`;
    };
    if (d.plan.length > 0) partes.push(`Notas del plan de ${d.paciente}: ${d.plan.map(dice).join("; ")}.`);
    for (const h of d.hojas) {
      partes.push(
        `Hoja de control ${h.numero} (${fechaCorta(h.fecha)}${h.borrador ? ", borrador sin firmar" : ""}): ${h.campos.map(dice).join("; ")}.`,
      );
    }
    for (const r of d.reevaluaciones) {
      partes.push(`Reevaluación ${r.version} (${fechaCorta(r.fecha)}): ${dice(r.motivo)}.`);
    }
    if (partes.length === 0) {
      return `${d.paciente} tiene caso de ortodoncia, pero no hay notas escritas en el plan, en sus últimas hojas de control ni en reevaluaciones. Se capturan en ${ficha}.`;
    }
    partes.push(
      `Es lo anotado por el doctor: repítelo tal cual, sin interpretarlo ni opinar del tratamiento. Lo que no aparece aquí no está escrito.` +
        (recortado ? ` Los textos con «…» van resumidos; el completo está en ${ficha}.` : "") +
        ` Solo se leen las últimas ${TOPE_HOJAS} hojas de control. Se edita en ${ficha}.`,
    );
    return `${partes.join(" ")}${fraseOmitidas(d.omitidas)}`;
  },
});
