// ═══════════════════════════════════════════════════════════════════════════
// EL AVISO DE MENSUALIDAD POR VENCER — núcleo puro, sin I/O (ws1-t3).
//
// Hoy la clínica avisa de la cita, del cumpleaños y del seguimiento. De la
// mensualidad, NADA: el paciente se entera de que debía cuando ya venció. Esto
// decide a quién se le avisa y de qué cuota; el barrido (`sweep.ts`) pone la
// base de datos y la cola pone el envío.
//
// ── Las cuotas NO se calculan aquí ────────────────────────────────────────
// Ni una línea de aritmética de plazos vive en este archivo. El calendario y
// «por qué cuota va» salen ENTEROS de `lib/invoices/plan-de-pagos.ts` (ws1-t2),
// que a su vez usa la aritmética con la que el paciente vio su calendario en el
// presupuesto y en el PDF. Si la cuota 7 vale $2,000 en la ficha, vale $2,000 en
// el WhatsApp: no hay una segunda versión que pueda discrepar.
//
// ── A quién NO se le avisa, y esto es la mitad del trabajo ────────────────
// Un aviso de cobranza equivocado no es un aviso de más: es cobrarle a alguien
// que no debe. Se descarta, con motivo, la factura CANCELADA, la PAGADA, la
// que no es a plazos, el paciente dado de baja o borrado, el que no tiene
// teléfono, y la cuota que ya se avisó.
//
// ── Idempotencia ──────────────────────────────────────────────────────────
// Cada aviso lleva una `dedupeKey` determinista (factura|cuota|vencimiento).
// Dos corridas del cron sobre el mismo estado producen EXACTAMENTE los mismos
// avisos, y quien ya esté encolado se cae aquí por `yaAvisado`. Como esta
// función es pura, la prueba de «el cron dos veces manda UNO» se corre sin
// base de datos.
// ═══════════════════════════════════════════════════════════════════════════

import {
  calendarioDeCuotas,
  estadoDelPlan,
  type CuotaConEstado,
  type PagoRecibido,
} from "@/lib/invoices/plan-de-pagos";
import type { CondicionesPago } from "@/lib/quotes/condiciones-pago";
import { dedupeKeyCobranza } from "@/lib/reminders/config";

/** Una factura candidata, tal como la deja el barrido. */
export interface FacturaCandidata {
  invoiceId: string;
  /** InvoiceStatus tal cual: "PENDING" | "PARTIAL" | "PAID" | "CANCELLED" | … */
  status: string;
  total: number;
  /** Las condiciones acordadas (`invoice_payment_terms`). null = no hay plan. */
  condiciones: CondicionesPago | null;
  /** Lo cobrado de verdad, ya con el signo del reembolso puesto. */
  pagos: PagoRecibido[];
  patientId: string;
  patientNombre: string;
  patientPhone: string | null;
  /** PatientStatus === "ACTIVE". */
  pacienteActivo: boolean;
  /** El paciente está borrado (deletedAt no nulo). */
  pacienteBorrado: boolean;
}

/** Por qué una factura candidata NO genera aviso. */
export type MotivoDescarte =
  | "facturaCancelada"
  | "facturaPagada"
  | "facturaBorrador"
  | "sinPlanAPlazos"
  | "pacienteDadoDeBaja"
  | "pacienteBorrado"
  | "sinTelefono"
  | "planSaldado"
  | "sinCuotaPorVencer"
  | "sinFechaDeVencimiento"
  | "todaviaNoTocaAvisar"
  | "yaAvisado"
  /** El paciente ya recibe otro aviso en esta corrida (dos planes a plazos). */
  | "otroAvisoDelMismoPaciente";

/** Un aviso listo para encolar. */
export interface AvisoCobranza {
  invoiceId: string;
  patientId: string;
  patientNombre: string;
  /** No nulo: una candidata sin teléfono se descarta antes de llegar aquí. */
  patientPhone: string;
  /** El «7» de «cuota 7 de 24». 0 = enganche. */
  numeroCuota: number;
  esEnganche: boolean;
  /** "YYYY-MM-DD". */
  vencimiento: string;
  /** Lo que falta de ESA cuota, en pesos (no el importe nominal). */
  importe: number;
  /** Cuántas cuotas tiene el plan, sin contar el enganche. */
  totalCuotas: number;
  /** Lo que falta del plan entero, en pesos. */
  pendiente: number;
  /** factura|cuota|vencimiento. */
  dedupeKey: string;
}

