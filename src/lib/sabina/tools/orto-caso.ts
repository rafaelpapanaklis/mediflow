/**
 * `orto_caso` — «¿cómo va el caso de ortodoncia de <paciente>?».
 *
 * Lo que contesta, y de dónde sale cada cosa (ver ./orto-motor: aquí no se
 * calcula nada):
 *  · estado del caso y «mes N de M» ........ la cabecera de la ficha
 *  · fase y arco actual .................... la ficha (`resolveCurrentWire`)
 *  · higiene ............................... el último control FIRMADO, y el
 *                                            aviso de «está empeorando» del panel
 *  · alineadores ........................... cuál trae y cuál debería traer hoy
 *  · último y próximo control .............. la Agenda (los controles son citas)
 *  · mensualidades ......................... `cobranzaDelCasoUnificada`
 *
 * 🔴 SOLO LECTURA. No abre el caso, no registra el control, no firma la hoja
 * y no cobra: da el enlace a la pestaña Ortodoncia de la ficha. Agendarle su
 * control sí se puede, pero lo hace `agendar_cita`, no esta herramienta.
 *
 * ── PERMISOS ────────────────────────────────────────────────────────────
 * La key del módulo la mira el runner. Dentro, cada parte con la suya, y la que
 * falta se DICE (`omitidas`):
 *  · lo clínico (fase, arco, higiene, alineadores) → `medicalRecord.view`.
 *    Recepción no la tiene por defecto: recibe el estado, los controles y las
 *    mensualidades, y se le dice que lo clínico no lo puede ver.
 *  · los controles → `agenda.view` · las mensualidades → `billing.view`.
 *
 * ── EL PACIENTE ─────────────────────────────────────────────────────────
 * Llega por `patientId` (el de la ficha que está abierta: lo pone el contexto de
 * pantalla) o por `paciente` (nombre, teléfono o folio). `buscar_paciente` NO le
 * da ids al modelo, así que sin `paciente` la pregunta solo funcionaría con la
 * ficha abierta. Se resuelve con `resolverPaciente`, el buscador de «Nueva
 * cita» que ya usan la agenda y las facturas: clínica de la sesión, visibilidad
 * del panel y `deletedAt`. Si hay varios, se PREGUNTA cuál; nunca se elige.
 * Uno de otra clínica, uno restringido o uno archivado por ARCO sale igual que
 * uno que no existe: «no lo encuentro entre los pacientes que puedes ver».
 *
 * 🔴 NO DIAGNOSTICA NI OPINA DEL TRATAMIENTO. Repite lo registrado.
 */

import { z } from "zod";
import { DIAS_SIN_CONTROL_URGENTE, fraseSinControl } from "@/lib/orthodontics/controles-modulo";
import { fraseDeAtraso, fraseDeProxima, fraseDeVencidos } from "@/lib/orthodontics/cobranza-modulo";
import type { AgendaDb } from "./agenda-comun";
import { resolverPaciente } from "./agenda-resolvedores";
import { dbDe, definirHerramienta, lineasDeLista, pesos } from "./base";
import { fechaDe, horaDe } from "./fechas";
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

export type ParamsOrtoCaso = z.infer<typeof parametros>;

/** Como lo dice la lista «Pacientes en tratamiento» del módulo. */
const ESTADO_DEL_CASO: Record<string, string> = {
  PLANNED: "Planeado",
  IN_PROGRESS: "En curso",
  ON_HOLD: "Pausado",
  RETENTION: "Retención",
  COMPLETED: "Completado",
  DROPPED_OUT: "Abandono",
};

/** Como lo dice la ficha del caso (`PHASE_LABELS`). */
const FASE: Record<string, string> = {
  ALIGNMENT: "Alineación",
  LEVELING: "Nivelación",
  SPACE_CLOSURE: "Cierre de espacios",
  DETAILS: "Detalles",
  FINISHING: "Finalización",
  RETENTION: "Retención",
};

/** Como lo dice la cabecera de la ficha (`formatWireLabel`). */
const MATERIAL: Record<string, string> = { NITI: "NiTi", SS: "SS", TMA: "TMA", BETA_TITANIUM: "β-Ti" };

