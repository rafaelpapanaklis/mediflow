"use client";
// Ortodoncia — Pacientes en tratamiento (ws1-t2, Ola 1). Tabla con buscador
// de los casos activos, con su cobranza real (decisión 1: factura del
// tratamiento, nunca OrthoPaymentPlan). Hermana de la vieja
// OrthodonticsSpecialtyClient.tsx (S1, `/dashboard/specialties/orthodontics`,
// sin ocultar todavía porque sigue siendo el único camino para abrir un caso
// — ver REPORTE-ws1-t1.md, punto 6): esta es la NUEVA, sin el toggle Kanban
// (`build-kanban-data.ts` sigue leyendo el modelo viejo y no es de esta
// parte) — reemplaza a la vieja cuando "Alta del caso" (Ola 1) termine su
// wizard y S1 se pueda ocultar.
//
// Diseño (ws1-t3): misma tabla, mismas columnas y mismo destino al pulsar.
// El nombre es ahora un enlace de verdad (se llega con Tab y se abre con
// Enter), los importes van alineados a la derecha y, en el teléfono, cada
// paciente pasa a ser una tarjeta en vez de una tabla que se desliza. Los
// `role` van escritos porque, pintada como tarjetas, algunos lectores de
// pantalla dejan de leerla como tabla.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, SearchX, Users } from "lucide-react";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { fechaEnZona } from "@/components/specialties/orthodontics/modulo/fechas";
import { Vacio } from "@/components/specialties/orthodontics/modulo/piezas";
import { AbrirCasoBoton } from "@/components/specialties/orthodontics/modulo/abrir-caso";
import s from "@/components/specialties/orthodontics/modulo/modulo.module.css";

export interface OrthoPacienteRow {
  planId: string;
  patientId: string;
  patientName: string;
  treatingDoctorName: string | null;
  status: "PLANNED" | "IN_PROGRESS" | "ON_HOLD" | "RETENTION" | "COMPLETED" | "DROPPED_OUT";
  overdueAmountMxn: number;
  nextDueDate: string | null;
}

const STATUS_LABEL: Record<OrthoPacienteRow["status"], string> = {
  PLANNED: "Planeado",
  IN_PROGRESS: "En curso",
  ON_HOLD: "Pausado",
  RETENTION: "Retención",
  COMPLETED: "Completado",
  DROPPED_OUT: "Abandono",
};

const STATUS_TONE: Record<OrthoPacienteRow["status"], "success" | "brand" | "warning" | "info" | "neutral" | "danger"> = {
  PLANNED: "brand",
  IN_PROGRESS: "success",
  ON_HOLD: "warning",
  RETENTION: "info",
  COMPLETED: "neutral",
  DROPPED_OUT: "danger",
};

function fmtMoney(n: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(n);
}

// Fecha de calendario ("YYYY-MM-DD"): se pinta tal cual, sin zona horaria.
const fmtDate = (iso: string | null) => fechaEnZona(iso, null);

export function OrthoPacientesTable({
  rows,
  puedeAbrirCaso = false,
}: {
  rows: OrthoPacienteRow[];
  /** `medicalRecord.edit`, decidido en el servidor: sin él no sale «Abrir caso». */
  puedeAbrirCaso?: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.patientName.toLowerCase().includes(q));
  }, [rows, query]);

  if (rows.length === 0) {
    return (
      <Vacio
        alto
        icono={Users}
        titulo="Aún no hay pacientes en tratamiento"
        pista={
          puedeAbrirCaso
            ? "Pulsa «Abrir caso» y elige al paciente: se abre su ficha con el formulario del caso. En cuanto esté activo, aparece aquí con su saldo y su próxima mensualidad."
            : "Un caso lo abre el doctor desde la ficha del paciente, en su pestaña Ortodoncia. En cuanto esté activo, aparece aquí con su saldo y su próxima mensualidad."
        }
      >
        {puedeAbrirCaso && <AbrirCasoBoton />}
        <Link href="/dashboard/patients" className={s.boton}>
          <Users size={15} strokeWidth={1.9} aria-hidden />
          Ir a Pacientes
        </Link>
      </Vacio>
    );
  }

  return (
    <section className={s.tarjeta} aria-label="Pacientes en tratamiento">
      <div className={s.barraHerramientas}>
        <div className={s.buscador}>
          <Search size={15} strokeWidth={1.9} aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar paciente…"
            aria-label="Buscar paciente"
            className={s.buscadorEntrada}
          />
        </div>
        <span className={s.conteo} role="status">
          {filtered.length === rows.length
            ? `${rows.length} paciente${rows.length === 1 ? "" : "s"}`
            : `${filtered.length} de ${rows.length}`}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className={s.tarjetaCuerpo}>
          <Vacio
            icono={SearchX}
            tono="neutro"
            titulo={`Ningún paciente coincide con «${query.trim()}»`}
            pista="Se busca por nombre, entre los casos activos."
          >
            <ButtonNew type="button" variant="secondary" size="sm" onClick={() => setQuery("")}>
              Limpiar búsqueda
            </ButtonNew>
          </Vacio>
        </div>
      ) : (
        <div className={s.tablaCaja}>
          <table className={s.tabla} role="table">
            <thead role="rowgroup">
              <tr role="row">
                <th scope="col" role="columnheader">Paciente</th>
                <th scope="col" role="columnheader">Estado</th>
                <th scope="col" role="columnheader" className={s.num}>Saldo vencido</th>
                <th scope="col" role="columnheader" className={s.num}>Próxima mensualidad</th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {filtered.map((r) => {
                const href = `/dashboard/patients/${r.patientId}?tab=ortodoncia`;
                return (
                  <tr key={r.planId} role="row" onClick={() => router.push(href)}>
                    <td role="cell">
                      <div className={s.paciente}>
                        <AvatarNew name={r.patientName} size="sm" />
                        <div className={s.pacienteTextos}>
                          <Link href={href} className={s.nombre} onClick={(e) => e.stopPropagation()}>
                            {r.patientName}
                          </Link>
                          {r.treatingDoctorName && <div className={s.detalle}>{r.treatingDoctorName}</div>}
                        </div>
                      </div>
                    </td>
                    <td role="cell" className={s.estado} data-etiqueta="Estado">
                      <BadgeNew tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</BadgeNew>
                    </td>
                    <td role="cell" className={s.num} data-etiqueta="Saldo vencido">
                      {r.overdueAmountMxn > 0 ? (
                        <span className={`${s.importe} ${s.importePeligro}`}>{fmtMoney(r.overdueAmountMxn)}</span>
                      ) : (
                        <span className={`${s.importe} ${s.importeApagado}`}>Al día</span>
                      )}
                    </td>
                    <td role="cell" className={s.num} data-etiqueta="Próxima mensualidad">
                      {fmtDate(r.nextDueDate)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
