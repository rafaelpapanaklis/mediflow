"use client";
// Pestaña Ortodoncia de la ficha — «Casos de este paciente» (ws1-t8). Solo sale
// cuando el paciente tiene más de un caso (uno viejo terminado o abandonado y
// uno nuevo): una fila corta para cambiar entre ellos. El activo es el que se
// ve por defecto; los demás se piden con `?caso=`.
//
// Son enlaces de verdad (Tab y Enter, o abrir en otra pestaña): cambiar de caso
// vuelve a leer la ficha en el servidor, con los datos de ESE caso.
import Link from "next/link";
import {
  PARAMETRO_CASO,
  casoPorDefecto,
  opcionesDeCasos,
  type CasoDelPaciente,
} from "@/lib/orthodontics/casos-del-paciente";
import s from "./modulo.module.css";

export function SelectorDeCasos({
  patientId,
  casos,
  actualId,
}: {
  patientId: string;
  casos: readonly CasoDelPaciente[];
  /** El caso que la ficha está enseñando ahora. */
  actualId: string | null;
}) {
  if (casos.length < 2) return null;
  const porDefecto = casoPorDefecto(casos);
  const opciones = opcionesDeCasos(casos, actualId);
  return (
    <nav className={s.selectorCasos} aria-label="Casos de este paciente">
      <span className={s.selectorCasosTitulo}>Casos de este paciente</span>
      {opciones.map((o) => (
        <Link
          key={o.id}
          // El caso activo por defecto va sin `?caso=`: así la dirección queda limpia.
          href={`/dashboard/patients/${encodeURIComponent(patientId)}?tab=ortodoncia${
            o.id === porDefecto ? "" : `&${PARAMETRO_CASO}=${encodeURIComponent(o.id)}`
          }`}
          scroll={false}
          aria-current={o.actual ? "true" : undefined}
          className={o.actual ? `${s.casoOpcion} ${s.casoOpcionActivo}` : s.casoOpcion}
        >
          {o.etiqueta}
        </Link>
      ))}
    </nav>
  );
}
