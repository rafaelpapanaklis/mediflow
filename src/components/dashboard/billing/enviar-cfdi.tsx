"use client";

// «Enviar CFDI» (ws1-t8, auditoría CFDI F-17): mandarle al paciente su factura timbrada por
// correo (Facturapi manda PDF + XML) o por WhatsApp (PDF adjunto + enlace de descarga, solo con
// la ventana de 24 h abierta). Lo usa el detalle de la factura, ya timbrada, y el formulario de
// timbrado («Mandársela al paciente al timbrar»). El servidor decide y lo deja en Movimientos:
// /api/cfdi/[cfdiId]/enviar.

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Mail, MessageCircle, Send } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocale } from "@/i18n/i18n-provider";
import { CLASES_FACTURA_REDISENO, clasesFactura as c } from "@/components/dashboard/factura-rediseno/raiz";

const TEXTOS = {
  es: {
    titulo: "Enviar la factura (CFDI) al paciente",
    boton: "Enviar CFDI",
    cargando: "Cargando…",
    correo: "Por correo",
    correoAyuda: "Le llegan el PDF y el XML. Puedes poner hasta 3 correos separados por coma.",
    correoBtn: "Enviar por correo",
    whatsapp: "Por WhatsApp",
    whatsappAyuda: "Sale el PDF y un enlace para bajar el PDF y el XML (sirve 7 días).",
    whatsappBtn: "Enviar por WhatsApp",
    a: "Para",
    enviando: "Enviando…",
    cerrar: "Cerrar",
    okCorreo: "Factura enviada por correo",
    okWhatsapp: "Factura enviada por WhatsApp",
    noVigente: "Este CFDI ya no está vigente: no se manda.",
    sinPermiso: "Tu usuario no puede mandar facturas (permiso «Crear facturas»).",
    error: "No se pudo enviar.",
  },
  en: {
    titulo: "Send the tax invoice (CFDI) to the patient",
    boton: "Send CFDI",
    cargando: "Loading…",
    correo: "By email",
    correoAyuda: "They get the PDF and the XML. Up to 3 addresses separated by commas.",
    correoBtn: "Send by email",
    whatsapp: "By WhatsApp",
    whatsappAyuda: "Sends the PDF and a link to download the PDF and XML (valid 7 days).",
    whatsappBtn: "Send by WhatsApp",
    a: "To",
    enviando: "Sending…",
    cerrar: "Close",
    okCorreo: "Invoice sent by email",
    okWhatsapp: "Invoice sent by WhatsApp",
    noVigente: "This CFDI is no longer valid: it is not sent.",
    sinPermiso: "Your user can't send invoices («Create invoices» permission).",
    error: "Could not send it.",
  },
} as const;

export function textosEnvioCfdi(locale: string | null | undefined) {
  return (locale ?? "").startsWith("en") ? TEXTOS.en : TEXTOS.es;
}

interface Vista {
  vigente: boolean;
  correo: string | null;
  puedeEnviar: boolean;
  whatsapp: { modo: "text" | "blocked"; motivo: string | null; destino: string | null };
}

/** POST al servidor. Devuelve el error legible o null si salió. */
export async function enviarCfdi(cfdiId: string, cuerpo: { canal: "correo"; correos: string } | { canal: "whatsapp" }): Promise<string | null> {
  try {
    const res = await fetch(`/api/cfdi/${encodeURIComponent(cfdiId)}/enviar`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo),
    });
    if (res.ok) return null;
    const d = await res.json().catch(() => null);
    return typeof d?.error === "string" && d.error ? d.error : `Error ${res.status}`;
  } catch {
    return "Sin conexión / No connection.";
  }
}

