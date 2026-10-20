/**
 * `orto_notas_internas` — «¿qué notas internas hay en el caso de ortodoncia de <paciente>?»
 *
 * Las NOTAS INTERNAS del equipo (la sección «Notas internas» al final del caso): quién escribió cada una, cuándo y
 * el texto vigente. Es información SOLO-EQUIPO (NOTAS_INTERNAS_SOLO_EQUIPO): Sabina es el asistente interno del
 * equipo y puede leerlas; NUNCA salen al paciente (portal, PDF del expediente, mensajes, bot de WhatsApp).
 * Tampoco las repite en nada que Sabina le mande a un paciente: esta herramienta solo responde a quien pregunta.
 *
 * 🔴 SOLO LECTURA Y NO OPINA. Repite lo anotado (cada nota se recorta a `TOPE_NOTA` letras y se dice que se
 * recortó; las últimas `TOPE_NOTAS` notas). Las correcciones se cuentan («corregida el …»), no se repite el texto
 * anterior: el historial completo se ve en la ficha.
 *
 * ── PERMISOS ────────────────────────────────────────────────────────────
 * La key del módulo la mira el runner (`specialties.orthodontics`) y, dentro, `patients.view` (la misma llave con
 * la que la pantalla enseña las notas). Lo que falta se DICE (`omitidas`).
 *
 * ── EL PACIENTE Y LA CLÍNICA ────────────────────────────────────────────
 * Igual que `orto_notas`: `resolverPaciente` (clínica de la sesión, visibilidad y `deletedAt`; con varios, se
 * PREGUNTA). Cada consulta lleva el `clinicId` de la sesión.
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
  fraseOmitidas,
  sinModulo,
  type EstadoModulo,
  type OmitidaOrto,
} from "./orto-comun";
import type { SabinaCtx } from "../tipos";

/** Cuántas letras de cada nota se repiten. Más largo se recorta: el resto se lee en la ficha. */
export const TOPE_NOTA = 500;
/** Cuántas notas (las más recientes) se leen. */
export const TOPE_NOTAS = 10;

const parametros = z.object({
  /** El id del paciente, SOLO si lo tienes del contexto de pantalla. Nunca lo inventes. */
  patientId: z.string().min(1).max(64).optional(),
  /** Nombre, teléfono o folio del paciente, tal como lo dijo quien pregunta. */
  paciente: z.string().max(120).optional(),
});

export type ParamsOrtoNotasInternas = z.infer<typeof parametros>;

export interface NotaInternaLeida {
  /** Cuándo se escribió, ya en la zona horaria de la clínica («5 oct 2026, 10:30»). */
  fecha: string;
  autor: string | null;
  texto: string;
  recortado: boolean;
  /** Cuándo fue la última corrección (misma zona), si la hubo. */
  corregidaEl: string | null;
}

export interface DatosOrtoNotasInternas {
  modulo: EstadoModulo;
  noEncontrado: string | null;
  aclarar: { pregunta: string; opciones: string[] } | null;
  paciente: string | null;
  /** false = el paciente no tiene caso de ortodoncia (o no se pudo leer por falta de permiso: ver `omitidas`). */
  hayCaso: boolean;
  /** false = todavía no se pegó el SQL de las notas internas. */
  disponible: boolean;
  notas: NotaInternaLeida[];
  /** Cuántas notas tiene el caso en total (puede ser más que las que se leen). */
  total: number;
  omitidas: OmitidaOrto[];
  enlace: string;
}

const iso = (d: unknown): string => (d instanceof Date ? d.toISOString() : String(d ?? ""));

