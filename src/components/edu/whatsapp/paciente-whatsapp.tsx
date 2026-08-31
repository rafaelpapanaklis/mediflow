"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Send } from "lucide-react";
import { eduRequest } from "@/components/edu/edu-http";
import { EduWaEnvios } from "@/components/edu/whatsapp/whatsapp-screen";
import { eduWaPhone, eduWaPhoneLabel, type EduWaConnectionDTO, type EduWaMessageRow } from "@/lib/edu/whatsapp-core";
import { eduMoney } from "@/lib/edu/dinero-core";
import type { EduChargeStatus } from "@/lib/edu/types";
import type { EduConsentEstado } from "@/lib/edu/consentimientos-core";

/**
 * La pestaña WhatsApp de la ficha del paciente: mandarle su carta de
 * consentimiento o el recibo de un cobro, y ver qué se le ha mandado ya.
 *
 * 🔴 LAS DOS MITADES SE PINTAN POR SEPARADO PORQUE SON DOS PERMISOS
 * DISTINTOS. Un alumno ve las cartas y no ve —ni puede mandar— un solo
 * recibo; caja ve las dos cosas. Eso lo decidió el servidor: aquí las listas
 * llegan vacías y no hay ni un `if` de rol.
 *
 * ⚠️ El botón se DESHABILITA con su motivo escrito debajo en vez de
 * esconderse. Un botón que no está no se puede preguntar por qué no está.
 */
export interface EduPacienteWaConsent {
  id: string;
  procedure: string;
  estado: EduConsentEstado;
  createdLabel: string;
}

export interface EduPacienteWaCharge {
  id: string;
  folio: string;
  totalCents: number;
  balanceCents: number;
  status: EduChargeStatus;
  chargedAt: string;
}

export interface EduPacienteWhatsappProps {
  patientId: string;
  patientName: string;
  patientPhone: string | null;
  connection: EduWaConnectionDTO;
  consents: EduPacienteWaConsent[];
  charges: EduPacienteWaCharge[];
  messages: EduWaMessageRow[];
  canSendConsent: boolean;
  canSendReceipt: boolean;
}

