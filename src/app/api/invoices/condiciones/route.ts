// GET /api/invoices/condiciones?ids=a,b,c  — lo que la FICHA de una factura
// necesita y la lista de facturas no trae: las condiciones de pago (para la
// frase en violeta) y si el paciente tiene correo y teléfono (para deshabilitar
// «Enviar» con un motivo, en vez de dejar que falle al pulsarlo).
//
// GET /api/invoices/condiciones?patientId=x — lo mismo, pero del paciente que se
// acaba de elegir en el popup de Nueva factura, antes de que exista la factura.
//
// Solo lectura. Multi-tenant: `clinicId` de la sesión. Los ids que manda el
// cliente se vuelven a filtrar por clínica Y por visibilidad de paciente antes
// de leer nada: un id ajeno o de un paciente restringido no devuelve ni la frase
// ni el «tiene teléfono».
//
// Del contacto se devuelve SOLO si existe (booleanos), no el dato. ws1-t10: si el caso de la
// factura tiene RESPONSABLE DE PAGO (tutor u otra persona), viene también `responsable` con su
// nombre y sus dos booleanos: la ficha le ofrece enviarle a él. Con `ids`, `contacto[id].whatsapp`
// dice además si «Enviar por WhatsApp» saldría ahora y, si no, por qué (revisión ws1-t2 #6).

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { relatedPatientVisibilityAnd, assertPatientVisible } from "@/lib/patient-visibility";
import { leerCondicionesDeFacturas } from "@/lib/invoices/condiciones-pago-db";
import type { CondicionesPago } from "@/lib/quotes/condiciones-pago";
import { contactosDeResponsablesDeFacturas } from "@/lib/orthodontics/responsable-telefono-db";
import { lastInboundAtForPhone } from "@/lib/whatsapp/inbox-log";
import { ultimoAvisoDeCobro } from "@/lib/whatsapp/aviso-cobro-tope";
import { masReciente, motivoDeLaClinica, vistaEnvioFactura, type VistaEnvioWhatsApp } from "@/lib/invoices/envio-factura-vista";
import { digitsLast10 } from "@/lib/inbox/send-core";
import { sePuedeEnviarPorWhatsApp } from "@/components/dashboard/factura-ficha-rediseno/datos";

export const dynamic = "force-dynamic";

async function vistaWhatsAppDelPaciente(
  clinicId: string,
  p: { phone: string | null; firstName: string | null; lastName: string | null },
): Promise<VistaEnvioWhatsApp> {
  const telefono = (p.phone ?? "").trim();
  // Menos de 7 consultas a la vez (el pooler). El token de WhatsApp NO se lee: solo si existe.
  const [clinica, conToken, ultimoEntrante, ultimoCobro] = await Promise.all([
    prisma.clinic.findFirst({
      where: { id: clinicId },
      select: { name: true, phone: true, timezone: true, waConnected: true, waPhoneNumberId: true, waTemplates: true },
    }),
    prisma.clinic.findFirst({ where: { id: clinicId, waAccessToken: { not: null } }, select: { id: true } }),
    telefono ? lastInboundAtForPhone(clinicId, telefono).catch(() => null) : Promise.resolve(null),
    telefono ? ultimoAvisoDeCobro(clinicId, telefono).catch(() => null) : Promise.resolve(null),
  ]);
  return vistaEnvioFactura({
    clinica: {
      name: clinica?.name ?? null,
      phone: clinica?.phone ?? null,
      timezone: clinica?.timezone ?? null,
      waConnected: clinica?.waConnected ?? false,
      waPhoneNumberId: clinica?.waPhoneNumberId ?? null,
      conToken: Boolean(conToken),
      waTemplates: clinica?.waTemplates ?? null,
    },
    paciente: p,
    ultimoEntrante,
    ultimoCobro,
    ahora: new Date(),
  });
}

