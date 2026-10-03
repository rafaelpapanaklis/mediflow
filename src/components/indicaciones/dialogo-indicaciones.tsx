"use client";

// «Indicaciones de cuidado» de una cita (ws1-t10, mejora 12): elegir qué hojas
// darle al paciente (vienen marcadas las que proponen los procedimientos de la
// cita), ver lo que recibirá y mandarlo por WhatsApp o abrir el PDF para
// imprimir. Si el WhatsApp no puede salir (ventana de 24 h sin plantilla, sin
// teléfono, sin conexión) lo dice ANTES y deja el PDF.
//
// Es un <Dialog> de Radix: el panel de la cita vive en la agenda y otros
// cuadros (cobrar, editar) también son de Radix; anidar una capa propia
// heredaría su `pointer-events: none` (ver modal-pedir-anticipo.tsx).

import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, FileDown, Info, Loader2, MessageCircle, Printer } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { CLASES_FACTURA_REDISENO, clasesFactura as c } from "@/components/dashboard/factura-rediseno/raiz";
import a from "@/components/dashboard/cobros-inventario-rediseno/anticipo.module.css";
import { conValores, useTextosIndicaciones } from "@/lib/indicaciones/textos";
import type { ContextoCita } from "@/lib/indicaciones/tipos";
import s from "./indicaciones.module.css";

interface Props {
  appointmentId: string;
  open: boolean;
  onClose: () => void;
  /** Contexto ya cargado (p. ej. por la oferta al terminar la consulta): ahorra una petición. */
  inicial?: ContextoCita | null;
}

export function urlPdfIndicaciones(appointmentId: string, hojas: string[], descargar = false): string {
  const q = new URLSearchParams({ hojas: hojas.join(",") });
  if (descargar) q.set("download", "1");
  return `/api/indicaciones/cita/${encodeURIComponent(appointmentId)}/pdf?${q.toString()}`;
}

