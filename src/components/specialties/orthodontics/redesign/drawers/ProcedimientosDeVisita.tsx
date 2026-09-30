"use client";
// Ortodoncia — «Procedimientos de esta visita» en la hoja de control.
//
// Editable (borrador / hoja nueva): se eligen del catálogo de ortodoncia ACTIVO
// (el de Configuración y Procedimientos) con su cantidad. Solo se manda QUÉ y
// CUÁNTOS: nombre, precio y si es incluido o con costo aparte los pone el
// servidor desde el catálogo. En solo lectura (hoja firmada, o la pantalla de
// «Control firmado») muestra el estado de cada línea: incluido, por cobrar
// (con «Cobrar» si hay permiso de cobro) o facturado.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { Banknote, Plus, X } from "lucide-react";
import {
  cargarProcedimientosDeHoja,
  cobrarProcedimientoDeHoja,
  type LineaParaVista,
  type ProcedimientoElegible,
} from "@/app/actions/orthodontics/procedimientosDeHoja";
import { isFailure } from "@/app/actions/orthodontics/result";
import { CANTIDAD_MAXIMA } from "@/lib/orthodontics/procedimientos-de-visita";
import { avisoDeProcedimientoFaltante } from "@/lib/orthodontics/plan-detalle";
import { CobrarEnFactura } from "@/components/dashboard/billing/cobrar-en-factura";
import { Btn } from "../atoms/Btn";
import { Pill } from "../atoms/Pill";
import orto from "../orto.module.css";

export interface SeleccionDeProcedimiento {
  procedureId: string;
  quantity: number;
}

const dinero = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });

export interface ProcedimientosDeVisitaProps {
  treatmentPlanId: string;
  /** La hoja (null si todavía no se ha guardado nada). */
  cardId: string | null;
  /** Hoja firmada: se ve el estado de cada línea y se puede cobrar. */
  soloLectura: boolean;
  /** Lo elegido en la hoja abierta (undefined = todavía no se cargó lo guardado). */
  seleccion: SeleccionDeProcedimiento[] | undefined;
  onSeleccion: (s: SeleccionDeProcedimiento[]) => void;
  /** Cambia para forzar una recarga (p. ej. justo después de firmar). */
  recarga?: number;
  /**
   * ws1-t12 — extracciones del plan de tratamiento que se hicieron en ESTA visita (FDI). Se anotan en el plan
   * al firmar la hoja. Sin `onExtracciones` no se ofrece marcarlas.
   */
  extracciones?: number[];
  onExtracciones?: (piezas: number[]) => void;
}

