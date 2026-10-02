"use client";

// ═══════════════════════════════════════════════════════════════════════════
// La FICHA de una factura ya creada (ws1-t1).
//
// Rafael: «me gusta mucho cómo se ve un presupuesto ya creado, agrégale ese
// diseño al crear una factura igual». Es el dibujo de `presupuesto-nuevo/
// lista.tsx`: folio y chips, importe grande a la derecha, la FRASE del trato en
// violeta —se entiende entero sin abrir nada— y la fila de acciones.
//
// Las tres leyes, aplicadas aquí:
//  1. Todo lo que la tabla enseñaba sin clic sigue a la vista: folio, fecha,
//     total, pagado, saldo, estado, CFDI, «Cobrar» y «Timbrar».
//  2. Ni un clic más: tocar la ficha abre el detalle (como tocar la fila),
//     «Cobrar» y «Timbrar» siguen a un clic. PDF, enviar y duplicar pasan de
//     dos clics (abrir el detalle y buscar) a uno.
//  3. Nada se esconde por ancho: la ficha envuelve.
//
// Solo se monta con el interruptor `menu-dos-niveles` encendido. Apagado, Caja
// y el expediente siguen con su tabla de siempre, sin tocar.
//
// ⛔ Aquí no hay lógica de dinero. «Cobrar», «Timbrar» y «Editar» son callbacks
// de quien monta la lista y abren los MISMOS diálogos de siempre.
// ═══════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import {
  CheckCircle2, Download, Eye, Files, Mail, MessageCircle, Pencil, Stamp, Wallet,
} from "lucide-react";
import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import {
  invoiceStatusBadge, isChargeableInvoice, isVoidedInvoice, type InvoiceStatusTone,
} from "@/components/dashboard/billing/invoice-status";
import { fmtMXNdec } from "@/lib/format";
import { formatDate } from "@/lib/utils";
import { fechaCorta } from "@/lib/quotes/condiciones-pago";
import { useT } from "@/i18n/i18n-provider";
import type { TFunction } from "@/i18n/t";
import {
  fraseDeFactura, resumenConceptos, sePuedeEnviarPorCorreo, sePuedeEnviarPorWhatsApp,
  type ContactoPaciente, type FacturaDeFicha, type ViaEnvio,
} from "./datos";
import { enviarFactura, useExtrasDeFacturas } from "./extras";
import { estadoDeEnvioEnFicha, nombreConParentesco, type DestinoDeEnvio } from "@/lib/invoices/destinatarios";
import { BloquePlan } from "@/components/dashboard/plan-de-pagos/bloque-plan";
import type { CondicionesPago } from "@/lib/quotes/condiciones-pago";
import { facturaEditableEnEditor } from "@/components/billing/editar-factura";
import s from "./ficha.module.css";
import { mensajeDeError } from "@/lib/errores/mensaje-de-error";

/** Los seis tonos de `invoice-status.ts`, en las etiquetas de esta hoja. */
const TONO_ETIQUETA: Record<InvoiceStatusTone, string> = {
  success: s.etiquetaExito,
  warning: s.etiquetaAlerta,
  danger: s.etiquetaPeligro,
  info: s.etiquetaVioleta,
  brand: s.etiquetaVioleta,
  neutral: s.etiquetaNeutra,
};