export function DialogoIndicaciones({ appointmentId, open, onClose, inicial = null }: Props) {
  const tx = useTextosIndicaciones();
  const confirmar = useConfirm();
  const [ctx, setCtx] = useState<ContextoCita | null>(inicial);
  const [cargando, setCargando] = useState(!inicial);
  const [fallo, setFallo] = useState(false);
  const [tick, setTick] = useState(0);
  const [elegidas, setElegidas] = useState<string[]>(() => inicial?.sugeridas ?? []);
  const [enviando, setEnviando] = useState(false);
  const [avisoEnvio, setAvisoEnvio] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (inicial && tick === 0) return;
    let vivo = true;
    setCargando(true);
    setFallo(false);
    fetch(`/api/indicaciones/cita/${encodeURIComponent(appointmentId)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        return (await r.json()) as ContextoCita;
      })
      .then((d) => {
        if (!vivo) return;
        setCtx(d);
        setElegidas(d.sugeridas);
      })
      .catch(() => vivo && setFallo(true))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [open, appointmentId, tick, inicial]);

  const sugeridas = useMemo(() => new Set(ctx?.sugeridas ?? []), [ctx]);
  const propuestas = (ctx?.indicaciones ?? []).filter((h) => sugeridas.has(h.id));
  const otras = (ctx?.indicaciones ?? []).filter((h) => !sugeridas.has(h.id));
  const seleccion = (ctx?.indicaciones ?? []).filter((h) => elegidas.includes(h.id));
  const motivo = ctx?.whatsapp.motivo ?? null;
  const waBloqueado = ctx?.whatsapp.modo === "blocked";

  const alternar = (id: string) =>
    setElegidas((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const enviar = useCallback(
    async (reenviar = false) => {
      if (elegidas.length === 0) {
        toast.error(tx.eligeUna);
        return;
      }
      setEnviando(true);
      setAvisoEnvio(null);
      try {
        const res = await fetch(`/api/indicaciones/cita/${encodeURIComponent(appointmentId)}/whatsapp`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hojas: elegidas, ...(reenviar ? { reenviar: true } : {}) }),
        });
        const out = await res.json().catch(() => ({}));
        if (res.ok) {
          if (out.modo === "template") {
            setAvisoEnvio(tx.enviadoAviso);
            toast.success(conValores(tx.enviadas, { destino: out.destino ?? "" }));
            return;
          }
          toast.success(conValores(out.conPdf ? tx.enviadasConPdf : tx.enviadas, { destino: out.destino ?? "" }));
          onClose();
          return;
        }
        if (out.code === "YA_ENVIADAS") {
          const hora = out.en
            ? new Date(out.en).toLocaleTimeString(tx.localeIntl, { hour: "2-digit", minute: "2-digit" })
            : "";
          const ok = await confirmar({
            title: tx.yaEnviadasTitulo,
            description: conValores(tx.yaEnviadasTexto, { hora }),
            confirmText: tx.yaEnviadasSi,
          });
          if (ok) {
            setEnviando(false);
            await enviar(true);
          }
          return;
        }
        const conocido = typeof out.code === "string" && out.code in tx.noWhatsapp;
        const texto = conocido
          ? tx.noWhatsapp[out.code as keyof typeof tx.noWhatsapp]
          : out.code === "ESTADO"
            ? tx.errorEstado
            : tx.errorEnvio;
        setAvisoEnvio(texto);
        toast.error(texto, { duration: 7000 });
      } catch {
        toast.error(tx.errorEnvio);
      } finally {
        setEnviando(false);
      }
    },
    [appointmentId, elegidas, confirmar, onClose, tx],
  );

  const abrirPdf = (descargar: boolean) => {
    if (elegidas.length === 0) {
      toast.error(tx.eligeUna);
      return;
    }
    // Sincrónico, dentro del clic: si no, el bloqueador de ventanas lo frena.
    window.open(urlPdfIndicaciones(appointmentId, elegidas, descargar), "_blank", "noopener");
  };

  // Función y no componente: un componente declarado aquí se volvería a montar en cada render y la casilla perdería el foco.
  const opcion = (h: ContextoCita["indicaciones"][number]) => (
    <li key={h.id}>
      <label className={s.opcion}>
        <input type="checkbox" checked={elegidas.includes(h.id)} onChange={() => alternar(h.id)} />
        <span className={s.opcionNombre}>{h.nombre}</span>
        {h.deFabrica && <span className={s.opcionEtiqueta}>{tx.deFabrica}</span>}
      </label>
    </li>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !enviando && onClose()}>
      <DialogContent className={`${CLASES_FACTURA_REDISENO} ${c.modal} ${s.raiz}`}>
        <DialogHeader className={c.cabecera}>
          <DialogTitle className={c.titulo}>{tx.dialogoTitulo}</DialogTitle>
        </DialogHeader>

        <div className={c.cuerpo}>
          {ctx && <p className={s.para}>{conValores(tx.dialogoPara, { paciente: ctx.paciente })}</p>}
          {cargando ? (
            <div className={a.espera} role="status">
              <Loader2 size={16} className="animate-spin" aria-hidden /> {tx.cargando}
            </div>
          ) : fallo || !ctx ? (
            <>
              <p className={`${a.nota} ${a.notaPeligro}`} role="alert">
                <AlertTriangle size={16} strokeWidth={1.75} aria-hidden />
                <span>{tx.errorCarga}</span>
              </p>
              <div>
                <ButtonNew variant="secondary" onClick={() => setTick((n) => n + 1)}>
                  {tx.reintentar}
                </ButtonNew>
              </div>
            </>
          ) : !ctx.admiteIndicaciones ? (
            <p className={`${a.nota} ${a.notaInfo}`}>
              <Info size={16} strokeWidth={1.75} aria-hidden />
              <span>{tx.errorEstado}</span>
            </p>
          ) : ctx.indicaciones.length === 0 ? (
            <p className={`${a.nota} ${a.notaInfo}`}>
              <Info size={16} strokeWidth={1.75} aria-hidden />
              <span>{tx.sinHojas}</span>
            </p>
          ) : (
            <>
              {/* Arriba, antes de elegir: por qué no hay «Enviar por WhatsApp» (o qué saldrá). */}
              {waBloqueado && motivo && (
                <p className={`${a.nota} ${a.notaAlerta}`} role="status">
                  <AlertTriangle size={16} strokeWidth={1.75} aria-hidden />
                  <span>{tx.noWhatsapp[motivo]}</span>
                </p>
              )}
              {ctx.whatsapp.modo === "template" && (
                <p className={`${a.nota} ${a.notaInfo}`}>
                  <Info size={16} strokeWidth={1.75} aria-hidden />
                  <span>{tx.avisoPlantilla}</span>
                </p>
              )}
              <div className={s.grupo}>
                <p className={s.grupoTitulo}>{tx.propuestas}</p>
                {propuestas.length > 0 ? (
                  <ul className={s.lista}>
                    {propuestas.map(opcion)}
                  </ul>
                ) : (
                  <p className={s.para} style={{ margin: 0 }}>
                    {tx.sinPropuestas}
                  </p>
                )}
              </div>
              {otras.length > 0 && (
                <div className={s.grupo}>
                  <p className={s.grupoTitulo}>{tx.otras}</p>
                  <ul className={s.lista}>
                    {otras.map(opcion)}
                  </ul>
                </div>
              )}

              {seleccion.length > 0 && (
                <div className={s.grupo}>
                  <p className={s.grupoTitulo}>{tx.vistaPrevia}</p>
                  {seleccion.map((h) => (
                    <div key={h.id} className={s.previa}>
                      {seleccion.length > 1 && <span className={s.previaTitulo}>{h.nombre}</span>}
                      {h.texto}
                    </div>
                  ))}
                </div>
              )}

              {avisoEnvio && (
                <p className={`${a.nota} ${a.notaAlerta}`} role="alert">
                  <AlertTriangle size={16} strokeWidth={1.75} aria-hidden />
                  <span>{avisoEnvio}</span>
                </p>
              )}
            </>
          )}
        </div>

        <DialogFooter className={c.pie}>
          <ButtonNew variant="ghost" onClick={onClose} disabled={enviando}>
            {tx.cerrar}
          </ButtonNew>
          {ctx?.admiteIndicaciones && ctx.indicaciones.length > 0 && (
            <>
              <ButtonNew
                variant="secondary"
                icon={<FileDown size={14} aria-hidden />}
                onClick={() => abrirPdf(true)}
                disabled={enviando || elegidas.length === 0}
              >
                {tx.descargarPdf}
              </ButtonNew>
              <ButtonNew
                variant={waBloqueado ? "primary" : "secondary"}
                icon={<Printer size={14} aria-hidden />}
                onClick={() => abrirPdf(false)}
                disabled={enviando || elegidas.length === 0}
              >
                {tx.verPdf}
              </ButtonNew>
              {!waBloqueado && (
                <ButtonNew
                  variant="primary"
                  icon={enviando ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <MessageCircle size={14} aria-hidden />}
                  onClick={() => enviar(false)}
                  disabled={enviando || elegidas.length === 0}
                >
                  {enviando ? tx.enviando : tx.enviarWhatsapp}
                </ButtonNew>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
