import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { revalidatePath } from "next/cache";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { invoiceSchema } from "@/lib/validations";
import { logMutation } from "@/lib/audit";
import { revalidateAfter } from "@/lib/cache/revalidate";
import { sumInvoiceItems, computeInvoiceTotal, round2, IVA_RATE_PCT } from "@/lib/invoice-totals";
import { relatedPatientVisibilityAnd, assertPatientVisible } from "@/lib/patient-visibility";
import { stripNestedPatientSecrets } from "@/lib/patient-secrets";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import {
  InvoiceNumberExhaustedError,
  nextInvoiceNumber,
  withInvoiceNumberRetry,
} from "@/lib/invoices/next-invoice-number";

// Contexto vía el helper CENTRAL: misma resolución cookie→clínica que la
// copia local que había aquí, pero aplicando el gate de plan vencido
// (isPlanExpired) que las copias locales se saltaban.
async function getCtx() {
  const ctx = await getAuthContext();
  if (!ctx) return null;
  return { clinicId: ctx.clinicId, userId: ctx.userId, role: ctx.role, permissionsOverride: ctx.permissionsOverride };
}

export async function GET(req: NextRequest) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Ver facturación es un permiso granular (configurable persona a persona en
  // /dashboard/team). Sin él, ni la lista de la clínica ni la de un paciente:
  // el gate va ADEMÁS del clinicId de sesión y de la visibilidad por paciente.
  const deniedPerm = denyIfMissingPermission(ctx, "billing.view");
  if (deniedPerm) return deniedPerm;
  const { clinicId } = ctx;
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") ?? "";
  const page = parseInt(searchParams.get("page") ?? "1");
  const limit = 20;
  const where: any = { clinicId };
  if (search) { where.OR = [{ invoiceNumber: { contains: search, mode: "insensitive" } }, { patient: { firstName: { contains: search, mode: "insensitive" } } }]; }
  // Visibilidad por paciente. Filtro de RELACIÓN (lista de toda la clínica) y va
  // en AND porque `where.OR` de arriba (búsqueda por texto) lo volvería permisivo.
  const visibility = relatedPatientVisibilityAnd({ userId: ctx.userId, role: ctx.role, clinicId });
  if (visibility.length) where.AND = visibility;
  const [total, invoices] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page-1)*limit, take: limit, include: { patient: { select: { id: true, firstName: true, lastName: true } }, payments: true } }),
  ]);
  return NextResponse.json({ invoices, total, page, limit });
}

