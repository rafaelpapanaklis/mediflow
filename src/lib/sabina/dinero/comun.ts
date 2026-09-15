/**
 * Lo común del área de DINERO de Sabina (ws1-t2): la rendija de lectura, cómo se
 * encuentra una factura a partir de lo que dice el usuario, los métodos de pago y
 * los formatos.
 *
 * 🔴 LAS TRES REGLAS QUE ESTE ARCHIVO SOSTIENE
 *
 * 1. Aquí no se escribe. `DineroDb` es de solo lectura por tipos, igual que
 *    `SabinaDb` y `AgendaDb`: no hay `create`, `update`, `delete` ni `$executeRaw`.
 *    Lo que escribe son los route handlers, llamados por la llave desde
 *    `ejecutar` (MAPA-dinero §6).
 * 2. Las facturas se buscan con el MISMO criterio que la pantalla: `clinicId` de
 *    la sesión y la visibilidad por paciente de `GET /api/invoices`
 *    (`relatedPatientVisibilityAnd`). Una factura de un paciente que no puedes ver
 *    es, para Sabina, una factura que no existe.
 * 3. El saldo es `total − pagado`, redondeado, que es con lo que valida el cobro
 *    (`POST /api/invoices/[id]`, MAPA-dinero C1). No la columna `balance`.
 *
 * Los ids no viajan al modelo: una factura se nombra por su FOLIO (MF-0042), que
 * es lo que el usuario lee en el papel y lo único que sobrevive al turno
 * siguiente (la conversación guarda texto, no resultados de herramientas).
 */

import { round2 } from "@/lib/invoice-totals";
import { relatedPatientVisibilityAnd } from "@/lib/patient-visibility";
import { prisma } from "@/lib/prisma";
import type { SabinaPreparacion } from "../engine-acciones";
import { FRASE_SABINA_APAGADA, causaSinPermiso } from "../permisos-sabina";
import { tienePermiso, visorDe } from "../tools/base";
import type { AgendaDb, OpcionAgenda } from "../tools/agenda-comun";
import { nombreDe, telefonoParcial } from "../tools/agenda-comun";
import { resolverPaciente, type PacienteResuelto } from "../tools/agenda-resolvedores";
import type { SabinaCtx } from "../tipos";

/* ═══════════════════════════════════════════════════════════════════════
   LA RENDIJA DE LECTURA
   ═══════════════════════════════════════════════════════════════════════ */

export interface DineroDb {
  invoice: { findMany(args: any): Promise<any[]>; count(args: any): Promise<number> };
  patient: { findMany(args: any): Promise<any[]> };
  quote: { findMany(args: any): Promise<any[]> };
  clinic: { findFirst(args: any): Promise<any> };
  /** El tope de avisos: lo que ya salió hoy por WhatsApp. */
  inboxMessage: { findMany(args: any): Promise<any[]> };
  /** El tope de avisos: lo que Sabina ya intentó mandar hoy. */
  auditLog: { findMany(args: any): Promise<any[]> };
  $queryRaw(query: any): Promise<any[]>;
}

/** `ctx.db` en las pruebas (el doble de dos clínicas), el `prisma` del repo en producción. */
export function dbDineroDe(ctx: SabinaCtx): DineroDb {
  return (ctx.db ?? prisma) as unknown as DineroDb;
}

/* ═══════════════════════════════════════════════════════════════════════
   MÉTODOS DE PAGO — los seis del selector de la pantalla
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Los métodos de `payment-modal.tsx` (`PaymentMethod`), y NINGUNO más. El
 * servidor acepta cualquier texto, incluido `"refund"`, que la Caja cuenta como
 * reembolso (MAPA-dinero N4): por eso la lista cerrada vive aquí y se comprueba
 * otra vez en `ejecutar`. Una prueba compara esta lista con la del modal.
 */
export const METODOS_COBRO = ["cash", "debit", "credit", "transfer", "check", "other"] as const;
export type MetodoCobro = (typeof METODOS_COBRO)[number];

/** Las etiquetas del selector (es.json → clinical.paymentModal). */
export const ETIQUETA_METODO: Record<MetodoCobro, string> = {
  cash: "Efectivo",
  debit: "Tarjeta débito",
  credit: "Tarjeta crédito",
  transfer: "Transferencia",
  check: "Cheque",
  other: "Otro",
};

export function esMetodoCobro(v: unknown): v is MetodoCobro {
  return typeof v === "string" && (METODOS_COBRO as readonly string[]).includes(v);
}

/* ═══════════════════════════════════════════════════════════════════════
   FORMATOS
   ═══════════════════════════════════════════════════════════════════════ */

