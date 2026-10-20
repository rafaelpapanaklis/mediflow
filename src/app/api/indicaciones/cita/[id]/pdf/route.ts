// GET /api/indicaciones/cita/[id]/pdf?hojas=<id>,<id> — las indicaciones elegidas
// en PDF, rellenas con los datos de la cita. `?download=1` lo baja como archivo;
// sin él se abre en el visor del navegador (y de ahí se imprime). Cada PDF es una
// copia que sale del sistema: queda en Movimientos.

import { NextRequest, NextResponse } from "next/server";
import { PERMISO_EMITIR, cargarCita, entrarCita } from "@/lib/indicaciones/cita.server";
import { sinIdsRepetidos } from "@/lib/indicaciones/servicio";
import { anotarEnMovimientos, hojasDeLaClinica, nombrarHojas } from "@/lib/indicaciones/hojas-de-cita.server";
import { admiteIndicaciones, fechaLarga, seccionesRellenas, valoresDeLaCita } from "@/lib/indicaciones/envio";
import { construirPdfHoja, nombreDeArchivoHoja } from "@/lib/indicaciones/pdf";

export const runtime = "nodejs"; // @react-pdf
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const e = await entrarCita(req, PERMISO_EMITIR, 30);
  if ("res" in e) return e.res;
  const { ctx } = e;
  const pedidas = (req.nextUrl.searchParams.get("hojas") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (pedidas.length === 0) return NextResponse.json({ code: "SIN_HOJAS" }, { status: 400 });

  try {
    const c = await cargarCita(ctx, params.id);
    if ("res" in c) return c.res;
    if (!admiteIndicaciones(c.datos.cita.status)) return NextResponse.json({ code: "ESTADO" }, { status: 409 });
    const hojas = await hojasDeLaClinica(ctx.clinicId, c.catalogo);
    if (!hojas) return NextResponse.json({ code: "SIN_TABLA" }, { status: 503 });
    // Lo que la persona marcó se respeta: solo se quitan los ids repetidos (ws1-t8 · N3-P1).
    const elegidas = sinIdsRepetidos(hojas.filter((h) => h.tipo === "INDICACIONES" && h.activa && pedidas.includes(h.id)));
    if (elegidas.length === 0) return NextResponse.json({ code: "SIN_HOJAS" }, { status: 400 });

    const ahora = new Date();
    const valores = valoresDeLaCita(c.datos, ahora);
    const pdf = await construirPdfHoja(c.clinica.letterhead, {
      tipo: "INDICACIONES",
      rotulo: "Indicaciones de cuidado",
      fecha: fechaLarga(ahora, c.datos.clinica.timezone),
      paciente: c.datos.paciente.nombre,
      fechaCita: valores.fechaCita ?? "",
      doctor: c.datos.doctor.nombre,
      cedula: c.datos.doctor.cedula,
      secciones: seccionesRellenas(elegidas, valores),
    });

    await anotarEnMovimientos({
      req,
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      patientId: c.patientId,
      appointmentId: c.appointmentId,
      texto: `Generó en PDF (para imprimir) las indicaciones de cuidado ${nombrarHojas(elegidas.map((h) => h.nombre))}`,
      categoria: "expediente",
      via: "pdf",
      hojas: elegidas.map((h) => h.id),
    });

    const modo = req.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline";
    return new NextResponse(pdf as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${modo}; filename="${nombreDeArchivoHoja("indicaciones", c.datos.paciente.nombre)}"`,
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  } catch (err) {
    console.error("PDF de indicaciones:", err);
    return NextResponse.json({ error: "No se pudo generar el PDF" }, { status: 500 });
  }
}
