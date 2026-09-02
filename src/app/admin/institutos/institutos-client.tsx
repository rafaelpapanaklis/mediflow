"use client";

// ═══════════════════════════════════════════════════════════════════════
// La tabla de institutos con su almacenamiento, y el editor de la cuota.
//
// Tres columnas que son el motivo de la pantalla: TB CONTRATADOS, TB
// USADOS y CUÁNTO FACTURARLE AL MES por lo que va por encima de los
// incluidos. El precio del TB extra NO se escribe aquí: sale de
// EDU_ALM_TB_EXTRA_MXN (src/lib/edu/almacenamiento-core.ts), que es su
// fuente única. Un precio tecleado en un componente es un precio que un día
// discrepa del que cobra el resto del producto.
//
// El contrato institucional NO pasa por Stripe: se administra a mano, por
// diseño. Por eso esta pantalla no "cobra" nada — DICE cuánto cobrar.
// ═══════════════════════════════════════════════════════════════════════
import { useMemo, useState, useTransition } from "react";
import toast from "react-hot-toast";
import { HardDrive, Pencil, X } from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import {
  eduAlmBytesDeTb,
  eduAlmCostoExtraMxn,
  eduAlmMxnLabel,
  eduAlmNivel,
  eduAlmPorcentaje,
  eduAlmPrecioLabel,
  eduAlmTb,
  eduAlmTbExtra,
  eduAlmValidarTb,
  EDU_ALM_TB_MAX,
  EDU_ALM_TB_MIN,
  type EduAlmAdminRow,
} from "@/lib/edu/almacenamiento-core";
import { eduFormatBytes } from "@/lib/edu/estudios-core";
import { guardarCuotaAccion } from "./actions";

function tono(nivel: string): "success" | "warning" | "danger" {
  if (nivel === "lleno" || nivel === "critico") return "danger";
  if (nivel === "aviso") return "warning";
  return "success";
}

