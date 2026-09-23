/**
 * `estado_mercado_pago` — cómo tiene ESTA clínica Mercado Pago: si la cuenta
 * está conectada, si el bot de WhatsApp pide anticipo al agendar, cuánto pide y
 * con qué plazo para pagar.
 *
 * ── DE DÓNDE SALE EL DATO ──────────────────────────────────────────────
 * De `leerPantallaAnticipos` (@/lib/anticipos/pantalla.server), que es
 * literalmente lo que pinta Configuración → Integraciones → Anticipos por
 * WhatsApp. No se reescribe la consulta: se le pasa el cliente de Sabina
 * (`dbDe(ctx)`), así que Sabina y la pantalla no pueden decir cosas distintas.
 * Esa lectura ya viene sin secretos (ni el token ni un trozo de él).
 *
 * 🔴 SOLO LEE. Sabina no conecta ni desconecta la cuenta, no enciende ni apaga
 * el anticipo, no cambia montos ni manda links de pago (decisión de Rafael: la
 * misma razón por la que no emite recetas). Si se lo piden, la respuesta es el
 * camino en pantalla — lo da `ayuda_del_panel`, tema `mercado_pago`.
 *
 * ── EL PERMISO ─────────────────────────────────────────────────────────
 * `settings.edit`, el MISMO que exigen la pantalla y su API
 * (`requirePermissionOrRedirect` / `denyIfMissingPermission`). Parece mucho
 * para leer, pero es lo que decide quién ve esa pantalla: con una key más
 * floja Sabina le enseñaría a una recepcionista la configuración de cobro que
 * el panel le esconde.
 *
 * ── LO QUE NO VIAJA ────────────────────────────────────────────────────
 * Los nombres de pacientes de «Últimos anticipos» y el id de la cuenta. De los
 * recientes solo salen cuentas por estado: contestan «¿está funcionando?» sin
 * meter datos de pacientes en la conversación (y sin pagar sus tokens).
 */

import { z } from "zod";
import { leerPantallaAnticipos, type PantallaAnticipos } from "@/lib/anticipos/pantalla.server";
import { ANTICIPO_MINIMO_MXN } from "@/lib/anticipos/core";
import { dbDe, definirHerramienta, pesos, plural } from "./base";
import { fechaDe } from "./fechas";
import type { SabinaCtx } from "../tipos";

const parametros = z.object({});

export interface DatosMercadoPago {
  /**
   * Por qué la función no se puede usar todavía, si es el caso:
   *  · "plataforma" — DaleControl aún no activa los cobros con Mercado Pago
   *    (faltan credenciales del sistema). No depende de la clínica.
   *  · "base" — la base de datos todavía no tiene las tablas.
   */
  noDisponible: "plataforma" | "base" | null;
  cuenta: {
    conectada: boolean;
    apodo: string | null;
    correo: string | null;
    /** Cuenta de pruebas de Mercado Pago: no cobra dinero real. */
    modoPruebas: boolean;
    /** AAAA-MM-DD en la zona de la clínica, o null. */
    conectadaEl: string | null;
    desconectadaEl: string | null;
  };
  anticipo: {
    /** Encendido DE VERDAD: pedido + cuenta conectada + plataforma lista (mismo cálculo que la pantalla). */
    activo: boolean;
    /** Lo que la clínica dejó marcado, aunque hoy no pueda funcionar (p. ej. sin cuenta). */
    modo: PantallaAnticipos["config"]["modo"];
    /** Pesos. En «fixed» es el anticipo; en «percent»/«total», el respaldo si el servicio no tiene precio. */
    monto: number;
    porcentaje: number;
    /** Plazo para pagar el link antes de que se libere el horario. */
    minutos: number;
  };
  /** De los últimos anticipos que enseña la pantalla (hasta 20): cuántos hay en cada estado. */
  recientes: {
    total: number;
    porEstado: Record<string, number>;
    /** Pagos con algo raro (segundo pago, monto menor…) que alguien debe revisar en la pantalla. */
    conAnomalias: number;
  };
}

/** Los mismos textos que la tabla «Últimos anticipos» de la pantalla. */
const ESTADO_LEGIBLE: Record<string, [string, string]> = {
  PENDING: ["esperando pago", "esperando pago"],
  PAID: ["pagado", "pagados"],
  EXPIRED: ["venció sin pago", "vencieron sin pago"],
  FAILED: ["sin link", "sin link"],
};

function dia(iso: string | null, timezone: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : fechaDe(d, timezone);
}

async function ejecutar(ctx: SabinaCtx): Promise<DatosMercadoPago> {
  // 🔴 clinicId de la sesión; el modelo no manda ninguno (los parámetros van vacíos).
  const p = await leerPantallaAnticipos(ctx.clinicId, dbDe(ctx));

  const porEstado: Record<string, number> = {};
  let conAnomalias = 0;
  for (const r of p.recientes) {
    porEstado[r.estado] = (porEstado[r.estado] ?? 0) + 1;
    if (r.anomalias.length > 0) conAnomalias += 1;
  }

  return {
    noDisponible: !p.tablasListas ? "base" : !p.plataforma.lista ? "plataforma" : null,
    cuenta: {
      conectada: p.cuenta.conectada,
      apodo: p.cuenta.apodo,
      correo: p.cuenta.correo,
      modoPruebas: p.cuenta.modoPruebas,
      conectadaEl: dia(p.cuenta.conectadaEl, ctx.timezone),
      desconectadaEl: dia(p.cuenta.desconectadaEl, ctx.timezone),
    },
    anticipo: { ...p.config },
    recientes: { total: p.recientes.length, porEstado, conAnomalias },
  };
}

