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
}

export function ProcedimientosDeVisita(props: ProcedimientosDeVisitaProps) {
  const [catalogo, setCatalogo] = useState<ProcedimientoElegible[]>([]);
  const [lineas, setLineas] = useState<LineaParaVista[]>([]);
  const [puedeCobrar, setPuedeCobrar] = useState(false);
  const [cargado, setCargado] = useState(false);
  const [error, setError] = useState(false);
  const [cobrando, setCobrando] = useState<string | null>(null);
  const { treatmentPlanId, cardId, soloLectura, seleccion, onSeleccion, recarga } = props;

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
        return;
      }
      toast.success(r.data.yaExistia ? `«${l.name}» ya tenía su factura (${r.data.invoiceNumber ?? "sin folio"}).` : `Factura ${r.data.invoiceNumber ?? ""} creada para «${l.name}».`);
      await cargar();
    } finally {
      setCobrando(null);
    }
  }

  const titulo = (
    <div className={orto.bloqueCabeza}>
      <h4 className={orto.bloqueTitulo}>Procedimientos de esta visita</h4>
    </div>
  );

  if (error && !cargado) {
    return (
      <section className={orto.bloque}>
        {titulo}
        <div className={orto.vacioLinea}>No se pudieron cargar los procedimientos. Cierra y vuelve a abrir la hoja.</div>
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
                          onClick={() => void cobrar(l)}
                        >
                          {cobrando === l.procedureId ? "Cobrando…" : "Cobrar"}
                        </Btn>
                      ) : (
                        <span className="text-[12px] opacity-70">Recepción lo cobra desde Cobranza</span>
                      )}
                    </>
                  )}
                  {l.estado === "facturado" && l.factura?.cancelada && puedeCobrar ? (
                    <Btn variant="secondary" size="sm" disabled={cobrando !== null} onClick={() => void cobrar(l)}>
                      Cobrar de nuevo
                    </Btn>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        )}
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
                {disponibles.map((c) => (
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
        </>
      )}
    </section>
  );
}