export function AdminInstitutosClient({
  rows,
  incluidoTb,
  totalMensualMxn,
}: {
  rows: EduAlmAdminRow[];
  incluidoTb: number;
  totalMensualMxn: number;
}) {
  const [editando, setEditando] = useState<EduAlmAdminRow | null>(null);

  const conExtra = useMemo(() => rows.filter((r) => r.extraTb > 0).length, [rows]);
  const enRojo = useMemo(
    () => rows.filter((r) => eduAlmNivel(r.medidor) !== "ok").length,
    [rows],
  );

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: "var(--text-1)" }}>
          Institutos
        </h1>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--text-3)", maxWidth: 760 }}>
          El vertical INSTITUCIONAL visto desde DaleControl. El contrato de una escuela no pasa
          por Stripe: se administra a mano. Esta pantalla es la que dice cuánto facturarle al mes
          por el almacenamiento que va por encima de los {incluidoTb} TB incluidos —{" "}
          {eduAlmPrecioLabel()}.
        </p>
      </div>

      {/* ── Lo que hay que cobrar ─────────────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 12,
          marginBottom: 18,
        }}
      >
        <CardNew title="A facturar al mes">
          <div style={{ fontSize: 26, fontWeight: 700, color: "var(--text-1)" }}>
            {eduAlmMxnLabel(totalMensualMxn)}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>
            Suma del almacenamiento extra de {conExtra}{" "}
            {conExtra === 1 ? "instituto" : "institutos"}. No se cobra solo.
          </div>
        </CardNew>
        <CardNew title="Institutos">
          <div style={{ fontSize: 26, fontWeight: 700, color: "var(--text-1)" }}>{rows.length}</div>
          <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>
            {enRojo === 0
              ? "Ninguno pasa del 80 % de su cuota."
              : `${enRojo} ${enRojo === 1 ? "pasa" : "pasan"} del 80 % de su cuota.`}
          </div>
        </CardNew>
      </div>

      <CardNew noPad title={`Almacenamiento por instituto (${rows.length})`}>
        {rows.length === 0 ? (
          <div
            style={{
              padding: "40px 18px",
              textAlign: "center",
              color: "var(--text-3)",
              fontSize: 13,
            }}
          >
            Todavía no hay ningún instituto dado de alta.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table-new">
              <thead>
                <tr>
                  <th>Instituto</th>
                  <th style={{ textAlign: "right" }}>Contratado</th>
                  <th style={{ textAlign: "right" }}>Usado</th>
                  <th style={{ textAlign: "right" }}>TB extra</th>
                  <th style={{ textAlign: "right" }}>A facturar / mes</th>
                  <th style={{ textAlign: "right" }}>Cuota</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const nivel = eduAlmNivel(r.medidor);
                  const pct = eduAlmPorcentaje(r.medidor);
                  return (
                    <tr key={r.institutionId}>
                      <td style={{ color: "var(--text-1)", fontWeight: 500 }}>
                        {r.nombre}
                        <span style={{ display: "block", fontSize: 11, color: "var(--text-4)" }}>
                          /{r.slug} · {r.sedes} {r.sedes === 1 ? "sede" : "sedes"} (comparten la
                          misma bolsa){!r.activo && " · INACTIVO"}
                        </span>
                      </td>
                      <td className="mono" style={{ textAlign: "right", fontWeight: 600 }}>
                        {r.cuotaTbLabel}
                      </td>
                      <td className="mono" style={{ textAlign: "right" }}>
                        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                          <BadgeNew tone={tono(nivel)} dot>
                            {pct} %
                          </BadgeNew>
                          <span>{eduFormatBytes(r.medidor.usadoBytes)}</span>
                        </div>
                        <span style={{ display: "block", fontSize: 11, color: "var(--text-4)" }}>
                          {r.medidor.estudios.toLocaleString("es-MX")} estudios
                        </span>
                      </td>
                      <td className="mono" style={{ textAlign: "right" }}>
                        {r.extraTb > 0 ? `+${r.extraTb} TB` : "—"}
                      </td>
                      <td
                        className="mono"
                        style={{
                          textAlign: "right",
                          fontWeight: 700,
                          color: r.costoExtraMxn > 0 ? "var(--text-1)" : "var(--text-4)",
                        }}
                      >
                        {r.costoExtraMxn > 0 ? eduAlmMxnLabel(r.costoExtraMxn) : "—"}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <ButtonNew
                          size="sm"
                          variant="ghost"
                          icon={<Pencil size={13} />}
                          onClick={() => setEditando(r)}
                        >
                          Cambiar
                        </ButtonNew>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardNew>

      <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 12, maxWidth: 760 }}>
        <HardDrive size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />
        Lo usado son los ESTUDIOS del expediente (radiografías, tomografías, fotos y PDFs) sumados
        por instituto, con todas sus sedes dentro: las sedes son ilimitadas y comparten la misma
        bolsa. Las firmas de consentimiento también ocupan espacio en el bucket, pero no se
        registra su tamaño y no se estiman aquí.
      </p>

      {editando && (
        <EditarCuota
          fila={editando}
          incluidoTb={incluidoTb}
          onCerrar={() => setEditando(null)}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// El editor. Se teclean TB ENTEROS: es como se vende.
// ═══════════════════════════════════════════════════════════════════════

function EditarCuota({
  fila,
  incluidoTb,
  onCerrar,
}: {
  fila: EduAlmAdminRow;
  incluidoTb: number;
  onCerrar: () => void;
}) {
  const [tb, setTb] = useState<string>(String(Math.round(eduAlmTb(fila.medidor.cuotaBytes))));
  const [pendiente, startTransition] = useTransition();

  const n = Number(tb);
  const invalido = eduAlmValidarTb(n);
  // La cuenta que se va a cobrar, ANTES de guardar: quien la escribe tiene
  // que ver el peso que acaba de crear, no enterarse al facturar.
  //
  // 🔴 El costo NO se multiplica aquí por ningún número escrito a mano: se
  // le pregunta al dominio (eduAlmCostoExtraMxn), que es quien conoce el
  // precio del TB extra. Es la misma cuenta que hace la tabla y la que hará
  // el día que el precio cambie.
  const bytes = Number.isFinite(n) ? eduAlmBytesDeTb(n) : 0;
  const extra = eduAlmTbExtra(bytes);
  const costo = eduAlmCostoExtraMxn(bytes);

  function guardar() {
    startTransition(async () => {
      const r = await guardarCuotaAccion({ institutionId: fila.institutionId, tb: Number(tb) });
      if (!r.ok) {
        toast.error(r.error ?? "No se pudo guardar.");
        return;
      }
      toast.success(r.mensaje ?? "Guardado.");
      onCerrar();
    });
  }

  return (
    <div className="modal-overlay" onClick={onCerrar}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cuota-modal-titulo"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <div className="modal__title" id="cuota-modal-titulo">
            Cuota de {fila.nombre}
          </div>
          <ButtonNew
            size="sm"
            variant="ghost"
            icon={<X size={14} />}
            onClick={onCerrar}
            aria-label="Cerrar"
          />
        </div>

        <div className="modal__body">
          <div className="field-new">
            <label className="field-new__label" htmlFor="cuota-tb">
              TB contratados <span className="req">*</span>
            </label>
            <input
              id="cuota-tb"
              className="input-new"
              type="number"
              min={EDU_ALM_TB_MIN}
              max={EDU_ALM_TB_MAX}
              step={1}
              value={tb}
              onChange={(e) => setTb(e.target.value)}
            />
            <p style={{ fontSize: 12, color: "var(--text-3)", margin: "6px 0 0" }}>
              El contrato institucional incluye {incluidoTb} TB. Lo que pase de ahí se factura
              aparte: {eduAlmPrecioLabel()}.
            </p>
          </div>

          {invalido ? (
            <p style={{ fontSize: 12.5, color: "var(--danger, #b3261e)", margin: "10px 0 0" }}>
              {invalido}
            </p>
          ) : (
            <p style={{ fontSize: 12.5, color: "var(--text-2)", margin: "10px 0 0" }}>
              Con {n} TB hay que facturarle <strong>{eduAlmMxnLabel(costo)}</strong> al mes
              {extra > 0 ? ` (${extra} TB por encima de los ${incluidoTb} incluidos)` : " por almacenamiento"}
              .
            </p>
          )}

          <p style={{ fontSize: 12, color: "var(--text-3)", margin: "10px 0 0" }}>
            Hoy lleva usados {eduFormatBytes(fila.medidor.usadoBytes)} en{" "}
            {fila.medidor.estudios.toLocaleString("es-MX")} estudios. Bajar la cuota por debajo de
            eso no borra nada: deja el medidor al 100 % y detiene las SUBIDAS nuevas.
          </p>
        </div>

        <div className="modal__footer">
          <ButtonNew variant="ghost" onClick={onCerrar} disabled={pendiente}>
            Cancelar
          </ButtonNew>
          <ButtonNew variant="primary" onClick={guardar} disabled={pendiente || !!invalido}>
            {pendiente ? "Guardando…" : "Guardar cuota"}
          </ButtonNew>
        </div>
      </div>
    </div>
  );
}