/** "$1,234.50" — siempre con centavos: en un cobro, $1,234.5 y $1,234.50 no se leen igual. */
export function dinero(n: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    Number.isFinite(n) ? n : 0,
  );
}

/** Mismas palabras que el badge de estado de la pantalla (es.json → billing.billingClient). */
export const ETIQUETA_ESTADO: Record<string, string> = {
  DRAFT: "borrador",
  PENDING: "pendiente",
  PARTIAL: "parcial",
  PAID: "pagada",
  OVERDUE: "vencida",
  CANCELLED: "cancelada",
};

export function estadoDe(status: string): string {
  return ETIQUETA_ESTADO[status] ?? String(status ?? "").toLowerCase();
}

/** El saldo con el que valida el cobro: total − pagado, a centavos. */
export function saldoDe(inv: { total: unknown; paid: unknown }): number {
  return round2(Number(inv.total) - Number(inv.paid));
}

/** El comprobante imprimible (GET, no fiscal). Es lectura: Sabina da el enlace, no lo «ejecuta». */
export function rutaComprobante(invoiceId: string): string {
  return `/api/invoices/${encodeURIComponent(invoiceId)}/print`;
}

/** Ids de Prisma (cuid) y de las siembras de prueba. Lo que no cuadre no va en una ruta. */
export const ID_SEGURO = /^[A-Za-z0-9_-]{1,64}$/;

/* ═══════════════════════════════════════════════════════════════════════
   LA FACTURA, A PARTIR DE LO QUE DICE EL USUARIO
   ═══════════════════════════════════════════════════════════════════════ */

export interface FacturaLeida {
  id: string;
  folio: string;
  status: string;
  total: number;
  paid: number;
  saldo: number;
  /** La columna, que es la que usa el texto del aviso de saldo. */
  balance: number;
  discount: number;
  taxRate: number;
  taxIncluded: boolean;
  timbrada: boolean;
  items: unknown;
  dueDate: Date | null;
  createdAt: Date;
  /** ISO. Entra en la huella: si alguien tocó la factura, la propuesta ya no vale. */
  updatedAt: string;
  paciente: {
    id: string;
    nombre: string;
    folio: string | null;
    telefono: string | null;
    /** Tal cual en la ficha: el aviso de saldo arma el saludo con estos dos, no con `nombre`. */
    firstName: string | null;
    lastName: string | null;
  };
}

export type Resolucion<T> =
  | { tipo: "ok"; valor: T }
  | { tipo: "aclarar"; pregunta: string; opciones: string[] }
  | { tipo: "no"; frase: string };

const SELECT_FACTURA = {
  id: true,
  invoiceNumber: true,
  status: true,
  total: true,
  paid: true,
  balance: true,
  discount: true,
  taxRate: true,
  taxIncluded: true,
  cfdiUuid: true,
  items: true,
  dueDate: true,
  createdAt: true,
  updatedAt: true,
  patientId: true,
  patient: { select: { id: true, firstName: true, lastName: true, patientNumber: true, phone: true } },
} as const;

function aFactura(f: any): FacturaLeida {
  const p = f.patient ?? {};
  return {
    id: f.id,
    folio: f.invoiceNumber,
    status: f.status,
    total: Number(f.total) || 0,
    paid: Number(f.paid) || 0,
    saldo: saldoDe(f),
    balance: Number(f.balance) || 0,
    discount: Number(f.discount) || 0,
    taxRate: Number(f.taxRate ?? 16),
    taxIncluded: f.taxIncluded !== false,
    timbrada: typeof f.cfdiUuid === "string" && f.cfdiUuid.length > 0,
    items: f.items,
    dueDate: f.dueDate ? new Date(f.dueDate) : null,
    createdAt: new Date(f.createdAt),
    updatedAt: new Date(f.updatedAt ?? f.createdAt).toISOString(),
    paciente: {
      id: f.patientId,
      nombre: nombreDe(p) || "Paciente",
      folio: p.patientNumber ?? null,
      telefono: typeof p.phone === "string" && p.phone.trim() ? p.phone.trim() : null,
      firstName: p.firstName ?? null,
      lastName: p.lastName ?? null,
    },
  };
}

/** El `where` de las facturas que este usuario puede ver en esta clínica. */
function whereVisible(ctx: SabinaCtx, extra: Record<string, unknown>): Record<string, unknown> {
  const vis = relatedPatientVisibilityAnd(visorDe(ctx));
  // 🔴 clinicId de la sesión, siempre, y la visibilidad en AND (nunca en OR).
  return { ...extra, clinicId: ctx.clinicId, ...(vis.length ? { AND: vis } : {}) };
}

