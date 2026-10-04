"use client";

// «CFDI ante el SAT» (ws1-t3, auditoría CFDI F-02, F-03, F-16): los CFDI de una
// factura con su estado real en el SAT y lo que se puede hacer con cada uno —
// consultar el estado, cancelar (motivos 01-04), sustituir y nota de crédito.
// Lo monta el detalle de la factura cuando ya tiene CFDI. El servidor decide
// todo y lo deja en Movimientos; aquí solo se pregunta y se pinta.
//   GET  /api/cfdi/factura/[invoiceId]
//   POST /api/cfdi/[cfdiId]/estado | cancelar | nota-credito

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { RefreshCw, XCircle, Repeat, ReceiptText } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocale } from "@/i18n/i18n-provider";
import { fmtMXNdec } from "@/lib/format";
import { CLASES_FACTURA_REDISENO, clasesFactura as c } from "@/components/dashboard/factura-rediseno/raiz";
import { MOTIVOS_CANCELACION, disponibleParaNota, motivo03Permitido } from "@/lib/invoices/cfdi-cancelacion";
import {
  accionesDe, estadoPintado, sustitutoDe, notasDe, textosCfdiSat, metodoDeDevolucionPorForma,
  FORMAS_DEVOLUCION, type CfdiVista, type RespuestaCfdisFactura,
} from "./cfdi-ante-el-sat-core";

async function postJson(url: string, body?: unknown): Promise<{ ok: boolean; data: any }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  } catch {
    return { ok: false, data: { error: "Sin conexión / No connection." } };
  }
}

const corto = (uuid: string) => (uuid.length > 13 ? `${uuid.slice(0, 8)}…${uuid.slice(-4)}` : uuid);

