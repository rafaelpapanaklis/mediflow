"use client";

// «Pedir anticipo» (ws1-t3 fase 1-2) — desde la cita o desde la factura.
//
// El monto SUGERIDO lo trae el servidor (Configuración → Anticipos → panel);
// es editable, pero lo que de verdad se cobra lo valida SIEMPRE el servidor
// (10 ≤ monto ≤ total − pagado). Si la cita todavía no tiene factura, pide
// además el concepto (nombre + precio) con el que se crea.
//
// Dos CANALES independientes (fase 2): Mercado Pago (link) o transferencia
// (datos bancarios de la sede, texto + PDF). Si solo hay uno disponible, se
// usa directo sin preguntar; con los dos, un selector.
//
// Al pedirlo: siempre "Copiar texto" (paciente, monto, fecha/hora, plazo,
// link o datos bancarios); "Enviar por WhatsApp" solo si el paciente escribió
// en las últimas 24 h (si no, el botón se apaga y dice por qué — nunca
// intenta una plantilla sin encender: eso lo decide Configuración → Anticipos).
//
// Ajuste 3 (QA t2, hallazgo B1): este modal se abre DESDE el detalle de la
// factura, que YA es un <Dialog> de Radix (invoice-detail-modal.tsx). Un
// <div role="dialog"> a mano, por mucho z-index y position:fixed que lleve,
// hereda el `pointer-events: none` que Radix pone en todo lo que no sea SU
// PROPIO Content mientras un Dialog está abierto — el clic (y el teclado)
// atraviesan al de abajo. La única forma correcta de anidar es un <Dialog>
// de Radix de verdad: por eso este componente usa Dialog/DialogContent, no
// una capa propia.

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, Banknote, CheckCircle2, Clock, Copy, Download, ExternalLink, Info, Link2, Loader2, MessageCircle } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
// Diseño (ws1-t5): esta ventana es de la FAMILIA de la factura (Reembolsar,
// Editar precio, Registrar pago…) y se viste igual que ella. Lo propio
// (elegir canal, el importe, el mensaje que se copia) está en
// `cobros-inventario-rediseno/anticipo.module.css`. Solo cambia la ropa.
import { CLASES_FACTURA_REDISENO, clasesFactura as c } from "@/components/dashboard/factura-rediseno/raiz";
import a from "@/components/dashboard/cobros-inventario-rediseno/anticipo.module.css";
import { useRedisenoActivo } from "@/components/dashboard/cobros-inventario-rediseno/rediseno-activo";
import { conPuntoFinal } from "@/lib/anticipos/core";