/** Lo tecleado, como se compara con la columna: mayúsculas y sin espacios de sobra. */
export function folioTecleado(texto: string): string {
  return texto.trim().toUpperCase().replace(/\s+/g, " ");
}

/**
 * Los folios con los que se puede estar nombrando una factura (MF) o un
 * presupuesto (P): lo tecleado tal cual y, SOLO si el texto nombra esa serie o
 * son dígitos pelados, la serie con cuatro dígitos («mf 42», «42» → MF-0042;
 * «p-3» → P-0003).
 *
 * No se completa a partir de cualquier número del final: «P0042» es el folio de
 * un PACIENTE, no la factura MF-0042, e «INV-2026-0007» no es la MF-0007 (en la
 * columna conviven las dos series). Cuando lo tecleado existe tal cual, gana eso
 * (ver `resolverFactura`).
 */
export function foliosCandidatos(texto: string, prefijo: "MF" | "P"): string[] {
  const limpio = folioTecleado(texto);
  const out = new Set<string>();
  if (limpio) out.add(limpio);
  const serie = prefijo === "MF" ? /^(?:MF\s*-?\s*)?(\d{1,8})$/ : /^(?:P\s*-\s*|P\s+)?(\d{1,8})$/;
  const digitos = serie.exec(limpio)?.[1];
  if (digitos) out.add(`${prefijo}-${digitos.replace(/^0+(?=\d)/, "").padStart(4, "0")}`);
  return Array.from(out);
}

/**
 * Sin `billing.view` no se enseña ni un folio ni un saldo. Cobrar
 * (`billing.charge`) y avisar (`whatsapp.send`) no lo exigen en su endpoint, y la
 * tarjeta sí enseña facturas: con un override que dé solo esas keys, Sabina
 * abriría la facturación de cualquier paciente. La pantalla no lo hace (el detalle
 * de la factura exige verla primero). Se mira con el mismo `tienePermiso` del ctx.
 */
export function sinVerFacturacion(ctx: SabinaCtx): SabinaPreparacion<never> | null {
  if (tienePermiso(ctx, "billing.view")) return null;
  // El ctx ya viene recortado (permisos de Sabina por usuario): si quien pregunta SÍ
  // ve facturación y fue el Super Admin quien se lo quitó a Sabina, «no tienes
  // permiso» es falso y lo manda a pedir algo que ya tiene.
  const causa = causaSinPermiso(ctx, "billing.view");
  if (causa === "apagada") return { tipo: "sin_permiso", frase: FRASE_SABINA_APAGADA };
  if (causa === "sabina") {
    return {
      tipo: "sin_permiso",
      frase: "Tú sí puedes ver facturación, pero el Super Admin de la clínica no me deja verla en tu nombre, así que no puedo enseñarte ni preparar nada sobre facturas. Puedes hacerlo tú desde el panel, o pedirle que me lo active en Equipo.",
    };
  }
  return {
    tipo: "sin_permiso",
    frase: "No tienes permiso para ver facturación, así que no puedo enseñarte ni preparar nada sobre facturas. Ese permiso lo da el administrador de la clínica en Equipo.",
  };
}

/** Una factura por id, con la visibilidad de quien pregunta. Para la huella y para releer tras un fallo. */
export async function leerFacturaPorId(ctx: SabinaCtx, id: string): Promise<FacturaLeida | null> {
  if (!ID_SEGURO.test(id)) return null;
  const filas = await dbDineroDe(ctx).invoice.findMany({ where: whereVisible(ctx, { id }), select: SELECT_FACTURA, take: 1 });
  return filas.length ? aFactura(filas[0]) : null;
}

/** Cómo se enseña un paciente en una pregunta: con lo que el usuario puede repetir en el siguiente turno. */
function opcionDePaciente(o: OpcionAgenda): string {
  const folio = /folio (\S+)/.exec(o.detalle ?? "")?.[1];
  return `${o.etiqueta}${o.detalle ? ` (${o.detalle})` : ""} → paciente: ${folio ?? o.etiqueta}`;
}

/** El paciente, con el resolvedor de agenda (el criterio del buscador de «Nueva cita»). */
export async function resolverPacienteDinero(ctx: SabinaCtx, paciente: string | undefined): Promise<Resolucion<PacienteResuelto>> {
  const r = await resolverPaciente(ctx, dbDineroDe(ctx) as unknown as AgendaDb, { paciente: paciente ?? null });
  if (r.tipo === "ok") return r;
  if (r.tipo === "pregunta") {
    return { tipo: "aclarar", pregunta: r.pregunta.texto, opciones: r.pregunta.opciones.map(opcionDePaciente) };
  }
  return { tipo: "no", frase: (r as { frase: string }).frase };
}