export function CfdiAnteElSat({
  invoiceId, recargar = 0, onSustituir, onMutated, rediseno = false,
}: {
  invoiceId: string;
  /** Súbelo para volver a pedir la lista (p. ej. después de timbrar un sustituto). */
  recargar?: number;
  /** Abre el formulario de timbrado de la factura en modo «sustituye a cfdiId». */
  onSustituir?: (cfdiId: string) => void;
  onMutated?: () => void | Promise<void>;
  rediseno?: boolean;
}) {
  const locale = useLocale();
  const en = (locale ?? "").startsWith("en");
  const tx = textosCfdiSat(locale);
  const cx = (vieja: string, nueva: string) => (rediseno ? nueva : vieja);

  const [datos, setDatos] = useState<RespuestaCfdisFactura | null>(null);
  const [consultando, setConsultando] = useState<string | null>(null);
  const [cancelando, setCancelando] = useState<{ cfdi: CfdiVista; motivo: string; sustituto: CfdiVista | null } | null>(null);
  const [nota, setNota] = useState<CfdiVista | null>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await fetch(`/api/cfdi/factura/${encodeURIComponent(invoiceId)}`);
      if (!r.ok) { setDatos(null); return; }
      setDatos(await r.json());
    } catch { setDatos(null); }
  }, [invoiceId]);

  useEffect(() => { void cargar(); }, [cargar, recargar]);

  if (!datos || datos.cfdis.length === 0) return null;

  async function consultar(cfdi: CfdiVista) {
    setConsultando(cfdi.id);
    const antes = estadoPintado(cfdi);
    const { ok, data } = await postJson(`/api/cfdi/${encodeURIComponent(cfdi.id)}/estado`);
    setConsultando(null);
    if (!ok) { toast.error(data?.error ?? tx.error, { duration: 8000 }); return; }
    if (data?.facturaLiberada) toast.success(tx.liberada, { duration: 8000 });
    else toast.success(data?.cfdi && estadoPintado(data.cfdi) !== antes ? tx.actualizado : tx.sinCambios);
    await cargar();
    if (data?.facturaLiberada || data?.cfdi?.status === "cancelled") await onMutated?.();
  }

  const ctx = { listo: datos.listo, admin: datos.puedeCancelar, invoiceCfdiUuid: datos.invoiceCfdiUuid };

  return (
    <section className={cx("space-y-2 rounded-lg border border-border p-3", c.campo)} data-cfdi-ante-el-sat>
      <p className="text-xs font-semibold">{tx.titulo}</p>
      {!datos.listo && datos.sqlPendiente && datos.puedeCancelar && (
        <p className={cx("text-[11px] text-muted-foreground", c.texto)} data-sql-pendiente>{tx.sqlPendiente(datos.sqlPendiente)}</p>
      )}
      <ul className="space-y-2">
        {datos.cfdis.map((cfdi) => {
          const estado = estadoPintado(cfdi);
          const acc = accionesDe(cfdi, datos.cfdis, ctx);
          const sust = sustitutoDe(datos.cfdis, cfdi);
          const color = estado === "cancelado" ? "var(--danger)"
            : estado === "vigente" ? "var(--success-strong)"
            : "var(--warning-strong)";
          return (
            <li key={cfdi.id} className="text-xs space-y-1" data-cfdi-fila={cfdi.id} data-estado={estado}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <strong>{cfdi.tipoComprobante === "E" ? tx.tipoE : tx.tipoI}{cfdi.paymentId ? ` ${tx.porPago}` : ""}</strong>
                <span className="font-mono">{corto(cfdi.uuid)}</span>
                <span>{fmtMXNdec(cfdi.total)}</span>
                <span style={{ color }} data-estado-texto>{tx.estados[estado]}</span>
              </div>
              {cfdi.relationType === "04" && cfdi.relatedUuid && (
                <p className="text-[11px] text-muted-foreground">{tx.sustituyeA} {corto(cfdi.relatedUuid)}</p>
              )}
              {cfdi.relationType === "01" && cfdi.relatedUuid && (
                <p className="text-[11px] text-muted-foreground">{tx.notaDe} {corto(cfdi.relatedUuid)}</p>
              )}
              {sust && <p className="text-[11px]" style={{ color: "var(--warning-strong)" }}>{tx.sustituidoPor} {corto(sust.uuid)}</p>}
              <div className="flex flex-wrap gap-2">
                {acc.consultar && (
                  <ButtonNew variant="ghost" size="sm" icon={<RefreshCw size={13} aria-hidden />} onClick={() => consultar(cfdi)} disabled={consultando !== null}>
                    {consultando === cfdi.id ? tx.consultando : tx.consultar}
                  </ButtonNew>
                )}
                {acc.cancelarSustituido && sust && (
                  <ButtonNew variant="danger" size="sm" icon={<XCircle size={13} aria-hidden />}
                    onClick={() => setCancelando({ cfdi, motivo: "01", sustituto: sust })}>
                    {tx.cancelarSustituido}
                  </ButtonNew>
                )}
                {acc.cancelar && !sust && (
                  <ButtonNew variant="danger" size="sm" icon={<XCircle size={13} aria-hidden />}
                    onClick={() => setCancelando({ cfdi, motivo: "02", sustituto: null })}>
                    {tx.cancelar}
                  </ButtonNew>
                )}
                {acc.sustituir && !sust && onSustituir && (
                  <ButtonNew variant="secondary" size="sm" icon={<Repeat size={13} aria-hidden />} onClick={() => onSustituir(cfdi.id)}>
                    {tx.sustituir}
                  </ButtonNew>
                )}
                {acc.notaCredito && (
                  <ButtonNew variant="secondary" size="sm" icon={<ReceiptText size={13} aria-hidden />} onClick={() => setNota(cfdi)}>
                    {tx.notaCredito}
                  </ButtonNew>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {cancelando && (
        <DialogoCancelar
          {...cancelando}
          cobrado={datos.cobrado}
          en={en}
          rediseno={rediseno}
          onClose={() => setCancelando(null)}
          onHecho={async () => { setCancelando(null); await cargar(); await onMutated?.(); }}
        />
      )}
      {nota && (
        <DialogoNota
          cfdi={nota}
          disponible={disponibleParaNota(nota.total, notasDe(datos.cfdis, nota).map((n) => n.total))}
          saldo={datos.saldo}
          rediseno={rediseno}
          onClose={() => setNota(null)}
          onHecho={async () => { setNota(null); await cargar(); await onMutated?.(); }}
        />
      )}
    </section>
  );
}

function DialogoCancelar({ cfdi, motivo: motivoInicial, sustituto, en, rediseno, onClose, onHecho, cobrado }: {
  cfdi: CfdiVista; motivo: string; sustituto: CfdiVista | null; en: boolean; rediseno: boolean;
  /** C-42: lo cobrado de la factura; con dinero, el motivo 03 no se ofrece. */
  cobrado?: number;
  onClose: () => void; onHecho: () => void | Promise<void>;
}) {
  const locale = useLocale();
  const tx = textosCfdiSat(locale);
  const cx = (vieja: string, nueva: string) => (rediseno ? nueva : vieja);
  const [motivo, setMotivo] = useState(motivoInicial);
  const [razon, setRazon] = useState("");
  const [enviando, setEnviando] = useState(false);
  const esGlobal = (cfdi.receptorRfc ?? "").toUpperCase() === "XAXX010101000";
  const sin03 = !motivo03Permitido(cobrado);
  const motivos = MOTIVOS_CANCELACION.filter((m) => (m.clave !== "04" || esGlobal) && (m.clave !== "01" || !!sustituto) && (m.clave !== "03" || !sin03));
  const def = MOTIVOS_CANCELACION.find((m) => m.clave === motivo);
  const falta01 = motivo === "01" && !sustituto;

  async function pedir() {
    setEnviando(true);
    const { ok, data } = await postJson(`/api/cfdi/${encodeURIComponent(cfdi.id)}/cancelar`, {
      motive: motivo, reason: razon, ...(motivo === "01" && sustituto ? { sustitutoCfdiId: sustituto.id } : {}),
    });
    setEnviando(false);
    if (!ok) { toast.error(data?.error ?? tx.error, { duration: 10000 }); if (data?.code === "YA_CANCELADO_FUERA") await onHecho(); return; }
    toast.success(
      data.status === "cancelled" ? tx.cOkAceptada : data.cancellationStatus === "pending" ? tx.cOkPendiente : tx.cOkVerificando,
      { duration: 8000 },
    );
    await onHecho();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !enviando) onClose(); }}>
      <DialogContent className={cx("max-w-md bg-card text-foreground border border-border", `${CLASES_FACTURA_REDISENO} ${c.modal} ${c.modalEstrecho}`)} data-dialogo-cancelar-cfdi>
        <DialogHeader className={rediseno ? c.cabecera : undefined}>
          <DialogTitle className={cx("text-foreground font-bold", c.titulo)}>{tx.cTitulo}</DialogTitle>
        </DialogHeader>
        <div className={cx("px-6 py-4 space-y-3 flex-1 overflow-y-auto min-h-0", c.cuerpo)}>
          <p className={cx("text-xs", c.texto)}><span className="font-mono">{cfdi.uuid}</span> · {fmtMXNdec(cfdi.total)}</p>
          <div className={cx("space-y-1.5", c.campo)}>
            <Label htmlFor="cfdi-cancel-motivo">{tx.cMotivo}</Label>
            <select id="cfdi-cancel-motivo" className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              value={motivo} onChange={(e) => setMotivo(e.target.value)} disabled={enviando}>
              {motivos.map((m) => <option key={m.clave} value={m.clave}>{en ? m.en : m.es}</option>)}
            </select>
            {def && <p className={cx("text-[11px] text-muted-foreground", c.texto)}>{en ? def.detalleEn : def.detalleEs}</p>}
            {!sustituto && <p className={cx("text-[11px] text-muted-foreground", c.texto)}>{tx.cSin01}</p>}
            {sin03 && (
              <p className={cx("text-[11px] text-muted-foreground", c.texto)} data-sin-motivo-03>
                {en
                  ? "Reason 03 (the operation didn't take place) isn't offered: this invoice has money collected. If you returned it, issue a credit note with the refund (with a valid CFDI the refund can't be recorded directly)."
                  : "No se ofrece el motivo 03 (no se llevó a cabo la operación): esta factura tiene dinero cobrado. Si lo devolviste, emite una nota de crédito con la devolución (con un CFDI vigente el reembolso no se registra directo)."}
              </p>
            )}
            {motivo === "01" && sustituto && (
              <p className="text-[11px]">{tx.cSustituto}: <span className="font-mono">{sustituto.uuid}</span></p>
            )}
          </div>
          <div className={cx("space-y-1.5", c.campo)}>
            <Label htmlFor="cfdi-cancel-razon">{tx.cRazon}</Label>
            <Input id="cfdi-cancel-razon" value={razon} onChange={(e) => setRazon(e.target.value)} placeholder={tx.cRazonPh} maxLength={300} disabled={enviando} />
          </div>
          <p className="text-[11px]" style={{ color: cfdi.aceptacion.requiere ? "var(--warning-strong)" : undefined }} data-aviso-aceptacion={cfdi.aceptacion.requiere ? "si" : "no"}>
            {cfdi.aceptacion.requiere ? tx.cAceptacion : tx.cSinAceptacion[cfdi.aceptacion.razon ?? "monto"]}
          </p>
          {cfdi.fueraDePlazo && <p className="text-[11px]" style={{ color: "var(--warning-strong)" }}>{tx.cFueraPlazo}</p>}
          <p className="text-[11px]" style={{ color: "var(--danger)" }}>{tx.cIrreversible}</p>
        </div>
        <DialogFooter className={rediseno ? c.pie : undefined}>
          <ButtonNew variant="ghost" onClick={onClose} disabled={enviando}>{tx.cancelarBtn}</ButtonNew>
          <ButtonNew variant="danger" onClick={pedir} disabled={enviando || falta01 || razon.trim().length < 5}>
            {enviando ? tx.cEnviando : tx.cBoton}
          </ButtonNew>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DialogoNota({ cfdi, disponible, rediseno, onClose, onHecho, saldo }: {
  cfdi: CfdiVista; disponible: number; rediseno: boolean;
  /** N-26: lo que la nota todavía debe (una bonificación sin devolución no puede pasar de ahí). */
  saldo?: number;
  onClose: () => void; onHecho: () => void | Promise<void>;
}) {
  const locale = useLocale();
  const tx = textosCfdiSat(locale);
  const cx = (vieja: string, nueva: string) => (rediseno ? nueva : vieja);
  const [monto, setMonto] = useState("");
  const [razon, setRazon] = useState("");
  const [devolver, setDevolver] = useState(true);
  const [forma, setForma] = useState("");
  const [enviando, setEnviando] = useState(false);
  const montoNum = Number(monto);
  // N-26 (segunda auditoría): sin devolver dinero, la nota de crédito solo baja lo que se debe.
  const tope = !devolver && typeof saldo === "number" ? Math.min(disponible, Math.max(0, saldo)) : disponible;
  const valido = isFinite(montoNum) && montoNum > 0 && montoNum <= tope + 0.001 && razon.trim().length >= 5 && !!forma;
  const en = (locale ?? "").startsWith("en");
  const f$ = (x: number) => fmtMXNdec(x);
  // El porqué del botón apagado, a la vista (antes se apagaba sin decir nada).
  const porQue = enviando ? null
    : !(isFinite(montoNum) && montoNum > 0) ? (en ? "Enter the amount." : "Escribe el monto.")
    : montoNum > disponible + 0.001 ? (en ? `It can't exceed ${f$(disponible)} available on this CFDI.` : `No puede pasar de ${f$(disponible)} disponibles en este CFDI.`)
    : montoNum > tope + 0.001 ? (en ? `Without returning money it only lowers what is owed (${f$(tope)}). If you return money, tick «the money is returned».` : `Sin devolver dinero solo baja lo que se debe (${f$(tope)}). Si devuelves dinero, marca «se le devuelve el dinero».`)
    : razon.trim().length < 5 ? (en ? "Write the reason (at least 5 letters)." : "Escribe el motivo (al menos 5 letras).")
    : !forma ? (en ? "Choose the payment form." : "Elige la forma de pago.")
    : null;

  async function timbrar() {
    setEnviando(true);
    const { ok, data } = await postJson(`/api/cfdi/${encodeURIComponent(cfdi.id)}/nota-credito`, {
      monto: montoNum, razon, devolverDinero: devolver, formaPago: forma,
      ...(devolver ? { metodoDevolucion: metodoDeDevolucionPorForma(forma) } : {}),
    });
    setEnviando(false);
    if (!ok) { toast.error(data?.error ?? tx.error, { duration: 10000 }); return; }
    toast.success(tx.nOk);
    if (data?.warning) toast.error(data.warning, { duration: 15000 });
    await onHecho();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !enviando) onClose(); }}>
      <DialogContent className={cx("max-w-md bg-card text-foreground border border-border", `${CLASES_FACTURA_REDISENO} ${c.modal} ${c.modalEstrecho}`)} data-dialogo-nota-credito>
        <DialogHeader className={rediseno ? c.cabecera : undefined}>
          <DialogTitle className={cx("text-foreground font-bold", c.titulo)}>{tx.nTitulo}</DialogTitle>
        </DialogHeader>
        <div className={cx("px-6 py-4 space-y-3 flex-1 overflow-y-auto min-h-0", c.cuerpo)}>
          <p className={cx("text-[11px] text-muted-foreground", c.texto)}>{tx.nAyuda}</p>
          <p className={cx("text-xs", c.texto)}>{tx.nDisponible}: <strong>{fmtMXNdec(disponible)}</strong></p>
          <div className={cx("space-y-1.5", c.campo)}>
            <Label htmlFor="cfdi-nota-monto">{tx.nMonto}</Label>
            <Input id="cfdi-nota-monto" type="number" inputMode="decimal" min={0} step="0.01" value={monto}
              onChange={(e) => setMonto(e.target.value)} disabled={enviando} />
          </div>
          <div className={cx("space-y-1.5", c.campo)}>
            <Label htmlFor="cfdi-nota-razon">{tx.nRazon}</Label>
            <Input id="cfdi-nota-razon" value={razon} onChange={(e) => setRazon(e.target.value)} placeholder={tx.nRazonPh} maxLength={300} disabled={enviando} />
          </div>
          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" checked={devolver} onChange={(e) => setDevolver(e.target.checked)} disabled={enviando} />
            <span>{tx.nDevolver}</span>
          </label>
          <div className={cx("space-y-1.5", c.campo)}>
            <Label htmlFor="cfdi-nota-forma">{devolver ? tx.nForma : tx.nFormaBonif}</Label>
            <select id="cfdi-nota-forma" className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              value={forma} onChange={(e) => setForma(e.target.value)} disabled={enviando}>
              <option value="">—</option>
              {FORMAS_DEVOLUCION.map((f) => <option key={f.clave} value={f.clave}>{f.clave} · {f.descripcion}</option>)}
            </select>
          </div>
        </div>
        <DialogFooter className={rediseno ? c.pie : undefined}>
          <ButtonNew variant="ghost" onClick={onClose} disabled={enviando}>{tx.cancelarBtn}</ButtonNew>
          {porQue && <p className="text-[11px] text-muted-foreground mr-auto" data-nota-porque>{porQue}</p>}
          <ButtonNew variant="primary" onClick={timbrar} disabled={enviando || !valido}>
            {enviando ? tx.nTimbrando : tx.nBoton}
          </ButtonNew>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