export function EduPacienteWhatsapp({
  patientId,
  patientName,
  patientPhone,
  connection,
  consents,
  charges,
  messages,
  canSendConsent,
  canSendReceipt,
}: EduPacienteWhatsappProps) {
  const router = useRouter();
  const [navigating, startNav] = useTransition();
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const telefono = eduWaPhone(patientPhone);
  const conectado = connection.state === "CONECTADO";
  const cartasOn = connection.readiness.find((r) => r.kind === "CONSENTIMIENTO");
  const recibosOn = connection.readiness.find((r) => r.kind === "RECIBO");

  // Solo las cartas que TODAVÍA se pueden firmar: mandar la liga de una ya
  // firmada, revocada o vencida le pone al paciente delante un documento que
  // no puede tocar y le dice que tiene algo pendiente que no tiene.
  const cartasVivas = consents.filter((c) => c.estado === "PENDIENTE");
  const cobrosVivos = charges.filter((c) => c.status !== "CANCELLED");

  async function mandar(body: Record<string, unknown>, id: string, exito: string) {
    if (busy) return;
    setBusy(id);
    setError(null);
    setFlash(null);
    try {
      const res = await eduRequest<{ ok: boolean; error: string | null }>(
        `/api/instituto/pacientes/${patientId}/whatsapp`,
        { method: "POST", body },
      );
      if (res.ok) setFlash(exito);
      // 🔴 Un envío que NO salió NO se pinta en verde. El servidor devuelve
      // 200 porque la constancia sí se escribió, y el motivo es lo único que
      // sirve para arreglarlo.
      else setError(res.error ?? "WhatsApp no lo aceptó. Revisa el registro de abajo.");
      startNav(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo mandar.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="edu-stack">
      {flash && (
        <div className="edu-banner edu-alert--ok" role="status">
          <div>
            <p className="edu-banner__title">{flash}</p>
          </div>
        </div>
      )}
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      <section className="edu-section">
        <div className="edu-section__head">
          <div>
            <h2 className="edu-section__title">Mandarle algo a {patientName}</h2>
            <p className="edu-section__lead">
              Todo sale por plantilla aprobada de WhatsApp. El teléfono de la ficha es{" "}
              <strong>{eduWaPhoneLabel(patientPhone)}</strong>
              {telefono ? "." : " — y no tiene 10 dígitos, así que WhatsApp no lo podría entregar."}
            </p>
          </div>
        </div>

        {!conectado && (
          <div className="edu-banner edu-banner--warn" role="alert">
            <div>
              <p className="edu-banner__title">El instituto no puede mandar WhatsApp ahora mismo</p>
              <p className="edu-banner__detail">
                {connection.state === "SIN_METODO_DE_PAGO"
                  ? "La cuenta de WhatsApp del instituto no tiene método de pago válido, así que Meta rechaza los envíos. Se arregla en el Administrador comercial de Meta, no aquí."
                  : "Todavía no hay una conexión de WhatsApp utilizable."}{" "}
                Habla con la dirección: lo configura en{" "}
                <Link href="/instituto/whatsapp">Ajustes → WhatsApp</Link>.
              </p>
            </div>
          </div>
        )}
      </section>

      {/* ── Cartas de consentimiento ─────────────────────────────────── */}
      {canSendConsent && (
        <section className="edu-section">
          <div className="edu-section__head">
            <div>
              <h3 className="edu-section__title">Consentimiento para firmar</h3>
              <p className="edu-section__lead">
                Va la <strong>liga</strong> de la carta, no un archivo: el paciente la abre, la lee y
                la firma con el dedo desde su teléfono. Solo se pueden mandar las que siguen
                pendientes de firma.
              </p>
            </div>
          </div>

          {cartasOn?.problem && <p className="edu-note">{cartasOn.problem}</p>}

          {cartasVivas.length === 0 ? (
            <div className="edu-empty">
              <p className="edu-empty__title">No hay ninguna carta pendiente de firma</p>
              <p className="edu-empty__detail">
                Emite una desde la pestaña <strong>Consentimientos</strong> y vuelve aquí para
                mandársela.
              </p>
            </div>
          ) : (
            <div className="edu-wa-docs">
              {cartasVivas.map((c) => (
                <div key={c.id} className="edu-wa-doc">
                  <div>
                    <p className="edu-wa-doc__name">{c.procedure}</p>
                    <p className="edu-wa-doc__meta">Emitida {c.createdLabel}</p>
                  </div>
                  <button
                    type="button"
                    className="edu-btn edu-btn--primary edu-btn--sm"
                    disabled={
                      busy !== null || !telefono || !conectado || !cartasOn?.enabled || !cartasOn?.templateOk
                    }
                    onClick={() =>
                      mandar(
                        { kind: "CONSENTIMIENTO", consentId: c.id },
                        c.id,
                        "La carta salió. El paciente la puede firmar desde su teléfono.",
                      )
                    }
                  >
                    <Send size={15} />
                    {busy === c.id ? "Mandando…" : "Mandar"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Recibos ──────────────────────────────────────────────────── */}
      {canSendReceipt && (
        <section className="edu-section">
          <div className="edu-section__head">
            <div>
              <h3 className="edu-section__title">Recibo de un cobro</h3>
              <p className="edu-section__lead">
                Va el <strong>resumen</strong>: folio, total y saldo. Ni el desglose de
                procedimientos ni nada del expediente — eso no se manda por WhatsApp.
              </p>
            </div>
          </div>

          {recibosOn?.problem && <p className="edu-note">{recibosOn.problem}</p>}

          {cobrosVivos.length === 0 ? (
            <div className="edu-empty">
              <p className="edu-empty__title">Este paciente no tiene cobros</p>
              <p className="edu-empty__detail">Los cobros se emiten desde Caja.</p>
            </div>
          ) : (
            <div className="edu-wa-docs">
              {cobrosVivos.map((c) => (
                <div key={c.id} className="edu-wa-doc">
                  <div>
                    <p className="edu-wa-doc__name">
                      {c.folio} · {eduMoney(c.totalCents)}
                    </p>
                    <p className="edu-wa-doc__meta">
                      {c.balanceCents > 0
                        ? `Saldo pendiente ${eduMoney(c.balanceCents)}`
                        : "Pagado por completo"}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="edu-btn edu-btn--primary edu-btn--sm"
                    disabled={
                      busy !== null ||
                      !telefono ||
                      !conectado ||
                      !recibosOn?.enabled ||
                      !recibosOn?.templateOk
                    }
                    onClick={() =>
                      mandar({ kind: "RECIBO", chargeId: c.id }, c.id, "El recibo salió.")
                    }
                  >
                    <Send size={15} />
                    {busy === c.id ? "Mandando…" : "Mandar"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── El registro ──────────────────────────────────────────────── */}
      <section className="edu-section">
        <div className="edu-section__head">
          <div>
            <h3 className="edu-section__title">Lo que se le ha mandado</h3>
            <p className="edu-section__lead">
              Incluye los recordatorios de cita, que manda el sistema solo. Cada renglón dice el
              texto exacto que salió y qué contestó WhatsApp.
            </p>
          </div>
        </div>
        <EduWaEnvios
          messages={messages}
          vacio="Todavía no se le ha mandado nada por WhatsApp."
        />
        {navigating && <p className="edu-note">Actualizando…</p>}
      </section>
    </div>
  );
}