export function EnviarCfdiDialog({ open, cfdiId, onClose, rediseno = false }: {
  open: boolean;
  /** null mientras se resuelve; el diálogo espera. */
  cfdiId: string | null;
  onClose: () => void;
  rediseno?: boolean;
}) {
  const locale = useLocale();
  const tx = textosEnvioCfdi(locale);
  const cx = (vieja: string, nueva: string) => (rediseno ? nueva : vieja);
  const [vista, setVista] = useState<Vista | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [correos, setCorreos] = useState("");
  const [enviando, setEnviando] = useState<null | "correo" | "whatsapp">(null);

  useEffect(() => {
    if (!open || !cfdiId) { setVista(null); setError(null); return; }
    let vivo = true;
    fetch(`/api/cfdi/${encodeURIComponent(cfdiId)}/enviar`)
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!vivo) return;
        if (!r.ok) { setError(d?.error ?? tx.error); return; }
        setVista(d);
        setCorreos(d?.correo ?? "");
      })
      .catch(() => { if (vivo) setError(tx.error); });
    return () => { vivo = false; };
  }, [open, cfdiId, tx.error]);

  async function mandar(canal: "correo" | "whatsapp") {
    if (!cfdiId) return;
    setEnviando(canal);
    const err = await enviarCfdi(cfdiId, canal === "correo" ? { canal, correos } : { canal });
    setEnviando(null);
    if (err) { toast.error(err, { duration: 8000 }); return; }
    toast.success(canal === "correo" ? tx.okCorreo : tx.okWhatsapp);
    onClose();
  }

  const ocupado = enviando !== null;
  const bloqueadoEnvio = vista ? (!vista.vigente ? tx.noVigente : !vista.puedeEnviar ? tx.sinPermiso : null) : null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !ocupado) onClose(); }}>
      <DialogContent className={cx("max-w-md bg-card text-foreground border border-border", `${CLASES_FACTURA_REDISENO} ${c.modal} ${c.modalEstrecho}`)} data-enviar-cfdi>
        <DialogHeader className={rediseno ? c.cabecera : undefined}>
          <DialogTitle className={cx("text-foreground font-bold", c.titulo)}>{tx.titulo}</DialogTitle>
        </DialogHeader>
        <div className={cx("px-6 py-4 space-y-4 flex-1 overflow-y-auto min-h-0", c.cuerpo)}>
          {!vista && !error && <p className={cx("text-xs text-muted-foreground", c.texto)}>{tx.cargando}</p>}
          {error && <p role="alert" className="text-xs" style={{ color: "var(--danger)" }}>{error}</p>}
          {bloqueadoEnvio && <p role="alert" className="text-xs" style={{ color: "var(--danger)" }}>{bloqueadoEnvio}</p>}
          {vista && !bloqueadoEnvio && (
            <>
              <section className={cx("space-y-1.5", c.campo)} data-envio-correo>
                <Label htmlFor="cfdi-envio-correo">{tx.correo}</Label>
                <Input id="cfdi-envio-correo" type="text" inputMode="email" autoComplete="off"
                  value={correos} onChange={(e) => setCorreos(e.target.value)} placeholder="paciente@correo.com" />
                <p className={cx("text-[11px] text-muted-foreground", c.texto)}>{tx.correoAyuda}</p>
                <ButtonNew variant="primary" size="sm" icon={<Mail size={14} aria-hidden />}
                  onClick={() => mandar("correo")} disabled={ocupado || !correos.trim()}>
                  {enviando === "correo" ? tx.enviando : tx.correoBtn}
                </ButtonNew>
              </section>
              <section className={cx("space-y-1.5", c.campo)} data-envio-whatsapp>
                <Label>{tx.whatsapp}</Label>
                {vista.whatsapp.destino && (
                  <p className={cx("text-xs", c.texto)}>{tx.a}: <strong>{vista.whatsapp.destino}</strong></p>
                )}
                {vista.whatsapp.modo === "blocked" ? (
                  <p className="text-[11px]" style={{ color: "var(--warning-strong)" }} data-motivo-whatsapp>{vista.whatsapp.motivo}</p>
                ) : (
                  <>
                    <p className={cx("text-[11px] text-muted-foreground", c.texto)}>{tx.whatsappAyuda}</p>
                    <ButtonNew variant="secondary" size="sm" icon={<MessageCircle size={14} aria-hidden />}
                      onClick={() => mandar("whatsapp")} disabled={ocupado}>
                      {enviando === "whatsapp" ? tx.enviando : tx.whatsappBtn}
                    </ButtonNew>
                  </>
                )}
              </section>
            </>
          )}
        </div>
        <DialogFooter className={rediseno ? c.pie : undefined}>
          <ButtonNew variant="ghost" onClick={onClose} disabled={ocupado}>{tx.cerrar}</ButtonNew>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Lo que se pide en el formulario de timbrado (apagado por defecto: lo decide quien timbra). */
