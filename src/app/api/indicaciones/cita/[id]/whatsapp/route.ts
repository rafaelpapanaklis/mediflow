// POST /api/indicaciones/cita/[id]/whatsapp — manda al paciente las indicaciones
// elegidas. Body: { hojas: string[], reenviar?: boolean }.
//
// LA VENTANA DE 24 HORAS: dentro, sale el texto (o, si no cabe, un aviso corto con
// el PDF). Fuera, solo una plantilla aprobada por Meta: hoy no hay una para
// indicaciones (KIND_ENVIO_INDICACIONES en lib/indicaciones/envio.ts), así que
// `sendWhatsAppLogged` lo BLOQUEA antes de llamar a Meta y aquí se contesta 409
// FUERA_DE_VENTANA: la pantalla ofrece imprimir o el PDF. Nunca falla en silencio.
//
// SIN DUPLICADOS: si las indicaciones de esta cita ya salieron por WhatsApp hace
// menos de 10 min, 409 YA_ENVIADAS salvo `reenviar: true` (la pantalla pregunta).

import { NextRequest, NextResponse } from "next/server";
import { sendWhatsAppLogged } from "@/lib/whatsapp/send-and-log";
import { WhatsAppBlockedError } from "@/lib/whatsapp/errors";
import { lastInboundAtForPhone } from "@/lib/whatsapp/inbox-log";
import { enmascararTelefono } from "@/lib/patient-documents/envio";
import { PERMISO_EMITIR, cargarCita, entrarCita } from "@/lib/indicaciones/cita.server";
import { anotarEnMovimientos, hojasDeLaClinica, nombrarHojas, ultimoEnvioReciente } from "@/lib/indicaciones/hojas-de-cita.server";
import {
  KIND_ENVIO_INDICACIONES,
  admiteIndicaciones,
  datosDePlantilla,
  fechaLarga,
  mensajeCortoConPdf,
  mensajeDeIndicaciones,
  seccionesRellenas,
  textoDeProcedimientos,
  valoresDeLaCita,
  vistaWhatsAppIndicaciones,
} from "@/lib/indicaciones/envio";
import { construirPdfHoja, nombreDeArchivoHoja } from "@/lib/indicaciones/pdf";

export const runtime = "nodejs"; // puede generar el PDF
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const e = await entrarCita(req, PERMISO_EMITIR, 10);
  if ("res" in e) return e.res;
  const { ctx } = e;

  const body = await req.json().catch(() => null);
  const pedidas: string[] = Array.isArray(body?.hojas) ? body.hojas.filter((x: unknown) => typeof x === "string") : [];
  if (pedidas.length === 0) return NextResponse.json({ code: "SIN_HOJAS" }, { status: 400 });

  try {
    const c = await cargarCita(ctx, params.id);
    if ("res" in c) return c.res;
    if (!admiteIndicaciones(c.datos.cita.status)) return NextResponse.json({ code: "ESTADO" }, { status: 409 });

    const hojas = await hojasDeLaClinica(ctx.clinicId, c.catalogo);
    if (!hojas) return NextResponse.json({ code: "SIN_TABLA" }, { status: 503 });
    // En el orden de la biblioteca; solo indicaciones en uso de ESTA clínica.
    const elegidas = hojas.filter((h) => h.tipo === "INDICACIONES" && h.activa && pedidas.includes(h.id));
    if (elegidas.length === 0) return NextResponse.json({ code: "SIN_HOJAS" }, { status: 400 });

    if (!c.telefono) return NextResponse.json({ code: "SIN_TELEFONO" }, { status: 409 });
    const cl = c.clinica;
    if (!cl.waConnected || !cl.waPhoneNumberId || !cl.waAccessToken) {
      return NextResponse.json({ code: "WA_SIN_CONECTAR" }, { status: 409 });
    }

    const previo = await ultimoEnvioReciente(ctx.clinicId, c.appointmentId);
    if (previo && body?.reenviar !== true) {
      return NextResponse.json({ code: "YA_ENVIADAS", en: previo.toISOString() }, { status: 409 });
    }

    const ahora = new Date();
    const valores = valoresDeLaCita(c.datos, ahora);
    const secciones = seccionesRellenas(elegidas, valores);
    const texto = mensajeDeIndicaciones(secciones, cl.letterhead.name);
    const vista = vistaWhatsAppIndicaciones({
      clinica: { waConnected: cl.waConnected, waPhoneNumberId: cl.waPhoneNumberId, conToken: true, waTemplates: cl.waTemplates },
      telefono: c.telefono,
      ultimoEntrante: await lastInboundAtForPhone(ctx.clinicId, c.telefono).catch(() => null),
      ahora,
    });

    // No cabe en un mensaje: aviso corto + el PDF (que solo viaja con la ventana abierta).
    const pdf =
      texto === null && vista.modo === "text"
        ? await construirPdfHoja(cl.letterhead, {
            tipo: "INDICACIONES",
            rotulo: "Indicaciones de cuidado",
            fecha: fechaLarga(ahora, c.datos.clinica.timezone),
            paciente: c.datos.paciente.nombre,
            fechaCita: valores.fechaCita ?? "",
            doctor: c.datos.doctor.nombre,
            cedula: c.datos.doctor.cedula,
            secciones,
          })
        : null;

    try {
      await sendWhatsAppLogged({
        clinic: {
          id: cl.id,
          waConnected: cl.waConnected,
          waPhoneNumberId: cl.waPhoneNumberId,
          waAccessToken: cl.waAccessToken,
          waTemplates: cl.waTemplates,
        },
        to: c.telefono,
        body: texto ?? mensajeCortoConPdf(c.primerNombre, cl.letterhead.name),
        kind: KIND_ENVIO_INDICACIONES,
        // "system" no liga el hilo al paciente por defecto; aquí sí es a él.
        linkPatient: true,
        patientId: c.patientId,
        sentById: ctx.userId,
        templateParams: datosDePlantilla(
          c.primerNombre,
          cl.letterhead.name,
          textoDeProcedimientos(c.datos.procedimientos, c.datos.cita.motivo),
        ),
        attachment: pdf
          ? { buffer: pdf, filename: nombreDeArchivoHoja("indicaciones", c.datos.paciente.nombre), caption: "Indicaciones de cuidado" }
          : null,
      });
    } catch (err) {
      if (err instanceof WhatsAppBlockedError) {
        return NextResponse.json({ code: "FUERA_DE_VENTANA", detalle: err.message }, { status: 409 });
      }
      console.error(`[indicaciones/whatsapp] fallo al enviar (${c.appointmentId}):`, err);
      return NextResponse.json({ code: "WA_FALLO" }, { status: 502 });
    }

    const nombres = elegidas.map((h) => h.nombre);
    await anotarEnMovimientos({
      req,
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      patientId: c.patientId,
      appointmentId: c.appointmentId,
      texto:
        vista.modo === "template"
          ? `Envió por WhatsApp el aviso de las indicaciones de cuidado ${nombrarHojas(nombres)}`
          : `Envió por WhatsApp las indicaciones de cuidado ${nombrarHojas(nombres)}`,
      categoria: "expediente",
      via: "whatsapp",
      hojas: elegidas.map((h) => h.id),
    });

    return NextResponse.json({ ok: true, destino: enmascararTelefono(c.telefono), modo: vista.modo, conPdf: !!pdf });
  } catch (err) {
    console.error("Indicaciones por WhatsApp:", err);
    return NextResponse.json({ code: "ERROR" }, { status: 500 });
  }
}
