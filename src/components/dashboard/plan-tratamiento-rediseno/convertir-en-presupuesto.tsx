"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, FileText, X } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { useT } from "@/i18n/i18n-provider";
import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import { useTextosConvertirPresupuesto } from "./textos-convertir-presupuesto";
import s from "./plan.module.css";
import c from "./convertir.module.css";

/**
 * «Convertir en presupuesto» (ws1-t3). Un botón y su vista previa: lee `GET /api/treatments/[id]/presupuesto`
 * (los conceptos que saldrían del plan y, si ya hay un presupuesto vivo del plan, cuál es) y, al confirmar,
 * `POST` crea el borrador. Con uno vivo NO ofrece crear: ofrece abrirlo. Aquí no se calcula nada de dinero:
 * todo viene del servidor, que recalcula al crear.
 */

export interface PresupuestoDelPlan { id: string; folio: string; status: string; total: number; title: string }

interface Concepto {
  name: string; toothFdi: string | null; quantity: number; unitPrice: number; origen: "plan" | "tarifario" | "sinPrecio"; deTarifario: boolean;
}

interface Vista {
  existente: PresupuestoDelPlan | null;
  conceptos: Concepto[];
  total: number;
  sinDetalle: boolean;
  sinPrecio: number;
  sinTarifario: number;
  totalDifiere: boolean;
}

