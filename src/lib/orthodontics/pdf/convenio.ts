// ═══════════════════════════════════════════════════════════════════════════
// El CONVENIO DE PAGO de ortodoncia, listo para pintar (ws1-t4, 29-sep-2026).
// Puro: sin Prisma, sin React y sin red. Lo arma la action del PDF con lo que
// ya lee el cobro del caso (`cargarPanelDeCobro`: la factura del tratamiento,
// sus condiciones y el calendario con estado) y lo pinta
// `pdf-templates/financial-agreement.tsx`.
//
// Por qué aquí y no en la plantilla: las pruebas tienen que poder comprobar
// QUÉ dice el convenio (fechas con año, estado de cada pago, el modo «pago por
// control», el responsable del pago) sin renderizar un PDF.
// ═══════════════════════════════════════════════════════════════════════════

import type { CondicionesPago } from "@/lib/quotes/condiciones-pago";
import type { CuotaConEstado, EstadoCuota } from "@/lib/invoices/plan-de-pagos";
import type { OrthoBillingMode } from "@/lib/orthodontics/billing-mode";
import type { ConfigRecargoPorAtraso } from "@/lib/orthodontics/cobro/reglas";
import { condicionesParaImprimir } from "@/lib/orthodontics/cobro/condiciones-convenio";
import type { DatosDelMembreteOrto } from "./membrete-orto";
import { dinero, edadEnAnios, fechaDMA } from "./formato";

export interface ResponsableDelPago {
  /** true = paga el propio paciente. */
  esElPaciente: boolean;
  nombre: string;
  /** «Madre», «Tutor legal»… null si es el paciente. */
  relacion: string | null;
  telefono: string | null;
  correo: string | null;
  direccion: string | null;
  rfc: string | null;
  razonSocial: string | null;
  regimenFiscal: string | null;
  cp: string | null;
}

export interface CargoDeControlConvenio {
  folio: string | null;
  /** "YYYY-MM-DD" */
  vencimiento: string | null;
  total: number;
  pagado: number;
}

export interface EntradaConvenio {
  membrete: DatosDelMembreteOrto;
  treatmentPlanId: string;
  modo: OrthoBillingMode;
  tecnica: string;
  duracionMeses: number | null;
  /** ISO de la colocación (`installedAt`), o null si todavía no se coloca. */
  colocacion: string | null;
  /** Factura del tratamiento (en «Pago por control», la de colocación/enganche). */
  factura: { numero: string | null; total: number; pagado: number; saldo: number } | null;
  condicionesPago: CondicionesPago | null;
  /** «Precio total»: el calendario completo de la factura, con su estado. */
  cuotas: CuotaConEstado[];
  saldoAFavor: number;
  /** «Pago por control»: precio de «Control de ortodoncia» del catálogo. */
  precioPorControl: number | null;
  /** «Pago por control»: los controles ya facturados del caso. */
  cargosDeControl: CargoDeControlConvenio[];
  /** "YYYY-MM-DD" de hoy en la zona de la clínica: decide qué control ya venció. */
  hoy: string;
  descuento: { etiqueta: string; porcentaje: number | null } | null;
  recargo: ConfigRecargoPorAtraso;
  reposicionesIncluidas: number;
  responsable: ResponsableDelPago;
  /** `agreementTerms` de la clínica: null = nunca las editó (sale el ejemplo). */
  condicionesGuardadas: string | null;
}

export interface Renglon {
  etiqueta: string;
  valor: string;
  destacado?: boolean;
}

export interface FilaCalendario {
  concepto: string;
  vence: string;
  importe: string;
  /** «Pagado», «Por vencer», «Vencido», con lo abonado si va a medias. */
  estado: string;
  tono: EstadoCuota;
}

export interface ConvenioPdfData {
  membrete: DatosDelMembreteOrto;
  documento: string;
  folio: string;
  modo: OrthoBillingMode;
  tratamiento: Renglon[];
  responsable: ResponsableDelPago;
  /** Renglones de contacto/fiscales del responsable (solo los que existen). */
  responsableRenglones: Renglon[];
  pacienteEsMenor: boolean;
  resumen: Renglon[];
  tituloCalendario: string;
  calendario: FilaCalendario[];
  /** Qué decir si el calendario está vacío. */
  calendarioVacio: string;
  clausulas: string[];
  clausulasSonEjemplo: boolean;
  /** Renglones que salen de la «Política de cobro» configurada (recargo), si está activa. */
  politica: string[];
  lugarYFecha: string;
  firmas: Array<{ rol: string; nombre: string; detalle: string | null }>;
}

export const DOCUMENTO_CONVENIO = "Convenio de pago";

const ESTADO: Record<EstadoCuota, string> = {
  pagada: "Pagado",
  porVencer: "Por vencer",
  vencida: "Vencido",
};

function estadoConAbono(estado: EstadoCuota, abonado: number, importe: number): string {
  if (estado !== "pagada" && abonado > 0.004 && abonado < importe) return `${ESTADO[estado]} · abonado ${dinero(abonado)}`;
  return ESTADO[estado];
}