const fmt = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
// ws1-t1 (M4): SIEMPRE con la zona de la CLÍNICA (viene del GET), nunca la
// del navegador — sin `timeZone`, Intl usa la del dispositivo, y una
// recepción en otra zona (o con el equipo mal configurado) leía una hora que
// no era la real (mismo criterio que el chip de la agenda y el PDF).
const fmtFecha = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("es-MX", { timeZone: tz, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
// N8 (QA ronda 4): `fmtFecha` ya puede terminar en "p.m." (con su propio
// punto, según la hora) — un punto final fijo detrás dejaba «p.m..» cuando
// coincidían los dos. `conPuntoFinal` (core.ts) no lo duplica.
const textoVence = (iso: string, tz: string) => conPuntoFinal(fmtFecha(iso, tz));

type MetodoAnticipo = "mercadopago" | "transferencia";

interface PendienteDTO {
  id: string;
  invoiceId: string;
  amount: number;
  expiresAt: string;
  checkoutUrl: string | null;
  apartada: boolean;
  metodo?: MetodoAnticipo;
}

interface CanalesDTO {
  mercadopago: boolean;
  transferencia: boolean;
}

interface EstadoGET {
  disponible: boolean;
  canales?: CanalesDTO;
  tieneFactura?: boolean; // solo en el endpoint de cita
  saldo?: number;
  sugerido: number | null;
  horasSugeridas: number;
  pendiente: PendienteDTO | null;
  /** Ajuste 2: SOLO citas futuras. false = ni se ofrece el formulario. */
  citaElegible?: boolean;
  motivoCitaNoElegible?: string | null;
  /** ws1-t1 (M4): zona de la clínica, para pintar `pendiente.expiresAt`. */
  zonaHoraria?: string;
  /** H26: ¿se puede mandar por WhatsApp desde aquí? Sin el dato, se ofrece como antes. */
  whatsapp?: { conectado: boolean; puedeEnviar: boolean };
}

interface ResultadoPOST {
  deposit: { invoiceId: string; checkoutUrl: string | null; metodo: MetodoAnticipo };
  texto: string;
  whatsapp: { enviado: boolean; motivo?: string };
}

/** Por qué no se ofrece enviar por WhatsApp, o null si se puede. Puro. */
export function motivoSinWhatsAppDe(w: { conectado: boolean; puedeEnviar: boolean } | undefined): string | null {
  if (!w) return null;
  if (!w.conectado) return "Esta clínica no tiene WhatsApp conectado: pide el anticipo y comparte el texto o el PDF por otro medio.";
  if (!w.puedeEnviar) return "No tienes permiso para enviar WhatsApp: pide el anticipo y comparte el texto o el PDF por otro medio.";
  return null;
}

export interface ModalPedirAnticipoProps {
  open: boolean;
  onClose: () => void;
  /** "cita" pide a /api/appointments/{id}/anticipo; "factura" a /api/invoices/{id}/anticipo. */
  origen: "cita" | "factura";
  id: string;
  /** Avisa al que lo montó (para refrescar la factura o la agenda). */
  onListo?: () => void;
  /**
   * ¿Diseño nuevo? Solo decide la ropa. Quien la abre (la factura, la
   * Agenda) no es de este trabajo y no lo pasa: si no llega, se mira si el
   * panel está en el diseño nuevo (`useRedisenoActivo`).
   */
  rediseno?: boolean;
}

export function ModalPedirAnticipo({ open, onClose, origen, id, onListo, rediseno: redisenoProp }: ModalPedirAnticipoProps) {
  const redisenoDetectado = useRedisenoActivo();
  const rediseno = redisenoProp ?? redisenoDetectado;
  const cx = (vieja: string, nueva: string) => (rediseno ? nueva : vieja);
  // Un campo: la maqueta propia y, con el diseño nuevo, el rótulo de la familia.
  const campo = `${a.campo} ${rediseno ? c.campo : ""}`;
  const base = origen === "cita" ? `/api/appointments/${id}/anticipo` : `/api/invoices/${id}/anticipo`;

  const [cargando, setCargando] = useState(true);
  // QA t2: el GET puede fallar por algo que NO es "sin canales" (403, 500,
  // 502, red caída). Antes cualquier fallo se pintaba como "esta clínica no
  // tiene Mercado Pago conectado", que es falso y confunde a recepción.
  const [cargaError, setCargaError] = useState(false);
  const [estado, setEstado] = useState<EstadoGET | null>(null);
  const [metodo, setMetodo] = useState<MetodoAnticipo>("mercadopago");
  const [monto, setMonto] = useState("");
  const [horas, setHoras] = useState("24");
  const [descripcion, setDescripcion] = useState("");
  const [precio, setPrecio] = useState("");
  const [enviando, setEnviando] = useState<"solo" | "wa" | null>(null);
  const [resultado, setResultado] = useState<ResultadoPOST | null>(null);
  const [recargarTick, setRecargarTick] = useState(0);
  // H26 (revisión final, ws1-t4): sin WhatsApp conectado (o sin permiso de
  // enviarlo) no se ofrece «Pedir y enviar por WhatsApp»: se dice antes, y el
  // anticipo se pide igual para compartir el texto o el PDF por otro medio.
  const motivoSinWhatsApp = motivoSinWhatsAppDe(estado?.whatsapp);

  useEffect(() => {
    if (!open) return;
    let vivo = true;
    setCargando(true);
    setCargaError(false);
    setResultado(null);
    fetch(base)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`GET ${base} → ${r.status}`))))
      .then((d: EstadoGET) => {
        if (!vivo) return;
        setEstado(d);
        setMonto(d.sugerido != null ? String(d.sugerido) : "");
        setHoras(String(d.horasSugeridas ?? 24));
        // Con los dos canales disponibles, arranca en Mercado Pago (el de
        // siempre); con uno solo, ESE, aunque no sea mercadopago.
        if (d.canales?.mercadopago) setMetodo("mercadopago");
        else if (d.canales?.transferencia) setMetodo("transferencia");
      })
      .catch(() => {
        if (vivo) { setCargaError(true); setEstado(null); }
      })
      .finally(() => {
        if (vivo) setCargando(false);
      });
    return () => {
      vivo = false;
    };
  }, [open, base, recargarTick]);

  const pedir = useCallback(
    async (enviarWhatsapp: boolean) => {
      const montoNum = Number(monto);
      if (!Number.isFinite(montoNum) || montoNum <= 0) {
        toast.error("Escribe un monto válido.");
        return;
      }
      const sinFactura = origen === "cita" && estado?.tieneFactura === false;
      if (sinFactura && (!descripcion.trim() || !Number.isFinite(Number(precio)))) {
        toast.error("Esta cita no tiene factura: escribe el concepto y el precio para crearla.");
        return;
      }
      setEnviando(enviarWhatsapp ? "wa" : "solo");
      try {
        const body: Record<string, unknown> = { monto: montoNum, metodo };
        const horasNum = Number(horas);
        if (Number.isFinite(horasNum) && horasNum > 0) body.horas = Math.round(horasNum);
        if (enviarWhatsapp) body.enviarWhatsapp = true;
        if (sinFactura) body.concepto = { description: descripcion.trim(), unitPrice: Number(precio) };

        const res = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(out?.error ?? "No se pudo pedir el anticipo.");
          return;
        }
        setResultado({ deposit: out.deposit, texto: out.texto, whatsapp: out.whatsapp });
        if (out.reutilizado) toast("Ya había un anticipo pendiente para esta factura: es el mismo.");
        else toast.success("Anticipo pedido.");
        if (enviarWhatsapp && out.whatsapp?.enviado) toast.success("Enviado por WhatsApp.");
        else if (enviarWhatsapp && out.whatsapp?.motivo) toast(out.whatsapp.motivo);
        onListo?.();
      } finally {
        setEnviando(null);
      }
    },
    [monto, horas, origen, estado, descripcion, precio, base, metodo, onListo],
  );

  const copiarTexto = useCallback(async (texto: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      toast.success("Texto copiado.");
    } catch {
      toast.error("No se pudo copiar.");
    }
  }, []);

  const sinFactura = origen === "cita" && estado?.tieneFactura === false;
  const pendiente = estado?.pendiente ?? null;
  const canales = estado?.canales;
  const dosCanal = !!canales?.mercadopago && !!canales?.transferencia;

  // Qué pantalla toca: solo para elegir el pie de la ventana.
  const enFormulario =
    !cargando && !cargaError && !!estado?.disponible && !resultado && !pendiente && estado?.citaElegible !== false;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className={cx("max-w-md bg-card text-foreground border border-border", `${CLASES_FACTURA_REDISENO} ${c.modal} ${c.modalEstrecho}`)}>
        <DialogHeader className={rediseno ? c.cabecera : undefined}>
          <DialogTitle className={cx("text-foreground font-bold", c.titulo)}>Pedir anticipo</DialogTitle>
        </DialogHeader>

        <div className={`${a.anticipo} ${cx(a.cuerpoClasico, c.cuerpo)}`}>
          {cargando ? (
            // Alto reservado: la ventana no crece de golpe al llegar los datos.
            <div className={a.espera} role="status">
              <Loader2 size={16} className="animate-spin" aria-hidden /> Cargando…
            </div>
          ) : cargaError ? (
            <>
              <p className={`${a.nota} ${a.notaPeligro}`} role="alert">
                <AlertTriangle size={16} strokeWidth={1.75} aria-hidden />
                <span>No se pudo cargar la información del anticipo. Inténtalo de nuevo.</span>
              </p>
              <div className={a.acciones}>
                <ButtonNew variant="secondary" onClick={() => setRecargarTick((n) => n + 1)}>
                  Reintentar
                </ButtonNew>
              </div>
            </>
          ) : !estado?.disponible ? (
            <p className={`${a.nota} ${a.notaInfo}`}>
              <Info size={16} strokeWidth={1.75} aria-hidden />
              <span>
                Esta clínica no tiene Mercado Pago conectado ni datos bancarios cargados. Actívalos en
                Configuración → Anticipos.
              </span>
            </p>
          ) : resultado ? (
            <>
              <p className={`${a.nota} ${a.notaExito}`} role="status">
                <CheckCircle2 size={16} strokeWidth={1.75} aria-hidden />
                <span className={a.notaTitulo}>
                  {resultado.deposit.metodo === "transferencia" ? "La solicitud de transferencia está lista." : "El link de pago está listo."}
                </span>
              </p>
              <pre className={a.mensaje}>{resultado.texto}</pre>
              {resultado.whatsapp?.motivo && !resultado.whatsapp.enviado && (
                <p className={`${a.nota} ${a.notaAlerta}`}>
                  <AlertTriangle size={16} strokeWidth={1.75} aria-hidden />
                  <span>{resultado.whatsapp.motivo}</span>
                </p>
              )}
              <div className={a.acciones}>
                <ButtonNew variant="secondary" icon={<Copy size={14} aria-hidden />} onClick={() => copiarTexto(resultado.texto)}>
                  Copiar texto
                </ButtonNew>
                {resultado.deposit.metodo === "mercadopago" && resultado.deposit.checkoutUrl ? (
                  <ButtonNew
                    variant="secondary"
                    icon={<ExternalLink size={14} aria-hidden />}
                    onClick={() => window.open(resultado.deposit.checkoutUrl!, "_blank", "noopener,noreferrer")}
                  >
                    Abrir link
                  </ButtonNew>
                ) : (
                  <ButtonNew
                    variant="secondary"
                    icon={<Download size={14} aria-hidden />}
                    onClick={() => window.open(`/api/invoices/${resultado.deposit.invoiceId}/anticipo/solicitud-pdf`, "_blank", "noopener,noreferrer")}
                  >
                    Descargar PDF
                  </ButtonNew>
                )}
              </div>
            </>
          ) : pendiente ? (
            <>
              <p className={`${a.nota} ${a.notaAlerta}`}>
                <Clock size={16} strokeWidth={1.75} aria-hidden />
                <span>
                  Ya hay un anticipo pendiente: <strong>{fmt.format(pendiente.amount)}</strong>, vence el {textoVence(pendiente.expiresAt, estado?.zonaHoraria || "America/Mexico_City")}
                  {pendiente.apartada ? " La cita sigue apartada mientras tanto." : ""}
                </span>
              </p>
              <div className={a.acciones}>
                {pendiente.metodo === "transferencia" ? (
                  <ButtonNew
                    variant="secondary"
                    icon={<Download size={14} aria-hidden />}
                    onClick={() => window.open(`/api/invoices/${pendiente.invoiceId}/anticipo/solicitud-pdf`, "_blank", "noopener,noreferrer")}
                  >
                    Descargar PDF con los datos bancarios
                  </ButtonNew>
                ) : (
                  pendiente.checkoutUrl && (
                    <>
                      <ButtonNew variant="secondary" icon={<Copy size={14} aria-hidden />} onClick={() => copiarTexto(pendiente.checkoutUrl!)}>
                        Copiar link
                      </ButtonNew>
                      <ButtonNew variant="secondary" icon={<ExternalLink size={14} aria-hidden />} onClick={() => window.open(pendiente.checkoutUrl!, "_blank", "noopener,noreferrer")}>
                        Abrir link
                      </ButtonNew>
                    </>
                  )
                )}
              </div>
            </>
          ) : estado?.citaElegible === false ? (
            <p className={`${a.nota} ${a.notaInfo}`}>
              <Info size={16} strokeWidth={1.75} aria-hidden />
              <span>{estado.motivoCitaNoElegible}</span>
            </p>
          ) : (
            <>
              {typeof estado?.saldo === "number" && (
                <div className={a.resumen}>
                  <span className={a.resumenRotulo}>Saldo de la factura</span>
                  <span className={a.resumenCifra}>{fmt.format(estado.saldo)}</span>
                </div>
              )}
              {sinFactura && (
                <>
                  <p className={`${a.nota} ${a.notaInfo}`}>
                    <Info size={16} strokeWidth={1.75} aria-hidden />
                    <span>Esta cita todavía no tiene factura: se crea con este concepto.</span>
                  </p>
                  <div className={campo}>
                    <Label htmlFor="anticipo-concepto">Concepto</Label>
                    <Input id="anticipo-concepto" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Ej. Consulta + limpieza" />
                  </div>
                  <div className={campo}>
                    <Label htmlFor="anticipo-precio">Precio del concepto (MXN)</Label>
                    <div className={a.importe}>
                      <span className={a.importeSigno} aria-hidden>$</span>
                      <Input id="anticipo-precio" value={precio} onChange={(e) => setPrecio(e.target.value)} inputMode="decimal" placeholder="0.00" />
                    </div>
                  </div>
                </>
              )}
              {dosCanal && (
                <div className={campo} role="radiogroup" aria-labelledby="anticipo-canal">
                  <Label id="anticipo-canal">Cómo se cobra</Label>
                  {/* Dos opciones a la vista en vez de un desplegable: un clic
                      menos y se ve cuál está elegida. Mismo estado (`metodo`). */}
                  <div className={a.opciones}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={metodo === "mercadopago"}
                      onClick={() => setMetodo("mercadopago")}
                      className={`${a.opcion} ${metodo === "mercadopago" ? a.opcionActiva : ""}`}
                    >
                      <Link2 size={16} strokeWidth={1.75} aria-hidden />
                      <span>
                        Mercado Pago
                        <span className={a.opcionDetalle}>Link de pago</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={metodo === "transferencia"}
                      onClick={() => setMetodo("transferencia")}
                      className={`${a.opcion} ${metodo === "transferencia" ? a.opcionActiva : ""}`}
                    >
                      <Banknote size={16} strokeWidth={1.75} aria-hidden />
                      <span>
                        Transferencia
                        <span className={a.opcionDetalle}>Datos bancarios</span>
                      </span>
                    </button>
                  </div>
                </div>
              )}
              <div className={a.rejilla2}>
                <div className={campo}>
                  <Label htmlFor="anticipo-monto">Monto del anticipo (MXN)</Label>
                  <div className={a.importe}>
                    <span className={a.importeSigno} aria-hidden>$</span>
                    <Input id="anticipo-monto" value={monto} onChange={(e) => setMonto(e.target.value)} inputMode="decimal" placeholder="0.00" />
                  </div>
                </div>
                <div className={campo}>
                  <Label htmlFor="anticipo-plazo">Plazo para pagar (horas)</Label>
                  <Input id="anticipo-plazo" value={horas} onChange={(e) => setHoras(e.target.value)} inputMode="numeric" />
                </div>
              </div>
              {motivoSinWhatsApp && (
                <p className={`${a.nota} ${a.notaInfo}`} role="note">
                  <MessageCircle size={16} strokeWidth={1.75} aria-hidden />
                  <span>{motivoSinWhatsApp}</span>
                </p>
              )}
            </>
          )}
        </div>

        <DialogFooter className={`${a.pie} ${rediseno ? c.pie : ""}`}>
          {enFormulario ? (
            <>
              <ButtonNew variant="ghost" onClick={onClose} disabled={enviando !== null}>Cancelar</ButtonNew>
              {!motivoSinWhatsApp && (
                <ButtonNew variant="secondary" icon={enviando === "wa" ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <MessageCircle size={14} aria-hidden />} onClick={() => pedir(true)} disabled={enviando !== null}>
                  {enviando === "wa" ? "Enviando…" : "Pedir y enviar por WhatsApp"}
                </ButtonNew>
              )}
              <ButtonNew variant="primary" icon={enviando === "solo" ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Link2 size={14} aria-hidden />} onClick={() => pedir(false)} disabled={enviando !== null}>
                {enviando === "solo" ? "Pidiendo…" : "Pedir anticipo"}
              </ButtonNew>
            </>
          ) : resultado ? (
            <ButtonNew variant="primary" onClick={onClose}>Listo</ButtonNew>
          ) : (
            <ButtonNew variant="ghost" onClick={onClose}>Cerrar</ButtonNew>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