export interface DatosOrtoCaso {
  modulo: EstadoModulo;
  /** El paciente no está entre los que puede ver quien pregunta: la frase, lista para decirla. */
  noEncontrado: string | null;
  /** Hay varios pacientes posibles (o falta decir cuál): la pregunta y sus opciones. */
  aclarar: { pregunta: string; opciones: string[] } | null;
  paciente: string | null;
  caso: {
    estado: string;
    /** «mes 7 de 24». `de` en 0 = sin duración estimada. */
    mes: number;
    de: number;
    inicio: string | null;
    finEstimado: string | null;
  } | null;
  tieneValoracion: boolean;
  clinico: {
    fase: string | null;
    /** "NiTi 0.014 (superior e inferior)". `null` = sin arco registrado. */
    arco: string | null;
    higiene: { fecha: string; placaPct: number | null; gingivitis: string | null; manchasBlancas: boolean } | null;
    /** Lo que empeoró en los últimos controles, con las palabras del panel. Vacío = sin aviso. */
    higieneEmpeora: string[];
    alineadores: {
      sistema: string | null;
      actual: number;
      total: number;
      esperado: number;
      diferencia: number;
      estado: string;
    } | null;
  } | null;
  controles: {
    /** AAAA-MM-DD, en la zona de la clínica. */
    ultimo: string | null;
    /** "AAAA-MM-DD HH:mm", en la zona de la clínica. */
    proximo: string | null;
    /** Solo si el caso está activo y no tiene control futuro: la frase de la pantalla de Controles. */
    sinControl: string | null;
    urgente: boolean;
  } | null;
  cobranza: {
    situacion: string;
    vencido: number;
    pagosVencidos: number;
    vencidoDesde: string | null;
    diasDeAtraso: number | null;
    proximaFecha: string | null;
    proximoImporte: number | null;
    diasParaLaProxima: number | null;
    porCobrar: number;
    cuotasPagadas: number;
    cuotasTotales: number;
    saldoAFavor: number;
  } | null;
  omitidas: OmitidaOrto[];
  /** La pestaña Ortodoncia de la ficha: donde se registra el control, se cobra y se cambia de fase. */
  enlace: string;
}

function arcoLegible(arco: { material: string; gauge: string; archUpper: boolean; archLower: boolean } | null): string | null {
  if (!arco) return null;
  const donde =
    arco.archUpper && arco.archLower ? "superior e inferior" : arco.archUpper ? "superior" : arco.archLower ? "inferior" : "";
  return `${MATERIAL[arco.material] ?? arco.material} ${arco.gauge}${donde ? ` (${donde})` : ""}`;
}

const SITUACION: Record<string, string> = {
  vencido: "con pagos vencidos",
  "por-vencer": "al corriente, con un pago por vencer",
  "al-corriente": "al corriente",
  saldado: "saldado",
  "sin-plan": "sin plan de pagos todavía",
};