export interface FichasFacturaProps<F extends FacturaDeFicha> {
  facturas: F[];
  facturApiEnabled: boolean;
  /** Caja mezcla pacientes: el título de la ficha es el paciente. En el
   *  expediente el paciente ya se sabe y el título son los conceptos. */
  conPaciente?: boolean;
  /** La lista vive DENTRO de una tarjeta que ya tiene borde (la pestaña del
   *  expediente): se separa de sus orillas en vez de ir a ras. */
  dentroDeTarjeta?: boolean;
  /** Vencida = lo decide quien monta la lista (Caja tiene el umbral del servidor). */
  estaVencida?: (inv: F) => boolean;
  /** Cuánto de la factura está vencido (pesos). Con esto la ficha dice «Vencido $X»
   *  junto al saldo, para que lo vencido cuadre a la vista con el KPI de arriba. */
  montoVencido?: (inv: F) => number;
  /** Texto del botón de cobro: «Cobrar» en el expediente, «Registrar pago» en Caja. */
  textoCobrar: string;
  textoVacio: string;
  /** Tocar la ficha y «Ver factura»: el detalle de factura de siempre. */
  onAbrir: (inv: F) => void;
  /**
   * ws1-t4 — «Editar»: abre el EDITOR de la factura (conceptos, precios,
   * descuentos), no el detalle. Solo se ofrece en una factura editable
   * (`facturaEditableEnEditor`: borrador sin pagos ni CFDI) y con permiso
   * (`puedeEditar`); en las demás el botón es «Ver factura» y abre el detalle.
   * Sin `onEditar`, siempre «Ver factura».
   */
  onEditar?: (inv: F) => void;
  /** H14: `false` = sin billing.edit, nunca se ofrece «Editar». */
  puedeEditar?: boolean;
  /**
   * «Cobrar» por fila. Manda las condiciones YA CARGADAS (las mismas de
   * `BloquePlan`) para que quien abra el pago pueda proponer la mensualidad o
   * lo vencido en vez del saldo completo (ws1-t10, H68) sin otra consulta.
   */
  onCobrar: (inv: F, condiciones: CondicionesPago | null) => void;
  onTimbrar: (inv: F) => void;
  /** ¿Se ofrece el cobro? Por defecto, la regla del expediente
   *  (`isChargeableInvoice`, borrador incluido: allí «Cobrar» lo confirma
   *  primero). Caja nunca ofreció cobrar un borrador desde la lista y sigue
   *  igual: pasa su propia regla. */
  puedeCobrar?: (inv: F) => boolean;
  /** ¿Se ofrece «Timbrar»? Por defecto, no en una anulada (regla del expediente).
   *  Caja lo ofrecía siempre que hubiera SAT y sigue igual: pasa `() => true`. */
  puedeTimbrar?: (inv: F) => boolean;
  /** H14: `false` = sin whatsapp.send, no se ofrece «Enviar por WhatsApp». */
  puedeEnviar?: boolean;
  /** Abre Nueva factura con los mismos conceptos y el mismo trato. */
  onDuplicar: (inv: F, condiciones: CondicionesPago | null) => void;
}

