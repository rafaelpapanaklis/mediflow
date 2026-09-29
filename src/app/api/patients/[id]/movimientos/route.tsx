import { NextResponse, type NextRequest } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/permissions";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { getVisiblePatientClinicIds } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { extractAuditMeta, logRead } from "@/lib/audit";
import { consentTimeZone } from "@/lib/consent/dates";
import { zonaDeClinica } from "@/lib/movimientos-paciente/zona";
import {
  categoriaValida,
  fechaDeFiltro,
  listarMovimientosDelPaciente,
  listarMovimientosParaDescarga,
} from "@/lib/movimientos-paciente/consultar";
import { ETIQUETA_CATEGORIA, fechaHoraLegible, movimientosACsv } from "@/lib/movimientos-paciente/csv";
import { MovimientosDocument } from "@/lib/movimientos-paciente/pdf";
import type { FiltroMovimientos } from "@/lib/movimientos-paciente/consultar-tipos";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Params { params: { id: string } }

const ROLES = ["SUPER_ADMIN", "ADMIN", "DOCTOR", "RECEPTIONIST"];

/**
 * GET /api/patients/[id]/movimientos
 *   ?page=&pageSize=&categoria=&desde=YYYY-MM-DD&hasta=YYYY-MM-DD
 *   &formato=json (default) | csv | pdf
 *
 * Los movimientos del paciente: todo cambio hecho a su perfil, citas,
 * expediente, archivos y cuenta, con fecha, quién y qué (texto humano). La
 * fuente es `audit_logs`; ver src/lib/movimientos-paciente.
 *
 * Puertas: sesión → rol → tenant (clinicId SIEMPRE de la sesión) → visibilidad
 * del paciente (404). Quien no tiene «medicalRecord.view» o «billing.view» ve las
 * filas clínicas / económicas como «Se actualizó el expediente / la
 * facturación», con su fecha y su autor pero sin el qué: el enmascarado se hace
 * AQUÍ, en el servidor, y el texto verdadero nunca viaja.
 * CSV y PDF dejan su lectura en la bitácora (`movimientos_export`).
 */
export async function GET(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  if (!ROLES.includes(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  // Regla (c): sin clínica en la sesión no se consulta (un undefined no filtra).
  if (!user.clinicId) return NextResponse.json({ error: "Sesión sin clínica" }, { status: 403 });

  const denied = await assertPatientVisible(params.id, { userId: user.id, role: user.role, clinicId: user.clinicId });
  if (denied) return denied;

  const sp = req.nextUrl.searchParams;
  const persona = { role: user.role, permissionsOverride: user.permissionsOverride ?? [] };
  const permisos = {
    verClinico: hasPermission(persona, "medicalRecord.view"),
    verDinero: hasPermission(persona, "billing.view"),
  };

  const clinicIds = await getVisiblePatientClinicIds(user.clinicId);
  const filtro: FiltroMovimientos = {
    clinicIds,
    patientId: params.id,
    categoria: categoriaValida(sp.get("categoria")),
    desde: fechaDeFiltro(sp.get("desde")),
    hasta: fechaDeFiltro(sp.get("hasta"), true),
    page: Number(sp.get("page") ?? 1),
    pageSize: Number(sp.get("pageSize") ?? 25),
  };

  const formato = sp.get("formato") ?? "json";
  if (formato !== "csv" && formato !== "pdf") {
    const [pagina, zonaClinica] = await Promise.all([
      listarMovimientosDelPaciente(filtro, permisos),
      zonaDeClinica(user.clinicId),
    ]);
    return NextResponse.json({ ...pagina, zona: consentTimeZone(zonaClinica) });
  }

  const paciente = await prisma.patient.findFirst({
    where: { id: params.id, clinicId: user.clinicId },
    select: { firstName: true, lastName: true, patientNumber: true, clinic: { select: { timezone: true } } },
  });
  if (!paciente) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });
  const zona = consentTimeZone(paciente.clinic?.timezone ?? null);

  const meta = extractAuditMeta(req);
  const lectura = logRead({
    clinicId: user.clinicId,
    userId: user.id,
    kind: "movimientos_export",
    patientId: params.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  const { items, total, recortado } = await listarMovimientosParaDescarga(filtro, permisos);
  const nombreArchivo = `movimientos-${String(paciente.patientNumber ?? params.id).replace(/[^\w-]/g, "")}`;

  if (formato === "csv") {
    await lectura;
    return new NextResponse(movimientosACsv(items, zona), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${nombreArchivo}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const partesFiltro: string[] = [];
  if (filtro.categoria) partesFiltro.push(`Tipo: ${ETIQUETA_CATEGORIA[filtro.categoria] ?? filtro.categoria}`);
  if (sp.get("desde") && filtro.desde) partesFiltro.push(`Desde ${sp.get("desde")}`);
  if (sp.get("hasta") && filtro.hasta) partesFiltro.push(`Hasta ${sp.get("hasta")}`);
  const buffer = await renderToBuffer(
    <MovimientosDocument
      paciente={`${paciente.firstName} ${paciente.lastName}`.trim()}
      numero={paciente.patientNumber != null ? String(paciente.patientNumber) : null}
      items={items}
      total={total}
      recortado={recortado}
      zona={zona}
      generado={fechaHoraLegible(new Date().toISOString(), zona)}
      filtros={partesFiltro.length > 0 ? partesFiltro.join(" · ") : "Todos los movimientos"}
    />,
  );
  await lectura;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nombreArchivo}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