export const ortoCaso = definirHerramienta<ParamsOrtoCaso, DatosOrtoCaso>({
  nombre: "orto_caso",
  descripcion:
    "Cómo va el caso de ORTODONCIA de un paciente: estado, mes N de M, fase, arco actual, higiene del último " +
    "control, alineadores, último y próximo control, y sus mensualidades. Úsala para «¿cómo va el caso de …?», " +
    "con `paciente` (nombre, teléfono o folio; no hace falta buscar_paciente antes) o con el `patientId` del " +
    "contexto. Solo lee lo registrado: no diagnostica, no cobra y no registra controles; da el enlace a su ficha. " +
    "Para agendarle su control usa agendar_cita.",
  parametros,
  permiso: PERMISO_ORTO,

  async ejecutar(ctx: SabinaCtx, params): Promise<DatosOrtoCaso> {
    const motor = await import("./orto-motor");
    const base: DatosOrtoCaso = {
      modulo: "activo",
      noEncontrado: null,
      aclarar: null,
      paciente: null,
      caso: null,
      tieneValoracion: false,
      clinico: null,
      controles: null,
      cobranza: null,
      omitidas: [],
      enlace: "",
    };

    const modulo = await motor.estadoDelModulo(ctx);
    if (modulo !== "activo") return { ...base, ...sinModulo(modulo) };

    // Quién es. Con la sede ya comprobada, y antes de leer nada de ortodoncia.
    const dbPacientes = dbDe(ctx) as unknown as AgendaDb;
    let quien = await resolverPaciente(ctx, dbPacientes, {
      pacienteId: params.patientId ?? null,
      paciente: params.paciente ?? null,
    });
    // Un `patientId` que no es un id (el modelo puso el folio o el nombre): se
    // busca por el texto, con las mismas reglas de clínica y de visibilidad.
    if (quien.tipo === "no" && params.patientId) {
      quien = await resolverPaciente(ctx, dbPacientes, {
        paciente: (params.paciente ?? "").trim() || params.patientId.trim(),
      });
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
    const enlace = enlaceDelCaso(patientId);

    const omitidas: OmitidaOrto[] = [];
    const puede = anotador(ctx, omitidas);
    const ver = {
      clinico: puede("fase, arco, higiene y alineadores", "medicalRecord.view"),
      controles: puede("último y próximo control", "agenda.view"),
      cobranza: puede("mensualidades", "billing.view"),
    };

    const leido = await motor.leerCaso(ctx, patientId, ver);
    if (!leido) return { ...base, noEncontrado: "No encuentro a ese paciente entre los pacientes que puedes ver." };
    // Sin caso no hay partes que omitir: lo que se dice es que no tiene caso.
    if (!leido.caso) return { ...base, enlace, paciente: leido.paciente, tieneValoracion: leido.tieneValoracion };

    const zona = motor.zonaDe(ctx);
    const fila = leido.cobranza?.fila ?? null;

    return {
      ...base,
      paciente: leido.paciente,
      caso: {
        estado: ESTADO_DEL_CASO[leido.caso.status] ?? leido.caso.status,
        mes: leido.caso.mes,
        de: leido.caso.de,
        inicio: leido.caso.inicio,
        finEstimado: leido.caso.finEstimado,
      },
      tieneValoracion: leido.tieneValoracion,
      clinico: leido.clinico
        ? {
            fase: leido.clinico.fase ? FASE[leido.clinico.fase] ?? leido.clinico.fase : null,
            arco: arcoLegible(leido.clinico.arco),
            higiene: leido.clinico.higiene,
            higieneEmpeora: leido.clinico.higieneEmpeora,
            alineadores: leido.clinico.alineadores
              ? {
                  sistema: leido.clinico.alineadores.sistema,
                  actual: leido.clinico.alineadores.actual,
                  total: leido.clinico.alineadores.total,
                  esperado: leido.clinico.alineadores.esperado,
                  diferencia: leido.clinico.alineadores.diferencia,
                  estado: leido.clinico.alineadores.estado,
                }
              : null,
          }
        : null,
      controles: leido.controles
        ? {
            ultimo: leido.controles.ultimo ? fechaDe(leido.controles.ultimo, zona) : null,
            proximo: leido.controles.proximo
              ? `${fechaDe(leido.controles.proximo, zona)} ${horaDe(leido.controles.proximo, zona)}`
              : null,
            sinControl: leido.controles.sinControl ? fraseSinControl(leido.controles.sinControl) : null,
            urgente: leido.controles.sinControl?.urgente === true,
          }
        : null,
      cobranza: leido.cobranza
        ? {
            // Sin fila = caso cerrado que la pantalla de Cobranza ya no lista:
            // o saldó su plan, o nunca tuvo uno. No son lo mismo.
            situacion: fila ? fila.situacion : leido.cobranza.tienePlan ? "saldado" : "sin-plan",
            vencido: fila?.vencido ?? 0,
            pagosVencidos: fila?.cuotasVencidas ?? 0,
            vencidoDesde: fila?.vencidoDesde ?? null,
            diasDeAtraso: fila?.diasDeAtraso ?? null,
            proximaFecha: fila?.proximaFecha ?? null,
            proximoImporte: fila?.proximoImporte ?? null,
            diasParaLaProxima: fila?.diasParaLaProxima ?? null,
            porCobrar: fila?.porCobrar ?? 0,
            cuotasPagadas: fila?.cuotasPagadas ?? leido.cobranza.cuotasPagadas,
            cuotasTotales: fila?.cuotasTotales ?? leido.cobranza.cuotasTotales,
            saldoAFavor: leido.cobranza.saldoAFavor,
          }
        : null,
      omitidas,
      enlace,
    };
  },

  // Nunca es «sin datos»: «no lo encuentro», «¿cuál de los dos?», «no tiene caso
  // de ortodoncia» y «esta sede no tiene el módulo» son cuatro respuestas
  // distintas, y un «no hay datos» las confunde todas.
  vacio: () => false,

  avisoObligatorio(d) {
    if (d.modulo !== "activo") return avisoSinModulo(d.modulo);
    if (d.noEncontrado || d.aclarar) return null;
    return avisoEnlace(
      d.caso ? "registrar el control, cobrar o cambiar algo del caso" : "abrir el caso de ortodoncia",
      d.caso ? "su ficha de ortodoncia" : "la ficha del paciente",
      d.enlace,
    );
  },

  resumir(d) {
    if (d.modulo !== "activo") return avisoSinModulo(d.modulo).frase;
    if (d.noEncontrado) {
      return `${d.noEncontrado} Dilo así: NO digas que no tiene caso de ortodoncia ni que no hay datos, porque no se llegó a mirar.`;
    }
    if (d.aclarar) {
      const opciones = lineasDeLista(d.aclarar.opciones, (o) => o);
      const una = !opciones && d.aclarar.opciones[0] ? ` ${d.aclarar.opciones[0]}.` : "";
      return `${d.aclarar.pregunta}${una}${opciones}\nPregúntaselo a quien escribe y NO elijas tú; cuando conteste, vuelve a llamar con \`paciente\`.`;
    }
    const ficha = `[su ficha de ortodoncia](${d.enlace})`;
    if (!d.caso) {
      const valorado = d.tieneValoracion ? " Tiene una valoración de ortodoncia registrada, sin plan de tratamiento." : "";
      return `${d.paciente} no tiene un caso de ortodoncia abierto.${valorado} Yo no lo abro: se abre en [la ficha del paciente](${d.enlace}).`;
    }

    const partes: string[] = [];
    const duracion = d.caso.de > 0 ? `mes ${d.caso.mes} de ${d.caso.de}` : `mes ${d.caso.mes} (sin duración estimada)`;
    partes.push(`Caso de ortodoncia de ${d.paciente}: ${d.caso.estado.toLowerCase()}, ${duracion}.`);

    if (d.clinico) {
      const c = d.clinico;
      partes.push(`Fase: ${c.fase ?? "sin fase en curso"}. Arco actual: ${c.arco ?? "sin arco registrado"}.`);
      if (c.higiene) {
        const h = c.higiene;
        const trozos = [
          h.placaPct !== null ? `placa ${h.placaPct}%` : null,
          h.gingivitis ? `gingivitis ${h.gingivitis.toLowerCase()}` : null,
          h.manchasBlancas ? "con manchas blancas" : null,
        ].filter(Boolean);
        partes.push(`Higiene en el control del ${fechaCorta(h.fecha)}: ${trozos.join(", ")}.`);
      } else {
        partes.push("Higiene: sin registro en un control firmado.");
      }
      if (c.higieneEmpeora.length > 0) partes.push(`Aviso del panel, la higiene empeora: ${c.higieneEmpeora.join("; ")}.`);
      if (c.alineadores) {
        const a = c.alineadores;
        const ritmo =
          a.diferencia === 0
            ? "va al día"
            : a.diferencia < 0
              ? `va ${Math.abs(a.diferencia)} atrás de lo esperado (el ${a.esperado})`
              : `va ${a.diferencia} adelante de lo esperado (el ${a.esperado})`;
        // En pausa o terminados, el «esperado» sigue corriendo con el calendario
        // y no dice nada del paciente: no se compara.
        const cola = a.estado === "PAUSED" ? ", en pausa" : a.estado === "FINISHED" ? ", terminados" : `; ${ritmo}`;
        partes.push(`Alineadores${a.sistema ? ` ${a.sistema}` : ""}: trae el ${a.actual} de ${a.total}${cola}.`);
      }
    }

    if (d.controles) {
      const k = d.controles;
      const ultimo = k.ultimo ? `último control el ${fechaCorta(k.ultimo)}` : "sin controles registrados";
      const proximo = k.proximo
        ? `próximo el ${fechaCorta(k.proximo)} a las ${k.proximo.slice(11)}`
        : "sin próximo control agendado";
      partes.push(
        `Controles: ${ultimo}; ${proximo}.${k.urgente ? ` Lleva ${DIAS_SIN_CONTROL_URGENTE} días o más sin control.` : ""}`,
      );
    }

    if (d.cobranza) {
      const m = d.cobranza;
      if (m.situacion === "sin-plan") {
        partes.push("Mensualidades: no tiene plan de pagos.");
      } else {
        const trozos = [`${SITUACION[m.situacion] ?? m.situacion}`];
        if (m.pagosVencidos > 0) {
          const atraso = fraseDeAtraso(m.diasDeAtraso);
          trozos.push(`${fraseDeVencidos(m.pagosVencidos)} por ${pesos(m.vencido)}${atraso ? ` (${atraso})` : ""}`);
        }
        if (m.proximaFecha && m.proximoImporte !== null) {
          const cuando = fraseDeProxima(m.diasParaLaProxima);
          trozos.push(`próximo pago de ${pesos(m.proximoImporte)} el ${fechaCorta(m.proximaFecha)}${cuando ? ` (${cuando})` : ""}`);
        }
        trozos.push(`${m.cuotasPagadas} de ${m.cuotasTotales} pagos hechos`);
        trozos.push(`le falta por pagar ${pesos(m.porCobrar)}`);
        if (m.saldoAFavor > 0) trozos.push(`tiene ${pesos(m.saldoAFavor)} de saldo a favor`);
        // En vivo (28-sep-2026) el modelo añadió un «ya pagó $6,000» que nadie le
        // dio: lo dedujo de «3 de 11». Los importes son los de aquí y ninguno más.
        partes.push(`Mensualidades: ${trozos.join("; ")}. No calcules ni deduzcas ningún otro importe (ni lo pagado ni el total).`);
      }
    }

    partes.push(
      `Es lo registrado en el panel; no es un diagnóstico. Yo no registro el control ni cobro: eso se hace en ${ficha}.`,
    );
    return `${partes.join(" ")}${fraseOmitidas(d.omitidas)}`;
  },
});