export function FichasFactura<F extends FacturaDeFicha>({
  facturas, facturApiEnabled, conPaciente = false, dentroDeTarjeta = false, estaVencida, montoVencido, textoCobrar, textoVacio,
  onAbrir, onEditar, puedeEditar = true, onCobrar, onTimbrar, puedeCobrar, puedeTimbrar, puedeEnviar = true, onDuplicar,
}: FichasFacturaProps<F>) {
  const t = useT();
  const extras = useExtrasDeFacturas(facturas.map((f) => f.id));

  return (
    <div className={`${CLASES_MENU} ${s.raiz} ${dentroDeTarjeta ? s.dentroDeTarjeta : ""}`}>
      {facturas.length === 0 ? (
        <div className={s.vacio}>{textoVacio}</div>
      ) : (
        <div className={s.fichas}>
          {extras.fallo && <p className={s.motivo}>{t("facturaFicha.extrasFallo")}</p>}
          {facturas.map((inv) => (
            <Ficha
              key={inv.id}
              inv={inv}
              t={t}
              facturApiEnabled={facturApiEnabled}
              conPaciente={conPaciente}
              vencida={estaVencida ? estaVencida(inv) : false}
              montoVencido={montoVencido ? montoVencido(inv) : 0}
              cobrable={puedeCobrar ? puedeCobrar(inv) : isChargeableInvoice(inv)}
              timbrable={puedeTimbrar ? puedeTimbrar(inv) : !isVoidedInvoice(inv)}
              puedeEnviar={puedeEnviar}
              textoCobrar={textoCobrar}
              condiciones={extras.condiciones[inv.id] ?? inv.condicionesPago ?? null}
              contacto={extras.contacto[inv.id]}
              cargandoContacto={extras.cargando}
              onAbrir={() => onAbrir(inv)}
              onEditar={onEditar && puedeEditar && facturaEditableEnEditor(inv) ? () => onEditar(inv) : null}
              onCobrar={() => onCobrar(inv, extras.condiciones[inv.id] ?? inv.condicionesPago ?? null)}
              onTimbrar={() => onTimbrar(inv)}
              onDuplicar={(c) => onDuplicar(inv, c)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Ficha({
  inv, t, facturApiEnabled, conPaciente, vencida, montoVencido, cobrable, timbrable, textoCobrar, condiciones, contacto,
  cargandoContacto, puedeEnviar, onAbrir, onEditar, onCobrar, onTimbrar, onDuplicar,
}: {
  inv: FacturaDeFicha;
  t: TFunction;
  facturApiEnabled: boolean;
  conPaciente: boolean;
  vencida: boolean;
  montoVencido: number;
  cobrable: boolean;
  timbrable: boolean;
  textoCobrar: string;
  condiciones: CondicionesPago | null;
  contacto: ContactoPaciente | undefined;
  cargandoContacto: boolean;
  puedeEnviar: boolean;
  onAbrir: () => void;
  /** `null` = no editable (o sin permiso): el botón es «Ver factura». */
  onEditar: (() => void) | null;
  onCobrar: () => void;
  onTimbrar: () => void;
  onDuplicar: (c: CondicionesPago | null) => void;
}) {
  const [enviando, setEnviando] = useState<ViaEnvio | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [enviado, setEnviado] = useState<ViaEnvio | null>(null);
  const [enviadoA, setEnviadoA] = useState<string[]>([]);

  // La píldora dice «Vencido» cuando la factura LO ESTÁ (dueDate + saldo),
  // aunque su status siga en PENDING/PARTIAL — igual que la tabla de Caja.
  const badge = invoiceStatusBadge(vencida ? "OVERDUE" : inv.status);
  // Cancelar NO pone balance a 0 en BD: se muestra «—», no una deuda.
  const anulada = isVoidedInvoice(inv);
  const conceptos = resumenConceptos(inv.items);
  const paciente = `${inv.patient?.firstName ?? ""} ${inv.patient?.lastName ?? ""}`.trim();
  const titulo = conPaciente ? (paciente || "—") : (conceptos.texto || inv.invoiceNumber);
  const frase = fraseDeFactura(inv.total, condiciones);
  const patientId = inv.patientId ?? inv.patient?.id ?? "";

  const sub = [
    t("quotes.card.itemCount", { count: conceptos.cuantos }),
    conPaciente && conceptos.texto ? conceptos.texto : null,
    // Misma fecha que enseñaba la tabla (día local de quien mira).
    formatDate(inv.createdAt),
    inv.dueDate ? t("quotes.card.validUntil", { date: fechaCorta(toIso(inv.dueDate)) }) : null,
  ].filter(Boolean).join(" · ");

  // Mandar sale al PACIENTE: sin correo o sin teléfono el botón se deshabilita
  // y el motivo se ESCRIBE debajo (un `title` no existe en un iPad).
  const ofreceCorreo = sePuedeEnviarPorCorreo(inv.status);
  const ofreceWhatsApp = puedeEnviar && sePuedeEnviarPorWhatsApp(inv.status);
  // ws1-t10: con RESPONSABLE DE PAGO (tutor u otra persona del caso) el envío es a él —y al paciente si
  // tiene—; el aviso de «no tiene» solo sale si ninguno de los dos tiene. Sin responsable, como siempre.
  const envioWa = estadoDeEnvioEnFicha(contacto, "telefono");
  const envioCorreo = estadoDeEnvioEnFicha(contacto, "correo");
  const sinCorreo = ofreceCorreo && !envioCorreo.puede;
  const sinTelefono = ofreceWhatsApp && !envioWa.puede;
  const responsable = contacto?.responsable ?? null;
  const [destino, setDestino] = useState<DestinoDeEnvio>("auto");
  const esperando = cargandoContacto && contacto === undefined;

  async function enviar(via: ViaEnvio, forzar = false) {
    setEnviando(via);
    setMensaje(null);
    setEnviado(null);
    // El trato dice Mercado Pago: el mensaje lleva el link del saldo (ws1-t1).
    const r = await enviarFactura(inv.id, via, { linkPago: condiciones?.metodo === "mercadopago", forzar, destino });
    // ws1-t4 #82: ya salió un aviso de cobro a ese teléfono hoy — se pregunta antes de mandar otro.
    if (!r.ok && r.codigo === "AVISO_YA_ENVIADO") {
      setEnviando(null);
      if (window.confirm(`${r.error ?? ""}\n\n¿Mandarlo de todos modos?`)) await enviar(via, true);
      return;
    }
    if (r.ok) { setEnviado(via); setEnviadoA(r.enviadoA ?? []); }
    // Con motivo del servidor, se enseña tal cual. SIN motivo (se cortó la red o
    // la función) no se sabe si salió: no se afirma que no, para que nadie
    // reenvíe a ciegas y el paciente reciba dos mensajes.
    else setMensaje(mensajeDeError(r, t, { porDefecto: t("facturaFicha.envioSinConfirmar") }));
    // Salió, pero sin el link de Mercado Pago que debía llevar (ws1-t1): se dice.
    if (r.ok && r.avisoLink) setMensaje(`${t("facturaMp.enviadoSinLink")} ${r.avisoLink}`);
    // Salió a uno y a otro no (ws1-t10): se dice.
    if (r.ok && r.avisoParcial) setMensaje(r.avisoParcial);
    setEnviando(null);
  }

  return (
    <article className={`${s.ficha} ${anulada ? s.fichaAnulada : ""}`} onClick={onAbrir}>
      <div className={s.fichaCuerpo}>
        <div className={s.fichaLinea1}>
          <span className={s.fichaFolio}>{inv.invoiceNumber}</span>
          <span className={`${s.etiqueta} ${TONO_ETIQUETA[badge.tone]}`}>{t(badge.labelKey)}</span>
          {/* CFDI — los mismos tres estados que `invoice-cfdi-badge.tsx`. */}
          {inv.cfdiUuid ? (
            <span className={`${s.etiqueta} ${s.etiquetaExito}`}>
              <CheckCircle2 size={11} strokeWidth={2.5} aria-hidden />
              {t("billing.billingClient.cfdiInvoiced")}
            </span>
          ) : !facturApiEnabled ? (
            <span className={s.apagado}>{t("billing.billingClient.satNotConfigured")}</span>
          ) : null}
        </div>
        <p className={s.fichaTitulo}>{titulo}</p>
        <p className={s.fichaSub}>{sub}</p>
        {frase && <p className={s.fichaPlan}>{frase}</p>}
      </div>

      <div className={s.fichaDinero}>
        <p className={s.fichaTotal}>{fmtMXNdec(inv.total)}</p>
        <p className={s.fichaCuenta}>
          <span className={s.tonoExito}>{t("patients.billing.colPaid")} {fmtMXNdec(inv.paid)}</span>
          {" · "}
          <span className={!anulada && inv.balance > 0 ? s.tonoAlerta : undefined}>
            {t("patients.billing.colBalance")} {anulada ? "—" : fmtMXNdec(inv.balance)}
          </span>
          {!anulada && montoVencido > 0 && (
            <>
              {" · "}
              <span className={s.tonoAlerta}>{t(invoiceStatusBadge("OVERDUE").labelKey)} {fmtMXNdec(montoVencido)}</span>
            </>
          )}
        </p>
      </div>

      {/* Por qué cuota va y si está al corriente (ws1-t2). Derivado de lo
          cobrado; sin condiciones a plazos no pinta nada. Una anulada no debe, y
          un borrador TODAVÍA no: nada de «vencidas» en lo que no se ha confirmado. */}
      {!anulada && inv.status !== "DRAFT" && <BloquePlan condiciones={condiciones} total={inv.total} pagado={inv.paid} />}

      {/* Las acciones no abren el detalle: cada botón hace lo suyo. */}
      <div className={s.fichaAcciones} onClick={(e) => e.stopPropagation()}>
        <a href={`/api/invoices/${inv.id}/print`} target="_blank" rel="noreferrer" className={s.accion}>
          <Download size={13} aria-hidden /> {t("quotes.card.pdf")}
        </a>

        {/* ws1-t4: «Editar» abre el EDITOR (antes abría el detalle, desde que
            nació la ficha). Solo en un borrador sin pagos ni CFDI — lo único que
            el servidor deja editar —; cancelada, timbrada, cobrada o ya emitida
            se VE (H9 ya lo hacía con las anuladas). */}
        {onEditar ? (
          <button type="button" className={s.accion} onClick={onEditar}>
            <Pencil size={13} aria-hidden /> {t("quotes.card.edit")}
          </button>
        ) : (
          <button type="button" className={s.accion} onClick={onAbrir}>
            <Eye size={13} aria-hidden /> {t("quotes.card.viewInvoice")}
          </button>
        )}

        {cobrable && (
          <button type="button" className={`${s.accion} ${s.accionExito}`} onClick={onCobrar}>
            <Wallet size={13} aria-hidden /> {textoCobrar}
          </button>
        )}

        {!inv.cfdiUuid && facturApiEnabled && timbrable && (
          <button type="button" className={s.accion} onClick={onTimbrar}>
            <Stamp size={13} aria-hidden /> {t("billing.billingClient.cfdiStamp")}
          </button>
        )}

        {responsable && (ofreceWhatsApp || ofreceCorreo) && (
          <label className={s.motivo} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            Enviar a
            <select
              className={s.accion}
              value={destino}
              disabled={enviando !== null}
              onChange={(e) => setDestino(e.target.value as DestinoDeEnvio)}
              aria-label="A quién se envía la factura"
            >
              <option value="auto">{`Responsable de pago: ${nombreConParentesco({ nombre: responsable.nombre, parentesco: responsable.parentesco })}`}</option>
              <option value="paciente">Paciente</option>
              <option value="ambos">Los dos</option>
            </select>
          </label>
        )}

        {ofreceWhatsApp && (
          <button
            type="button"
            className={`${s.accion} ${s.accionPrincipal}`}
            disabled={enviando !== null || sinTelefono || esperando}
            onClick={() => enviar("whatsapp")}
          >
            <MessageCircle size={13} aria-hidden />
            {enviando === "whatsapp" ? t("facturaFicha.enviando") : t("quotes.card.sendWhatsApp")}
          </button>
        )}

        {ofreceCorreo && (
          <button
            type="button"
            className={`${s.accion} ${s.accionPrincipal}`}
            disabled={enviando !== null || sinCorreo || esperando}
            onClick={() => enviar("correo")}
          >
            <Mail size={13} aria-hidden />
            {enviando === "correo" ? t("facturaFicha.enviando") : t("facturaFicha.enviarCorreo")}
          </button>
        )}

        <button type="button" className={s.accion} onClick={() => onDuplicar(condiciones)}>
          <Files size={13} aria-hidden /> {t("quotes.card.duplicate")}
        </button>

        {sinTelefono && <p className={s.motivo}>{envioWa.motivo ?? t("facturaFicha.sinTelefono")}</p>}
        {sinCorreo && <p className={s.motivo}>{envioCorreo.motivo ?? t("facturaFicha.sinCorreo")}</p>}
        {mensaje && <p className={s.fichaMensaje} role="alert">{mensaje}</p>}
        {enviado && responsable && enviadoA.length > 0 && (
          <p className={s.fichaAviso} role="status">{`Enviado a ${enviadoA.join(" y ")}.`}</p>
        )}
        {enviado === "whatsapp" && (
          <p className={s.fichaAviso} role="status">
            {t("quotes.card.waSentToast")}
            {/* Sin patientId no hay a dónde llevar: se calla el enlace en vez
                de mandar a la bandeja general sin decirlo (regla de ws1-t4). */}
            {patientId && (
              <>
                {" "}
                <a href={`/dashboard/inbox?patientId=${patientId}`}>
                  {t("quotes.card.waViewInbox")}
                </a>
              </>
            )}
          </p>
        )}
        {enviado === "correo" && <p className={s.fichaAviso} role="status">{t("facturaFicha.correoEnviado")}</p>}
      </div>
    </article>
  );
}

function toIso(d: string | Date): string {
  return d instanceof Date ? d.toISOString() : String(d);
}
