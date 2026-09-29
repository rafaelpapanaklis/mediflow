// Módulo de Ortodoncia — «Casos con diagnóstico o plan incompleto» (ws1-t12). La misma lista en Tablero (los
// primeros) y en Alertas (todos): cada fila dice qué falta y lleva un acceso directo al PASO que falta de la
// ventana del caso (`?completar=diagnostico|plan` abre la ficha con esa ventana). Útil sobre todo para los casos
// migrados de Dentalink, que entran casi vacíos. Solo pinta lo que recibe.
import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import type { CasoIncompleto } from "@/lib/orthodontics/casos-incompletos-db";
import { enlaceParaCompletar } from "@/lib/orthodontics/casos-incompletos-ruta";
import s from "./modulo.module.css";

export function FilaDeCasoIncompleto({ caso, puedeEditar }: { caso: CasoIncompleto; puedeEditar: boolean }) {
  const detalle = caso.faltan.map((f) => f.texto).join(" · ");
  const hayDiagnostico = caso.faltan.some((f) => f.paso === "diagnostico");
  const hayPlan = caso.faltan.some((f) => f.paso === "plan");
  return (
    <li className={`${s.fila} ${s.filaApilable}`}>
      <div className={s.filaCuerpo}>
        <Link href={`/dashboard/patients/${caso.patientId}?tab=ortodoncia`} className={`${s.nombre} ${s.nombreEstirado}`}>
          {caso.patientName}
        </Link>
        <div className={s.detalle}>Falta: {detalle}</div>
      </div>
      {puedeEditar ? (
        <div className={s.filaDerecha}>
          {hayDiagnostico ? (
            <Link href={enlaceParaCompletar(caso.patientId, "diagnostico")} className={`${s.boton} ${s.botonPeq}`}>
              <ClipboardCheck size={14} strokeWidth={1.9} aria-hidden />
              Completar diagnóstico
            </Link>
          ) : null}
          {hayPlan ? (
            <Link href={enlaceParaCompletar(caso.patientId, "plan")} className={`${s.boton} ${s.botonPeq}`}>
              <ClipboardCheck size={14} strokeWidth={1.9} aria-hidden />
              Completar plan
            </Link>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