export interface DescarteCobranza {
  invoiceId: string;
  motivo: MotivoDescarte;
}

export interface ResultadoCobranza {
  avisos: AvisoCobranza[];
  descartes: DescarteCobranza[];
}

/**
 * Estados de factura que NUNCA generan aviso, y por qué cada uno:
 *   · CANCELLED — esa deuda no existe. Avisar sería cobrar lo que se anuló.
 *   · PAID      — ya está pagada entera.
 *   · DRAFT     — un borrador no se le ha enseñado al paciente todavía.
 * OVERDUE, PENDING y PARTIAL sí pasan: son las que tienen algo vivo.
 */
const ESTADOS_MUDOS: Record<string, MotivoDescarte> = {
  CANCELLED: "facturaCancelada",
  PAID: "facturaPagada",
  DRAFT: "facturaBorrador",
};

/** Suma días a un "YYYY-MM-DD" sin cruzar por zonas horarias. */
export function sumarDias(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split("-").map((x) => parseInt(x, 10));
  const t = Date.UTC(a, (m || 1) - 1, d || 1) + dias * 86400000;
  const f = new Date(t);
  return `${f.getUTCFullYear()}-${String(f.getUTCMonth() + 1).padStart(2, "0")}-${String(f.getUTCDate()).padStart(2, "0")}`;
}

export interface OpcionesCobranza {
  /** "YYYY-MM-DD" en el día de la clínica. */
  hoy: string;
  /** Cuántos días antes del vencimiento se avisa. */
  diasAntes: number;
  /** Llaves ya encoladas o ya enviadas. Lo que esté aquí NO vuelve a salir. */
  yaAvisado?: ReadonlySet<string>;
  /** Tope de avisos de la corrida. */
  tope?: number;
}

/**
 * De facturas candidatas a avisos que hay que mandar HOY.
 *
 * Avisa de la PRÓXIMA cuota por vencer, no de las vencidas: el encargo es
 * «que alguien avise de una mensualidad POR VENCER». Una cuota que ya venció
 * es una conversación de cobranza, no un recordatorio, y mandarla por el mismo
 * canal convertiría el aviso en un acoso automático.
 *
 * La ventana es [hoy, hoy + diasAntes] INCLUSIVA en los dos extremos: la cuota
 * que vence hoy todavía cuenta como por vencer (`estadoDelPlan` la deja en
 * `porVencer` hasta que el día pasa), y avisar el mismo día sigue sirviendo.
 */