export function ConvertirEnPresupuesto({ planId, planCosto, onAbrirPresupuesto, antigua = false }: {
  planId: string;
  /** Ficha sin el menú nuevo: el botón lleva la ropa de la ventana de siempre (el diálogo es el mismo). */
  antigua?: boolean;
  planCosto: number;
  /** Lleva al presupuesto (el recién creado o el que ya existía). Lo resuelve el contenedor de la ficha. */
  onAbrirPresupuesto: (q: PresupuestoDelPlan) => void;
}) {
  const t = useTextosConvertirPresupuesto();
  const tc = useT();
  const [abierto, setAbierto] = useState(false);
  const [vista, setVista] = useState<Vista | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    let vivo = true;
    setVista(null);
    setError(null);
    fetch(`/api/treatments/${encodeURIComponent(planId)}/presupuesto`)
      .then(async (r) => {
        if (r.status === 403) throw new Error(t.sinPermiso);
        if (!r.ok) throw new Error(t.errorCarga);
        return r.json() as Promise<Vista>;
      })
      .then((v) => { if (vivo) setVista(v); })
      .catch((e: Error) => { if (vivo) setError(e.message || t.errorCarga); });
    return () => { vivo = false; };
  }, [abierto, planId, t.errorCarga, t.sinPermiso]);

  async function crear() {
    if (creando) return;
    setCreando(true);
    setError(null);
    try {
      const r = await fetch(`/api/treatments/${encodeURIComponent(planId)}/presupuesto`, { method: "POST" });
      if (r.status === 403) throw new Error(t.sinPermiso);
      if (!r.ok) throw new Error(t.errorCrear);
      const out = (await r.json()) as { quote: PresupuestoDelPlan };
      setAbierto(false);
      onAbrirPresupuesto(out.quote);
    } catch (e) {
      setError((e as Error).message || t.errorCrear);
    } finally {
      setCreando(false);
    }
  }

  const cerrar = () => { if (!creando) setAbierto(false); };
  const avisos: string[] = [];
  if (vista && !vista.existente) {
    if (vista.sinDetalle) avisos.push(t.avisoSinDetalle);
    if (vista.sinPrecio > 0) avisos.push(t.avisoSinPrecio(vista.sinPrecio));
    if (vista.sinTarifario > 0 && !vista.sinDetalle) avisos.push(t.avisoSinTarifario(vista.sinTarifario));
    if (vista.totalDifiere) avisos.push(t.avisoTotalDifiere(formatCurrency(planCosto)));
  }

  return (
    <>
      <button
        type="button"
        className={antigua
          ? "px-3 h-9 rounded-lg border border-border text-sm font-semibold hover:bg-muted transition-colors focus-visible:outline-none focus-visible:shadow-[var(--ring)] inline-flex items-center gap-1.5"
          : s.boton}
        onClick={() => setAbierto(true)}
      >
        <FileText size={14} strokeWidth={1.75} aria-hidden /> {t.boton}
      </button>

      {abierto && (
        <div className={`${CLASES_MENU} ${s.velo}`} onClick={cerrar}>
          <div className={`${s.caja} ${s.cajaAngosta}`} role="dialog" aria-modal="true" aria-labelledby="plan-convertir-titulo" onClick={(e) => e.stopPropagation()}>
            <header className={s.cabecera}>
              <span className={s.cabeceraIcono}><FileText size={17} strokeWidth={1.75} aria-hidden /></span>
              <div className={s.cabeceraTextos}><h3 id="plan-convertir-titulo" className={s.titulo}>{t.titulo}</h3></div>
              <button type="button" className={s.cerrar} onClick={cerrar} aria-label={tc("common.close")}>
                <X size={15} strokeWidth={2} aria-hidden />
              </button>
            </header>

            <div className={s.cuerpo}>
              <div className={c.espacio}>
                {!vista && !error && <div className={s.vacio}>{t.cargando}</div>}
                {error && <div className={s.error} role="alert">{error}</div>}

                {vista?.existente && (
                  <div className={c.ya}>
                    <div className={c.yaTitulo}>{t.yaTitulo(vista.existente.folio, t.estado[vista.existente.status] ?? vista.existente.status.toLowerCase())}</div>
                    <div className={c.yaTexto}>{t.yaTexto}</div>
                  </div>
                )}

                {vista && !vista.existente && (
                  <>
                    <div className={c.pista}>{t.intro}</div>
                    <div className={c.tabla} role="table">
                      <div className={`${c.fila} ${c.encabezado}`} role="row">
                        <span role="columnheader">{t.colConcepto}</span>
                        <span role="columnheader">{t.colDientes}</span>
                        <span role="columnheader" className={c.num}>{t.colCant}</span>
                        <span role="columnheader" className={c.num}>{t.colPrecio}</span>
                        <span role="columnheader" className={c.num}>{t.colImporte}</span>
                      </div>
                      {vista.conceptos.map((k, i) => (
                        <div key={i} className={c.fila} role="row">
                          <span className={c.nombre} role="cell">{k.name}</span>
                          <span className={c.apagado} role="cell">{k.toothFdi ? k.toothFdi.split(",").join(", ") : "—"}</span>
                          <span className={c.num} role="cell">{k.quantity}</span>
                          <span className={`${c.num} ${k.unitPrice > 0 ? "" : c.sinPrecio}`} role="cell">
                            {k.unitPrice > 0 ? formatCurrency(k.unitPrice) : t.sinPrecio}
                          </span>
                          <span className={c.num} role="cell">{formatCurrency(k.unitPrice * k.quantity)}</span>
                        </div>
                      ))}
                      <div className={`${c.fila} ${c.total}`} role="row">
                        <span className={c.nombre} role="cell">{t.total}</span>
                        <span role="cell" /><span role="cell" /><span role="cell" />
                        <span className={c.num} role="cell">{formatCurrency(vista.total)}</span>
                      </div>
                    </div>
                    {avisos.length > 0 && (
                      <ul className={s.avisos} style={{ marginTop: 0 }}>
                        {avisos.map((a) => (
                          <li key={a} className={s.aviso}><AlertTriangle size={14} strokeWidth={1.75} aria-hidden /> {a}</li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
            </div>

            <footer className={s.pie}>
              <button type="button" className={s.boton} onClick={cerrar} disabled={creando}>
                {vista?.existente ? t.cerrar : t.cancelar}
              </button>
              {vista?.existente && (
                <button type="button" className={`${s.boton} ${s.botonPrincipal}`} onClick={() => { setAbierto(false); onAbrirPresupuesto(vista.existente!); }}>
                  {t.abrir(vista.existente.folio)}
                </button>
              )}
              {vista && !vista.existente && (
                <button type="button" className={`${s.boton} ${s.botonPrincipal}`} onClick={crear} disabled={creando}>
                  {creando ? t.creando : t.crear}
                </button>
              )}
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
