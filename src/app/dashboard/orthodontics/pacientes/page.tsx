// Ortodoncia — Pacientes en tratamiento (ws1-t2, Ola 1). La lista de casos
// activos, con su fase y su cobranza real (factura del tratamiento, decisión
// 1 de la arquitectura). La guarda de módulo corre en el layout y, otra vez, aquí.
//
// Diseño (ws1-t3): solo cambia cómo se pinta; las filas salen igual que antes.
//
// 28-sep-2026 (ws1-t3, H17 de la QA en vivo): botón «Abrir caso», que lleva a
// elegir paciente. Antes un caso solo se abría desde la ficha. Lo ve quien
// puede escribir en el expediente (`medicalRecord.edit`), el mismo permiso
// que exige crear el caso.
//
// ws1-t4 ronda 6 (revisión de lógica de uso, filas 18 a 20): la tabla dice por
// dónde va cada caso (etapa, aparatología, último y próximo control) y deja
// de repetir la de Cobranza; se puede filtrar por estado y por doctor
// tratante, así que también se encuentra a quien está en retención, en pausa,
// terminó o abandonó; y un caso sin plan de pago ya no sale «Al día». Las
// filas las arma `pacientes-modulo.ts` (puro, con tests).
export const dynamic = "force-dynamic";

import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/permissions";
import { exigirModuloOrtodoncia } from "@/lib/orthodontics/exigir-modulo";
import { cargarFilasDeCasos } from "@/lib/orthodontics/pacientes-modulo-db";
import { contarPorEstado, leerFiltroEstado, leerFiltroVer } from "@/lib/orthodontics/pacientes-modulo";
import { OrthoPacientesTable } from "@/components/specialties/orthodontics/OrthoPacientesTable";
import { Pantalla } from "@/components/specialties/orthodontics/modulo/piezas";
import { AbrirCasoBoton } from "@/components/specialties/orthodontics/modulo/abrir-caso";

export default async function OrthodonticsPacientesPage({
  searchParams,
}: {
  searchParams?: { estado?: string | string[]; ver?: string | string[] };
}) {
  await exigirModuloOrtodoncia();
  const user = await getCurrentUser();
  const viewer = { userId: user.id, role: user.role, clinicId: user.clinicId };
  const rows = await cargarFilasDeCasos(user.clinicId, user.clinic.timezone, viewer);
  const activos = contarPorEstado(rows).activos;

  const puedeAbrirCaso = hasPermission(
    { role: user.role, permissionsOverride: user.permissionsOverride },
    "medicalRecord.edit",
  );

  return (
    <Pantalla
      titulo="Pacientes en tratamiento"
      sub={`${activos} caso${activos === 1 ? "" : "s"} activo${activos === 1 ? "" : "s"}${
        rows.length > activos ? ` · ${rows.length} en total` : ""
      }.`}
      acciones={puedeAbrirCaso ? <AbrirCasoBoton /> : undefined}
    >
      <OrthoPacientesTable
        rows={rows}
        puedeAbrirCaso={puedeAbrirCaso}
        zonaHoraria={user.clinic.timezone}
        estadoInicial={leerFiltroEstado(searchParams?.estado)}
        verInicial={leerFiltroVer(searchParams?.ver)}
      />
    </Pantalla>
  );
}