export function ProcedimientosDeVisita(props: ProcedimientosDeVisitaProps) {
  const [catalogo, setCatalogo] = useState<ProcedimientoElegible[]>([]);
  const [lineas, setLineas] = useState<LineaParaVista[]>([]);
  const [puedeCobrar, setPuedeCobrar] = useState(false);
  const [pendientes, setPendientes] = useState<number[]>([]);
  const [faltantes, setFaltantes] = useState<string[]>([]);
  const [cargado, setCargado] = useState(false);
  const [error, setError] = useState(false);
  const [cobrando, setCobrando] = useState<string | null>(null);
  // ws1-t4 (revisión final, fallo 3): «Cobrar» abre la ventana completa de cobro de
  // la factura del procedimiento (como los demás «Cobrar»). `cobrando` sigue puesto
  // hasta que la ventana ya se ve: «Creando la factura…» y luego «Abriendo el cobro…».
  const [ventana, setVentana] = useState<{ invoiceId: string; total: number; rediseno: boolean; clinicTaxMode: string | null } | null>(null);
  const { treatmentPlanId, cardId, soloLectura, seleccion, onSeleccion, recarga, extracciones = [], onExtracciones } = props;

  const cargar = useCallback(async () => {
    try {
      const res = await cargarProcedimientosDeHoja({ treatmentPlanId, cardId });
      if (isFailure(res)) {
        setError(true);
        return;
      }
      setError(false);
      setCatalogo(res.data.catalogo);
      setLineas(res.data.lineas);
      setPuedeCobrar(res.data.puedeCobrar);
      setPendientes(res.data.extraccionesPendientes ?? []);
      setFaltantes(res.data.procedimientosFaltantes ?? []);
      setCargado(true);
      // La primera vez, lo elegido parte de lo que la hoja ya tenía guardado.
      if (!soloLectura && seleccion === undefined) {
        onSeleccion(res.data.lineas.map((l) => ({ procedureId: l.procedureId, quantity: l.quantity })));
      }
    } catch {
      setError(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treatmentPlanId, cardId, soloLectura, seleccion === undefined]);

  useEffect(() => {
    void cargar();
  }, [cargar, recarga]);

  async function cobrar(l: LineaParaVista) {
    if (!cardId || cobrando) return;
    setCobrando(l.procedureId);
    try {
      const r = await cobrarProcedimientoDeHoja({ cardId, procedureId: l.procedureId });
      if (isFailure(r)) {
        toast.error(r.error);
        setCobrando(null);
        return;
      }
      if (!r.data.yaExistia) toast.success(`Factura ${r.data.invoiceNumber ?? ""} creada para «${l.name}».`);
      // La línea ya queda «facturada» aunque se cierre la ventana sin cobrar.
      void cargar();
      setVentana({ invoiceId: r.data.invoiceId, total: r.data.total, rediseno: r.data.rediseno, clinicTaxMode: r.data.clinicTaxMode });
    } catch {
      toast.error("No se pudo cobrar el procedimiento. Inténtalo de nuevo.");
      setCobrando(null);
    }
  }

  const textoDeCobro = (procedureId: string, normal: string) =>
    cobrando === procedureId ? (ventana ? "Abriendo el cobro…" : "Creando la factura…") : normal;

  const ventanaDeCobro = ventana ? (
    <CobrarEnFactura
      invoiceId={ventana.invoiceId}
      montoSugerido={ventana.total > 0 ? ventana.total : undefined}
      rediseno={ventana.rediseno}
      clinicTaxMode={ventana.clinicTaxMode}
      onLista={() => setCobrando(null)}
      onClose={() => {
        setVentana(null);
        setCobrando(null);
      }}
      onRefrescar={() => void cargar()}
    />
  ) : null;

  const titulo = (
    <div className={orto.bloqueCabeza}>
      <h4 className={orto.bloqueTitulo}>Procedimientos de esta visita</h4>
    </div>
  );

  if (error && !cargado) {
    return (
      <section className={orto.bloque}>
        {titulo}
        <div className={`${orto.vacioLinea} flex items-center gap-2 flex-wrap`} role="alert">
          <span>No se pudieron cargar los procedimientos.</span>
          <Btn
            variant="secondary"
            size="sm"
            onClick={() => {
              setError(false);
              void cargar();
            }}
          >
            Reintentar
          </Btn>
        </div>
      </section>
    );
  }

  // ── Solo lectura: el estado de cada línea ──────────────────────────
  if (soloLectura) {
    return (
      <section className={orto.bloque}>
        {titulo}
        {!cargado ? (
          <div className={orto.vacioLinea}>Cargando…</div>
        ) : lineas.length === 0 ? (
          <div className={orto.vacioLinea}>Sin procedimientos registrados en esta visita.</div>
        ) : (
          <div className="flex flex-col gap-[6px]">
            {lineas.map((l) => (
              <div key={l.procedureId} className={`${orto.caja} flex items-center gap-2 flex-wrap text-[13px]`}>
                <span className="font-semibold min-w-0 [overflow-wrap:anywhere]">
                  {l.name}
                  {l.quantity > 1 ? ` ×${l.quantity}` : ""}
                </span>
                <span className="ml-auto flex items-center gap-2 flex-wrap justify-end">
                  {l.estado === "incluido" ? (
                    <Pill color="slate" size="xs">Incluido en el tratamiento</Pill>
                  ) : l.estado === "facturado" ? (
                    <Pill color={l.factura?.pagada ? "emerald" : l.factura?.cancelada ? "rose" : "amber"} size="xs">
                      {l.factura?.cancelada
                        ? `Factura ${l.factura.numero ?? ""} cancelada`
                        : `Factura ${l.factura?.numero ?? l.invoiceNumber ?? ""} · ${l.factura?.pagada ? "cobrada" : "por pagar"}`}
                    </Pill>
                  ) : (
                    <>
                      <Pill color="amber" size="xs">Pendiente de cobro · {dinero.format(l.total)}</Pill>
                      {puedeCobrar ? (
                        <Btn
                          variant="secondary"
                          size="sm"
                          icon={<Banknote size={14} strokeWidth={1.75} aria-hidden />}
                          disabled={cobrando !== null}
                          aria-busy={cobrando === l.procedureId || undefined}
                          onClick={() => void cobrar(l)}
                        >
                          {textoDeCobro(l.procedureId, "Cobrar")}
                        </Btn>
                      ) : (
                        <span className="text-[12px] opacity-70">Recepción lo cobra desde Cobranza</span>
                      )}
                    </>
                  )}
                  {l.estado === "facturado" && l.factura?.cancelada && puedeCobrar ? (
                    <Btn variant="secondary" size="sm" disabled={cobrando !== null} aria-busy={cobrando === l.procedureId || undefined} onClick={() => void cobrar(l)}>
                      {textoDeCobro(l.procedureId, "Cobrar de nuevo")}
                    </Btn>
                  ) : null}
                  {/* Facturada y sin pagar: «Cobrar» abre la ventana de esa MISMA factura (no crea otra). */}
                  {l.estado === "facturado" && l.factura && !l.factura.pagada && !l.factura.cancelada && puedeCobrar ? (
                    <Btn variant="secondary" size="sm" disabled={cobrando !== null} aria-busy={cobrando === l.procedureId || undefined} onClick={() => void cobrar(l)}>
                      {textoDeCobro(l.procedureId, "Cobrar")}
                    </Btn>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        )}
        {ventanaDeCobro}
      </section>
    );
  }

  // ── Editable ───────────────────────────────────────────────────────
  const elegidos = seleccion ?? [];
  const porId = new Map(catalogo.map((c) => [c.id, c]));
  const disponibles = catalogo.filter((c) => !elegidos.some((e) => e.procedureId === c.id));

  return (
    <section className={orto.bloque}>
      {titulo}
      {!cargado ? (
        <div className={orto.vacioLinea}>Cargando…</div>
      ) : (
        <>
          {elegidos.length === 0 ? (
            <div className={orto.vacioLinea}>
              {catalogo.length === 0
                ? "No hay procedimientos de ortodoncia activos. Agrégalos en Ortodoncia → Configuración."
                : "Ningún procedimiento en esta visita."}
            </div>
          ) : (
            <div className="flex flex-col gap-[6px] mb-[10px]">
              {elegidos.map((e) => {
                const c = porId.get(e.procedureId);
                return (
                  <div key={e.procedureId} className={`${orto.caja} flex items-center gap-2 flex-wrap text-[13px]`}>
                    <span className="font-semibold min-w-0 [overflow-wrap:anywhere]">{c?.name ?? "Procedimiento que ya no está disponible"}</span>
                    {c ? (
                      c.incluido ? (
                        <Pill color="slate" size="xs">Incluido en el tratamiento</Pill>
                      ) : (
                        <Pill color="amber" size="xs">Con costo aparte · {dinero.format(c.price * e.quantity)}</Pill>
                      )
                    ) : (
                      <Pill color="rose" size="xs">Quítalo para guardar</Pill>
                    )}
                    <span className="ml-auto flex items-center gap-2">
                      <label className="flex items-center gap-1 text-[12px]">
                        Cant.
                        <input
                          type="number"
                          min={1}
                          max={CANTIDAD_MAXIMA}
                          value={e.quantity}
                          onChange={(ev) => {
                            const n = Math.max(1, Math.min(CANTIDAD_MAXIMA, Math.floor(Number(ev.target.value) || 1)));
                            onSeleccion(elegidos.map((x) => (x.procedureId === e.procedureId ? { ...x, quantity: n } : x)));
                          }}
                          className={`${orto.entrada} ${orto.entradaCorta}`}
                          aria-label={`Cantidad de ${c?.name ?? "procedimiento"}`}
                        />
                      </label>
                      <button
                        type="button"
                        className={orto.botonIcono}
                        aria-label={`Quitar ${c?.name ?? "procedimiento"}`}
                        onClick={() => onSeleccion(elegidos.filter((x) => x.procedureId !== e.procedureId))}
                      >
                        <X size={16} strokeWidth={1.75} aria-hidden />
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {faltantes.map((item) => (
            <p key={item} className="text-[12px] text-[color:var(--pr-texto-3)]" role="status">
              {avisoDeProcedimientoFaltante(item)}{" "}
              <Link href="/dashboard/procedures" target="_blank" className="underline">Abrir Procedimientos</Link>
            </p>
          ))}
          {disponibles.length > 0 ? (
            <label className="flex items-center gap-2 text-[12.5px]">
              <Plus size={14} strokeWidth={1.75} aria-hidden />
              <select
                value=""
                onChange={(ev) => {
                  if (ev.target.value) onSeleccion([...elegidos, { procedureId: ev.target.value, quantity: 1 }]);
                }}
                className={orto.entrada}
                aria-label="Agregar un procedimiento a esta visita"
              >
                <option value="">Agregar un procedimiento…</option>
                {/* ws1-t12: lo que el plan de tratamiento del caso pide (microtornillo, barra palatina…) va primero. */}
                {disponibles.some((c) => c.sugerido) ? (
                  <optgroup label="Del plan de tratamiento de este caso">
                    {disponibles.filter((c) => c.sugerido).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} · {c.incluido ? "incluido" : `con costo aparte ${dinero.format(c.price)}`}
                        {c.motivo ? ` (${c.motivo})` : ""}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {(disponibles.some((c) => c.sugerido) ? disponibles.filter((c) => !c.sugerido) : disponibles).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.incluido ? "incluido" : `con costo aparte ${dinero.format(c.price)}`}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <p className="text-[12px] mt-[8px] opacity-70">
            Los incluidos en el tratamiento solo se registran. Los de costo aparte se cobran al firmar la hoja, con el botón «Cobrar».
          </p>
          {onExtracciones && pendientes.length > 0 ? (
            <div className="mt-[12px]" data-extracciones-del-plan>
              <div className={orto.campoEtiqueta}>Extracciones del plan pendientes</div>
              <p className="text-[12px] opacity-70 mt-[2px]">Marca las que se hicieron en esta visita: se anotan como realizadas en el plan de tratamiento al firmar la hoja.</p>
              <div className="flex flex-wrap gap-[6px] mt-[6px]" role="group" aria-label="Extracciones del plan pendientes">
                {pendientes.map((p) => {
                  const marcada = extracciones.includes(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      aria-pressed={marcada}
                      className={`${orto.boton} ${orto.botonChico} ${marcada ? orto.botonPrincipal : ""}`}
                      onClick={() => onExtracciones(marcada ? extracciones.filter((x) => x !== p) : [...extracciones, p].sort((a, b) => a - b))}
                    >
                      {p}
                      {marcada ? " · hecha hoy" : ""}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