/**
 * Revisión ws1-t2 #6 — las FICHAS de facturas ya creadas: el mismo «¿sale por WhatsApp?» que el
 * popup, para apagar «Enviar por WhatsApp» con su motivo ANTES de pulsar. Lo de la clínica
 * (desconectado, sin teléfono) se lee una vez y vale para todas. Lo de cada teléfono (tope de un
 * cobro en 24 h y ventana) solo si son pocos —el expediente de un paciente—: en Caja, con decenas
 * de pacientes, serían cientos de consultas al pooler, y ahí decide la ruta de envío con su motivo.
 * Nunca rompe la respuesta: sin dato, la ficha no apaga nada.
 */
const MAX_TELEFONOS_VISTA = 4;

async function vistasWhatsAppDeFacturas(
  clinicId: string,
  facturas: Array<{ id: string; paciente: { firstName: string | null; lastName: string | null }; telefonos: string[] }>,
): Promise<Record<string, VistaEnvioWhatsApp>> {
  const out: Record<string, VistaEnvioWhatsApp> = {};
  if (facturas.length === 0) return out;
  const [clinicaDb, conToken] = await Promise.all([
    prisma.clinic.findFirst({
      where: { id: clinicId },
      select: { name: true, phone: true, timezone: true, waConnected: true, waPhoneNumberId: true, waTemplates: true },
    }),
    prisma.clinic.findFirst({ where: { id: clinicId, waAccessToken: { not: null } }, select: { id: true } }),
  ]);
  const clinica = {
    name: clinicaDb?.name ?? null,
    phone: clinicaDb?.phone ?? null,
    timezone: clinicaDb?.timezone ?? null,
    waConnected: clinicaDb?.waConnected ?? false,
    waPhoneNumberId: clinicaDb?.waPhoneNumberId ?? null,
    conToken: Boolean(conToken),
    waTemplates: clinicaDb?.waTemplates ?? null,
  };
  const ahora = new Date();
  const bloqueadaEntera = motivoDeLaClinica(clinica) !== null;

  // Un teléfono por sus 10 dígitos (el mismo hogar no se consulta dos veces).
  const porClave = new Map<string, string>();
  for (const f of facturas) for (const t of f.telefonos) if (!porClave.has(digitsLast10(t))) porClave.set(digitsLast10(t), t);
  const porTelefono = new Map<string, { entrante: Date | null; cobro: Date | null }>();
  if (!bloqueadaEntera) {
    if (porClave.size > MAX_TELEFONOS_VISTA) return out;
    // En serie: cada teléfono ya lanza hasta 4 consultas a la vez (menos de 7 por el pooler).
    for (const [clave, tel] of Array.from(porClave.entries())) {
      const [entrante, cobro] = await Promise.all([
        lastInboundAtForPhone(clinicId, tel).catch(() => null),
        ultimoAvisoDeCobro(clinicId, tel, ahora).catch(() => null),
      ]);
      porTelefono.set(clave, { entrante, cobro });
    }
  }
  for (const f of facturas) {
    const datos = f.telefonos.map((t) => porTelefono.get(digitsLast10(t)));
    out[f.id] = vistaEnvioFactura({
      clinica,
      paciente: { ...f.paciente, phone: f.telefonos[0] ?? null },
      // Sale si a alguno de los dos (paciente o responsable) se le puede escribir; el tope, como la
      // ruta, mira los dos teléfonos.
      ultimoEntrante: masReciente(datos.map((d) => d?.entrante)),
      ultimoCobro: masReciente(datos.map((d) => d?.cobro)),
      ahora,
    });
  }
  return out;
}

/** La lista de Facturación trae como mucho 100 facturas. */
const MAX_IDS = 100;

const tiene = (v: string | null | undefined) => typeof v === "string" && v.trim().length > 0;

