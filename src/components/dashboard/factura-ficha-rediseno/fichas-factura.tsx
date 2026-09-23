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
  CheckCircle2, Download, Files, Mail, MessageCircle, Pencil, Stamp, Wallet,
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
import { BloquePlan } from "@/components/dashboard/plan-de-pagos/bloque-plan";
import type { CondicionesPago } from "@/lib/quotes/condiciones-pago";
import s from "./ficha.module.css";

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
  /** Texto del botón de cobro: «Cobrar» en el expediente, «Registrar pago» en Caja. */
  textoCobrar: string;
  textoVacio: string;
  /** Tocar la ficha y «Editar»: el detalle de factura de siempre. */
  onAbrir: (inv: F) => void;
  onCobrar: (inv: F) => void;
  onTimbrar: (inv: F) => void;
  /** ¿Se ofrece el cobro? Por defecto, la regla del expediente
   *  (`isChargeableInvoice`, borrador incluido: allí «Cobrar» lo confirma
   *  primero). Caja nunca ofreció cobrar un borrador desde la lista y sigue
   *  igual: pasa su propia regla. */
  puedeCobrar?: (inv: F) => boolean;
  /** ¿Se ofrece «Timbrar»? Por defecto, no en una anulada (regla del expediente).
   *  Caja lo ofrecía siempre que hubiera SAT y sigue igual: pasa `() => true`. */
  puedeTimbrar?: (inv: F) => boolean;
  /** Abre Nueva factura con los mismos conceptos y el mismo trato. */
  onDuplicar: (inv: F, condiciones: CondicionesPago | null) => void;
}

export function FichasFactura<F extends FacturaDeFicha>({
  facturas, facturApiEnabled, conPaciente = false, dentroDeTarjeta = false, estaVencida, textoCobrar, textoVacio,
  onAbrir, onCobrar, onTimbrar, puedeCobrar, puedeTimbrar, onDuplicar,
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
              cobrable={puedeCobrar ? puedeCobrar(inv) : isChargeableInvoice(inv)}
              timbrable={puedeTimbrar ? puedeTimbrar(inv) : !isVoidedInvoice(inv)}
              textoCobrar={textoCobrar}
              condiciones={extras.condiciones[inv.id] ?? inv.condicionesPago ?? null}
              contacto={extras.contacto[inv.id]}
              cargandoContacto={extras.cargando}
              onAbrir={() => onAbrir(inv)}
              onCobrar={() => onCobrar(inv)}
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
  inv, t, facturApiEnabled, conPaciente, vencida, cobrable, timbrable, textoCobrar, condiciones, contacto,
  cargandoContacto, onAbrir, onCobrar, onTimbrar, onDuplicar,
}: {
  inv: FacturaDeFicha;
  t: TFunction;
  facturApiEnabled: boolean;
  conPaciente: boolean;
  vencida: boolean;
  cobrable: boolean;
  timbrable: boolean;
  textoCobrar: string;
  condiciones: CondicionesPago | null;
  contacto: ContactoPaciente | undefined;
  cargandoContacto: boolean;
  onAbrir: () => void;
  onCobrar: () => void;
  onTimbrar: () => void;
  onDuplicar: (c: CondicionesPago | null) => void;
}) {
  const [enviando, setEnviando] = useState<ViaEnvio | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [enviado, setEnviado] = useState<ViaEnvio | null>(null);

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
  const ofreceWhatsApp = sePuedeEnviarPorWhatsApp(inv.status);
  const sinCorreo = ofreceCorreo && contacto?.correo === false;
  const sinTelefono = ofreceWhatsApp && contacto?.telefono === false;
  const esperando = cargandoContacto && contacto === undefined;

  async function enviar(via: ViaEnvio) {
    setEnviando(via);
    setMensaje(null);
    setEnviado(null);
    // El trato dice Mercado Pago: el mensaje lleva el link del saldo (ws1-t1).
    const r = await enviarFactura(inv.id, via, { linkPago: condiciones?.metodo === "mercadopago" });
    if (r.ok) setEnviado(via);
    // Con motivo del servidor, se enseña tal cual. SIN motivo (se cortó la red o
    // la función) no se sabe si salió: no se afirma que no, para que nadie
    // reenvíe a ciegas y el paciente reciba dos mensajes.
    else setMensaje(r.error ?? t("facturaFicha.envioSinConfirmar"));
    // Salió, pero sin el link de Mercado Pago que debía llevar (ws1-t1): se dice.
    if (r.ok && r.avisoLink) setMensaje(`${t("facturaMp.enviadoSinLink")} ${r.avisoLink}`);
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

        <button type="button" className={s.accion} onClick={onAbrir}>
          <Pencil size={13} aria-hidden /> {t("quotes.card.edit")}
        </button>

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

        {sinTelefono && <p className={s.motivo}>{t("facturaFicha.sinTelefono")}</p>}
        {sinCorreo && <p className={s.motivo}>{t("facturaFicha.sinCorreo")}</p>}
        {mensaje && <p className={s.fichaMensaje} role="alert">{mensaje}</p>}
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
