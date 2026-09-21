// Server component: sin estado, sin handlers, sin "use client".
//
// «Quién está trabajando» — la otra mitad de la portada. La sección de arriba
// contesta qué se está rompiendo; ésta, cuánto ha hecho cada clínica. Una
// puede no tener ni una alarma y llevar tres semanas sin abrir una ficha.
//
// Tres números por clínica y no uno (citas · facturas · notas) porque juntos
// distinguen a la que trabaja de la que entra a mirar: 116 citas con 1 factura
// es una agenda llena que no cobra; 4 citas con 5 facturas es alguien poniéndose
// al día con lo viejo. Un solo contador los confundiría.
import Link from "next/link";
import { ArrowDown, ArrowUp, Minus, Activity } from "lucide-react";
import { DIAS_ACTIVIDAD, totalActividad, type FilaActividad } from "./atencion-core";
import { fechaHoraAdmin } from "@/lib/admin/zona-horaria";
import "./portada.css";

/** Cuántas clínicas se listan antes del «y N más». */
const FILAS_VISIBLES = 8;

/**
 * El punto de «en línea». Discreto a propósito: es una señal de contexto, no
 * una métrica, y no compite con las alarmas de arriba. Lleva `title` y texto
 * para lector de pantalla porque un punto de color, solo, no es información.
 */
export function PuntoEnLinea({ visto }: { visto?: Date | null }) {
  return (
    <span
      className="pa-online"
      title={visto ? `En el panel ahora · visto ${fechaHoraAdmin(visto)}` : "En el panel ahora"}
    >
      <span className="pa-online__dot" aria-hidden />
      <span className="pa-sr">en línea</span>
    </span>
  );
}

/** Flecha + porcentaje contra la ventana anterior. */
function Tendencia({ pct }: { pct: number | null }) {
  // `null` = la ventana anterior fue 0. De cero a algo no es un porcentaje,
  // es un arranque, y decir «+∞ %» o «+100 %» sería inventarse una cifra.
  if (pct === null) {
    return <span className="pa-tend pa-tend--nuevo">arranca</span>;
  }
  if (pct === 0) {
    return (
      <span className="pa-tend pa-tend--igual">
        <Minus size={11} strokeWidth={2.5} aria-hidden /> igual
      </span>
    );
  }
  const sube = pct > 0;
  return (
    <span className={`pa-tend ${sube ? "pa-tend--sube" : "pa-tend--baja"}`}>
      {sube
        ? <ArrowUp size={11} strokeWidth={2.5} aria-hidden />
        : <ArrowDown size={11} strokeWidth={2.5} aria-hidden />}
      {Math.abs(pct)}%
    </span>
  );
}

function Celda({ n, unidad }: { n: number; unidad: string }) {
  return (
    <td className="pa-act__num">
      {/* El cero se apaga para que la vista salte sola a lo que sí tiene
          movimiento; sigue siendo un 0 legible, no un hueco. */}
      <span className={n === 0 ? "pa-act__cero" : undefined}>{n}</span>
      <span className="pa-sr"> {unidad}</span>
    </td>
  );
}

export function ActividadPanel({ filas, enLinea }: { filas: FilaActividad[]; enLinea: number }) {
  const visibles = filas.slice(0, FILAS_VISIBLES);
  const restantes = filas.slice(FILAS_VISIBLES);
  const ocultas = restantes.length;
  // Se MIDE cuántas de las ocultas tienen movimiento en vez de darlo por hecho:
  // la lista va ordenada de más a menos, pero con más de 8 clínicas activas la
  // frase "todas sin movimiento" sería falsa.
  const ocultasActivas = restantes.filter((f) => totalActividad(f.actividad) > 0).length;
  const conMovimiento = filas.filter((f) => totalActividad(f.actividad) > 0).length;

  return (
    <div className="pa-act">
      <div className="pa-act__head">
        <div className="pa-act__titles">
          <span className="pa-act__title">Actividad de los últimos {DIAS_ACTIVIDAD} días</span>
          <span className="pa-act__sub">
            Citas, facturas y notas clínicas, contra los {DIAS_ACTIVIDAD} días anteriores.
          </span>
        </div>
        <div className="pa-act__resumen">
          <span className="pa-num">{conMovimiento}</span>
          <span className="pa-act__resumen-label">
            {conMovimiento === 1 ? "clínica con movimiento" : "clínicas con movimiento"}
          </span>
          {enLinea > 0 && (
            <span className="pa-act__enlinea">
              <span className="pa-online__dot" aria-hidden />
              <span className="pa-num">{enLinea}</span> en línea ahora
            </span>
          )}
        </div>
      </div>

      {filas.length === 0 ? (
        <div className="pa-act__vacio">
          No hay ninguna clínica que medir: todas las cuentas están apartadas como de prueba
          o archivadas.
        </div>
      ) : (
        <div className="pa-scroll-x">
          <table className="table-new pa-act__tabla">
            <thead>
              <tr>
                <th>Clínica</th>
                <th className="pa-act__th-num">Citas</th>
                <th className="pa-act__th-num">Facturas</th>
                <th className="pa-act__th-num">Notas</th>
                <th className="pa-act__th-num">Total</th>
                <th className="pa-act__th-num">vs. {DIAS_ACTIVIDAD} d antes</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((f) => (
                <tr key={f.id}>
                  <td>
                    <span className="pa-act__nombre">
                      <Link href={`/admin/clinics/${f.id}`} className="pa-act__link">
                        {f.nombre}
                      </Link>
                      {f.enLinea && <PuntoEnLinea visto={f.ultimoAcceso} />}
                    </span>
                  </td>
                  <Celda n={f.actividad.citas} unidad="citas" />
                  <Celda n={f.actividad.facturas} unidad="facturas" />
                  <Celda n={f.actividad.notas} unidad="notas" />
                  <td className="pa-act__num pa-act__num--total">{totalActividad(f.actividad)}</td>
                  <td className="pa-act__num">
                    <Tendencia pct={f.cambioPct} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {ocultas > 0 && (
        <div className="pa-act__mas">
          <Activity size={12} aria-hidden /> y {ocultas}{" "}
          {ocultas === 1 ? "clínica más" : "clínicas más"}
          {ocultasActivas === 0
            ? `, ninguna con movimiento en ${DIAS_ACTIVIDAD} días`
            : `, ${ocultasActivas} con movimiento`}
        </div>
      )}
    </div>
  );
}
