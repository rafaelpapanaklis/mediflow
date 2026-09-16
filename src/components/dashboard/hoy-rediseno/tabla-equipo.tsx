"use client";

/**
 * Rendimiento del equipo (admin), con el diseño nuevo. La misma tabla
 * ordenable que `home/parts/team-performance-table.tsx`: doctor, citas,
 * % completadas con su barra e ingresos. Solo cambia la ropa.
 */

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import type { HomeAdminTeamRow } from "@/lib/home/types";
import { Iniciales } from "./piezas";
import s from "./hoy.module.css";

type Columna = "doctorName" | "appointments" | "completionPct" | "revenueMXN";
type Sentido = "asc" | "desc";

const mxn = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });

export function TablaEquipo({ filas }: { filas: HomeAdminTeamRow[] }) {
  const t = useT();
  const [columna, setColumna] = useState<Columna>("revenueMXN");
  const [sentido, setSentido] = useState<Sentido>("desc");

  const ordenadas = useMemo(() => {
    const copia = [...filas];
    copia.sort((a, b) => {
      const av = a[columna];
      const bv = b[columna];
      const cmp =
        typeof av === "string" && typeof bv === "string"
          ? av.localeCompare(bv, "es-MX")
          : (av as number) - (bv as number);
      return sentido === "asc" ? cmp : -cmp;
    });
    return copia;
  }, [filas, columna, sentido]);

  const ordenar = (c: Columna) => {
    if (columna === c) {
      setSentido((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setColumna(c);
      setSentido(c === "doctorName" ? "asc" : "desc");
    }
  };

  const cabecera = (texto: string, c: Columna, derecha?: boolean) => {
    const activa = columna === c;
    const Icono = activa ? (sentido === "asc" ? ChevronUp : ChevronDown) : ChevronsUpDown;
    return (
      <th
        scope="col"
        className={derecha ? s.num : undefined}
        aria-sort={activa ? (sentido === "asc" ? "ascending" : "descending") : "none"}
      >
        <button
          type="button"
          onClick={() => ordenar(c)}
          className={`${s.ordenar} ${derecha ? s.ordenarDerecha : ""} ${activa ? s.ordenarActivo : ""}`}
        >
          {texto}
          <Icono size={11} strokeWidth={1.75} aria-hidden />
        </button>
      </th>
    );
  };

  return (
    <div className={s.tablaCaja}>
      <table className={s.tabla}>
        <thead>
          <tr>
            {cabecera(t("home.teamPerf.colDoctor"), "doctorName")}
            {cabecera(t("home.teamPerf.colAppointments"), "appointments", true)}
            {cabecera(t("home.teamPerf.colCompletedPct"), "completionPct", true)}
            {cabecera(t("home.teamPerf.colRevenue"), "revenueMXN", true)}
          </tr>
        </thead>
        <tbody>
          {ordenadas.map((r) => (
            <tr key={r.userId}>
              <td>
                <div className={s.celdaDoctor}>
                  <Iniciales nombre={r.doctorName} peq />
                  <span>{r.doctorName}</span>
                </div>
              </td>
              <td className={s.num}>{r.appointments}</td>
              <td className={s.num}>
                <Progreso pct={r.completionPct} />
              </td>
              <td className={s.num}>{mxn.format(r.revenueMXN)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Progreso({ pct }: { pct: number }) {
  // Mismos umbrales que hoy: <60 peligro, <75 alerta, ≥90 éxito.
  let tono = s.tonoNormal;
  let fondo = s.fondoNormal;
  if (pct < 75) { tono = s.tonoAlerta; fondo = s.fondoAlerta; }
  if (pct < 60) { tono = s.tonoPeligro; fondo = s.fondoPeligro; }
  if (pct >= 90) { tono = s.tonoExito; fondo = s.fondoExito; }
  return (
    <span className={s.progreso}>
      <span aria-hidden className={s.progresoBarra}>
        <span
          className={`${s.progresoRelleno} ${fondo}`}
          style={{ display: "block", width: `${Math.max(0, Math.min(100, pct))}%` }}
        />
      </span>
      <span className={`${s.progresoTexto} ${tono}`}>{pct}%</span>
    </span>
  );
}