export async function POST(req: NextRequest) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { clinicId } = ctx;
  try {
    const body = await req.json();
    const data = invoiceSchema.parse(body);

    // Campos IVA/doctor de la OLA 1 — no viven en invoiceSchema: se leen del body crudo.
    const taxIncluded = body.taxIncluded !== false; // default: el precio ya incluye IVA
    // Solo 0 (exento) o 16. El CFDI SIEMPRE desglosa 16% (Facturapi recibe
    // rate 0.16 fijo), así que una tasa intermedia nace rota en los dos modos:
    // con IVA AGREGADO la guarda de integridad da un 409 permanente (tasa 8 →
    // total 1080 contra los 1160 que espera el timbrado) y con IVA INCLUIDO
    // pasa la guarda pero se timbra un desglose distinto al que reporta el
    // corte de Caja. Antes se aceptaba cualquier valor 0-100: el editor ya solo
    // ofrece las dos opciones válidas, esto cierra la puerta al POST directo.
    const rawRate = body.taxRate === undefined || body.taxRate === null
      ? IVA_RATE_PCT
      : Number(body.taxRate);
    if (!isFinite(rawRate) || (rawRate !== 0 && rawRate !== IVA_RATE_PCT)) {
      return NextResponse.json(
        { error: `La tasa de IVA debe ser 0 (exento) o ${IVA_RATE_PCT}%.` },
        { status: 400 },
      );
    }
    const taxRate = rawRate;

    // Doctor atribuido (opcional). Se valida que sea un DOCTOR de ESTA clínica (aislamiento).
    let doctorId: string | null = null;
    if (typeof body.doctorId === "string" && body.doctorId.trim()) {
      const doc = await prisma.user.findFirst({
        where: { id: body.doctorId.trim(), clinicId, role: "DOCTOR" },
        select: { id: true },
      });
      if (!doc) return NextResponse.json({ error: "Doctor inválido para esta clínica" }, { status: 400 });
      doctorId = doc.id;
    }

    // Misma aritmética canónica que el timbrado y el PATCH (invoice-totals):
    // subtotal = Σ(qty × unitPrice − desc. de línea). Antes se sumaba i.total
    // tal cual del cliente: una línea con descuento (o un total inconsistente)
    // dejaba invoice.total ≠ lo que la guarda del CFDI calcula por unitPrice.
    const subtotal = sumInvoiceItems(data.items);
    const discount = round2(Math.max(0, data.discount ?? 0));
    // El descuento GLOBAL sigue necesitando su propio tope: el clamp por línea
    // del schema solo garantiza que cada concepto sea ≥ 0 (y por tanto que este
    // subtotal sea el real, no uno encogido por un importe negativo). Sin él, un
    // descuento mayor a la suma de conceptos se persistiría mientras
    // computeInvoiceTotal lo trata contra un base con piso 0 → total ≠ Σconceptos
    // − descuento.
    if (discount > subtotal) {
      return NextResponse.json({ error: "El descuento excede el subtotal" }, { status: 400 });
    }
    const { total } = computeInvoiceTotal(subtotal, discount, taxRate, taxIncluded);

    // Visibilidad + tenant: el paciente debe pertenecer a la clínica Y ser visible
    // para este usuario. Sin esto, un excluido POSTea {patientId: restringido} y el
    // include:{patient:true} de abajo le devuelve la fila COMPLETA (identidad +
    // RFC/razón social) en el eco 201. assertPatientVisible cubre tenant + visibilidad
    // en un query (mismo patrón que quotes/treatments/payment-plans POST).
    const denied = await assertPatientVisible(data.patientId, {
      userId: ctx.userId, role: ctx.role, clinicId,
    });
    if (denied) return denied;

    // La cita del body debe ser de ESTA clínica y de ESTE paciente (P1-6).
    // Invoice.appointmentId es @unique GLOBAL: sin esta validación se escribía
    // la FK sobre la cita de OTRA clínica y se le quemaba el slot único (409
    // permanente para su dueña) — o, intra-clínica, se colgaba la factura del
    // paciente X sobre la cita del paciente Y. 404 para la cita ajena (no
    // confirmar existencia cross-tenant), 400 para el cruce de paciente.
    if (data.appointmentId) {
      const appt = await prisma.appointment.findFirst({
        where: { id: data.appointmentId, clinicId },
        select: { id: true, patientId: true },
      });
      if (!appt) {
        return NextResponse.json({ error: "Cita no encontrada" }, { status: 404 });
      }
      if (appt.patientId !== data.patientId) {
        return NextResponse.json(
          { error: "La cita seleccionada es de otro paciente" },
          { status: 400 },
        );
      }
    }

    // Folio por MÁXIMO emitido con reintento ante carrera (P0-2): el folio se
    // recalcula DENTRO de cada intento para que el perdedor de la carrera vea
    // el máximo nuevo. El count+1 anterior, con cualquier hueco (DRAFT borrado),
    // apuntaba a un folio ya emitido → P2002 permanente: facturación bloqueada.
    const invoice = await withInvoiceNumberRetry(async () =>
      prisma.invoice.create({
        data: { clinicId, patientId: data.patientId, appointmentId: data.appointmentId ?? undefined,
          invoiceNumber: await nextInvoiceNumber(clinicId), items: data.items, subtotal, discount,
          total, paid: 0, balance: total, status: "PENDING", paymentMethod: data.paymentMethod, notes: data.notes,
          dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
          doctorId, taxRate, taxIncluded },
        include: { patient: true },
      }),
    );

    await logMutation({
      req,
      clinicId,
      userId: ctx.userId,
      entityType: "invoice",
      entityId: invoice.id,
      action: "create",
      after: { invoiceNumber: invoice.invoiceNumber, patientId: invoice.patientId, total: invoice.total },
    });

    revalidateAfter("invoices");
    revalidatePath(`/dashboard/patients/${invoice.patientId}`);
    // P1-N1: el `include: { patient: true }` de arriba arrastra `portalToken`.
    return NextResponse.json(stripNestedPatientSecrets(invoice), { status: 201 });
  } catch (err: any) {
    // Un fallo de zod llega con `message` = el JSON crudo de TODOS los issues, y
    // el editor lo pinta tal cual en el toast. Se surfacea el primero con su ruta
    // ("items.1.discount") para que se vea qué línea corregir.
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      const where = issue && issue.path.length ? ` (${issue.path.join(".")})` : "";
      return NextResponse.json({ error: `${issue ? issue.message : "Datos inválidos"}${where}` }, { status: 400 });
    }
    // Carrera de folio agotada (ya reintentó recalculando el máximo): es un
    // conflicto transitorio, no un error del usuario → 409 con mensaje humano.
    if (err instanceof InvoiceNumberExhaustedError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    // El único P2002 que llega hasta aquí es el de appointmentId @unique (el de
    // invoiceNumber lo reintenta withInvoiceNumberRetry distinguiendo por
    // meta.target): la cita ya tiene factura → 409 humano, no el texto de Prisma.
    if (err?.code === "P2002") {
      return NextResponse.json({ error: "Esa cita ya tiene una factura" }, { status: 409 });
    }
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
