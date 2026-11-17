// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — EXPORTAR los datos de una barbería desde su ficha de
// /admin/barberias/[id] (ws6-t1, 16-nov-2026): el «Exportar» de la ficha de
// clínica del dental (/api/admin/clinics/[id]/export: ZIP con CSV +
// manifest), con lo de barber: clientes, citas, tickets y sus líneas.
//
// Alcance como «Números del negocio»: la matriz exporta ella + TODAS sus
// sucursales (cada fila dice de qué sede es); una sucursal, solo ella. Los
// ids salen de la base a partir del [id] de la ficha (sedesDeLaFicha).
//
// Lleva datos personales de los clientes (nombre, teléfono, correo), como
// el del dental con los pacientes: por eso solo lo pide un admin de
// DaleControl (la ruta valida la sesión) y no se enseña en pantalla.
//
// Sin "server-only" (como cash.ts): las pruebas lo importan con tsx.
// ═══════════════════════════════════════════════════════════════════════
import { prisma } from "@/lib/prisma";
import { isSaleCancelled } from "@/lib/barber/commissions";
import { saleKindOf } from "@/lib/barber/memberships-core";
import { sedesDeLaFicha } from "@/lib/barber/admin-numeros";

type Celda = string | number | boolean | Date | null | undefined | { toString(): string };

/**
 * Una celda de CSV. Igual que el del dental (comillas si hace falta) y,
 * además, una celda de TEXTO que empieza con = + - @ lleva un apóstrofo
 * delante: así Excel no la ejecuta como fórmula (un cliente pudo escribir
 * «=HYPERLINK(…)» en sus notas). Los números (−100 de una devolución) no se tocan.
 */