/** El folio del convenio: el de la factura del tratamiento, o uno estable del caso si no hay factura. */
export function folioDelConvenio(numeroFactura: string | null | undefined, treatmentPlanId: string): string {
  const n = (numeroFactura ?? "").trim();
  if (n) return `CONV-${n}`;
  return `CONV-${treatmentPlanId.slice(-8).toUpperCase()}`;
}

/** «Día 23 de cada mes», «Cada semana»… a partir de la fecha del primer pago y la frecuencia. */
export function diaDePago(c: CondicionesPago | null): string | null {
  if (!c || c.modo !== "plazos") return null;
  const dia = c.primerPago && /^\d{4}-\d{2}-(\d{2})$/.exec(c.primerPago)?.[1];
  if (c.frecuencia === "WEEKLY") return "Cada semana";
  if (c.frecuencia === "BIWEEKLY") return "Cada quince días";
  return dia ? `Día ${Number(dia)} de cada mes` : "Mensual";
}

function lineaDeRecargo(r: ConfigRecargoPorAtraso): string | null {
  if (!r.activo || !(r.valor > 0)) return null;
  const monto = r.tipo === "FIJO" ? dinero(r.valor) : `${r.valor}% del pago atrasado`;
  const gracia = r.diasDeGracia > 0 ? ` después de ${r.diasDeGracia} ${r.diasDeGracia === 1 ? "día" : "días"} de tolerancia` : "";
  return `Recargo por atraso: ${monto}${gracia}, según la política de cobro de la clínica.`;
}

function renglonesDelResponsable(r: ResponsableDelPago): Renglon[] {
  const out: Renglon[] = [];
  const push = (etiqueta: string, v: string | null) => {
    const valor = (v ?? "").trim();
    if (valor) out.push({ etiqueta, valor });
  };
  push("Teléfono", r.telefono);
  push("Correo", r.correo);
  push("Domicilio", r.direccion);
  push("RFC", r.rfc ? r.rfc.toUpperCase() : null);
  push("Razón social", r.razonSocial);
  push("Régimen fiscal", r.regimenFiscal);
  push("C.P. fiscal", r.cp);
  return out;
}

