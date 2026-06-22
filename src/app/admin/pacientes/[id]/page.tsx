export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPacienteDetalle } from "@/lib/admin/pacientes";
import { PacienteDetalleClient } from "./paciente-detalle-client";

export const metadata: Metadata = { title: "Paciente — Admin DaleControl" };

export default async function AdminPacienteDetallePage({ params }: { params: { id: string } }) {
  const paciente = await getPacienteDetalle(params.id);
  if (!paciente) notFound();
  return <PacienteDetalleClient paciente={paciente} />;
}