function fraseMonto(a: DatosMercadoPago["anticipo"]): string {
  const respaldo =
    a.monto >= ANTICIPO_MINIMO_MXN
      ? `si el servicio no tiene precio, ${pesos(a.monto)}`
      : "si el servicio no tiene precio, la cita va sin anticipo";
  // Si el porcentaje da menos del mínimo, esa cita va sin anticipo (`calcularMontoAnticipo`).
  if (a.modo === "percent" && a.porcentaje > 0) {
    return `el ${a.porcentaje}% del precio del servicio; si eso da menos de ${pesos(ANTICIPO_MINIMO_MXN)}, esa cita va sin anticipo (${respaldo})`;
  }
  if (a.modo === "total") return `el precio completo del servicio (${respaldo})`;
  // «percent» con 0 %: `calcularMontoAnticipo` cae al monto, como el fijo.
  return a.monto >= ANTICIPO_MINIMO_MXN
    ? `un monto fijo de ${pesos(a.monto)}`
    : `un monto fijo de ${pesos(a.monto)}, por debajo del mínimo de ${pesos(ANTICIPO_MINIMO_MXN)}: las citas van sin anticipo`;
}

function resumir(d: DatosMercadoPago): string {
  if (d.noDisponible === "base") {
    return "Mercado Pago: la función de anticipos todavía no está disponible en esta instalación (no depende de la clínica). Mientras, el bot agenda como siempre, sin anticipo.";
  }

  const partes: string[] = [];
  if (d.noDisponible === "plataforma") {
    partes.push(
      "DaleControl todavía no activa los cobros con Mercado Pago (no depende de la clínica); mientras, el bot agenda como siempre, sin anticipo.",
    );
  }

  const c = d.cuenta;
  if (c.conectada) {
    const quien = [c.apodo ? `«${c.apodo}»` : null, c.correo].filter(Boolean).join(", ");
    partes.push(
      `Cuenta de Mercado Pago conectada${quien ? ` (${quien})` : ""}${c.conectadaEl ? ` desde el ${c.conectadaEl}` : ""}.`,
    );
    if (c.modoPruebas) partes.push("OJO: es una cuenta de PRUEBAS de Mercado Pago, no cobra dinero real.");
  } else {
    partes.push(
      `Sin cuenta de Mercado Pago conectada${c.desconectadaEl ? ` (se desconectó el ${c.desconectadaEl})` : ""}.`,
    );
  }

  const a = d.anticipo;
  if (a.activo) {
    partes.push(
      `Anticipo al agendar por WhatsApp: ENCENDIDO. Se pide ${fraseMonto(a)}, y el paciente tiene ${a.minutos} minutos para pagar antes de que se libere el horario.`,
    );
  } else if (!c.conectada && d.noDisponible === null) {
    partes.push(
      "Anticipo al agendar por WhatsApp: APAGADO; sin cuenta conectada no se puede pedir, así que el bot agenda sin anticipo.",
    );
  } else {
    partes.push("Anticipo al agendar por WhatsApp: APAGADO; el bot agenda sin pedir anticipo.");
  }

  const r = d.recientes;
  if (r.total > 0) {
    const cuentas = Object.entries(r.porEstado)
      .sort((x, y) => y[1] - x[1])
      .map(([estado, n]) => {
        const [uno, varios] = ESTADO_LEGIBLE[estado] ?? [estado.toLowerCase(), estado.toLowerCase()];
        return `${n} ${n === 1 ? uno : varios}`;
      })
      .join(", ");
    partes.push(`De los últimos ${plural(r.total, "anticipo", "anticipos")}: ${cuentas}.`);
    if (r.conAnomalias > 0) {
      partes.push(
        `${plural(r.conAnomalias, "anticipo tiene", "anticipos tienen")} un pago con algo que revisar: se ve en «Últimos anticipos» de esa pantalla.`,
      );
    }
  } else {
    partes.push("Todavía no se ha pedido ningún anticipo.");
  }

  return `Mercado Pago de la clínica: ${partes.join(" ")}`;
}

export const estadoMercadoPago = definirHerramienta<z.infer<typeof parametros>, DatosMercadoPago>({
  nombre: "estado_mercado_pago",
  descripcion:
    "Cómo tiene ESTA clínica Mercado Pago: si la cuenta está conectada, si el bot de WhatsApp pide anticipo al agendar, cuánto pide, el plazo para pagar y cómo van los últimos anticipos. Solo lee: no conecta, no cambia nada y no manda links. Para «cómo lo configuro» usa ayuda_del_panel.",
  parametros,
  permiso: "settings.edit",
  ejecutar: (ctx) => ejecutar(ctx),
  resumir,
  // «Sin cuenta conectada» ES la respuesta, no un «sin datos».
  vacio: () => false,
});