export function armarConvenio(e: EntradaConvenio): ConvenioPdfData {
  const m = e.membrete;
  const tz = m.zonaHoraria;
  const porControl = e.modo === "PAGO_POR_CONTROL";

  const tratamiento: Renglon[] = [
    { etiqueta: "Técnica", valor: e.tecnica || "—" },
    { etiqueta: "Duración estimada", valor: e.duracionMeses && e.duracionMeses > 0 ? `${e.duracionMeses} meses` : "—" },
    { etiqueta: "Fecha de colocación", valor: e.colocacion ? fechaDMA(e.colocacion, tz) : "Por programar" },
    { etiqueta: "Forma de pago", valor: porControl ? "Pago por control" : "Precio total a plazos" },
  ];
  if (e.reposicionesIncluidas > 0) {
    tratamiento.push({ etiqueta: "Reposiciones incluidas", valor: String(e.reposicionesIncluidas) });
  }

  const resumen: Renglon[] = [];
  let calendario: FilaCalendario[];
  let tituloCalendario: string;
  let calendarioVacio: string;

  if (porControl) {
    resumen.push({
      etiqueta: "Precio por control",
      valor: e.precioPorControl != null ? dinero(e.precioPorControl) : "Según el catálogo de la clínica",
      destacado: true,
    });
    if (e.factura) {
      resumen.push({ etiqueta: "Colocación / enganche", valor: dinero(e.factura.total) });
    }
    const facturadoControles = e.cargosDeControl.reduce((a, c) => a + c.total, 0);
    const pagadoControles = e.cargosDeControl.reduce((a, c) => a + Math.min(c.pagado, c.total), 0);
    const pagado = (e.factura?.pagado ?? 0) + pagadoControles;
    const saldo = (e.factura?.saldo ?? 0) + Math.max(0, facturadoControles - pagadoControles);
    resumen.push({ etiqueta: "Controles facturados", valor: String(e.cargosDeControl.length) });
    resumen.push({ etiqueta: "Pagado a la fecha", valor: dinero(pagado) });
    resumen.push({ etiqueta: "Saldo pendiente", valor: dinero(saldo), destacado: true });

    tituloCalendario = "Pagos del tratamiento";
    calendarioVacio = "Todavía no hay controles facturados. Cada control atendido se cobra al precio por control.";
    calendario = [];
    if (e.factura) {
      const diaColocacion = e.colocacion ? fechaDMA(e.colocacion, tz).split("/").reverse().join("-") : null;
      const estado: EstadoCuota =
        e.factura.saldo <= 0.004 ? "pagada" : diaColocacion && diaColocacion < e.hoy ? "vencida" : "porVencer";
      calendario.push({
        concepto: "Colocación / enganche",
        vence: e.colocacion ? fechaDMA(e.colocacion, tz) : "—",
        importe: dinero(e.factura.total),
        estado: estadoConAbono(estado, e.factura.pagado, e.factura.total),
        tono: estado,
      });
    }
    e.cargosDeControl
      .slice()
      .sort((a, b) => (a.vencimiento ?? "").localeCompare(b.vencimiento ?? ""))
      .forEach((c, i) => {
        const estado: EstadoCuota =
          c.pagado + 0.004 >= c.total ? "pagada" : c.vencimiento && c.vencimiento < e.hoy ? "vencida" : "porVencer";
        calendario.push({
          concepto: `Control ${i + 1}${c.folio ? ` · ${c.folio}` : ""}`,
          vence: fechaDMA(c.vencimiento, tz),
          importe: dinero(c.total),
          estado: estadoConAbono(estado, c.pagado, c.total),
          tono: estado,
        });
      });
  } else {
    const c = e.condicionesPago;
    const aPlazos = c?.modo === "plazos";
    const mensualidades = e.cuotas.filter((q) => !q.esEnganche);
    const enganche = e.cuotas.find((q) => q.esEnganche);
    resumen.push({ etiqueta: "Costo total del tratamiento", valor: dinero(e.factura?.total ?? 0), destacado: true });
    if (e.descuento) {
      resumen.push({
        etiqueta: "Descuento acordado",
        valor: e.descuento.porcentaje != null ? `${e.descuento.etiqueta} (${e.descuento.porcentaje}%)` : e.descuento.etiqueta,
      });
    }
    if (aPlazos) {
      resumen.push({ etiqueta: "Enganche", valor: dinero(enganche?.importe ?? c?.enganche ?? 0) });
      const n = mensualidades.length || c?.numPagos || 0;
      resumen.push({ etiqueta: "Número de pagos", valor: String(n) });
      const montos = Array.from(new Set(mensualidades.map((q) => q.importe)));
      resumen.push({
        etiqueta: "Monto de cada pago",
        valor:
          montos.length === 0
            ? "—"
            : montos.length === 1
              ? dinero(montos[0])
              : `${dinero(Math.max(...montos))} (el último ${dinero(mensualidades[mensualidades.length - 1].importe)})`,
      });
      resumen.push({ etiqueta: "Día de pago", valor: diaDePago(c) ?? "—" });
    } else {
      resumen.push({ etiqueta: "Forma de pago", valor: "Pago único" });
    }
    resumen.push({ etiqueta: "Pagado a la fecha", valor: dinero(e.factura?.pagado ?? 0) });
    resumen.push({ etiqueta: "Saldo pendiente", valor: dinero(e.factura?.saldo ?? 0), destacado: true });
    if (e.saldoAFavor > 0.004) resumen.push({ etiqueta: "Saldo a favor", valor: dinero(e.saldoAFavor) });

    tituloCalendario = "Calendario de pagos";
    calendarioVacio = e.factura
      ? "Pago único, sin calendario de mensualidades."
      : "Este caso todavía no tiene plan de pago abierto.";
    calendario = e.cuotas
      .slice()
      .sort((a, b) => a.numero - b.numero)
      .map((q) => ({
        concepto: q.esEnganche ? "Enganche" : `Pago ${q.numero} de ${mensualidades.length}`,
        vence: fechaDMA(q.vencimiento, tz),
        importe: dinero(q.importe),
        estado: estadoConAbono(q.estado, q.abonado, q.importe),
        tono: q.estado,
      }));
  }

  const edad = edadEnAnios(m.paciente.fechaNacimiento, new Date(m.emitidoEl));
  const { clausulas, esEjemplo } = condicionesParaImprimir(e.condicionesGuardadas);
  const recargo = lineaDeRecargo(e.recargo);

  const fecha = fechaDMA(m.emitidoEl, tz);
  const doctor = m.doctor;

  return {
    membrete: m,
    documento: DOCUMENTO_CONVENIO,
    folio: folioDelConvenio(e.factura?.numero, e.treatmentPlanId),
    modo: e.modo,
    tratamiento,
    responsable: e.responsable,
    responsableRenglones: renglonesDelResponsable(e.responsable),
    pacienteEsMenor: edad != null && edad < 18,
    resumen,
    tituloCalendario,
    calendario,
    calendarioVacio,
    clausulas,
    clausulasSonEjemplo: esEjemplo,
    politica: recargo ? [recargo] : [],
    lugarYFecha: `${m.lugar || "________________"}, a ${fecha}`,
    firmas: [
      {
        rol: e.responsable.esElPaciente ? "Paciente" : "Responsable del pago",
        nombre: e.responsable.nombre,
        detalle: e.responsable.esElPaciente ? null : e.responsable.relacion,
      },
      {
        rol: "Por la clínica",
        nombre: doctor?.nombre || m.clinicName,
        detalle: doctor ? [doctor.cedula ? `Céd. prof. ${doctor.cedula}` : null, m.clinicName].filter(Boolean).join(" · ") : null,
      },
    ],
  };
}
