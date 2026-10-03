// Ortodoncia — «Completar varios a la vez» (ws1-t8, auditoría de BEVADENT: F11 y mejora 8). La tabla de los casos
// con diagnóstico o plan incompleto: doctor tratante, tiempo de tratamiento y controles previstos de varios casos a la
// vez, y la marca «migrado, sin datos de diagnóstico» para los que vinieron de otro sistema. El diagnóstico NO se
// captura aquí (lo captura la clínica en la ficha): la marca solo saca el caso de la alerta.
//
// Se llega desde Alertas y el Tablero. Pide `medicalRecord.edit` (lo mismo que «Completar diagnóstico / plan»); la
// guarda de módulo corre en el layout y, otra vez, aquí. Esta página solo carga; la tabla vive en
// `modulo/completar-en-bloque.tsx` y guarda por `completarCasosEnBloque`.
export const dynamic = "force-dynamic";

import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/permissions";
import { exigirModuloOrtodoncia } from "@/lib/orthodontics/exigir-modulo";
import { loadOrthoCases } from "@/lib/orthodontics/tablero-data";
import { cargarCasosIncompletosDetallados } from "@/lib/orthodontics/casos-incompletos-db";
import { cargarDoctoresTratantes, existeColumnaDoctorTratante } from "@/lib/orthodontics/doctores-tratantes-db";
import { columnaDePlanDetalleExiste, leerOpcionesDelPlan } from "@/lib/orthodontics/plan-detalle-db";
import { FRECUENCIAS_DE_CONTROL } from "@/lib/orthodontics/plan-detalle";
import { propuestaDeControles, type FilaParaCompletar } from "@/lib/orthodontics/completar-casos";
import { Pantalla } from "@/components/specialties/orthodontics/modulo/piezas";
import { CompletarEnBloque } from "@/components/specialties/orthodontics/modulo/completar-en-bloque";
import s from "@/components/specialties/orthodontics/modulo/modulo.module.css";

export default async function CompletarCasosPage() {
  await exigirModuloOrtodoncia();
  const user = await getCurrentUser();
  const puedeEditar = hasPermission({ role: user.role, permissionsOverride: user.permissionsOverride }, "medicalRecord.edit");
  if (!puedeEditar) {
    return (
      <Pantalla titulo="Completar casos" sub="Para completar casos hace falta poder editar el expediente clínico.">
        <Link href="/dashboard/orthodontics/alertas" className={s.boton}>
          Volver a Alertas
        </Link>
      </Pantalla>
    );
  }
  const viewer = { userId: user.id, role: user.role, clinicId: user.clinicId };
  const { cases } = await loadOrthoCases(user.clinicId, user.clinic.timezone, viewer);
  const incompletos = await cargarCasosIncompletosDetallados(user.clinicId, cases, { incluirMarcados: true });
  // Cuatro lecturas a la vez, después de las de arriba: el pooler se satura por encima de 7.
  const [doctores, opciones, planGuardable, doctorGuardable] = await Promise.all([
    cargarDoctoresTratantes(user.clinicId),
    leerOpcionesDelPlan(user.clinicId),
    columnaDePlanDetalleExiste(),
    existeColumnaDoctorTratante(),
  ]);
  const frecuencia = opciones.frecuenciaControlDias;
  const filas: FilaParaCompletar[] = incompletos.map((c) => ({
    planId: c.planId,
    patientId: c.patientId,
    patientName: c.patientName,
    faltan: c.faltan,
    paso: c.paso ?? "plan",
    migrado: c.migrado,
    sinDiagnosticoMarcado: c.sinDiagnosticoMarcado,
    faltaDiagnostico: c.faltan.some((f) => f.paso === "diagnostico"),
    doctorId: c.doctorId,
    duracionMeses: c.duracionMeses,
    controlesPrevistos: c.controlesPrevistos,
    controlesPropuestos: propuestaDeControles(c.duracionMeses, frecuencia),
    planGuardable,
  }));
  const frecuenciaTexto = FRECUENCIAS_DE_CONTROL.find((f) => f.dias === frecuencia)?.texto.toLowerCase() ?? `cada ${frecuencia} días`;
  const pendientes = filas.filter((f) => f.faltan.length > 0).length;

  return (
    <Pantalla
      titulo="Completar casos"
      sub={
        pendientes === 0
          ? "Todos los casos activos tienen su diagnóstico y su plan completos."
          : `${pendientes} caso${pendientes === 1 ? "" : "s"} con diagnóstico o plan incompleto. Cambia lo que quieras en la tabla y guarda una sola vez.`
      }
      acciones={
        <Link href="/dashboard/orthodontics/alertas#casos-incompletos" className={s.boton}>
          Volver a Alertas
        </Link>
      }
    >
      <CompletarEnBloque
        filas={filas}
        doctores={doctores.map((d) => ({ id: d.id, nombre: d.fullName }))}
        frecuenciaDias={frecuencia}
        frecuenciaTexto={frecuenciaTexto}
        planGuardable={planGuardable}
        doctorGuardable={doctorGuardable}
      />
    </Pantalla>
  );
}
