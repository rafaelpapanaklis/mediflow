// GET /api/indicaciones/cita/[id]/constancia?hoja=<id> — la constancia de
// asistencia de la cita en PDF: paciente, fecha y hora REALES (llegada o inicio, y
// fin de la consulta), doctor con cédula y clínica, con la plantilla de la clínica
// (o la de fábrica). Solo con la consulta empezada o terminada (N-29). Funciona
// también ANTES de pegar el SQL (con la de fábrica). Queda en Movimientos.

import { NextRequest, NextResponse } from "next/server";
import { PERMISO_EMITIR, cargarCita, entrarCita } from "@/lib/indicaciones/cita.server";
import {
  anotarEnMovimientos,
  constanciaSinTabla,
  hojasDeLaClinica,
} from "@/lib/indicaciones/hojas-de-cita.server";
import { constanciaPorDefecto } from "@/lib/indicaciones/servicio";
import { MENSAJE_SIN_CONSTANCIA, fechaLarga, motivoSinConstancia, seccionesRellenas, valoresDeLaCita } from "@/lib/indicaciones/envio";
import { construirPdfHoja, nombreDeArchivoHoja } from "@/lib/indicaciones/pdf";

export const runtime = "nodejs"; // @react-pdf
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const e = await entrarCita(req, PERMISO_EMITIR, 30);
  if ("res" in e) return e.res;
  const { ctx } = e;

  try {
    const c = await cargarCita(ctx, params.id);
    if ("res" in c) return c.res;
    // N-29: solo con la consulta empezada o terminada, de un día que ya llegó y con hora real registrada.
    const motivo = motivoSinConstancia(c.datos.cita, c.datos.clinica.timezone, new Date());
    if (motivo) return NextResponse.json({ code: motivo, error: MENSAJE_SIN_CONSTANCIA[motivo] }, { status: 409 });

    const hojas = await hojasDeLaClinica(ctx.clinicId, c.catalogo);
    const pedida = req.nextUrl.searchParams.get("hoja");
    // La pedida si está en uso; si no, la de la clínica por defecto; y si la clínica apagó todas,
    // el texto de fábrica (una constancia siempre se puede emitir).
    const plantilla =
      (hojas
        ? (pedida ? hojas.find((h) => h.id === pedida && h.tipo === "CONSTANCIA" && h.activa) : null) ??
          constanciaPorDefecto(hojas)
        : null) ?? constanciaSinTabla();

    const ahora = new Date();
    const valores = valoresDeLaCita(c.datos, ahora);
    const pdf = await construirPdfHoja(c.clinica.letterhead, {
      tipo: "CONSTANCIA",
      rotulo: "Constancia de asistencia",
      fecha: fechaLarga(ahora, c.datos.clinica.timezone),
      paciente: c.datos.paciente.nombre,
      fechaCita: valores.fechaCita ?? "",
      doctor: c.datos.doctor.nombre,
      cedula: c.datos.doctor.cedula,
      // El título del PDF es siempre «Constancia de asistencia»; el nombre de la plantilla es interno.
      secciones: seccionesRellenas([{ nombre: "Constancia de asistencia", cuerpo: plantilla.cuerpo }], valores),
    });

    await anotarEnMovimientos({
      req,
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      patientId: c.patientId,
      appointmentId: c.appointmentId,
      texto: `Emitió la constancia de asistencia de la cita del ${valores.fechaCita}`,
      categoria: "citas",
      via: "constancia",
      hojas: [plantilla.id],
    });

    const modo = req.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline";
    return new NextResponse(pdf as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${modo}; filename="${nombreDeArchivoHoja("constancia-asistencia", c.datos.paciente.nombre)}"`,
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  } catch (err) {
    console.error("Constancia de asistencia:", err);
    return NextResponse.json({ error: "No se pudo generar la constancia" }, { status: 500 });
  }
}
