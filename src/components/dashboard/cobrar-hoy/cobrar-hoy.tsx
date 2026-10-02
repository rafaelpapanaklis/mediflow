"use client";

// «Cobrar hoy» (ws1-t4, ticket 3 de BEVADENT, 8d) — concepto, importe, pago recibido,
// saldo que queda y comprobante opcional en UN paso.
//
// No es un cuarto camino de cobro: por dentro hace, en este orden, lo que ya hacen
// «Nueva factura» (POST /api/invoices, mismo cuerpo, mismos impuestos por defecto) y
// «Registrar pago» (POST /api/invoices/:id, mismo cuerpo que useCobro/PaymentModal, con
// el mismo freno de «caja cerrada»). La nota y el pago quedan con su folio, su bitácora
// (Movimientos) y su corte de Caja como cualquier otro. Las cuentas en vivo salen de
// lib/invoices/cobrar-hoy (puras, con pruebas).
//
// Avisos: NO manda ningún aviso de cobro (el tope de uno al día no se toca). La única
// salida opcional es el comprobante del pago (POST …/send-receipt, `payment_receipt`):
// confirma dinero recibido, no pide dinero, y viene APAGADO.
//
// Reintento sin duplicar: si la nota se creó y el pago falló, la nota se recuerda y el
// siguiente clic solo registra el pago.

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Search, Trash2, Check, ExternalLink } from "lucide-react";
import toast from "react-hot-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { useT } from "@/i18n/i18n-provider";
import { fmtMXNdec } from "@/lib/format";
import { todayLocalISO, paidAtInstant } from "@/lib/billing/paid-at";
import { mensajeDeError } from "@/lib/errores/mensaje-de-error";
import { CLASES_FACTURA_REDISENO, clasesFactura as c } from "@/components/dashboard/factura-rediseno/raiz";
import h from "./cobrar-hoy.module.css";
import { METHODS, type PaymentMethod } from "@/components/dashboard/billing/payment-modal";
import { useFrenoCajaCerrada } from "@/components/dashboard/billing/aviso-caja-cerrada";
import { AvisoCajaCerrada } from "@/components/dashboard/billing/aviso-caja-cerrada.component";
import {
  conceptoDeLaCita,
  cuerpoNotaCobroHoy,
  pagoTrasCrear,
  vistaCobroHoy,
  type ConceptoCobroHoy,
  type FaltaCobroHoy,
  type ProcedimientoDelCatalogo,
} from "@/lib/invoices/cobrar-hoy";

export interface CobrarHoyProps {
  open: boolean;
  onClose: () => void;
  patientId: string;
  patientName?: string;
  /** Abierta desde una cita: la nota queda ligada a ella y el concepto nace de su motivo. */
  cita?: { id: string; motivo?: string | null } | null;
  clinicTaxMode?: string | null;
  /**
   * "billing.charge": sin él la hoja no ofrece el pago y solo crea el cargo (queda todo
   * por cobrar). Falla cerrado: quien no lo pasa no cobra. El servidor lo exige igual.
   */
  puedeCobrar?: boolean;
  /** "whatsapp.send": sin él no se ofrece el comprobante por WhatsApp. */
  puedeEnviarComprobante?: boolean;
  /** Notas anteriores por cobrar: se enlazan («Cobrar esas»), no se mezclan con la de hoy. */
  pendientes?: { cuantas: number; saldo: number } | null;
  onCobrarPendientes?: () => void;
  /** Al terminar (nota creada, con o sin pago): para refrescar la pantalla de origen. */
  onListo?: (nota: { id: string; invoiceNumber: string }) => void;
}

interface Linea extends ConceptoCobroHoy { key: string; texto: string }

let _seq = 0;
const nuevaClave = () => `ch-${++_seq}`;
const comoTexto = (n: number) => (Number.isFinite(n) ? String(n) : "");

const LLAVE_FALTA: Record<FaltaCobroHoy, string> = {
  sin_conceptos: "cobrarHoy.faltaSinConceptos",
  concepto_sin_nombre: "cobrarHoy.faltaNombre",
  importe_invalido: "cobrarHoy.faltaImporte",
  total_cero: "cobrarHoy.faltaTotalCero",
  pago_invalido: "cobrarHoy.faltaPago",
  pago_mayor: "cobrarHoy.faltaPagoMayor",
};

