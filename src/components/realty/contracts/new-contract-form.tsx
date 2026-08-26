"use client";

// ═══════════════════════════════════════════════════════════════════════
// GENERAR UN CONTRATO — el formulario del alta.
//
// La idea entera del módulo cabe aquí: el asesor NO escribe un contrato,
// ELIGE de dónde sale. La renta, la exclusiva o la operación ya tienen los
// datos —el inmueble, el inquilino, el monto, las fechas— y la plantilla se
// llena sola con ellos.
//
// Por eso este formulario tiene tres campos y no treinta. El único tipo que
// pide capturar algo es el convenio de comisión, porque el segundo asesor y
// el reparto no viven en ninguna tabla del producto.
//
// 🔴 NO HAY VISTA PREVIA AQUÍ, Y ES A PROPÓSITO. Generar crea un BORRADOR
// que se lee, se edita y se borra: eso ES la vista previa, y además es la
// honesta —lo que se lee es exactamente lo que se va a mandar a firmar—.
// La vista previa de verdad vive en el editor de plantillas, que es donde
// tiene sentido mirar el texto sin datos de nadie.
// ═══════════════════════════════════════════════════════════════════════

import { useMemo, useState } from "react";
import type { Dictionary } from "@/i18n/t";
import { makeRealtyT } from "@/lib/realty/i18n";
import { Field, Modal, Note } from "../rentals/ui";
import { CONTRACT_SOURCE, REALTY_CONTRACT_KINDS, type RealtyContractKind } from "./shared";

export interface SourceOption {
  id: string;
  label: string;
}

export interface ContractSources {
  leases: SourceOption[];
  exclusives: SourceOption[];
  deals: SourceOption[];
  properties: SourceOption[];
}

export function NewContractForm({
  dict,
  open,
  sources,
  onClose,
  onCreate,
}: {
  dict: Dictionary;
  open: boolean;
  sources: ContractSources;
  onClose: () => void;
  onCreate: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const t = makeRealtyT(dict);

  const [kind, setKind] = useState<RealtyContractKind>("ARRENDAMIENTO");
  const [sourceId, setSourceId] = useState("");
  const [title, setTitle] = useState("");
  const [manual, setManual] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);

  const origen = CONTRACT_SOURCE[kind];

  const opciones = useMemo<SourceOption[]>(() => {
    if (origen === "lease") return sources.leases;
    if (origen === "exclusive") return sources.exclusives;
    if (origen === "deal") return sources.deals;
    return sources.properties;
  }, [origen, sources]);

  function cambiarTipo(next: RealtyContractKind) {
    setKind(next);
    // El origen se limpia SIEMPRE al cambiar de tipo: un id de renta
    // arrastrado a una exclusiva no existe, y el servidor respondería un
    // 404 que aquí se ve como "esa exclusiva ya no existe" — confuso.
    setSourceId("");
  }

  function setManualField(key: string, value: string) {
    setManual((prev) => ({ ...prev, [key]: value }));
  }

  const faltaOrigen = origen !== "none" && !sourceId;

  async function enviar() {
    if (enviando) return;
    setEnviando(true);
    try {
      await onCreate({
        kind,
        leaseId: origen === "lease" ? sourceId : null,
        exclusiveId: origen === "exclusive" ? sourceId : null,
        dealId: origen === "deal" ? sourceId : null,
        propertyId: origen === "none" ? sourceId || null : null,
        title: title.trim() || null,
        manual: kind === "COMISION" ? manual : {},
      });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal
      open={open}
      title={t("nuevo.title")}
      sub={t("nuevo.sub")}
      size="wide"
      onClose={onClose}
      closeLabel={t("comun.cerrar")}
      footer={
        <>
          <button type="button" className="rnt-btn" onClick={onClose}>
            {t("comun.cancelar")}
          </button>
          <button
            type="button"
            className="rnt-btn rnt-btn--primary"
            onClick={enviar}
            disabled={enviando || faltaOrigen}
          >
            {enviando ? t("nuevo.generando") : t("nuevo.generar")}
          </button>
        </>
      }
    >
      <div className="rnt-grid rnt-grid--auto">
        <Field label={t("nuevo.tipo")}>
          <select
            className="rnt-select"
            value={kind}
            onChange={(e) => cambiarTipo(e.target.value as RealtyContractKind)}
          >
            {REALTY_CONTRACT_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`kinds.${k}`)}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label={origen === "none" ? t("nuevo.origenProperty") : t(`nuevo.origen.${origen}`)}
          hint={origen === "none" ? t("nuevo.origenOpcional") : t("nuevo.origenHint")}
        >
          <select
            className="rnt-select"
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
          >
            <option value="">{origen === "none" ? t("nuevo.sinInmueble") : t("nuevo.elige")}</option>
            {opciones.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {opciones.length === 0 && origen !== "none" ? (
        <div style={{ marginTop: 12 }}>
          <Note tone="warning">{t(`nuevo.vacio.${origen}`)}</Note>
        </div>
      ) : null}

      <div style={{ marginTop: 12 }}>
        <Field label={t("nuevo.titulo")} hint={t("nuevo.tituloHint")}>
          <input
            className="rnt-input"
            value={title}
            maxLength={160}
            placeholder={t("nuevo.tituloPlaceholder")}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
      </div>

      {kind === "COMISION" ? (
        <div style={{ marginTop: 16 }}>
          <Note tone="info">{t("nuevo.comisionNota")}</Note>
          <div className="rnt-grid rnt-grid--auto" style={{ marginTop: 12 }}>
            <Field label={t("nuevo.asesorB")}>
              <input
                className="rnt-input"
                value={manual["asesorB.nombre"] ?? ""}
                maxLength={160}
                onChange={(e) => setManualField("asesorB.nombre", e.target.value)}
              />
            </Field>
            <Field label={t("nuevo.asesorBTel")}>
              <input
                className="rnt-input"
                value={manual["asesorB.telefono"] ?? ""}
                maxLength={40}
                inputMode="tel"
                onChange={(e) => setManualField("asesorB.telefono", e.target.value)}
              />
            </Field>
            <Field label={t("nuevo.montoOperacion")} hint={t("nuevo.soloNumeros")}>
              <input
                className="rnt-input"
                value={manual["operacion.montoRaw"] ?? ""}
                inputMode="decimal"
                onChange={(e) => setManualField("operacion.montoRaw", e.target.value)}
              />
            </Field>
            <Field label={t("nuevo.comisionTotal")} hint={t("nuevo.comisionTotalHint")}>
              <input
                className="rnt-input"
                value={manual["comision.totalRaw"] ?? ""}
                inputMode="decimal"
                onChange={(e) => setManualField("comision.totalRaw", e.target.value)}
              />
            </Field>
            <Field label={t("nuevo.pctA")}>
              <input
                className="rnt-input"
                value={manual["comision.pctA"] ?? ""}
                maxLength={12}
                placeholder="50.00%"
                onChange={(e) => setManualField("comision.pctA", e.target.value)}
              />
            </Field>
            <Field label={t("nuevo.pctB")}>
              <input
                className="rnt-input"
                value={manual["comision.pctB"] ?? ""}
                maxLength={12}
                placeholder="50.00%"
                onChange={(e) => setManualField("comision.pctB", e.target.value)}
              />
            </Field>
          </div>
        </div>
      ) : null}

      <div style={{ marginTop: 16 }}>
        <Note tone="warning">{t("nuevo.avisoAbogado")}</Note>
      </div>
    </Modal>
  );
}