export function avisosDeCobranza(
  facturas: FacturaCandidata[],
  opts: OpcionesCobranza,
): ResultadoCobranza {
  const avisos: AvisoCobranza[] = [];
  const descartes: DescarteCobranza[] = [];
  const yaAvisado = opts.yaAvisado ?? new Set<string>();
  const limite = sumarDias(opts.hoy, Math.max(0, opts.diasAntes));
  // Dentro de la MISMA corrida tampoco se repite: dos facturas no pueden
  // producir la misma llave, pero una lista con la misma factura duplicada sí.
  const enEstaCorrida = new Set<string>();
  // Y UN aviso por paciente, aunque tenga dos planes a plazos.
  //
  // Un tratamiento partido en dos facturas con el mismo día de pago es un caso
  // real, y produciría dos WhatsApp seguidos diciendo casi lo mismo. Eso no se
  // lee como dos avisos: se lee como el sistema fallando. Gana la cuota que
  // vence ANTES (la lista llega ordenada por antigüedad de factura, y se
  // compara explícitamente), que es la que urge.
  const porPaciente = new Map<string, number>();

  const descarta = (invoiceId: string, motivo: MotivoDescarte) => {
    descartes.push({ invoiceId, motivo });
  };

  for (const f of facturas ?? []) {
    if (opts.tope !== undefined && avisos.length >= opts.tope) break;

    const mudo = ESTADOS_MUDOS[f.status];
    if (mudo) {
      descarta(f.invoiceId, mudo);
      continue;
    }
    // El paciente manda sobre la factura: una factura viva de alguien dado de
    // baja no se cobra por WhatsApp.
    if (f.pacienteBorrado) {
      descarta(f.invoiceId, "pacienteBorrado");
      continue;
    }
    if (!f.pacienteActivo) {
      descarta(f.invoiceId, "pacienteDadoDeBaja");
      continue;
    }

    const cuotas = calendarioDeCuotas(f.condiciones, f.total);
    if (cuotas.length === 0) {
      descarta(f.invoiceId, "sinPlanAPlazos");
      continue;
    }

    const estado = estadoDelPlan(cuotas, f.pagos, opts.hoy);
    // Cinturón y tirantes: el plan puede estar saldado aunque la factura siga
    // marcada PENDING (el `status` lo mueve Caja, el plan lo deriva el dinero).
    if (estado.pendiente <= 0) {
      descarta(f.invoiceId, "planSaldado");
      continue;
    }

    const siguiente: CuotaConEstado | null = estado.siguiente;
    if (!siguiente) {
      descarta(f.invoiceId, "sinCuotaPorVencer");
      continue;
    }
    if (siguiente.vencimiento === null) {
      // Un plan sin fechas no vence nunca: no hay nada que anunciar, y
      // inventarle una fecha sería mentirle al paciente.
      descarta(f.invoiceId, "sinFechaDeVencimiento");
      continue;
    }
    if (siguiente.vencimiento > limite) {
      descarta(f.invoiceId, "todaviaNoTocaAvisar");
      continue;
    }

    // El teléfono se comprueba TARDE a propósito: así el descarte dice
    // «sin teléfono» solo de quien de verdad tocaba avisar, y la clínica ve en
    // el resumen a quién no pudo alcanzar.
    const phone = (f.patientPhone ?? "").trim();
    if (phone.replace(/\D/g, "").length < 10) {
      descarta(f.invoiceId, "sinTelefono");
      continue;
    }

    const llave = dedupeKeyCobranza(f.invoiceId, siguiente.numero, siguiente.vencimiento);
    if (yaAvisado.has(llave) || enEstaCorrida.has(llave)) {
      descarta(f.invoiceId, "yaAvisado");
      continue;
    }

    // ¿Este paciente ya tiene un aviso en esta corrida? Se queda el que vence
    // antes; el otro se descarta con motivo, no en silencio.
    const yaTiene = porPaciente.get(f.patientId);
    if (yaTiene !== undefined) {
      const previo = avisos[yaTiene];
      if (previo.vencimiento <= siguiente.vencimiento) {
        descarta(f.invoiceId, "otroAvisoDelMismoPaciente");
        continue;
      }
      // Este vence antes: sustituye al anterior, que pasa a ser el descartado.
      descarta(previo.invoiceId, "otroAvisoDelMismoPaciente");
      enEstaCorrida.delete(previo.dedupeKey);
      avisos.splice(yaTiene, 1);
      // Los índices guardados de otros pacientes se recalculan abajo.
      porPaciente.forEach((idx, pid) => {
        if (idx > yaTiene) porPaciente.set(pid, idx - 1);
      });
      porPaciente.delete(f.patientId);
    }

    enEstaCorrida.add(llave);
    porPaciente.set(f.patientId, avisos.length);

    avisos.push({
      invoiceId: f.invoiceId,
      patientId: f.patientId,
      patientNombre: f.patientNombre,
      patientPhone: phone,
      numeroCuota: siguiente.numero,
      esEnganche: siguiente.esEnganche,
      vencimiento: siguiente.vencimiento,
      // Lo que FALTA de esa cuota, no su importe nominal: si ya lleva $500
      // abonados, el aviso pide los $1,500 que quedan, no $2,000.
      importe: siguiente.falta,
      totalCuotas: estado.totalCuotas,
      pendiente: estado.pendiente,
      dedupeKey: llave,
    });
  }

  return { avisos, descartes };
}