/**
 * Si el usuario nombró factura Y paciente, que sean del mismo. «Cóbrale a Ana la
 * MF-0043» con la MF-0043 de Pedro no es un cobro a Pedro: es un error de dedo, y
 * un cobro no se deshace.
 */
async function pacienteCuadra(ctx: SabinaCtx, f: FacturaLeida, paciente: string): Promise<boolean> {
  const r = await resolverPaciente(ctx, dbDineroDe(ctx) as unknown as AgendaDb, { paciente });
  if (r.tipo === "ok") return r.valor.id === f.paciente.id;
  if (r.tipo === "pregunta") return r.pregunta.opciones.some((o) => o.id === f.paciente.id);
  return false;
}

/**
 * Qué factura quiere el usuario.
 *
 *  · Con folio: esa, si la puede ver. Si lo tecleado existe tal cual, gana; si hay
 *    dos que podrían ser, PREGUNTA. Si además dijo el paciente, tiene que cuadrar.
 *  · Con paciente: la única que cumpla `estados` (en la consulta, no después) y
 *    `filtro`; si hay varias, PREGUNTA cuál (nunca elige: cobrar la factura
 *    equivocada es peor que no cobrar).
 *  · Sin nada: pregunta.
 */
export async function resolverFactura(
  ctx: SabinaCtx,
  args: { factura?: string; paciente?: string },
  uso: { estados?: readonly string[]; filtro: (f: FacturaLeida) => boolean; queTiene: string },
): Promise<Resolucion<FacturaLeida>> {
  const db = dbDineroDe(ctx);
  const folio = (args.factura ?? "").trim();
  if (folio) {
    const filas = (
      await db.invoice.findMany({
        where: whereVisible(ctx, { invoiceNumber: { in: foliosCandidatos(folio, "MF") } }),
        select: SELECT_FACTURA,
        take: 5,
      })
    ).map(aFactura);
    if (filas.length === 0) return { tipo: "no", frase: `No encuentro la factura «${folio}» entre las que puedes ver.` };
    const exacta = filas.filter((f) => f.folio.toUpperCase() === folioTecleado(folio));
    const elegidas = exacta.length === 1 ? exacta : filas;
    if (elegidas.length > 1) {
      return {
        tipo: "aclarar",
        pregunta: `Hay ${elegidas.length} facturas que podrían ser «${folio}». ¿Cuál?`,
        opciones: elegidas.map((f) => `${f.folio} · ${f.paciente.nombre} · saldo ${dinero(f.saldo)} → factura: ${f.folio}`),
      };
    }
    const f = elegidas[0];
    if ((args.paciente ?? "").trim() && !(await pacienteCuadra(ctx, f, args.paciente!.trim()))) {
      return { tipo: "no", frase: `La factura ${f.folio} es de ${pacienteConFolio(f.paciente)}, no de «${args.paciente!.trim()}». Dime cuál de las dos es la buena.` };
    }
    return { tipo: "ok", valor: f };
  }

  if (!(args.paciente ?? "").trim()) {
    return { tipo: "aclarar", pregunta: "¿Qué factura? Dime su folio (MF-…) o el nombre del paciente.", opciones: [] };
  }
  const p = await resolverPacienteDinero(ctx, args.paciente);
  if (p.tipo !== "ok") return p;

  const filas = await db.invoice.findMany({
    // El estado va en la consulta: filtrado después, un paciente con muchas
    // facturas viejas dejaría fuera justo la cobrable.
    where: whereVisible(ctx, { patientId: p.valor.id, ...(uso.estados ? { status: { in: [...uso.estados] } } : {}) }),
    select: SELECT_FACTURA,
    orderBy: { createdAt: "desc" },
    take: 60,
  });
  const candidatas = filas.map(aFactura).filter(uso.filtro);
  if (candidatas.length === 0) return { tipo: "no", frase: `${p.valor.nombre} no tiene facturas ${uso.queTiene}.` };
  if (candidatas.length === 1) return { tipo: "ok", valor: candidatas[0] };
  return {
    tipo: "aclarar",
    pregunta: `${p.valor.nombre} tiene ${candidatas.length} facturas ${uso.queTiene}. ¿Cuál?`,
    opciones: candidatas
      .slice(0, 8)
      .map((f) => `${f.folio} · ${estadoDe(f.status)} · saldo ${dinero(f.saldo)} → factura: ${f.folio}`),
  };
}

/** «Ana Pérez (P0001)». */
export function pacienteConFolio(p: { nombre: string; folio: string | null }): string {
  return p.folio ? `${p.nombre} (${p.folio})` : p.nombre;
}

export { telefonoParcial };