export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = denyIfMissingPermission(ctx, "billing.view");
  if (denied) return denied;
  // Regla de la casa: `clinicId: undefined` no filtra nada. Se corta antes.
  if (!ctx.clinicId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { searchParams } = new URL(req.url);

  const patientId = (searchParams.get("patientId") ?? "").trim();
  if (patientId) {
    const deniedPatient = await assertPatientVisible(patientId, {
      userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId,
    });
    if (deniedPatient) return deniedPatient;
    const p = await prisma.patient.findFirst({
      where: { id: patientId, clinicId: ctx.clinicId },
      select: { email: true, phone: true, firstName: true, lastName: true },
    });
    if (!p) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });
    // ws1-t6: por qué canal saldría «Enviar por WhatsApp» (o por qué no sale) para que el
    // popup enseñe ANTES de guardar lo que recibirá el paciente. Nunca rompe la respuesta.
    const whatsapp = await vistaWhatsAppDelPaciente(ctx.clinicId, p).catch((e) => {
      console.error("[invoices/condiciones] no se pudo preparar la vista del envío por WhatsApp:", e);
      return null;
    });
    return NextResponse.json({ contacto: { correo: tiene(p.email), telefono: tiene(p.phone) }, whatsapp });
  }

  const ids = Array.from(new Set(
    (searchParams.get("ids") ?? "").split(",").map((x) => x.trim()).filter(Boolean),
  )).slice(0, MAX_IDS);
  if (ids.length === 0) {
    return NextResponse.json({ condiciones: {}, contacto: {}, sinTabla: false, fallo: false });
  }

  const visibility = relatedPatientVisibilityAnd({ userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
  const propias = await prisma.invoice.findMany({
    where: {
      id: { in: ids },
      clinicId: ctx.clinicId,
      ...(visibility.length ? { AND: visibility } : {}),
    },
    select: { id: true, status: true, patient: { select: { email: true, phone: true, firstName: true, lastName: true } } },
  });

  const responsables = await contactosDeResponsablesDeFacturas(ctx.clinicId, propias.map((i) => i.id));
  const contacto: Record<string, {
    correo: boolean; telefono: boolean;
    responsable?: { nombre: string; parentesco: string; correo: boolean; telefono: boolean };
    whatsapp?: VistaEnvioWhatsApp;
  }> = {};
  propias.forEach((inv) => {
    const r = responsables.get(inv.id);
    contacto[inv.id] = {
      correo: tiene(inv.patient?.email),
      telefono: tiene(inv.patient?.phone),
      ...(r ? { responsable: { nombre: r.nombre, parentesco: r.parentesco, correo: tiene(r.correo), telefono: tiene(r.telefono) } } : {}),
    };
  });

  // Solo las que ofrecen «Enviar por WhatsApp» (con saldo) y tienen a quién mandarlo.
  const conWhatsApp = propias
    .filter((inv) => sePuedeEnviarPorWhatsApp(inv.status))
    .map((inv) => {
      const r = responsables.get(inv.id);
      const telefonos = [inv.patient?.phone, r?.telefono].map((t) => (t ?? "").trim()).filter(Boolean);
      return { id: inv.id, paciente: { firstName: inv.patient?.firstName ?? null, lastName: inv.patient?.lastName ?? null }, telefonos };
    })
    .filter((f) => f.telefonos.length > 0);
  const vistas = await vistasWhatsAppDeFacturas(ctx.clinicId, conWhatsApp).catch((e) => {
    console.error("[invoices/condiciones] no se pudo preparar la vista del envío por WhatsApp de las fichas:", e);
    return {} as Record<string, VistaEnvioWhatsApp>;
  });
  for (const [id, v] of Object.entries(vistas)) if (contacto[id]) contacto[id].whatsapp = v;

  const leido = await leerCondicionesDeFacturas(prisma, {
    clinicId: ctx.clinicId,
    invoiceIds: propias.map((i) => i.id),
  });
  const condiciones: Record<string, CondicionesPago> = {};
  leido.porFactura.forEach((c, id) => { condiciones[id] = c; });

  return NextResponse.json({ condiciones, contacto, sinTabla: leido.sinTabla, fallo: leido.fallo });
}