export function CobrarHoy(props: CobrarHoyProps) {
  // Mientras guarda no se cierra (ni Esc ni clic fuera): la nota podría quedar a medias.
  const ocupado = useRef(false);
  return (
    <Dialog open={props.open} onOpenChange={(o) => { if (!o && !ocupado.current) props.onClose(); }}>
      <DialogContent className={`${CLASES_FACTURA_REDISENO} ${c.modal} ${c.modalEstrecho}`}>
        {/* Se monta de cero en cada apertura: nunca arrastra lo de la vez anterior. */}
        {props.open && <CuerpoCobrarHoy {...props} ocupado={ocupado} />}
      </DialogContent>
    </Dialog>
  );
}

function CuerpoCobrarHoy({
  onClose, patientId, patientName, cita, clinicTaxMode, puedeCobrar = false, puedeEnviarComprobante, pendientes, onCobrarPendientes, onListo, ocupado,
}: CobrarHoyProps & { ocupado: React.MutableRefObject<boolean> }) {
  const t = useT();
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [catalogo, setCatalogo] = useState<ProcedimientoDelCatalogo[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [pago, setPago] = useState<string>("");
  const [pagoTocado, setPagoTocado] = useState(false);
  const [metodo, setMetodo] = useState<PaymentMethod>("cash");
  const [referencia, setReferencia] = useState("");
  const [comprobante, setComprobante] = useState(false);
  const [guardando, setGuardando] = useState(false);
  // La nota ya creada en este intento (reintento = solo el pago).
  const [nota, setNota] = useState<{ id: string; invoiceNumber: string; balance: number } | null>(null);
  const [hecho, setHecho] = useState<{ id: string; invoiceNumber: string; cobrado: number; queda: number; comprobante: string | null } | null>(null);
  const freno = useFrenoCajaCerrada(true, metodo === "cash");

  // Tarifario (el mismo que usa «Nueva factura») y, desde una cita, el concepto de su motivo.
  useEffect(() => {
    let vivo = true;
    fetch("/api/procedures")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        if (!vivo) return;
        const lista: ProcedimientoDelCatalogo[] = (Array.isArray(d) ? d : d?.procedures ?? [])
          .filter((p: any) => p && p.id && p.name && p.isActive !== false)
          .map((p: any) => ({ id: String(p.id), name: String(p.name), basePrice: Number(p.basePrice) || 0 }));
        setCatalogo(lista);
        const inicial = conceptoDeLaCita(cita?.motivo, lista);
        if (inicial) {
          setLineas((prev) => (prev.length ? prev : [{ ...inicial, key: nuevaClave(), texto: comoTexto(inicial.importe) }]));
        }
      })
      .catch(() => {
        const inicial = conceptoDeLaCita(cita?.motivo, []);
        if (vivo && inicial) setLineas((prev) => (prev.length ? prev : [{ ...inicial, key: nuevaClave(), texto: "" }]));
      });
    return () => { vivo = false; };
  }, [cita?.motivo]);

  const conceptos: ConceptoCobroHoy[] = lineas.map((l) => ({ nombre: l.nombre, importe: l.texto === "" ? NaN : Number(l.texto), procedureId: l.procedureId }));
  // Mientras no se toque, «paga hoy» sigue al total: lo normal es que pague todo.
  // Sin "billing.charge" el pago es 0: solo se crea el cargo (revisión ws1-t1, fallo 1).
  const vista = vistaCobroHoy({ conceptos, puedeCobrar, pagoTocado, pago, clinicTaxMode });
  const pagoEfectivo = vista.pago;

  const coincidencias = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return (q ? catalogo.filter((p) => p.name.toLowerCase().includes(q)) : catalogo).slice(0, 30);
  }, [catalogo, busqueda]);

  const ponLinea = (key: string, cambio: Partial<Linea>) => setLineas((prev) => prev.map((l) => (l.key === key ? { ...l, ...cambio } : l)));

  async function guardar(sinAvisoCaja?: unknown) {
    if (guardando || vista.falta) return;
    setGuardando(true);
    ocupado.current = true;
    try {
      // Efectivo con la caja cerrada: se avisa ANTES de crear nada (mismo freno que «Registrar pago»).
      if (pagoEfectivo > 0 && sinAvisoCaja !== true && (await freno.frenar())) return;
      freno.ocultar();

      // 1) La nota (una sola vez por apertura).
      let actual = nota;
      if (!actual) {
        const res = await fetch("/api/invoices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cuerpoNotaCobroHoy({ patientId, appointmentId: cita?.id ?? null, conceptos, clinicTaxMode, conPagoHoy: pagoEfectivo > 0 })),
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(mensajeDeError(out, t, { estado: res.status, porDefecto: t("cobrarHoy.errorCrear") }));
          return;
        }
        actual = { id: String(out.id), invoiceNumber: String(out.invoiceNumber ?? ""), balance: Number(out.balance ?? vista.total) };
        setNota(actual);
      }

      // 2) El pago, sobre lo que de verdad quedó (el anticipo pudo descontar al crear).
      let cobrado = 0;
      const { monto, recortado } = pagoTrasCrear(pagoEfectivo, actual.balance);
      if (recortado) {
        toast(t("cobrarHoy.anticipo", { cobra: fmtMXNdec(monto), pedido: fmtMXNdec(pagoEfectivo) }), { duration: 10000 });
      }
      if (monto > 0) {
        const res = await fetch(`/api/invoices/${actual.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: monto,
            method: metodo,
            paidAt: paidAtInstant(todayLocalISO())?.toISOString(),
            reference: referencia.trim() || undefined,
          }),
        });
        if (!res.ok) {
          const cuerpo = await res.json().catch(() => ({}));
          toast.error(t("cobrarHoy.errorPago", {
            folio: actual.invoiceNumber,
            motivo: mensajeDeError(cuerpo, t, { estado: res.status, porDefecto: t("clinical.paymentModal.registerErrorGeneric") }),
          }), { duration: 12000 });
          return;
        }
        cobrado = monto;
      }

      // 3) Comprobante, solo si se pidió y hubo pago. Si no sale, el cobro sigue hecho.
      let estadoComprobante: string | null = null;
      if (comprobante && cobrado > 0) {
        try {
          const res = await fetch(`/api/invoices/${actual.id}/send-receipt`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
          const out = await res.json().catch(() => ({}));
          estadoComprobante = res.ok
            ? t("cobrarHoy.comprobanteEnviado")
            : t("cobrarHoy.comprobanteNo", { motivo: mensajeDeError(out, t, { estado: res.status }) });
        } catch (e) {
          estadoComprobante = t("cobrarHoy.comprobanteNo", { motivo: mensajeDeError(e, t) });
        }
      }

      const queda = Math.max(0, Math.round((actual.balance - cobrado) * 100) / 100);
      setHecho({ id: actual.id, invoiceNumber: actual.invoiceNumber, cobrado, queda, comprobante: estadoComprobante });
      toast.success(cobrado > 0
        ? t("cobrarHoy.toastCobrado", { monto: fmtMXNdec(cobrado), folio: actual.invoiceNumber })
        : t("cobrarHoy.toastCargo", { folio: actual.invoiceNumber }));
      onListo?.({ id: actual.id, invoiceNumber: actual.invoiceNumber });
    } catch (e) {
      toast.error(mensajeDeError(e, t, { porDefecto: t("cobrarHoy.errorCrear") }));
    } finally {
      setGuardando(false);
      ocupado.current = false;
    }
  }

  const titulo = patientName ? t("cobrarHoy.tituloCon", { patient: patientName }) : t("cobrarHoy.titulo");

  if (hecho) {
    return (
      <>
        <DialogHeader className={c.cabecera}>
          <DialogTitle className={c.titulo}>{titulo}</DialogTitle>
        </DialogHeader>
        <div className={c.cuerpo}>
          <div className={c.resumen} role="status">
            <div className={c.resumenFila}>
              <span className={c.rotulo}>{t("cobrarHoy.nota")}</span>
              <span className={`${c.cifra} ${c.folio}`}>{hecho.invoiceNumber}</span>
            </div>
            <div className={c.resumenFila}>
              <span className={c.rotulo}>{t("cobrarHoy.cobrado")}</span>
              <span className={`${c.cifra} ${c.cifraExito}`}>{fmtMXNdec(hecho.cobrado)}</span>
            </div>
            <div className={c.resumenFila}>
              <span className={c.rotulo}>{hecho.queda > 0 ? t("cobrarHoy.quedaPorCobrar") : t("cobrarHoy.liquidada")}</span>
              <span className={`${c.cifra} ${c.cifraTotal} ${hecho.queda > 0 ? c.cifraPeligro : c.cifraExito}`}>{fmtMXNdec(hecho.queda)}</span>
            </div>
          </div>
          {hecho.comprobante && <p className={c.ayuda}>{hecho.comprobante}</p>}
        </div>
        <DialogFooter className={c.pie}>
          <a className={c.enlace} href={`/api/invoices/${hecho.id}/print`} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={13} aria-hidden /> {t("cobrarHoy.verComprobante")}
          </a>
          <ButtonNew variant="primary" onClick={onClose}>{t("cobrarHoy.cerrar")}</ButtonNew>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader className={c.cabecera}>
        <DialogTitle className={c.titulo}>{titulo}</DialogTitle>
      </DialogHeader>

      <div className={c.cuerpo}>
        <p className={c.ayuda}>{t("cobrarHoy.intro")}</p>

        {/* Qué se cobra */}
        <div className={c.bloque}>
          <div className={`${c.bloqueCabeza} ${h.cabeza}`}>
            <h3 className={c.bloqueTitulo}>{t("cobrarHoy.conceptos")}</h3>
            {nota === null && (
              <div className={c.bloqueAcciones}>
                <button type="button" className={c.enlace} onClick={() => setBuscando((v) => !v)}>
                  <Search size={13} aria-hidden /> {t("cobrarHoy.delCatalogo")}
                </button>
                <button type="button" className={`${c.enlace} ${c.enlaceSuave}`}
                  onClick={() => setLineas((prev) => [...prev, { key: nuevaClave(), nombre: "", importe: NaN, texto: "", procedureId: null }])}>
                  <Plus size={13} aria-hidden /> {t("cobrarHoy.lineaLibre")}
                </button>
              </div>
            )}
          </div>

          {buscando && nota === null && (
            <div className={c.buscador}>
              <input
                autoFocus
                className={c.input}
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder={t("cobrarHoy.buscar")}
                aria-label={t("cobrarHoy.buscar")}
              />
              <div className={c.opciones}>
                {coincidencias.length === 0 ? (
                  <p className={c.vacio}>{t("cobrarHoy.sinCoincidencias")}</p>
                ) : coincidencias.map((p) => (
                  <button key={p.id} type="button" className={c.opcion}
                    onClick={() => {
                      setLineas((prev) => [...prev, { key: nuevaClave(), nombre: p.name, importe: p.basePrice, texto: comoTexto(p.basePrice), procedureId: p.id }]);
                      setBusqueda("");
                      setBuscando(false);
                    }}>
                    <span>{p.name}</span>
                    <span className={`${c.cifra} ${c.cifraApagada}`}>{fmtMXNdec(p.basePrice)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {lineas.length === 0 ? (
            <p className={c.vacio}>{t("cobrarHoy.vacio")}</p>
          ) : (
            <div className={c.conceptos}>
              {lineas.map((l) => (
                <div key={l.key} className={c.concepto}>
                  <div className={c.conceptoCabeza}>
                    <input
                      className={c.conceptoNombre}
                      value={l.nombre}
                      disabled={nota !== null}
                      onChange={(e) => ponLinea(l.key, { nombre: e.target.value })}
                      placeholder={t("cobrarHoy.conceptoPlaceholder")}
                      aria-label={t("cobrarHoy.conceptoPlaceholder")}
                    />
                    {nota === null && (
                      <button type="button" className={c.botonIcono} onClick={() => setLineas((prev) => prev.filter((x) => x.key !== l.key))}
                        aria-label={t("cobrarHoy.quitar")} title={t("cobrarHoy.quitar")}>
                        <Trash2 size={14} aria-hidden />
                      </button>
                    )}
                  </div>
                  <label className={c.campo}>
                    <span className={c.campoRotulo}>{t("cobrarHoy.importe")}</span>
                    <input
                      className={c.input}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      value={l.texto}
                      disabled={nota !== null}
                      onChange={(e) => ponLinea(l.key, { texto: e.target.value })}
                    />
                  </label>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pago recibido hoy. Sin "billing.charge" (p. ej. un doctor) no se ofrece: se
            crea el cargo y lo cobra quien tiene el permiso. */}
        {!puedeCobrar ? (
          <div className={c.bloque}>
            <h3 className={c.bloqueTitulo}>{t("cobrarHoy.pagoTitulo")}</h3>
            <p className={c.ayuda}>{t("cobrarHoy.sinPermisoCobro")}</p>
          </div>
        ) : (
        <div className={c.bloque}>
          <div className={`${c.bloqueCabeza} ${h.cabeza}`}>
            <h3 className={c.bloqueTitulo}>{t("cobrarHoy.pagoTitulo")}</h3>
            <div className={c.bloqueAcciones}>
              <button type="button" className={c.enlace} onClick={() => { setPagoTocado(false); setPago(""); }} disabled={guardando}>
                {t("cobrarHoy.todo")}
              </button>
              <button type="button" className={`${c.enlace} ${c.enlaceSuave}`} onClick={() => { setPagoTocado(true); setPago("0"); }} disabled={guardando}>
                {t("cobrarHoy.sinPago")}
              </button>
            </div>
          </div>
          <label className={c.campo}>
            <span className={c.campoRotulo}>{t("cobrarHoy.monto")}</span>
            <input
              className={c.input}
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={pagoTocado ? pago : comoTexto(vista.total)}
              onChange={(e) => { setPagoTocado(true); setPago(e.target.value); }}
              disabled={guardando}
            />
          </label>
          {pagoEfectivo > 0 && (
            <div className={c.campo}>
              <span className={c.campoRotulo}>{t("clinical.paymentModal.paymentMethod")}</span>
              <div className={c.metodos}>
                {METHODS.map((m) => {
                  const Icono = m.icon;
                  const activo = m.value === metodo;
                  return (
                    <button key={m.value} type="button" aria-pressed={activo}
                      className={`${c.metodo} ${activo ? c.metodoActivo : ""}`}
                      onClick={() => setMetodo(m.value)} disabled={guardando}>
                      <Icono size={14} aria-hidden /> {t(m.labelKey)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {pagoEfectivo > 0 && metodo !== "cash" && (
            <label className={c.campo}>
              <span className={c.campoRotulo}>{t("cobrarHoy.referencia")}</span>
              <input className={c.input} value={referencia} onChange={(e) => setReferencia(e.target.value)} disabled={guardando} />
            </label>
          )}
          {puedeEnviarComprobante && pagoEfectivo > 0 && (
            <label className={c.casilla}>
              <input type="checkbox" checked={comprobante} onChange={(e) => setComprobante(e.target.checked)} disabled={guardando} />
              <span>
                {t("cobrarHoy.comprobante")}
                <span className={`${c.ayuda} ${h.ayudaCasilla}`}>{t("cobrarHoy.comprobanteAyuda")}</span>
              </span>
            </label>
          )}
        </div>
        )}

        {/* Lo que va a quedar, antes de guardar */}
        <div className={c.totales} aria-live="polite">
          <div className={c.totalFila}>
            <span>{t("cobrarHoy.total")}</span>
            <span className={c.cifra}>{fmtMXNdec(vista.total)}</span>
          </div>
          <div className={c.totalFila}>
            <span>{t("cobrarHoy.pagaHoy")}</span>
            <span className={`${c.cifra} ${c.cifraExito}`}>{fmtMXNdec(vista.pago)}</span>
          </div>
          <div className={`${c.totalFila} ${c.totalFinal}`}>
            <span>{vista.saldoQueda > 0 ? t("cobrarHoy.quedaPorCobrar") : t("cobrarHoy.liquidada")}</span>
            <span className={`${c.cifra} ${c.cifraTotal} ${vista.saldoQueda > 0 ? c.cifraPeligro : c.cifraExito}`}>{fmtMXNdec(vista.saldoQueda)}</span>
          </div>
        </div>

        {vista.falta && lineas.length > 0 && (
          <p className={`${c.ayuda} ${c.cifraPeligro}`} role="alert">
            {t(LLAVE_FALTA[vista.falta], { total: fmtMXNdec(vista.total) })}
          </p>
        )}
        {pendientes && pendientes.cuantas > 0 && (
          <div className={`${c.aviso} ${c.avisoAlerta}`}>
            <span>{t("cobrarHoy.pendientes", { monto: fmtMXNdec(pendientes.saldo), n: pendientes.cuantas })}</span>
            {onCobrarPendientes && (
              <button type="button" className={`${c.enlace} ${h.enlaceAviso}`} onClick={onCobrarPendientes} disabled={guardando || nota !== null}>
                {t("cobrarHoy.cobrarPendientes")}
              </button>
            )}
          </div>
        )}

        {nota && (
          <p className={`${c.aviso} ${c.avisoAlerta}`}>{t("cobrarHoy.notaCreada", { folio: nota.invoiceNumber })}</p>
        )}
      </div>

      {freno.visible && <AvisoCajaCerrada onCobrarDeTodosModos={() => guardar(true)} ocupado={guardando} />}

      <DialogFooter className={c.pie}>
        <ButtonNew variant="ghost" onClick={onClose} disabled={guardando}>
          {nota ? t("cobrarHoy.cerrar") : t("common.cancel")}
        </ButtonNew>
        <ButtonNew variant="primary" onClick={() => guardar()} disabled={guardando || vista.falta !== null}>
          {guardando ? t("cobrarHoy.guardando") : (
            <>
              <Check size={14} aria-hidden />{" "}
              {pagoEfectivo > 0 ? t("cobrarHoy.boton", { monto: fmtMXNdec(vista.pago) }) : t("cobrarHoy.botonSinPago")}
            </>
          )}
        </ButtonNew>
      </DialogFooter>
    </>
  );
}
