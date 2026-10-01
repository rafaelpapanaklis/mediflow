/**
 * `notas_de_consulta` — «¿qué anotó el doctor en la última consulta de <paciente>?» (ws1-t9).
 *
 * Las notas clínicas de las consultas (`MedicalRecord`): motivo/subjetivo, exploración/objetivo, diagnóstico/
 * análisis y plan, tal como el doctor las tecleó o las dictó. Son texto libre y largo: cada campo se recorta a
 * `TOPE_CAMPO` letras (se dice que se recortó) y solo se leen las últimas `TOPE_CONSULTAS` consultas.
 *
 * 🔴 SOLO LECTURA. Repite lo anotado: no diagnostica, no interpreta, no edita; da el enlace a la ficha.
 *
 * ── PERMISOS Y PRIVACIDAD ───────────────────────────────────────────────
 * `medicalRecord.view` (la mira el runner): recepción no recibe nada. Las notas marcadas PRIVADAS son de su
 * autor y SOLO él las lee —sin excepción para el admin—, con el mismo fragmento que la ficha
 * (`ownPrivateRecordsOnly`). Cada consulta lleva el `clinicId` de la sesión.
 *
 * ── EL PACIENTE ─────────────────────────────────────────────────────────
 * `patientId` del contexto de pantalla o `paciente` (nombre, teléfono o folio), con `resolverPaciente`: clínica
 * de la sesión, visibilidad y `deletedAt`; con varios, se PREGUNTA.
 */

import { z } from "zod";
import { ownPrivateRecordsOnly } from "@/lib/clinical/record-scope";
import type { AgendaDb } from "./agenda-comun";
import { resolverPaciente } from "./agenda-resolvedores";
import { dbDe, definirHerramienta, lineasDeLista } from "./base";
import type { SabinaCtx } from "../tipos";

export const TOPE_CAMPO = 400;
export const TOPE_CONSULTAS = 3;


const parametros = z.object({
  /** El id del paciente, SOLO si lo tienes del contexto de pantalla. Nunca lo inventes. */
  patientId: z.string().min(1).max(64).optional(),
  /** Nombre, teléfono o folio del paciente, tal como lo dijo quien pregunta. */
  paciente: z.string().max(120).optional(),
});

export type ParamsNotasConsulta = z.infer<typeof parametros>;

export interface CampoNota {
  etiqueta: string;
  texto: string;
  recortado: boolean;
}

export interface DatosNotasConsulta {
  noEncontrado: string | null;
  aclarar: { pregunta: string; opciones: string[] } | null;
  paciente: string | null;
  consultas: Array<{ fecha: string; campos: CampoNota[] }>;
  enlace: string;
}

function campo(etiqueta: string, crudo: unknown): CampoNota | null {
  const t = typeof crudo === "string" ? crudo.replace(/\s+/g, " ").trim() : "";
  if (!t) return null;
  return t.length > TOPE_CAMPO
    ? { etiqueta, texto: `${t.slice(0, TOPE_CAMPO).trimEnd()}…`, recortado: true }
    : { etiqueta, texto: t, recortado: false };
}

const dia = (d: unknown): string => (d instanceof Date ? d.toISOString() : String(d ?? "")).slice(0, 10);

export const notasDeConsulta = definirHerramienta<ParamsNotasConsulta, DatosNotasConsulta>({
  nombre: "notas_de_consulta",
  descripcion:
    "Las NOTAS clínicas de las últimas consultas de un paciente: motivo (subjetivo), exploración (objetivo), " +
    "diagnóstico (análisis) y plan, tal como las escribió o dictó el doctor, resumidas si son largas. Úsala para " +
    "«¿qué anotó el doctor en la última consulta de …?» o «¿qué se le indicó en su consulta?», con `paciente` " +
    "(nombre, teléfono o folio) o con el `patientId` del contexto. Solo repite lo anotado: no interpreta, no " +
    "edita, y las notas privadas de otro doctor no las ve nadie más.",
  parametros,
  permiso: "medicalRecord.view",

  async ejecutar(ctx: SabinaCtx, params): Promise<DatosNotasConsulta> {
    const base: DatosNotasConsulta = { noEncontrado: null, aclarar: null, paciente: null, consultas: [], enlace: "" };
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
    const enlace = `/dashboard/patients/${patientId}`;

    const filas = (await dbDe(ctx).medicalRecord?.findMany({
      // 🔴 clinicId de la sesión; las privadas, solo de su autor (en un AND: dos OR en el mismo objeto se pisan).
      where: { clinicId: ctx.clinicId, patientId, AND: [ownPrivateRecordsOnly(ctx.userId)] },
      orderBy: { visitDate: "desc" },
      take: TOPE_CONSULTAS,
      select: { visitDate: true, subjective: true, objective: true, assessment: true, plan: true },
    })) ?? [];

    const consultas = (filas as Array<Record<string, unknown>>)
      .map((r) => ({
        fecha: dia(r.visitDate),
        campos: [
          campo("Motivo / subjetivo", r.subjective),
          campo("Exploración / objetivo", r.objective),
          campo("Diagnóstico / análisis", r.assessment),
          campo("Plan", r.plan),
        ].filter((c): c is CampoNota => c !== null),
      }))
      .filter((c) => c.campos.length > 0);
    return { ...base, paciente: quien.valor.nombre ?? null, consultas, enlace };
  },

  vacio: () => false,

  avisoObligatorio: () => null,

  resumir(d) {
    if (d.noEncontrado) return `${d.noEncontrado} Dilo así: NO digas que no tiene notas, porque no se llegó a mirar.`;
    if (d.aclarar) {
      const opciones = lineasDeLista(d.aclarar.opciones, (o) => o);
      const una = !opciones && d.aclarar.opciones[0] ? ` ${d.aclarar.opciones[0]}.` : "";
      return `${d.aclarar.pregunta}${una}${opciones}\nPregúntaselo a quien escribe y NO elijas tú; cuando conteste, vuelve a llamar con \`paciente\`.`;
    }
    if (d.consultas.length === 0) {
      return `${d.paciente} no tiene notas de consulta que yo pueda leer (puede no haber ninguna, o ser privadas de otro doctor). Se capturan en [su ficha](${d.enlace}).`;
    }
    let recortado = false;
    const partes = d.consultas.map((c) => {
      const campos = c.campos.map((f) => {
        if (f.recortado) recortado = true;
        return `${f.etiqueta}: «${f.texto}»`;
      });
      return `Consulta del ${c.fecha}: ${campos.join("; ")}.`;
    });
    partes.push(
      `Es lo anotado por el doctor: repítelo tal cual, sin interpretarlo. Solo van las últimas ${TOPE_CONSULTAS} consultas.` +
        (recortado ? ` Los textos con «…» van resumidos; el completo está en [su ficha](${d.enlace}).` : ""),
    );
    return `Notas de consulta de ${d.paciente}: ${partes.join(" ")}`;
  },
});
