// GET /api/paciente/payments — Implementa A8. Respuesta: PacientePagosResponse.
// · getPatientPortalContext() | 401. patientIds de ctx.links.
// · clinics: links → patient → clinic (como summary).
// · invoices: invoice.findMany({ patientId in, status not DRAFT }, orderBy
//   createdAt desc, take 200, select SOLO { id, clinicId, invoiceNumber,
//   status, total, paid, balance, createdAt, dueDate, paidAt }).
//   NUNCA items (traen notas internas) ni notes.
// · totals: paidTotal = sum(paid) de todas; pendingTotal = sum(balance) de
//   status PENDING|PARTIAL|OVERDUE. byClinic: mismas sumas agrupadas por
//   clinicId (en JS está bien). Montos MXN tal cual (Float del schema).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPatientPortalContext, pacienteUnauthorized } from "@/lib/patient-portal/guard";
import { getClinicConnectAccounts } from "@/lib/patient-portal/online-payment";
import type {
  PacienteClinica,
  PacienteFactura,
  PacientePagosResponse,
} from "@/lib/patient-portal/types";

export const dynamic = "force-dynamic";

/** Estados cuyo saldo cuenta como pendiente. */
const PENDING_STATUSES = ["PENDING", "PARTIAL", "OVERDUE"];

/** Redondeo a 2 decimales para montos MXN sumados en JS (Float). */
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

export async function GET() {
  try {
    const ctx = await getPatientPortalContext();
    if (!ctx) return pacienteUnauthorized();

    const patientIds = ctx.links.map((l) => l.patientId);
    const clinicIds = Array.from(new Set(ctx.links.map((l) => l.clinicId)));
    if (patientIds.length === 0) {
      const empty: PacientePagosResponse = {
        clinics: [],
        invoices: [],
        totals: { paidTotal: 0, pendingTotal: 0 },
        byClinic: [],
      };
      return NextResponse.json(empty);
    }

    const [links, invoiceRows, connectAccounts] = await Promise.all([
      prisma.patientAccountLink.findMany({
        where: { accountId: ctx.account.id, patient: { deletedAt: null } },
        select: {
          clinicId: true,
          patient: {
            select: {
              id: true,
              patientNumber: true,
              clinic: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  logoUrl: true,
                  city: true,
                  phone: true,
                },
              },
            },
          },
        },
      }),
      prisma.invoice.findMany({
        where: { patientId: { in: patientIds }, status: { not: "DRAFT" } },
        orderBy: { createdAt: "desc" },
        take: 200,
        // patientId se usa SOLO server-side para excluir expedientes
        // soft-deleted; no viaja en la respuesta. NUNCA seleccionar
        // items (traen notas internas) ni notes.
        select: {
          id: true,
          clinicId: true,
          patientId: true,
          invoiceNumber: true,
          status: true,
          total: true,
          paid: true,
          balance: true,
          createdAt: true,
          dueDate: true,
          paidAt: true,
        },
      }),
      getClinicConnectAccounts(clinicIds),
    ]);

    const clinics: PacienteClinica[] = links.map((l) => ({
      clinicId: l.patient.clinic.id,
      clinicName: l.patient.clinic.name,
      clinicSlug: l.patient.clinic.slug,
      logoUrl: l.patient.clinic.logoUrl,
      city: l.patient.clinic.city,
      phone: l.patient.clinic.phone,
      patientId: l.patient.id,
      patientNumber: l.patient.patientNumber,
      onlinePaymentEnabled: connectAccounts.has(l.patient.clinic.id),
    }));

    // Solo facturas de expedientes visibles (paciente no soft-deleted),
    // para que la lista sea consistente con `clinics`.
    const visiblePatientIds = new Set(links.map((l) => l.patient.id));
    const invoices: PacienteFactura[] = invoiceRows
      .filter((inv) => visiblePatientIds.has(inv.patientId))
      .map((inv) => ({
        id: inv.id,
        clinicId: inv.clinicId,
        invoiceNumber: inv.invoiceNumber,
        status: inv.status,
        total: inv.total,
        paid: inv.paid,
        balance: inv.balance,
        createdAt: inv.createdAt.toISOString(),
        dueDate: inv.dueDate ? inv.dueDate.toISOString() : null,
        paidAt: inv.paidAt ? inv.paidAt.toISOString() : null,
      }));

    // Totales en JS. CANCELLED no suma ni en pagado ni en pendiente.
    let paidTotal = 0;
    let pendingTotal = 0;
    const byClinicMap = new Map<string, { paid: number; pending: number }>();
    for (const inv of invoices) {
      if (inv.status === "CANCELLED") continue;
      let entry = byClinicMap.get(inv.clinicId);
      if (!entry) {
        entry = { paid: 0, pending: 0 };
        byClinicMap.set(inv.clinicId, entry);
      }
      paidTotal += inv.paid;
      entry.paid += inv.paid;
      if (PENDING_STATUSES.includes(inv.status)) {
        pendingTotal += inv.balance;
        entry.pending += inv.balance;
      }
    }

    // byClinic en el orden de `clinics` (dedup por clinicId), solo clínicas
    // con al menos una factura que sume.
    const byClinic: PacientePagosResponse["byClinic"] = [];
    const added = new Set<string>();
    for (const c of clinics) {
      if (added.has(c.clinicId)) continue;
      added.add(c.clinicId);
      const entry = byClinicMap.get(c.clinicId);
      if (entry) {
        byClinic.push({
          clinicId: c.clinicId,
          paid: round2(entry.paid),
          pending: round2(entry.pending),
        });
      }
    }

    const body: PacientePagosResponse = {
      clinics,
      invoices,
      totals: { paidTotal: round2(paidTotal), pendingTotal: round2(pendingTotal) },
      byClinic,
    };
    return NextResponse.json(body);
  } catch (err) {
    console.error("[paciente/payments] error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
