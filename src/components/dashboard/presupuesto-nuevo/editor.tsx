"use client";

// ═══════════════════════════════════════════════════════════════════════════
// Editor de presupuesto rediseñado (WS1-T8).
//
// Solo se monta con el interruptor `menu-dos-niveles` encendido para la
// clínica. Apagado, `quotes-tab.tsx` sigue pintando el editor de siempre, sin
// que cambie un píxel.
//
// Lo que este editor hace y el de antes no:
//  · Los conceptos son una TABLA, con su importe de línea a la vista.
//  · El descuento —de línea y global— se captura en pesos O en porcentaje, y
//    siempre se enseña cuánto es en dinero.
//  · Hay FORMA DE PAGO: un pago con su método, o a plazos con enganche,
//    número de pagos, cada cuánto y desde cuándo.
//  · El calendario de mensualidades se pinta MIENTRAS se arma, no al final.
//  · El total vive en una barra pegada abajo, siempre visible.
//
// Dos cosas que NO hace, a propósito:
//  · No cobra. Un presupuesto propone; Caja y Facturación mueven el dinero.
//  · No promete «meses sin intereses». Ver el aviso de la sección de pagos y
//    el encabezado de `lib/quotes/condiciones-pago.ts`.
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays, Check, CreditCard, FileText, Info, Layers, Loader2, Plus,
  Search, Tag, Trash2, Wallet,
} from "lucide-react";
import { computeTotals } from "@/lib/quotes/compute";
import {
  FRECUENCIAS_PAGO, MAX_PAGOS, METODOS_PAGO, MIN_PAGOS, PAGOS_SUGERIDOS,
  calcularCalendario, condicionesPorDefecto, dinero, fechaEnPalabras, frasePlan,
  totalACobrar,
  type CondicionesPago, type FrecuenciaPago, type ModoPago,
} from "@/lib/quotes/condiciones-pago";
import type { BillingInvoiceLite, QuoteDTO, QuoteItemInput } from "@/lib/quotes/types";
import { useT } from "@/i18n/i18n-provider";
import type { TFunction } from "@/i18n/t";
import r from "@/components/dashboard/pacientes-rediseno/rediseno.module.css";
import s from "./presupuesto.module.css";

/* ── Estado de una línea en el editor ─────────────────────────────────── */

/** Cómo se está capturando un descuento: en pesos o en porcentaje. */
type UnidadDescuento = "monto" | "pct";

interface LineaEditor {
  key: string;
  procedureId: string | null;
  nombre: string;
  diente: string;
  cantidad: number;
  precio: number;
  /** Lo que el usuario TECLEÓ. Su significado depende de `descUnidad`. */
  descValor: number;
  descUnidad: UnidadDescuento;
  fase: string;
  nota: string;
}

interface Tarifa { id: string; nombre: string; precio: number }

let _n = 0;
function nuevaKey(): string { _n += 1; return `ln-${_n}`; }