export function celdaCsv(v: Celda): string {
  if (v === null || v === undefined) return "";
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  s = s.replace(/"/g, '""');
  return /[",\n\r]/.test(s) ? `"${s}"` : s;
}

/** Encabezados fijos (también con 0 filas: el archivo dice qué columnas tendría). */
export function aCsv(encabezados: string[], filas: Array<Record<string, Celda>>): string {
  const cuerpo = filas.map((f) => encabezados.map((h) => celdaCsv(f[h])).join(","));
  return [encabezados.join(","), ...cuerpo].join("\n");
}

export const CSV_CLIENTES = [
  "id", "sede", "nombre", "telefono", "email", "cumpleanos", "visitas", "ultima_visita",
  "estrellas", "bloqueado", "alta", "notas",
];
export const CSV_CITAS = [
  "id", "sede", "cliente_id", "cliente", "telefono", "barbero", "inicio", "fin", "estado",
  "origen", "anticipo", "estado_anticipo", "notas", "creada",
];
export const CSV_TICKETS = [
  "id", "sede", "fecha", "cliente_id", "cliente", "barbero", "cita_id", "metodo", "subtotal",
  "propina", "total", "tipo", "cancelado", "turno_id", "notas",
];
export const CSV_LINEAS = ["ticket_id", "sede", "descripcion", "cantidad", "precio_unitario", "servicio_id", "producto_id"];

export interface ExportBarberia {
  nombre: string;
  slug: string;
  manifest: {
    barbershopId: string;
    barbershopName: string;
    sedes: Array<{ id: string; nombre: string; matriz: boolean; activa: boolean }>;
    exportedAt: string;
    counts: { clientes: number; citas: number; tickets: number; lineas: number };
  };
  archivos: Array<{ nombre: string; contenido: string }>;
}

/** null = la barbería no existe. Quien llama YA validó que es admin de DaleControl. */
export async function exportarBarberia(barbershopId: string, ahora: Date = new Date()): Promise<ExportBarberia | null> {
  const alcance = await sedesDeLaFicha(barbershopId);
  if (!alcance) return null;
  const ids = alcance.sedes.map((s) => s.id);
  const nombreSede = new Map(alcance.sedes.map((s) => [s.id, s.parentId ? s.branchName || s.name : s.name]));

  // 5 lecturas a la vez (regla del pooler: < 7).
  const [raiz, clientes, citas, tickets, lineas] = await Promise.all([
    prisma.barbershop.findUnique({ where: { id: barbershopId }, select: { name: true, slug: true } }),
    prisma.barberClient.findMany({
      where: { barbershopId: { in: ids } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, barbershopId: true, name: true, phone: true, email: true, birthday: true, totalVisits: true,
        lastVisitAt: true, loyaltyCount: true, blockedAt: true, createdAt: true, notes: true,
      },
    }),
    prisma.barberAppointment.findMany({
      where: { barbershopId: { in: ids } },
      orderBy: { startAt: "asc" },
      select: {
        id: true, barbershopId: true, clientId: true, clientName: true, clientPhone: true, startAt: true, endAt: true,
        status: true, source: true, depositAmount: true, depositStatus: true, notes: true, createdAt: true,
        client: { select: { name: true, phone: true } },
        barber: { select: { name: true, nickname: true } },
      },
    }),
    prisma.barberSale.findMany({
      where: { barbershopId: { in: ids } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, barbershopId: true, createdAt: true, clientId: true, appointmentId: true, paymentMethod: true,
        subtotal: true, tip: true, total: true, cashSessionId: true, notes: true,
        client: { select: { name: true } },
        barber: { select: { name: true, nickname: true } },
      },
    }),
    prisma.barberSaleItem.findMany({
      where: { sale: { barbershopId: { in: ids } } },
      orderBy: { saleId: "asc" },
      select: { saleId: true, description: true, qty: true, unitPrice: true, serviceId: true, productId: true, sale: { select: { barbershopId: true } } },
    }),
  ]);

  const barbero = (b: { name: string; nickname: string | null } | null) => (b ? b.nickname || b.name : null);
  const archivos = [
    {
      nombre: "clientes.csv",
      contenido: aCsv(
        CSV_CLIENTES,
        clientes.map((c) => ({
          id: c.id, sede: nombreSede.get(c.barbershopId), nombre: c.name, telefono: c.phone, email: c.email,
          cumpleanos: c.birthday ? c.birthday.toISOString().slice(0, 10) : null, visitas: c.totalVisits,
          ultima_visita: c.lastVisitAt, estrellas: c.loyaltyCount, bloqueado: c.blockedAt ? "si" : "no",
          alta: c.createdAt, notas: c.notes,
        })),
      ),
    },
    {
      nombre: "citas.csv",
      contenido: aCsv(
        CSV_CITAS,
        citas.map((a) => ({
          id: a.id, sede: nombreSede.get(a.barbershopId), cliente_id: a.clientId, cliente: a.client?.name ?? a.clientName,
          telefono: a.client?.phone ?? a.clientPhone, barbero: barbero(a.barber), inicio: a.startAt, fin: a.endAt,
          estado: a.status, origen: a.source, anticipo: a.depositAmount, estado_anticipo: a.depositStatus,
          notas: a.notes, creada: a.createdAt,
        })),
      ),
    },
    {
      nombre: "tickets.csv",
      contenido: aCsv(
        CSV_TICKETS,
        tickets.map((t) => ({
          id: t.id, sede: nombreSede.get(t.barbershopId), fecha: t.createdAt, cliente_id: t.clientId,
          cliente: t.client?.name ?? null, barbero: barbero(t.barber), cita_id: t.appointmentId, metodo: t.paymentMethod,
          subtotal: t.subtotal, propina: t.tip, total: t.total, tipo: saleKindOf(t.notes),
          cancelado: isSaleCancelled({ notes: t.notes }) ? "si" : "no", turno_id: t.cashSessionId, notas: t.notes,
        })),
      ),
    },
    {
      nombre: "tickets-lineas.csv",
      contenido: aCsv(
        CSV_LINEAS,
        lineas.map((l) => ({
          ticket_id: l.saleId, sede: nombreSede.get(l.sale.barbershopId), descripcion: l.description, cantidad: l.qty,
          precio_unitario: l.unitPrice, servicio_id: l.serviceId, producto_id: l.productId,
        })),
      ),
    },
  ];

  return {
    nombre: raiz?.name ?? barbershopId,
    slug: raiz?.slug ?? barbershopId,
    manifest: {
      barbershopId,
      barbershopName: raiz?.name ?? barbershopId,
      sedes: alcance.sedes.map((s) => ({ id: s.id, nombre: nombreSede.get(s.id) ?? s.name, matriz: s.parentId === null, activa: s.isActive })),
      exportedAt: ahora.toISOString(),
      counts: { clientes: clientes.length, citas: citas.length, tickets: tickets.length, lineas: lineas.length },
    },
    archivos,
  };
}
