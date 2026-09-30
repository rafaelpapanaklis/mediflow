"use client";
// Sección — «Plan de tratamiento» (ws1-t12): el plan COMPLETO del caso, de un vistazo. Arriba, cuatro cifras
// que importan (duración, controles, anclaje, extracciones); debajo, una tarjeta por cada grupo con lo que se
// eligió (aditamentos, control radiográfico, aparatología, tubos-bandas-cementación, interconsultas) y, al
// final, una línea discreta con lo que falta por definir. Nada vacío ocupa una tarjeta.
//
// Lo que ya tenía el caso (duración, anclaje general, extracciones indicadas) se ve aquí junto a lo nuevo; nada
// se duplica. Lo conectado también se ve: «Controles: 5 de 18», los TAD registrados y, si toca, la
// reevaluación radiográfica.

import type { ReactNode } from "react";
import { AlertTriangle, Check, ClipboardList, Pencil, ScanLine } from "lucide-react";
import { Btn, Card } from "../atoms";
import { ProgressBar } from "../atoms/ProgressBar";
import {
  CAMPOS_DE_UNA_OPCION,
  anclajeGeneralComoDato,
  esAditamentoConTads,
  esPlanDetalleVacio,
  etiquetaDeAnclaje,
  etiquetaDeRadiografia,
  fechaCorta,
  progresoDeControles,
  textoControlQueSigue,
  textoDeReevaluacion,
  type PlanDeTratamientoVista,
} from "@/lib/orthodontics/plan-detalle";
import c from "../plan-tratamiento.module.css";

export interface SectionPlanDeTratamientoProps {
  vista: PlanDeTratamientoVista;
  /** Sin esto no hay «Editar plan» (solo lectura, o sin permiso). */
  onEditar?: () => void;
}

const plural = (n: number, uno: string, varios: string): string => `${n} ${n === 1 ? uno : varios}`;