export interface EnvioAlTimbrar { correo: boolean; whatsapp: boolean }

export function OpcionesEnvioAlTimbrar({ valor, onChange, hayCorreo, rediseno = false }: {
  valor: EnvioAlTimbrar;
  onChange: (v: EnvioAlTimbrar) => void;
  /** Sin correo capturado no se puede marcar «por correo». */
  hayCorreo: boolean;
  rediseno?: boolean;
}) {
  const locale = useLocale();
  const en = (locale ?? "").startsWith("en");
  const cx = (vieja: string, nueva: string) => (rediseno ? nueva : vieja);
  return (
    <fieldset className={cx("space-y-1.5", c.campo)} data-envio-al-timbrar>
      <legend className="text-xs font-medium">{en ? "Send it to the patient when stamped" : "Mandársela al paciente al timbrar"}</legend>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={valor.correo && hayCorreo} disabled={!hayCorreo}
          onChange={(e) => onChange({ ...valor, correo: e.target.checked })} />
        {en ? "By email (PDF + XML) to the address above" : "Por correo (PDF + XML) al correo de arriba"}
      </label>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={valor.whatsapp}
          onChange={(e) => onChange({ ...valor, whatsapp: e.target.checked })} />
        {en ? "By WhatsApp (only if the patient wrote in the last 24 h)" : "Por WhatsApp (solo si el paciente escribió en las últimas 24 h)"}
      </label>
    </fieldset>
  );
}

/** Tras timbrar: manda lo que se pidió y avisa con un toast por canal. No lanza. */
export async function enviarTrasTimbrar(cfdiId: string, pedir: EnvioAlTimbrar, correo: string, locale: string | null | undefined): Promise<void> {
  const tx = textosEnvioCfdi(locale);
  if (pedir.correo && correo.trim()) {
    const err = await enviarCfdi(cfdiId, { canal: "correo", correos: correo });
    if (err) toast.error(`${tx.correo}: ${err}`, { duration: 8000 }); else toast.success(tx.okCorreo);
  }
  if (pedir.whatsapp) {
    const err = await enviarCfdi(cfdiId, { canal: "whatsapp" });
    if (err) toast.error(`${tx.whatsapp}: ${err}`, { duration: 10000 }); else toast.success(tx.okWhatsapp);
  }
}

/**
 * Todo lo del envío que necesita el detalle de la factura, en un solo hook para tocar lo mínimo
 * del modal (lo editan varias pantallas a la vez): el diálogo «Enviar CFDI», las casillas del
 * formulario de timbrado y el envío después de timbrar. Se limpia al cambiar de factura.
 */
export function useEnvioCfdi(invoiceId: string | null | undefined) {
  const locale = useLocale();
  const [abierto, setAbierto] = useState(false);
  const [cfdiId, setCfdiId] = useState<string | null>(null);
  const [alTimbrar, setAlTimbrar] = useState<EnvioAlTimbrar>({ correo: false, whatsapp: false });
  useEffect(() => { setAbierto(false); setCfdiId(null); setAlTimbrar({ correo: false, whatsapp: false }); }, [invoiceId]);
  const abrir = useCallback((id: string | null) => {
    if (!id) { toast.error(textosEnvioCfdi(locale).error); return; }
    setCfdiId(id);
    setAbierto(true);
  }, [locale]);
  const cerrar = useCallback(() => setAbierto(false), []);
  const trasTimbrar = useCallback((id: string, correo: string) => enviarTrasTimbrar(id, alTimbrar, correo, locale), [alTimbrar, locale]);
  return { abierto, cfdiId, abrir, cerrar, alTimbrar, setAlTimbrar, trasTimbrar };
}

/** El botón «Enviar CFDI» junto a «PDF» y «XML» del detalle de una factura timbrada. */
export function BotonEnviarCfdi({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  const locale = useLocale();
  return (
    <ButtonNew variant="secondary" icon={<Send size={14} aria-hidden />} onClick={onClick} disabled={disabled} data-enviar-cfdi-btn>
      {textosEnvioCfdi(locale).boton}
    </ButtonNew>
  );
}