function cuando(isoStr: string, zona: string): string {
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return "sin fecha";
  try {
    return d.toLocaleString("es-MX", { timeZone: zona, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return d.toLocaleString("es-MX", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }
}

export const ortoNotasInternas = definirHerramienta<ParamsOrtoNotasInternas, DatosOrtoNotasInternas>({
  nombre: "orto_notas_internas",
  descripcion:
    "Las NOTAS INTERNAS del equipo en el caso de ortodoncia de un paciente (la sección «Notas internas» de su " +
    "ficha): quién escribió cada una, cuándo, el texto y si fue corregida. Son solo del equipo de la clínica: se " +
    "pueden contar a quien pregunta, nunca mandárselas al paciente. Úsala para «¿qué notas internas hay de …?», " +
    "«¿qué anotó recepción sobre …?» o «¿alguien dejó algún aviso en el caso de …?», con `paciente` (nombre, " +
    "teléfono o folio) o con el `patientId` del contexto. Solo repite lo anotado (resumido si es largo): no " +
    "interpreta, no opina y no escribe notas. Lo clínico del caso lo dan orto_notas, orto_diagnostico y orto_caso.",
  parametros,
  permiso: PERMISO_ORTO,

  async ejecutar(ctx: SabinaCtx, params): Promise<DatosOrtoNotasInternas> {
    const motor = await import("./orto-motor");
    const base: DatosOrtoNotasInternas = {
      modulo: "activo",
      noEncontrado: null,
      aclarar: null,
      paciente: null,
      hayCaso: false,
      disponible: true,
      notas: [],
      total: 0,
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
    // La misma llave con la que la pantalla enseña las notas internas.
    if (!puede("notas internas del caso de ortodoncia", "patients.view")) return { ...base, paciente, omitidas, enlace };

    const db = dbDe(ctx);
    // 🔴 `clinicId` de la sesión en cada lectura; sin él no se consulta (exigirSesion).
    const caso = await db.orthodonticTreatmentPlan?.findFirst({
      where: { clinicId: ctx.clinicId, patientId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!caso) return { ...base, paciente, omitidas, enlace };

    // Las notas viven en tablas con SQL crudo (sin modelo de Prisma): sin ellas, se dice y no se rompe.
    const { repoNotasInternas } = await import("@/lib/orthodontics/notas-internas-db");
    if (!(await repoNotasInternas.tablaExiste())) return { ...base, paciente, hayCaso: true, disponible: false, omitidas, enlace };
    const todas = await repoNotasInternas.listar(ctx.clinicId, caso.id);
    const notas = todas.slice(0, TOPE_NOTAS).map((n): NotaInternaLeida => {
      const t = n.texto.replace(/\s+/g, " ").trim();
      const recortado = t.length > TOPE_NOTA;
      return {
        fecha: cuando(iso(n.createdAt), ctx.timezone),
        autor: n.authorNombre,
        texto: recortado ? `${t.slice(0, TOPE_NOTA).trimEnd()}…` : t,
        recortado,
        corregidaEl: n.revisiones.length > 0 ? cuando(iso(n.updatedAt), ctx.timezone) : null,
      };
    });

    // Bitácora de LECTURA del expediente (la misma de la ficha): esta consulta también es abrir las notas.
    const { logRead } = await import("@/lib/audit");
    await logRead({ clinicId: ctx.clinicId, userId: ctx.userId, kind: "orto_notas_internas", patientId, recordId: caso.id });

    return { ...base, paciente, hayCaso: true, notas, total: todas.length, omitidas, enlace };
  },

  vacio: () => false,

  avisoObligatorio(d) {
    if (d.modulo !== "activo") return avisoSinModulo(d.modulo);
    if (d.noEncontrado || d.aclarar) return null;
    return avisoEnlace("agregar o corregir una nota interna", "su ficha de ortodoncia", d.enlace);
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
      if (d.omitidas.length > 0) return `No puedo mostrarte las notas internas de ${d.paciente}.${fraseOmitidas(d.omitidas)}`;
      return `${d.paciente} no tiene un caso de ortodoncia registrado, así que no hay notas internas que leer.`;
    }
    if (!d.disponible) {
      return `Las notas internas todavía no están activas en esta cuenta, así que no puedo leer las de ${d.paciente}.`;
    }
    if (d.notas.length === 0) {
      return `${d.paciente} no tiene notas internas en su caso de ortodoncia. Se agregan en ${ficha}.${fraseOmitidas(d.omitidas)}`;
    }
    const lineas = d.notas.map((n) => {
      const quien = n.autor ?? "alguien del equipo";
      const corregida = n.corregidaEl ? `, corregida el ${n.corregidaEl}` : "";
      return `${quien} (${n.fecha}${corregida}): «${n.texto}»`;
    });
    const recortado = d.notas.some((n) => n.recortado);
    const mas = d.total > d.notas.length ? ` Hay ${d.total} notas en total; aquí van las ${d.notas.length} más recientes.` : "";
    return (
      `Notas internas de ${d.paciente} (de la más reciente a la más antigua): ${lineas.join("; ")}.` +
      ` Son solo del equipo de la clínica: repítelas tal cual a quien pregunta, sin interpretarlas, y NUNCA las incluyas en un mensaje al paciente.` +
      mas +
      (recortado ? ` Los textos con «…» van resumidos; el completo está en ${ficha}.` : "") +
      ` Se agregan y se corrigen en ${ficha}.${fraseOmitidas(d.omitidas)}`
    );
  },
});