function num(v: string): number {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/** Importe bruto de una línea, antes de su descuento. */
function bruto(l: LineaEditor): number {
  return round2(Math.max(0, round2(l.precio)) * Math.max(1, Math.floor(l.cantidad || 1)));
}

/**
 * Descuento de la línea EN PESOS, que es lo único que se guarda (la columna
 * `quote_items.discount` es un importe). El porcentaje es una comodidad de
 * captura: se convierte aquí y se enseña convertido, para que nadie firme un
 * «10%» que la base guardó como «$10».
 */
function descuentoEnPesos(l: LineaEditor): number {
  const v = Math.max(0, round2(l.descValor));
  if (l.descUnidad !== "pct") return Math.min(v, bruto(l));
  return round2((bruto(l) * Math.min(100, v)) / 100);
}

/** Prellenado opcional al abrir desde otra pantalla (p. ej. el odontograma). */
export interface PrefillPresupuesto {
  title?: string;
  items?: Array<Partial<QuoteItemInput>>;
}

function lineasIniciales(
  prefill: PrefillPresupuesto | null,
  editando: QuoteDTO | null,
): LineaEditor[] {
  const desde = editando
    ? editando.items
    : (prefill?.items ?? []);
  return desde.map((it) => ({
    key: nuevaKey(),
    procedureId: it.procedureId ?? null,
    nombre: it.name ?? "",
    diente: it.toothFdi ?? "",
    cantidad: Number(it.quantity) || 1,
    precio: Number(it.unitPrice) || 0,
    // Lo guardado son pesos: se reabre en pesos. Si se capturó como
    // porcentaje, el importe resultante es el mismo — es el número que firmó
    // el paciente, y ese es el que manda.
    descValor: Number(it.discount) || 0,
    descUnidad: "monto" as UnidadDescuento,
    fase: it.phase == null ? "" : String(it.phase),
    nota: it.notes ?? "",
  }));
}

/* ── El editor ────────────────────────────────────────────────────────── */

export function PresupuestoEditor({
  patientId, editando, prefill, onCancelar, onGuardado,
}: {
  patientId: string;
  editando: QuoteDTO | null;
  prefill: PrefillPresupuesto | null;
  onCancelar: () => void;
  onGuardado: (res?: { invoice?: BillingInvoiceLite | null }) => void;
}) {
  const t = useT();

  const [titulo, setTitulo] = useState(
    editando?.title ?? prefill?.title ?? t("presupuestoNuevo.tituloPorDefecto"),
  );
  const [lineas, setLineas] = useState<LineaEditor[]>(() => lineasIniciales(prefill, editando));

  // Descuento global. `discountPct` es columna propia del presupuesto, así que
  // el porcentaje SÍ sobrevive a una recarga; el monto también.
  const [descUnidad, setDescUnidad] = useState<UnidadDescuento>(
    editando?.discountPct != null ? "pct" : "monto",
  );
  const [descValor, setDescValor] = useState<number>(
    editando?.discountPct != null ? editando.discountPct : (editando?.discountAmount ?? 0),
  );

  const [vigencia, setVigencia] = useState<string>(() => {
    const base = editando?.validUntil ? new Date(editando.validUntil) : new Date(Date.now() + 30 * 86400000);
    return isNaN(base.getTime()) ? "" : base.toISOString().slice(0, 10);
  });
  const [notas, setNotas] = useState(editando?.notes ?? "");

  // Condiciones de pago. Las de un presupuesto que se está editando llegan en
  // el DTO; si el SQL todavía no está aplicado llegan como null y aquí se
  // arranca con las de por defecto (un pago, sin método) — que es exactamente
  // lo que había antes de esta pantalla.
  const [cond, setCond] = useState<CondicionesPago>(
    () => editando?.condicionesPago ?? condicionesPorDefecto(),
  );

  /**
   * La base no pudo leer las formas de pago de este presupuesto (`fallo` de
   * `leerCondiciones`). NO es lo mismo que «no tiene»: puede tener doce
   * mensualidades firmadas ahí guardadas.
   *
   * Mientras no se sepa, esta pantalla NO las toca: la sección se bloquea y el
   * cuerpo del PATCH se manda SIN el campo `condicionesPago`, que la ruta lee
   * como «no lo cambies». Sin esto, abrir el presupuesto justo cuando la base
   * tropieza y corregirle una coma al título le borraba el plan entero.
   */
  const condicionesIlegibles = editando?.condicionesPagoIlegible === true;

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tarifario, setTarifario] = useState<Tarifa[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [buscadorAbierto, setBuscadorAbierto] = useState(false);
  const cajaBusqueda = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch("/api/procedures")
      .then((res) => (res.ok ? res.json() : []))
      .then((d) => {
        if (!vivo) return;
        setTarifario(
          Array.isArray(d)
            ? d.map((p: { id: string; name: string; basePrice: number }) => ({
                id: p.id, nombre: p.name, precio: Number(p.basePrice) || 0,
              }))
            : [],
        );
      })
      .catch(() => { if (vivo) setTarifario([]); });
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    if (buscadorAbierto) cajaBusqueda.current?.focus();
  }, [buscadorAbierto]);

  const coincidencias = useMemo(() => {
    const q = busqueda.toLowerCase().trim();
    const base = q ? tarifario.filter((p) => p.nombre.toLowerCase().includes(q)) : tarifario;
    return base.slice(0, 30);
  }, [tarifario, busqueda]);

  /* ── El dinero ──────────────────────────────────────────────────────
     Dos pasos, y en este orden, porque es el MISMO camino que recorre el
     servidor al guardar:
       1. `computeTotals` normaliza las líneas y resuelve el descuento global
          (lo que `service.ts` escribe en la base).
       2. `totalACobrar` deriva de ESAS líneas el total con la aritmética de
          la factura (`invoiceFieldsFromQuote`), que es la que se cobra y se
          timbra.
     Sumar aquí por nuestra cuenta es justo lo que produce el desfase de
     centavos entre lo que ve el paciente y lo que se guarda. */
  /**
   * Las líneas que de verdad se van a guardar. El servidor descarta las que no
   * tienen nombre (`sanitizeItems`, service.ts), así que son estas —y no todas—
   * las que tienen que alimentar el total y el calendario. Calcular sobre las
   * otras hacía que la cifra grande de la barra y las mensualidades que se le
   * enseñan al paciente incluyeran una línea a medio escribir que después no se
   * guardaba: pantalla $13,000 / papel $10,000.
   */
  const guardables = useMemo(
    () => lineas.filter((l) => l.nombre.trim().length > 0),
    [lineas],
  );

  const dinero_ = useMemo(() => {
    const entrada: QuoteItemInput[] = guardables.map((l) => ({
      procedureId: l.procedureId,
      name: l.nombre,
      toothFdi: l.diente,
      quantity: l.cantidad,
      unitPrice: l.precio,
      discount: descuentoEnPesos(l),
      phase: l.fase === "" ? null : Number(l.fase),
      notes: l.nota,
    }));
    const normalizado = computeTotals(entrada, {
      discountPct: descUnidad === "pct" ? descValor : null,
      discountAmount: descUnidad === "monto" ? descValor : null,
    });
    const factura = totalACobrar({
      discountAmount: normalizado.discountAmount,
      items: normalizado.items.map((it) => ({
        name: it.name,
        toothFdi: it.toothFdi ?? null,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        discount: it.discount,
      })),
    });
    const descuentoDeLineas = round2(
      normalizado.items.reduce((acc, it) => acc + it.discount, 0),
    );
    return {
      subtotal: factura.subtotal,
      descuentoGlobal: factura.descuento,
      descuentoDeLineas,
      total: factura.total,
      entrada,
    };
  }, [guardables, descUnidad, descValor]);

  const calendario = useMemo(
    () => calcularCalendario(dinero_.total, cond),
    [dinero_.total, cond],
  );

  /* ── Mutaciones ─────────────────────────────────────────────────────── */

  const parchear = useCallback((key: string, cambio: Partial<LineaEditor>) => {
    setLineas((prev) => prev.map((l) => (l.key === key ? { ...l, ...cambio } : l)));
  }, []);

  const quitar = useCallback((key: string) => {
    setLineas((prev) => prev.filter((l) => l.key !== key));
  }, []);

  function agregarDelTarifario(p: Tarifa) {
    setLineas((prev) => [...prev, {
      key: nuevaKey(), procedureId: p.id, nombre: p.nombre, diente: "",
      cantidad: 1, precio: p.precio, descValor: 0, descUnidad: "monto", fase: "", nota: "",
    }]);
    setBusqueda("");
    setBuscadorAbierto(false);
  }

  function agregarLibre() {
    setLineas((prev) => [...prev, {
      key: nuevaKey(), procedureId: null, nombre: "", diente: "",
      cantidad: 1, precio: 0, descValor: 0, descUnidad: "monto", fase: "", nota: "",
    }]);
  }

  const parchearCond = useCallback((cambio: Partial<CondicionesPago>) => {
    setCond((prev) => {
      const sig = { ...prev, ...cambio };
      // «Lo difiere con su banco» solo vive donde significa algo: un pago, con
      // tarjeta de crédito. El servidor lo vuelve a comprobar (normalizar-
      // Condiciones); aquí se apaga para que la pantalla no enseñe una casilla
      // marcada que la base va a descartar.
      if (sig.modo !== "unico" || sig.metodo !== "credit") sig.difiereConSuBanco = false;
      return sig;
    });
  }, []);

  function elegirModo(modo: ModoPago) {
    parchearCond({
      modo,
      // Al pasar a plazos por primera vez se sugieren 6 mensualidades y el
      // primer pago hoy: números con los que ya se puede enseñar la tabla,
      // en vez de un formulario vacío que no dice nada.
      numPagos: modo === "plazos" ? (cond.numPagos >= MIN_PAGOS ? cond.numPagos : PAGOS_SUGERIDOS) : 0,
      primerPago: modo === "plazos" && !cond.primerPago
        ? new Date().toISOString().slice(0, 10)
        : cond.primerPago,
    });
  }

  /* ── Guardar ────────────────────────────────────────────────────────── */

  async function guardar() {
    // Las MISMAS que alimentan el total de la barra: lo que se ve es lo que se
    // manda, sin una segunda regla de filtrado que pueda separarse de la otra.
    const limpias = guardables;
    if (limpias.length === 0) {
      setError(t("presupuestoNuevo.errorSinConceptos"));
      return;
    }
    setGuardando(true);
    setError(null);

    const cuerpo = {
      patientId,
      title: titulo.trim() || t("presupuestoNuevo.tituloPorDefecto"),
      items: limpias.map((l) => ({
        procedureId: l.procedureId,
        name: l.nombre.trim(),
        toothFdi: l.diente.trim() || null,
        quantity: l.cantidad,
        unitPrice: l.precio,
        // Siempre en PESOS: el porcentaje es captura, no almacenamiento.
        discount: descuentoEnPesos(l),
        phase: l.fase === "" ? null : Number(l.fase),
        notes: l.nota.trim() || null,
      })),
      discountPct: descUnidad === "pct" ? descValor : null,
      discountAmount: descUnidad === "monto" ? descValor : null,
      validUntil: vigencia ? new Date(vigencia).toISOString() : null,
      notes: notas.trim() || null,
      // Ausente = «no las cambies» (ver el PATCH). Presente = lo que diga.
      ...(condicionesIlegibles ? {} : { condicionesPago: cond }),
    };

    try {
      const res = await fetch(editando ? `/api/quotes/${editando.id}` : "/api/quotes", {
        method: editando ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      const salida = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(salida.error ?? t("presupuestoNuevo.errorGuardar"));
      // El presupuesto se guardó, pero su plan de pagos NO (la base falló al
      // escribirlo). No se cierra el editor: cerrarlo sería decirle a la
      // recepcionista que las 12 mensualidades que acaba de negociar quedaron
      // guardadas cuando no es cierto. El botón sigue ahí para reintentar.
      if (salida.condicionesPagoFallo) {
        setError(t("presupuestoNuevo.errorFormaDePago"));
        setGuardando(false);
        return;
      }
      onGuardado({ invoice: salida.invoice ?? null });
    } catch (e) {
      setError((e as Error).message);
      setGuardando(false);
    }
  }

  /* ── Pintado ────────────────────────────────────────────────────────── */

  const hayLineas = lineas.length > 0;

  return (
    <div className={s.pantalla}>
      <div className={s.cabecera}>
        <div className={s.cabeceraTexto}>
          <h2 className={s.titulo}>
            {editando
              ? t("presupuestoNuevo.tituloEditar", { folio: editando.folio })
              : t("presupuestoNuevo.tituloNuevo")}
          </h2>
          <p className={s.subtitulo}>{t("presupuestoNuevo.subtitulo")}</p>
        </div>
        <div className={s.cabeceraAcciones}>
          <button type="button" className={r.boton} onClick={onCancelar}>
            {t("presupuestoNuevo.cancelar")}
          </button>
        </div>
      </div>

      {/* ── Título y vigencia ─────────────────────────────────────────── */}
      <section className={r.tarjeta}>
        <div className={s.camposPlan} style={{ marginTop: 0 }}>
          <label className={r.campo} style={{ gridColumn: "span 2" }}>
            <span className={r.campoEtiqueta}>{t("presupuestoNuevo.campoTitulo")}</span>
            <input
              className={r.campoEntrada}
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder={t("presupuestoNuevo.campoTituloPista")}
            />
          </label>
          <label className={r.campo}>
            <span className={r.campoEtiqueta}>{t("presupuestoNuevo.campoVigencia")}</span>
            <input
              type="date"
              className={r.campoEntrada}
              value={vigencia}
              onChange={(e) => setVigencia(e.target.value)}
            />
          </label>
        </div>
      </section>

      {/* ── Conceptos ─────────────────────────────────────────────────── */}
      <section className={r.tarjeta}>
        <div className={r.tarjetaCabeza}>
          <span className={r.tarjetaIcono}><Layers size={15} /></span>
          <h3 className={r.tarjetaTitulo}>{t("presupuestoNuevo.conceptos")}</h3>
          <button
            type="button"
            className={r.tarjetaEnlace}
            onClick={() => setBuscadorAbierto((v) => !v)}
          >
            <Search size={12} style={{ marginRight: 4, verticalAlign: -2 }} />
            {t("presupuestoNuevo.delTarifario")}
          </button>
          <button type="button" className={r.tarjetaEnlace} onClick={agregarLibre}>
            <Plus size={12} style={{ marginRight: 4, verticalAlign: -2 }} />
            {t("presupuestoNuevo.lineaLibre")}
          </button>
        </div>

        {buscadorAbierto && (
          <div className={s.buscador}>
            <input
              ref={cajaBusqueda}
              className={r.campoEntrada}
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder={t("presupuestoNuevo.buscarPista")}
            />
            <div className={s.buscadorLista}>
              {coincidencias.length === 0 ? (
                <p className={r.vacioPista} style={{ padding: "12px 10px", maxWidth: "none" }}>
                  {t("presupuestoNuevo.sinCoincidencias")}
                </p>
              ) : coincidencias.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={s.buscadorItem}
                  onClick={() => agregarDelTarifario(p)}
                >
                  <span className={s.buscadorNombre}>{p.nombre}</span>
                  <span className={s.buscadorPrecio}>{dinero(p.precio)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {!hayLineas ? (
          <div className={r.vacio}>
            <span className={r.vacioIcono}><FileText size={17} /></span>
            <p className={r.vacioTitulo}>{t("presupuestoNuevo.vacioTitulo")}</p>
            <p className={r.vacioPista}>{t("presupuestoNuevo.vacioPista")}</p>
          </div>
        ) : (
          <div className={s.tablaCaja}>
            <table className={s.tabla}>
              <thead>
                <tr>
                  <th className={s.colConcepto}>{t("presupuestoNuevo.colConcepto")}</th>
                  <th className={s.colDiente}>{t("presupuestoNuevo.colDiente")}</th>
                  <th className={`${s.colCant} ${s.thCentro}`}>{t("presupuestoNuevo.colCantidad")}</th>
                  <th className={`${s.colPrecio} ${s.thNum}`}>{t("presupuestoNuevo.colPrecio")}</th>
                  <th className={`${s.colDesc} ${s.thNum}`}>{t("presupuestoNuevo.colDescuento")}</th>
                  <th className={`${s.colImporte} ${s.thNum}`}>{t("presupuestoNuevo.colImporte")}</th>
                  <th className={s.colQuitar}><span className="sr-only" /></th>
                </tr>
              </thead>
              <tbody>
                {lineas.map((l) => (
                  <FilaConcepto
                    key={l.key}
                    linea={l}
                    onCambio={parchear}
                    onQuitar={quitar}
                    t={t}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Descuento global ──────────────────────────────────────────── */}
      <section className={r.tarjeta}>
        <div className={r.tarjetaCabeza}>
          <span className={r.tarjetaIcono}><Tag size={15} /></span>
          <h3 className={r.tarjetaTitulo}>{t("presupuestoNuevo.descuentoGlobal")}</h3>
        </div>
        <div className={s.camposPlan} style={{ marginTop: 0 }}>
          <div className={r.campo}>
            <span className={r.campoEtiqueta}>{t("presupuestoNuevo.descuentoSobreSubtotal")}</span>
            <EntradaDescuento
              valor={descValor}
              unidad={descUnidad}
              base={dinero_.subtotal}
              onValor={setDescValor}
              onUnidad={(u) => { setDescUnidad(u); }}
              etiquetaMonto={t("presupuestoNuevo.unidadMonto")}
              etiquetaPct={t("presupuestoNuevo.unidadPct")}
            />
            <p className={`${s.descuentoEnDinero} ${dinero_.descuentoGlobal > 0 ? "" : s.descuentoCero}`}>
              {dinero_.descuentoGlobal > 0
                ? t("presupuestoNuevo.descuentoEnDinero", { monto: dinero(dinero_.descuentoGlobal) })
                : t("presupuestoNuevo.sinDescuento")}
            </p>
          </div>
          <div className={r.campo} style={{ gridColumn: "span 2" }}>
            <span className={r.campoEtiqueta}>{t("presupuestoNuevo.campoNotas")}</span>
            <textarea
              className={`${r.campoEntrada} ${r.campoArea}`}
              rows={2}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder={t("presupuestoNuevo.campoNotasPista")}
            />
          </div>
        </div>
      </section>

      {/* ── Forma de pago ─────────────────────────────────────────────── */}
      <section className={r.tarjeta}>
        <div className={r.tarjetaCabeza}>
          <span className={r.tarjetaIcono}><Wallet size={15} /></span>
          <h3 className={r.tarjetaTitulo}>{t("presupuestoNuevo.formaDePago")}</h3>
        </div>

        {/* No se pudieron leer: se dice y NO se deja tocar nada, para que
            guardar no borre un plan que este editor nunca llegó a ver. */}
        {condicionesIlegibles ? (
          <div className={s.aviso}>
            <Info size={15} className={s.avisoIcono} />
            <p className={s.avisoTexto}>
              <strong className={s.avisoTitulo}>{t("presupuestoNuevo.ilegibleTitulo")}</strong>
              {t("presupuestoNuevo.ilegibleTexto")}
            </p>
          </div>
        ) : (
        <>
        <div className={s.opciones}>
          <OpcionPago
            activa={cond.modo === "unico"}
            icono={<CreditCard size={15} />}
            titulo={t("presupuestoNuevo.modoUnico")}
            pista={t("presupuestoNuevo.modoUnicoPista")}
            onClick={() => elegirModo("unico")}
          />
          <OpcionPago
            activa={cond.modo === "plazos"}
            icono={<CalendarDays size={15} />}
            titulo={t("presupuestoNuevo.modoPlazos")}
            pista={t("presupuestoNuevo.modoPlazosPista")}
            onClick={() => elegirModo("plazos")}
          />
        </div>

        <div className={r.campo}>
          <span className={r.campoEtiqueta}>
            {cond.modo === "plazos"
              ? t("presupuestoNuevo.metodoDeLasCuotas")
              : t("presupuestoNuevo.metodo")}
          </span>
          <div className={s.metodos}>
            {METODOS_PAGO.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={cond.metodo === m}
                className={`${s.metodo} ${cond.metodo === m ? s.metodoActivo : ""}`}
                onClick={() => parchearCond({ metodo: cond.metodo === m ? null : m })}
              >
                {t(`presupuestoNuevo.metodos.${m}`)}
              </button>
            ))}
          </div>
        </div>

        {cond.modo === "plazos" && (
          <>
            <div className={s.camposPlan}>
              <label className={r.campo}>
                <span className={r.campoEtiqueta}>{t("presupuestoNuevo.enganche")}</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className={`${r.campoEntrada} ${s.celdaNum}`}
                  value={cond.enganche || ""}
                  placeholder="0.00"
                  onChange={(e) => parchearCond({ enganche: Math.max(0, num(e.target.value)) })}
                />
              </label>
              <label className={r.campo}>
                <span className={r.campoEtiqueta}>{t("presupuestoNuevo.cuantosPagos")}</span>
                <input
                  type="number"
                  min={MIN_PAGOS}
                  max={MAX_PAGOS}
                  step={1}
                  className={`${r.campoEntrada} ${s.celdaNum}`}
                  value={cond.numPagos || PAGOS_SUGERIDOS}
                  onChange={(e) => parchearCond({
                    numPagos: Math.min(MAX_PAGOS, Math.max(MIN_PAGOS, Math.floor(num(e.target.value)) || MIN_PAGOS)),
                  })}
                />
              </label>
              <label className={r.campo}>
                <span className={r.campoEtiqueta}>{t("presupuestoNuevo.cadaCuanto")}</span>
                <select
                  className={r.campoEntrada}
                  value={cond.frecuencia}
                  onChange={(e) => parchearCond({ frecuencia: e.target.value as FrecuenciaPago })}
                >
                  {FRECUENCIAS_PAGO.map((f) => (
                    <option key={f} value={f}>{t(`presupuestoNuevo.frecuencias.${f}`)}</option>
                  ))}
                </select>
              </label>
              <label className={r.campo}>
                <span className={r.campoEtiqueta}>{t("presupuestoNuevo.primerPago")}</span>
                <input
                  type="date"
                  className={r.campoEntrada}
                  value={cond.primerPago ?? ""}
                  onChange={(e) => parchearCond({ primerPago: e.target.value || null })}
                />
              </label>
            </div>

            <Calendario
              calendario={calendario}
              cond={cond}
              total={dinero_.total}
              t={t}
            />
          </>
        )}

        {cond.modo === "unico" && cond.metodo === "credit" && (
          <label className={s.casilla}>
            <input
              type="checkbox"
              checked={cond.difiereConSuBanco}
              onChange={(e) => parchearCond({ difiereConSuBanco: e.target.checked })}
            />
            <span>{t("presupuestoNuevo.difiereCasilla")}</span>
          </label>
        )}

        {/* El aviso sobre «meses sin intereses» NO está detrás de un clic: es
            justo lo que alguien viene a buscar a esta sección. */}
        <div className={s.aviso}>
          <Info size={15} className={s.avisoIcono} />
          <p className={s.avisoTexto}>
            <strong className={s.avisoTitulo}>{t("presupuestoNuevo.msiTitulo")}</strong>
            {t("presupuestoNuevo.msiTexto")}
          </p>
        </div>
        </>
        )}
      </section>

      {/* ── Barra de totales, siempre a la vista ──────────────────────── */}
      <div className={s.barra}>
        <div className={s.barraCifras}>
          <div className={s.cifra}>
            <span className={s.cifraEtiqueta}>{t("presupuestoNuevo.subtotal")}</span>
            <span className={s.cifraValor}>{dinero(dinero_.subtotal)}</span>
          </div>
          {dinero_.descuentoDeLineas > 0 && (
            <div className={`${s.cifra} ${s.cifraDescuento}`}>
              <span className={s.cifraEtiqueta}>{t("presupuestoNuevo.descuentoPorLinea")}</span>
              <span className={s.cifraValor}>−{dinero(dinero_.descuentoDeLineas)}</span>
            </div>
          )}
          {dinero_.descuentoGlobal > 0 && (
            <div className={`${s.cifra} ${s.cifraDescuento}`}>
              <span className={s.cifraEtiqueta}>{t("presupuestoNuevo.descuentoGlobalCorto")}</span>
              <span className={s.cifraValor}>−{dinero(dinero_.descuentoGlobal)}</span>
            </div>
          )}
          <div className={`${s.cifra} ${s.cifraTotal}`}>
            <span className={s.cifraEtiqueta}>{t("presupuestoNuevo.total")}</span>
            <span className={s.cifraValor}>{dinero(dinero_.total)}</span>
          </div>
        </div>

        <div className={s.barraAcciones}>
          <button type="button" className={r.boton} onClick={onCancelar} disabled={guardando}>
            {t("presupuestoNuevo.cancelar")}
          </button>
          <button
            type="button"
            className={`${r.boton} ${r.botonPrincipal}`}
            onClick={guardar}
            disabled={guardando}
          >
            {guardando ? <Loader2 size={15} className={r.girando} /> : <Check size={15} />}
            {editando ? t("presupuestoNuevo.guardarCambios") : t("presupuestoNuevo.crear")}
          </button>
        </div>

        {/* La frase del plan vive en la barra: es lo que se le dice al paciente
            y tiene que estar a la vista mientras se negocia. */}
        {!condicionesIlegibles && cond.modo === "plazos" && dinero_.total > 0 && (
          <p className={s.barraPlan}>
            <span className={s.barraPlanFuerte}>{frasePlan(dinero_.total, cond)}</span>
          </p>
        )}

        {error && <p className={s.barraError}>{error}</p>}
      </div>
    </div>
  );
}

/* ── Piezas ───────────────────────────────────────────────────────────── */

function FilaConcepto({
  linea, onCambio, onQuitar, t,
}: {
  linea: LineaEditor;
  onCambio: (key: string, cambio: Partial<LineaEditor>) => void;
  onQuitar: (key: string) => void;
  t: TFunction;
}) {
  const importeBruto = bruto(linea);
  const desc = descuentoEnPesos(linea);
  const importe = round2(Math.max(0, importeBruto - desc));

  return (
    <tr>
      <td className={s.colConcepto}>
        <input
          className={`${s.celdaEntrada} ${s.nombreConcepto}`}
          value={linea.nombre}
          onChange={(e) => onCambio(linea.key, { nombre: e.target.value })}
          placeholder={t("presupuestoNuevo.conceptoPista")}
        />
        <input
          className={s.notaLinea}
          value={linea.nota}
          onChange={(e) => onCambio(linea.key, { nota: e.target.value })}
          placeholder={t("presupuestoNuevo.notaLineaPista")}
        />
      </td>
      <td className={s.colDiente}>
        <input
          className={s.celdaEntrada}
          value={linea.diente}
          onChange={(e) => onCambio(linea.key, { diente: e.target.value })}
          placeholder="11,12"
          title={t("presupuestoNuevo.colDienteAyuda")}
        />
      </td>
      <td className={`${s.colCant} ${s.tdCentro}`}>
        <input
          type="number"
          min={1}
          step={1}
          className={`${s.celdaEntrada} ${s.celdaNum}`}
          value={linea.cantidad}
          onChange={(e) => onCambio(linea.key, {
            cantidad: Math.max(1, Math.floor(Number(e.target.value) || 1)),
          })}
        />
      </td>
      <td className={`${s.colPrecio} ${s.tdNum}`}>
        <input
          type="number"
          min={0}
          step="0.01"
          className={`${s.celdaEntrada} ${s.celdaNum}`}
          value={linea.precio}
          onChange={(e) => onCambio(linea.key, { precio: Number(e.target.value) || 0 })}
        />
      </td>
      <td className={`${s.colDesc} ${s.tdNum}`}>
        <EntradaDescuento
          valor={linea.descValor}
          unidad={linea.descUnidad}
          base={importeBruto}
          onValor={(v) => onCambio(linea.key, { descValor: v })}
          onUnidad={(u) => onCambio(linea.key, { descUnidad: u })}
          etiquetaMonto={t("presupuestoNuevo.unidadMonto")}
          etiquetaPct={t("presupuestoNuevo.unidadPct")}
        />
        {/* Con el porcentaje se enseña SIEMPRE cuánto es en pesos: es lo que
            se va a guardar y lo que va a firmar el paciente. */}
        {linea.descUnidad === "pct" && desc > 0 && (
          <p className={s.descuentoEnDinero}>−{dinero(desc)}</p>
        )}
      </td>
      <td className={`${s.colImporte} ${s.tdNum}`}>
        <span className={s.importeLinea}>
          {desc > 0 && <span className={s.importeTachado}>{dinero(importeBruto)}</span>}
          {dinero(importe)}
        </span>
      </td>
      <td className={s.colQuitar}>
        <button
          type="button"
          className={s.quitar}
          onClick={() => onQuitar(linea.key)}
          aria-label={t("presupuestoNuevo.quitarConcepto")}
        >
          <Trash2 size={14} />
        </button>
      </td>
    </tr>
  );
}

/** Entrada de descuento con interruptor $ / % pegado. */
function EntradaDescuento({
  valor, unidad, base, onValor, onUnidad, etiquetaMonto, etiquetaPct,
}: {
  valor: number;
  unidad: UnidadDescuento;
  /** Importe sobre el que se aplica el porcentaje. Sirve para convertir $ ⇄ %. */
  base: number;
  onValor: (v: number) => void;
  onUnidad: (u: UnidadDescuento) => void;
  etiquetaMonto: string;
  etiquetaPct: string;
}) {
  /**
   * Cambiar de unidad CONVIERTE el descuento; no lo acota y no lo conserva.
   *
   * Conservarlo era el defecto: «$150 de descuento» + un clic en «%» se leía
   * como 150 %, que `computeTotals` acota al 100 %, y el presupuesto —con la
   * factura borrador ligada, que el PATCH re-sincroniza— quedaba en $0.00 de un
   * clic. Acotar a 100 tampoco servía: deja exactamente el mismo $0.00, solo que
   * disparado por cualquier descuento de $100 o más, que es la mitad de los
   * descuentos reales de una clínica.
   *
   * Convertir es lo único que no cambia el dinero: $150 sobre una base de
   * $10,000 pasa a 1.5 %, y al volver a «$» pasa a $150. `base` es el importe
   * sobre el que se aplica el porcentaje —el subtotal para el descuento global,
   * el importe bruto para el de línea—, el mismo que usa el cálculo de verdad.
   * Sin base (aún no hay conceptos) no hay conversión posible y se pone en 0,
   * que es lo honesto.
   */
  const cambiarUnidad = (u: UnidadDescuento) => {
    if (u === unidad) return;
    if (base <= 0) onValor(0);
    else if (u === "pct") onValor(Math.min(100, Math.round((valor / base) * 100 * 100) / 100));
    else onValor(Math.round(((base * Math.min(100, valor)) / 100) * 100) / 100);
    onUnidad(u);
  };

  return (
    <div className={s.grupoDescuento}>
      <input
        type="number"
        min={0}
        max={unidad === "pct" ? 100 : undefined}
        step="0.01"
        className={`${s.celdaEntrada} ${s.celdaNum}`}
        value={valor || ""}
        placeholder="0"
        onChange={(e) => {
          const v = Math.max(0, Number(e.target.value) || 0);
          onValor(unidad === "pct" ? Math.min(100, v) : v);
        }}
      />
      <span className={s.unidad}>
        <button
          type="button"
          aria-pressed={unidad === "monto"}
          title={etiquetaMonto}
          className={`${s.unidadBoton} ${unidad === "monto" ? s.unidadActiva : ""}`}
          onClick={() => cambiarUnidad("monto")}
        >
          $
        </button>
        <button
          type="button"
          aria-pressed={unidad === "pct"}
          title={etiquetaPct}
          className={`${s.unidadBoton} ${unidad === "pct" ? s.unidadActiva : ""}`}
          onClick={() => cambiarUnidad("pct")}
        >
          %
        </button>
      </span>
    </div>
  );
}

function OpcionPago({
  activa, icono, titulo, pista, onClick,
}: {
  activa: boolean;
  icono: React.ReactNode;
  titulo: string;
  pista: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={activa}
      onClick={onClick}
      className={`${s.opcionPago} ${activa ? s.opcionPagoActiva : ""}`}
    >
      <span className={s.opcionIcono}>{icono}</span>
      <span className={s.opcionCuerpo}>
        <span className={s.opcionTitulo}>{titulo}</span>
        <span className={s.opcionPista}>{pista}</span>
      </span>
    </button>
  );
}

/** La tabla de mensualidades ya dividida — lo que convence al paciente. */
function Calendario({
  calendario, cond, total, t,
}: {
  calendario: ReturnType<typeof calcularCalendario>;
  cond: CondicionesPago;
  total: number;
  t: TFunction;
}) {
  if (total <= 0) {
    return (
      <div className={s.calendario}>
        <div className={s.calendarioCabeza}>
          <span className={r.vacioPista} style={{ maxWidth: "none" }}>
            {t("presupuestoNuevo.calendarioSinTotal")}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={s.calendario}>
      <div className={s.calendarioCabeza}>
        <span className={s.calendarioFrase}>{frasePlan(total, cond)}</span>
        {/* La suma de las cuotas es el total, siempre. Se enseña porque es la
            pregunta que hace cualquiera que mire una tabla de pagos. */}
        <span className={s.calendarioCuadra}>
          {t("presupuestoNuevo.calendarioCuadra", { suma: dinero(calendario.suma) })}
        </span>
      </div>
      <div className={s.calendarioLista}>
        {calendario.pagos.map((p) => (
          <div
            key={`${p.esEnganche ? "e" : "p"}-${p.numero}`}
            className={`${s.cuota} ${p.esEnganche ? s.cuotaEnganche : ""}`}
          >
            <span className={s.cuotaNombre}>
              {p.esEnganche
                ? t("presupuestoNuevo.enganche")
                : t("presupuestoNuevo.pagoN", { n: p.numero })}
            </span>
            <span className={s.cuotaFecha}>{fechaEnPalabras(p.fecha)}</span>
            <span className={s.cuotaMonto}>{dinero(p.monto)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
