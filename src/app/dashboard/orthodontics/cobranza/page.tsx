// Ortodoncia — Cobranza de mensualidades (ws1-t3, H16 de la QA en vivo del
// 28-sep-2026: este apartado decía «Próximamente»). Quién debe, cuánto y
// desde cuándo, caso por caso; qué está por vencer; y cobrar.
//
// No calcula dinero por su cuenta: usa `loadOrthoCases` (el mismo cargador
// del Tablero, Alertas y Pacientes), que resuelve cada caso con
// `cobranzaDelCasoUnificada` contra la factura real del tratamiento. Para
// cobrar monta `ListaMensualidades`, la misma lista de Caja.
//
// La guarda de módulo corre en el layout y, otra vez, aquí. `clinicId` y la
// zona horaria salen de la sesión.
export const dynamic = "force-dynamic";

import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/permissions";
import { exigirModuloOrtodoncia } from "@/lib/orthodontics/exigir-modulo";
import { loadOrthoCases } from "@/lib/orthodontics/tablero-data";
import { filasDeCobranza, resumenDeCobranza, leerFiltroCobranza } from "@/lib/orthodontics/cobranza-modulo";
import { hoyEnZona } from "@/lib/whatsapp/cobranza/sweep";
import { zonaValida } from "@/components/specialties/orthodontics/modulo/fechas";
import { VistaCobranza } from "@/components/specialties/orthodontics/modulo/vista-cobranza";

export default async function OrthodonticsCobranzaPage({
  searchParams,
}: {
  searchParams?: { filtro?: string | string[] };
}) {
  await exigirModuloOrtodoncia();
  const user = await getCurrentUser();
  const viewer = { userId: user.id, role: user.role, clinicId: user.clinicId };
  const zona = zonaValida(user.clinic.timezone);
  const ahora = new Date();

  const { cases } = await loadOrthoCases(user.clinicId, zona, viewer, ahora);
  const filas = filasDeCobranza(cases, hoyEnZona(ahora, zona));

  // COBRAR exige `billing.charge` (lo mismo que POST /api/invoices/[id]): con
  // solo `billing.view` el botón salía y el cobro fallaba al guardar (ws1-t4 #85).
  const puedeCobrar = hasPermission(
    { role: user.role, permissionsOverride: user.permissionsOverride },
    "billing.charge",
  );

  return (
    <VistaCobranza
      filas={filas}
      resumen={resumenDeCobranza(filas)}
      puedeCobrar={puedeCobrar}
      // «Casos con vencido» del Tablero llega aquí con `?filtro=vencido`.
      filtroInicial={leerFiltroCobranza(searchParams?.filtro)}
    />
  );
}