export function SectionPlanDeTratamiento({ vista, onEditar }: SectionPlanDeTratamientoProps) {
  const d = vista.detalle;
  const progreso = d.controlesPrevistos ? progresoDeControles(vista.controlesHechos, d.controlesPrevistos) : null;
  const indicadas = vista.extraccionesIndicadas;
  const hechas = indicadas.filter((p) => d.extraccionesRealizadas.includes(p));
  const extraRealizadas = d.extraccionesRealizadas.filter((p) => !indicadas.includes(p));

  const aditamentos = [...d.aditamentos];
  if (vista.tads > 0 && !aditamentos.some(esAditamentoConTads)) aditamentos.push("Microtornillos (TAD)");
  const hayRadiografico = d.controlRadiografico.length > 0 || d.periodicidadMeses !== null || d.reevaluacion !== null;
  const hayAparatologia = d.brackets.length + d.alineadores.length + d.placas.length > 0 || d.alineadoresTotales !== null;
  const hayTubos = CAMPOS_DE_UNA_OPCION.some((x) => Boolean(d[x.campo]));
  const hayCementacion = Boolean(d.cementacionSuperiorAnterior || d.cementacionSuperiorPosterior || d.cementacionInferiorAnterior || d.cementacionInferiorPosterior);
  const hayTubosOBandas = Boolean(d.tubosSuperiores || d.tubosInferiores || d.bandasSuperiores || d.bandasInferiores);

  const sinDefinir = [
    aditamentos.length === 0 ? "aditamentos" : null,
    !hayRadiografico ? "control radiográfico" : null,
    !hayAparatologia ? "aparatología" : null,
    !hayTubos ? "tubos, bandas y cementación" : null,
    !d.interconsultas ? "interconsultas" : null,
  ].filter((x): x is string => x !== null);

  return (
    <Card
      id="plan-de-tratamiento"
      icon={<ClipboardList size={15} strokeWidth={1.75} />}
      title="Plan de tratamiento"
      eyebrow="Lo planeado para el caso: tiempo y controles, anclaje, aditamentos, extracciones, radiografías, aparatología e interconsultas"
      action={
        onEditar ? (
          <Btn variant="secondary" size="sm" icon={<Pencil size={14} strokeWidth={1.75} aria-hidden />} onClick={onEditar}>
            {hayDatos(vista) ? "Editar plan" : "Completar plan"}
          </Btn>
        ) : undefined
      }
    >
      <div className={c.resumen}>
        {!vista.columna ? (
          <div className={c.aviso} role="status">
            <AlertTriangle size={15} strokeWidth={1.75} aria-hidden />
            <span>Falta pegar sql/ortodoncia-plan-de-tratamiento.sql para poder guardar el plan completo. Mientras, se ve lo que el caso ya tenía.</span>
          </div>
        ) : null}

        {vista.reevaluaciones.length > 0 ? (
          <div className={c.aviso} role="status">
            <ScanLine size={15} strokeWidth={1.75} aria-hidden />
            <span>
              <strong>Toca la reevaluación radiográfica:</strong> {vista.reevaluaciones.map(textoDeReevaluacion).join(" · ")}.
            </span>
          </div>
        ) : null}

        {/* ── Las cuatro cifras ─────────────────────────────────── */}
        <div className={c.kpis}>
          <Kpi etiqueta="Duración" vacio={vista.duracionMeses ? null : "Sin definir"}>
            {vista.duracionMeses ? (
              <div className={c.kpiValor}>
                {vista.duracionMeses} <small>{vista.duracionMeses === 1 ? "mes" : "meses"}</small>
              </div>
            ) : null}
          </Kpi>

          <Kpi etiqueta="Controles" vacio={progreso ? null : "Sin definir"}>
            {progreso ? (
              <>
                <div className={c.kpiValor}>
                  {progreso.hechos} <small>de {progreso.previstos}</small>
                </div>
                <ProgressBar value={progreso.pct ?? 0} color={progreso.excedido ? "amber" : "violet"} className="mt-[8px]" ariaLabel={`Controles: ${progreso.hechos} de ${progreso.previstos}`} />
                <div className={c.kpiSub}>
                  {progreso.completo ? (progreso.excedido ? `Ya pasó de los ${progreso.previstos} previstos` : "Controles completos") : `Sigue el ${textoControlQueSigue(progreso).toLowerCase()}`}
                </div>
              </>
            ) : null}
          </Kpi>

          <Kpi etiqueta="Anclaje" vacio={d.anclajeSuperior || d.anclajeInferior || anclajeGeneralComoDato(vista.anchorageType) ? null : "Sin capturar"}>
            {d.anclajeSuperior || d.anclajeInferior ? (
              <div className={c.kpiPildoras}>
                {/* Solo la arcada que se definió: nada de «Inf. —». */}
                {d.anclajeSuperior ? <Pildora etiqueta="Sup." valor={etiquetaDeAnclaje(d.anclajeSuperior)} /> : null}
                {d.anclajeInferior ? <Pildora etiqueta="Inf." valor={etiquetaDeAnclaje(d.anclajeInferior)} /> : null}
              </div>
            ) : anclajeGeneralComoDato(vista.anchorageType) ? (
              <div className={c.kpiPildoras}>
                <Pildora etiqueta="General" valor={anclajeGeneralComoDato(vista.anchorageType)!} />
                <div className={c.kpiSub}>Aún sin el detalle por arcada.</div>
              </div>
            ) : null}
          </Kpi>

          <Kpi etiqueta="Extracciones" vacio={indicadas.length > 0 || d.extraccionesRealizadas.length > 0 ? null : vista.extraccionesRequired ? "Indicadas, sin piezas" : "Ninguna"}>
            {indicadas.length > 0 || d.extraccionesRealizadas.length > 0 ? (
              <>
                <div className={c.kpiValor}>
                  {hechas.length} <small>de {indicadas.length} hechas</small>
                </div>
                <div className={c.chips} style={{ marginTop: 8 }}>
                  {indicadas.map((p) => {
                    const hecha = d.extraccionesRealizadas.includes(p);
                    return (
                      <span key={p} className={`${c.pildora} ${hecha ? c.pildoraExito : c.pildoraNeutra}`} title={hecha ? "Realizada" : "Indicada, pendiente"} aria-label={`Pieza ${p}: ${hecha ? "realizada" : "pendiente"}`} style={{ fontVariantNumeric: "tabular-nums" }}>
                        {hecha ? <Check size={12} strokeWidth={2.6} aria-hidden /> : null}
                        {p}
                      </span>
                    );
                  })}
                  {extraRealizadas.map((p) => (
                    <span key={`x${p}`} className={`${c.pildora} ${c.pildoraExito}`} title="Realizada (no estaba indicada)" style={{ fontVariantNumeric: "tabular-nums" }}>
                      <Check size={12} strokeWidth={2.6} aria-hidden />
                      {p}
                    </span>
                  ))}
                </div>
              </>
            ) : null}
          </Kpi>
        </div>

        {/* ── Un grupo por tarjeta, solo si tiene algo ─────────── */}
        {aditamentos.length > 0 ? (
          <Grupo titulo="Aditamentos">
            <Chips valores={aditamentos} />
            {vista.tads > 0 ? <div className={c.kpiSub}>{plural(vista.tads, "TAD registrado", "TAD registrados")} en «Mecánicas auxiliares».</div> : d.aditamentos.some(esAditamentoConTads) ? <div className={c.kpiSub}>Aún no hay TAD registrados en «Mecánicas auxiliares».</div> : null}
          </Grupo>
        ) : null}

        {hayRadiografico ? (
          <Grupo titulo="Control radiográfico">
            {d.controlRadiografico.length > 0 ? <Chips valores={d.controlRadiografico.map(etiquetaDeRadiografia)} /> : null}
            {d.periodicidadMeses || d.reevaluacion ? (
              <div className={c.chips} style={{ marginTop: d.controlRadiografico.length > 0 ? 8 : 0 }}>
                {d.periodicidadMeses ? <span className={c.pildora}>Cada {plural(d.periodicidadMeses, "mes", "meses")}</span> : null}
                {d.reevaluacion ? <span className={c.pildora}>Reevaluación · {fechaCorta(d.reevaluacion)}</span> : null}
              </div>
            ) : null}
          </Grupo>
        ) : null}

        {hayAparatologia ? (
          <Grupo titulo="Aparatología" ancho>
            {d.brackets.length > 0 ? (
              <div className={c.subgrupo}>
                <span className={c.subgrupoEtq}>Brackets</span>
                <Chips valores={d.brackets} />
              </div>
            ) : null}
            {d.alineadores.length > 0 || d.alineadoresTotales ? (
              <div className={c.subgrupo}>
                <span className={c.subgrupoEtq}>Alineadores</span>
                <div className={c.chips}>
                  {d.alineadores.map((x) => (
                    <span key={x} className={c.pildora}>{x}</span>
                  ))}
                  {d.alineadoresTotales ? (
                    <span className={`${c.pildora} ${c.pildoraNeutra}`}>
                      Serie de {d.alineadoresTotales}
                      {vista.conSeguimientoDeAlineadores ? " · del seguimiento" : ""}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}
            {d.placas.length > 0 ? (
              <div className={c.subgrupo}>
                <span className={c.subgrupoEtq}>Placas</span>
                <Chips valores={d.placas} />
              </div>
            ) : null}
          </Grupo>
        ) : null}

        {hayTubos ? (
          <Grupo titulo="Tubos, bandas y cementación" ancho>
            {hayTubosOBandas ? (
              <TablaMini
                columnas={[
                  { titulo: "Superior", tiene: Boolean(d.tubosSuperiores || d.bandasSuperiores) },
                  { titulo: "Inferior", tiene: Boolean(d.tubosInferiores || d.bandasInferiores) },
                ]}
                filas={[
                  { titulo: "Tubos", valores: [d.tubosSuperiores, d.tubosInferiores] },
                  { titulo: "Bandas", valores: [d.bandasSuperiores, d.bandasInferiores] },
                ]}
                cabeceraDeFilas=""
                separado={hayCementacion}
              />
            ) : null}
            {hayCementacion ? (
              <TablaMini
                columnas={[
                  { titulo: "Anterior", tiene: Boolean(d.cementacionSuperiorAnterior || d.cementacionInferiorAnterior) },
                  { titulo: "Posterior", tiene: Boolean(d.cementacionSuperiorPosterior || d.cementacionInferiorPosterior) },
                ]}
                filas={[
                  { titulo: "Superior", valores: [d.cementacionSuperiorAnterior, d.cementacionSuperiorPosterior] },
                  { titulo: "Inferior", valores: [d.cementacionInferiorAnterior, d.cementacionInferiorPosterior] },
                ]}
                cabeceraDeFilas="Cementación"
              />
            ) : null}
          </Grupo>
        ) : null}

        {d.interconsultas ? (
          <Grupo titulo="Interconsultas" ancho>
            <p className={c.cita}>{d.interconsultas}</p>
          </Grupo>
        ) : null}

        {sinDefinir.length > 0 ? (
          <p className={c.sinDefinir}>
            {hayDatos(vista) ? "Sin definir: " : "Aún nada anotado en: "}
            {sinDefinir.join(", ")}.
          </p>
        ) : null}
      </div>
    </Card>
  );
}

/** ¿El plan tiene algo más que lo que el caso traía de siempre? Decide «Editar plan» o «Completar plan». */
function hayDatos(v: PlanDeTratamientoVista): boolean {
  return !esPlanDetalleVacio(v.detalle);
}

function Kpi({ etiqueta, vacio, children }: { etiqueta: string; vacio: string | null; children?: ReactNode }) {
  return (
    <div className={`${c.kpi} ${vacio ? c.kpiVacio : ""}`}>
      <div className={c.datoEtiqueta}>{etiqueta}</div>
      {vacio ? <div className={c.kpiVacioValor}>{vacio}</div> : children}
    </div>
  );
}

function Grupo({ titulo, ancho, children }: { titulo: string; ancho?: boolean; children: ReactNode }) {
  return (
    <div className={`${c.tarjetaPlan} ${ancho ? c.tarjetaPlanAncha : ""}`}>
      <h4 className={c.tarjetaPlanTitulo}>{titulo}</h4>
      {children}
    </div>
  );
}

function Chips({ valores }: { valores: readonly string[] }) {
  return (
    <div className={c.chips}>
      {valores.map((x) => (
        <span key={x} className={c.pildora}>{x}</span>
      ))}
    </div>
  );
}

function Pildora({ etiqueta, valor, apagada }: { etiqueta: string; valor: string; apagada?: boolean }) {
  return (
    <span className={`${c.pildora} ${apagada ? c.pildoraNeutra : ""}`}>
      <span className={c.pildoraEtq}>{etiqueta}</span>
      {valor}
    </span>
  );
}

/**
 * Tabla chica de dos columnas (superior/inferior o anterior/posterior) que solo dibuja lo que tiene dato:
 * la columna sin ningún valor y la fila sin ninguno no salen, y la celda vacía queda en blanco (nada de «—»).
 */
function TablaMini({
  columnas,
  filas,
  cabeceraDeFilas,
  separado,
}: {
  columnas: [{ titulo: string; tiene: boolean }, { titulo: string; tiene: boolean }];
  filas: Array<{ titulo: string; valores: [string | null, string | null] }>;
  cabeceraDeFilas: string;
  separado?: boolean;
}) {
  const idx = [0, 1].filter((i) => columnas[i].tiene);
  const conDato = filas.filter((f) => idx.some((i) => f.valores[i]));
  if (idx.length === 0 || conDato.length === 0) return null;
  return (
    <div className={c.tablaMini} style={{ gridTemplateColumns: `auto repeat(${idx.length}, minmax(0, 1fr))`, marginBottom: separado ? 12 : 0 }}>
      <span className={c.tablaMiniCab}>{cabeceraDeFilas}</span>
      {idx.map((i) => (
        <span key={columnas[i].titulo} className={c.tablaMiniCab}>{columnas[i].titulo}</span>
      ))}
      {conDato.map((f) => (
        <span key={f.titulo} className="contents">
          <span className={c.tablaMiniFila}>{f.titulo}</span>
          {idx.map((i) => (
            <span key={i} className={c.tablaMiniValor}>{f.valores[i] ?? ""}</span>
          ))}
        </span>
      ))}
    </div>
  );
}
