// GET /api/indicaciones/cita/[id] — lo que el cuadro «Indicaciones y constancia»
// de la cita necesita: qué hojas hay (ya rellenas con los datos de la cita),
// cuáles se proponen por los procedimientos de la cita, y si el WhatsApp saldría
// (ventana de 24 h, plantilla) — decidido con las MISMAS piezas que el envío.

import { NextRequest, NextResponse } from "next/server";
import { lastInboundAtForPhone } from "@/lib/whatsapp/inbox-log";
import { PERMISO_VER, cargarCita, entrarCita } from "@/lib/indicaciones/cita.server";
import { constanciaSinTabla, hojasDeLaClinica, ultimoEnvioReciente } from "@/lib/indicaciones/hojas-de-cita.server";
import { constanciaPorDefecto, hojasSugeridas } from "@/lib/indicaciones/servicio";
import {
  admiteConstancia,
  admiteIndicaciones,
  seccionesRellenas,
  valoresDeLaCita,
  vistaWhatsAppIndicaciones,
} from "@/lib/indicaciones/envio";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const e = await entrarCita(req, PERMISO_VER, 60);
  if ("res" in e) return e.res;
  const { ctx } = e;
  try {
    const c = await cargarCita(ctx, params.id);
    if ("res" in c) return c.res;

    const hojas = await hojasDeLaClinica(ctx.clinicId, c.catalogo);
    const valores = valoresDeLaCita(c.datos, new Date());
    const indicaciones = (hojas ?? []).filter((h) => h.tipo === "INDICACIONES" && h.activa);
    const constancias = hojas ? hojas.filter((h) => h.tipo === "CONSTANCIA" && h.activa) : [constanciaSinTabla()];
    const porDefecto = hojas ? constanciaPorDefecto(hojas) : constancias[0];

    const ultimoEntrante = c.telefono
      ? await lastInboundAtForPhone(ctx.clinicId, c.telefono).catch(() => null)
      : null;
    const whatsapp = vistaWhatsAppIndicaciones({
      clinica: {
        waConnected: c.clinica.waConnected,
        waPhoneNumberId: c.clinica.waPhoneNumberId,
        conToken: !!c.clinica.waAccessToken,
        waTemplates: c.clinica.waTemplates,
      },
      telefono: c.telefono,
      ultimoEntrante,
      ahora: new Date(),
    });

    return NextResponse.json({
      disponible: hojas !== null,
      estado: c.datos.cita.status,
      admiteIndicaciones: admiteIndicaciones(c.datos.cita.status),
      admiteConstancia: admiteConstancia(c.datos.cita.status),
      paciente: c.datos.paciente.nombre,
      procedimientos: c.datos.procedimientos,
      indicaciones: indicaciones.map((h) => ({
        id: h.id,
        nombre: h.nombre,
        deFabrica: h.deFabrica,
        texto: seccionesRellenas([h], valores)[0].cuerpo,
      })),
      sugeridas: hojas
        ? hojasSugeridas(hojas, c.procedimientos, [c.datos.cita.motivo, ...c.conceptos])
        : [],
      constancias: constancias.map((h) => ({ id: h.id, nombre: h.nombre, deFabrica: h.deFabrica })),
      constanciaPorDefecto: porDefecto?.id ?? null,
      whatsapp,
      ultimoEnvio: (await ultimoEnvioReciente(ctx.clinicId, c.appointmentId))?.toISOString() ?? null,
      doctor: c.datos.doctor.nombre,
      doctorSinCedula: !c.datos.doctor.cedula,
    });
  } catch (err) {
    console.error("Indicaciones de la cita:", err);
    return NextResponse.json({ error: "No se pudieron cargar las indicaciones" }, { status: 500 });
  }
}
