import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAuthContext } from "@/lib/auth-context";
import { rateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { dateISOInTz, timeHHMMInTz } from "@/lib/agenda/legacy-helpers";
import { patientVisibilityAnd, relatedPatientVisibilityAnd } from "@/lib/patient-visibility";
import { patientSearchTokens } from "@/lib/patients/patient-search-core";
import { findPatientIdsBySearch } from "@/lib/patients/patient-search";
import {
  LARGO_MINIMO_BUSQUEDA,
  terminosBusqueda,
  condicionesCitas,
  condicionesFacturas,
  condicionesPacientesRespaldo,
} from "@/lib/command-palette/terminos-busqueda";
import { accesoOrtodonciaParaPaleta } from "@/lib/command-palette/ortodoncia";
import { hasPermission } from "@/lib/auth/permissions";
import { hasActiveOrthodonticsModule } from "@/lib/orthodontics/access";
import {
  COOKIE_VISTA_PREVIA_SIN_MODULO,
  moduloActivoALaVista,
  vistaPreviaSinModulo,
} from "@/lib/orthodontics/contratar";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const rl = rateLimit(req, 30);
  if (rl) return rl;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Ortodoncia en el buscador (ws1-t5): las MISMAS tres condiciones que el
  // guardia del módulo (sede dental, módulo contratado de verdad y permiso
  // `specialties.orthodontics`). Sin ellas la paleta no enseña nada de
  // ortodoncia. Se resuelve también con la búsqueda vacía, porque la paleta
  // lo pide al abrirse para pintar los destinos. clinicId de la sesión.
  const quien = { role: ctx.role as any, permissionsOverride: ctx.permissionsOverride };
  const esDental = ctx.clinicCategory === "DENTAL";
  const tienePermisoModulo = hasPermission(quien, "specialties.orthodontics");
  const moduloReal =
    esDental && tienePermisoModulo && !ctx.isPlanExpired
      ? await hasActiveOrthodonticsModule(ctx.clinicId).catch(() => false)
      : false;
  const ortodoncia = accesoOrtodonciaParaPaleta({
    esDental,
    // La vista previa «sin módulo» solo puede QUITARLO a la vista, y en
    // producción se ignora (igual que en el layout y en el guardia).
    moduloActivo: moduloActivoALaVista(
      moduloReal,
      vistaPreviaSinModulo({
        nodeEnv: process.env.NODE_ENV,
        cookie: cookies().get(COOKIE_VISTA_PREVIA_SIN_MODULO)?.value,
      }),
    ),
    tienePermisoModulo,
    puedeVerConfiguracion: hasPermission(quien, "settings.view"),
  });

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < LARGO_MINIMO_BUSQUEDA) {
    return NextResponse.json({ patients: [], appointments: [], invoices: [], ortodoncia });
  }

  // "Ana Pérez" son DOS términos y cada uno tiene que casar en algún campo
  // (AND de ORs). Antes se comparaba la cadena entera contra cada campo y un
  // nombre completo no encontraba a nadie. Ver terminos-busqueda.ts.
  const terminos = terminosBusqueda(q);

  const clinicTz = await prisma.clinic.findUnique({
    where: { id: ctx.clinicId },
    select: { timezone: true },
  });
  const tz = clinicTz?.timezone ?? "America/Mexico_City";

  // Visibilidad por paciente: la búsqueda global es una puerta lateral que
  // listaba pacientes/citas/facturas de TODA la clínica, restringidos incluidos.
  // Va en AND (nunca en OR) porque el OR de cada query ya lo ocupa el texto —
  // meterlo ahí lo volvería permisivo. Vacío para admins (no filtra).
  const viewer = { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId };
  const patientVis = patientVisibilityAnd(viewer);
  const relatedVis = relatedPatientVisibilityAnd(viewer);

  // Folio escrito sin prefijo: "72" tiene que traer MF-0072 como PRIMER
  // resultado y no perderse entre los `contains` (que también matchean 1720,
  // 720…). Los generadores del repo rellenan a 4 dígitos — MF-#### y
  // INV-AAAA-#### — así que probamos el crudo, el de 4 y el de 6 (por si el
  // padding crece). El `endsWith` se afina luego en JS comparando la cola
  // numérica exacta, para que "72" NO se quede con MF-10072.
  const numericQ = /^\d+$/.test(q) ? q : null;
  const folioVariants = numericQ
    ? Array.from(new Set([numericQ, numericQ.padStart(4, "0"), numericQ.padStart(6, "0")]))
    : [];

  const invoiceSelect = {
    id: true, invoiceNumber: true, total: true, status: true, createdAt: true,
    patient: { select: { firstName: true, lastName: true } },
  } as const;

  // Mismo clinicId y mismo relatedVis que la query de facturas de abajo: esto
  // solo reordena/complementa, no abre ninguna puerta de visibilidad.
  const folioPromise = numericQ
    ? prisma.invoice.findMany({
        where: {
          clinicId: ctx.clinicId,
          OR: folioVariants.map((v) => ({ invoiceNumber: { endsWith: v } })),
          ...(relatedVis.length ? { AND: relatedVis } : {}),
        },
        select: invoiceSelect,
        take: 5,
        orderBy: { createdAt: "desc" as const },
      })
    : Promise.resolve([]);

  // Pacientes con el MISMO criterio que el buscador de «Nueva cita»
  // (/api/patients/search): sin acentos ("Perez" encuentra a "Pérez"), con el
  // teléfono normalizado y por folio. Devuelve ids CANDIDATOS acotados por
  // clinicId; el where de Prisma de abajo sigue poniendo clinicId y la
  // visibilidad. Si la consulta normalizada falla (`null`), se cae a los
  // cinco campos de siempre. Los campos no cambian: nombre, apellido, folio,
  // teléfono y correo.
  const idsPacientes = await findPatientIdsBySearch({
    clinicIds: [ctx.clinicId],
    tokens: patientSearchTokens(q),
    limit: 200,
  });

  const [patients, appointments, invoices, folioHits] = await Promise.all([
    prisma.patient.findMany({
      where: {
        clinicId: ctx.clinicId,
        // ARCO: un paciente cancelado (deletedAt ≠ null) no sale en el
        // buscador — misma regla que /api/patients/search y que las listas.
        deletedAt: null,
        AND: [
          ...(idsPacientes !== null
            ? [{ id: { in: idsPacientes } }]
            : condicionesPacientesRespaldo(terminos)),
          ...patientVis,
        ],
      },
      select: { id: true, firstName: true, lastName: true, patientNumber: true, phone: true },
      take: 5,
      orderBy: { createdAt: "desc" },
    }),
    prisma.appointment.findMany({
      where: {
        clinicId: ctx.clinicId,
        AND: [...condicionesCitas(terminos), ...relatedVis],
      },
      select: {
        id: true, startsAt: true, status: true,
        patient: { select: { firstName: true, lastName: true } },
        doctor:  { select: { firstName: true, lastName: true } },
      },
      take: 5,
      orderBy: { startsAt: "desc" },
    }),
    prisma.invoice.findMany({
      where: {
        clinicId: ctx.clinicId,
        AND: [...condicionesFacturas(terminos), ...relatedVis],
      },
      select: invoiceSelect,
      take: 5,
      orderBy: { createdAt: "desc" },
    }),
    folioPromise,
  ]);

  // ¿Cuáles de estos pacientes tienen (o tuvieron) un caso de ortodoncia? Solo
  // se pregunta si la persona puede entrar al módulo. Acotado por clinicId y a
  // los ids que YA pasaron la visibilidad de arriba. Si falla, la búsqueda
  // sigue: simplemente no se ofrece «Abrir su caso».
  const conCaso = new Set<string>();
  if (ortodoncia.activo && patients.length > 0) {
    const planes = await prisma.orthodonticTreatmentPlan
      .findMany({
        where: {
          clinicId: ctx.clinicId,
          patientId: { in: patients.map((p) => p.id) },
          deletedAt: null,
        },
        select: { patientId: true },
      })
      .catch(() => [] as Array<{ patientId: string }>);
    for (const plan of planes) conCaso.add(plan.patientId);
  }

  // Solo los que de verdad SON ese folio (cola numérica == número escrito).
  const exactFolio = folioHits.filter((i) => {
    const tail = /(\d+)$/.exec(i.invoiceNumber ?? "")?.[1];
    return tail != null && numericQ != null && Number(tail) === Number(numericQ);
  });

  const seenInvoice = new Set<string>();
  const rankedInvoices: typeof invoices = [];
  for (const inv of [...exactFolio, ...invoices]) {
    if (seenInvoice.has(inv.id)) continue;
    seenInvoice.add(inv.id);
    rankedInvoices.push(inv);
    if (rankedInvoices.length === 5) break;
  }

  return NextResponse.json({
    patients: patients.map(p => ({
      id: p.id,
      firstName: p.firstName,
      lastName: p.lastName,
      patientNumber: p.patientNumber,
      phone: p.phone,
      ...(conCaso.has(p.id) ? { casoOrtodoncia: true } : {}),
    })),
    appointments: appointments.map(a => ({
      id: a.id,
      date: dateISOInTz(a.startsAt, tz),
      startTime: timeHHMMInTz(a.startsAt, tz),
      patientName: `${a.patient.firstName} ${a.patient.lastName}`,
      doctorName: `${a.doctor.firstName} ${a.doctor.lastName}`,
      status: a.status,
    })),
    invoices: rankedInvoices.map(i => ({
      id: i.id,
      folio: i.invoiceNumber,
      amount: Number(i.total),
      status: i.status,
      date: i.createdAt.toISOString(),
      patientName: `${i.patient.firstName} ${i.patient.lastName}`,
    })),
    ortodoncia,
  });
}
