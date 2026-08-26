"use client";

// ═══════════════════════════════════════════════════════════════════════
// EDITOR DE PLANTILLAS — /inmobiliaria/contratos/plantillas
//
// Una plantilla por tipo de contrato y por cuenta. Sin fila guardada, la
// inmobiliaria usa la del sistema; en cuanto guarda, usa la suya.
//
// ── "LAS VARIABLES MARCADAS PARA QUE NO SE ROMPAN" ────────────────────
// Se resuelve en DOS sitios y los dos hacen falta:
//   · AQUÍ  → las variables son fichas que se insertan de un clic, así
//     nadie las teclea de memoria; y antes de mandar nada se avisa, con el
//     nombre, de cualquier `{{x}}` que no exista en el catálogo del tipo.
//   · EN EL SERVIDOR → saveTemplate rechaza esa misma plantilla aunque
//     esta pantalla se equivoque o alguien llame a la API a mano.
// Lo de aquí es comodidad; lo de allá es la reja. Sin la reja, un dedazo
// (`{{inquilino.nombr}}`) se guardaría y saldría impreso con la llave
// cruda en medio de una cláusula.
//
// 🔴 EDITAR UNA PLANTILLA NO TOCA NI UN CONTRATO YA GENERADO. Cada
// contrato guarda su propio texto resuelto; por eso se puede cambiar la
// plantilla sin miedo a que se mueva algo que alguien ya firmó.
//
// i18n CONVENCIÓN B: el servidor ya recortó el sub-árbol; prefijo VACÍO.
// ═══════════════════════════════════════════════════════════════════════

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { ArrowLeft, Eye, RotateCcw, Save } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import { makeRealtyT } from "@/lib/realty/i18n";
import type { ContractTemplateDTO } from "@/lib/realty/contracts";
import { Card, Field, Modal, Note, Pill, Tabs } from "../rentals/ui";
import "../rentals/rentals.css";
import "./contracts.css";
import {
  CONTRACT_VARIABLES,
  REALTY_CONTRACT_KINDS,
  unknownVariables,
  type RealtyContractKind,
} from "./shared";

type PorTipo = Record<string, ContractTemplateDTO>;

export function TemplatesClient({
  dict,
  templates,
}: {
  dict: Dictionary;
  templates: ContractTemplateDTO[];
}) {
  const t = makeRealtyT(dict);

  const inicial = useMemo<PorTipo>(() => {
    const map: PorTipo = {};
    for (const tpl of templates) map[tpl.kind] = tpl;
    return map;
  }, [templates]);

  const [porTipo, setPorTipo] = useState<PorTipo>(inicial);
  const [kind, setKind] = useState<RealtyContractKind>("ARRENDAMIENTO");
  const [name, setName] = useState<string>(inicial.ARRENDAMIENTO?.name ?? "");
  const [body, setBody] = useState<string>(inicial.ARRENDAMIENTO?.body ?? "");
  const [guardando, setGuardando] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [armandoPreview, setArmandoPreview] = useState(false);

  // El textarea se toca por ref para insertar la variable EN EL CURSOR.
  // Sin esto, la ficha tendría que pegar al final y quien edita perdería el
  // sitio donde estaba escribiendo.
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

  const actual = porTipo[kind];
  const esBase = !actual?.custom;
  const variables = CONTRACT_VARIABLES[kind];

  // Las que el texto usa y NO existen. Se recalcula en cada tecleo: son
  // decenas de variables y un texto de pocas páginas, no cuesta nada.
  const desconocidas = useMemo(() => unknownVariables(kind, body), [kind, body]);

  const sucio = body !== (actual?.body ?? "") || name !== (actual?.name ?? "");

  function cambiarTipo(next: RealtyContractKind) {
    // Sin confirmación de "vas a perder cambios" a propósito: guardar es un
    // clic y perder tres párrafos por un cambio de pestaña es una crueldad.
    // Se avisa y se deja lo tecleado en su tipo, en memoria.
    if (sucio) {
      setPorTipo((prev) => ({
        ...prev,
        [kind]: { ...(prev[kind] as ContractTemplateDTO), name, body },
      }));
    }
    setKind(next);
    const tpl = porTipo[next];
    setName(tpl?.name ?? "");
    setBody(tpl?.body ?? "");
  }

  function insertar(nombre: string) {
    const area = areaRef.current;
    const token = `{{${nombre}}}`;
    if (!area) {
      setBody((prev) => `${prev}${token}`);
      return;
    }
    const start = area.selectionStart ?? body.length;
    const end = area.selectionEnd ?? start;
    const next = `${body.slice(0, start)}${token}${body.slice(end)}`;
    setBody(next);
    // El cursor queda DESPUÉS de la variable recién puesta. requestAnimationFrame
    // porque React todavía no repintó el textarea cuando esto corre.
    requestAnimationFrame(() => {
      area.focus();
      const pos = start + token.length;
      area.setSelectionRange(pos, pos);
    });
  }

  async function guardar() {
    if (guardando) return;
    if (desconocidas.length > 0) {
      toast.error(
        t("plantillas.desconocidas", { vars: desconocidas.map((v) => `{{${v}}}`).join(", ") }),
        { duration: 7000 },
      );
      return;
    }
    setGuardando(true);
    try {
      const res = await fetch("/api/realty/contracts/plantillas", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, name, body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof data.error === "string" ? data.error : t("comun.error"));
        return;
      }
      setPorTipo((prev) => ({ ...prev, [kind]: data.template as ContractTemplateDTO }));
      setName((data.template as ContractTemplateDTO).name);
      setBody((data.template as ContractTemplateDTO).body);
      toast.success(t("plantillas.guardada"));
    } catch {
      toast.error(t("comun.error"));
    } finally {
      setGuardando(false);
    }
  }

  async function restaurar() {
    if (guardando) return;
    // window.confirm y no el ConfirmProvider del panel dental: ese vive en
    // src/components/ui y trae los tokens del otro producto.
    if (!window.confirm(t("plantillas.restaurarConfirm"))) return;
    setGuardando(true);
    try {
      const res = await fetch(`/api/realty/contracts/plantillas?kind=${kind}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof data.error === "string" ? data.error : t("comun.error"));
        return;
      }
      const tpl = data.template as ContractTemplateDTO;
      setPorTipo((prev) => ({ ...prev, [kind]: tpl }));
      setName(tpl.name);
      setBody(tpl.body);
      toast.success(t("plantillas.restaurada"));
    } catch {
      toast.error(t("comun.error"));
    } finally {
      setGuardando(false);
    }
  }

  async function verPrevia() {
    if (armandoPreview) return;
    setArmandoPreview(true);
    try {
      const res = await fetch("/api/realty/contracts/vista-previa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof data.error === "string" ? data.error : t("comun.error"));
        return;
      }
      setPreview(typeof data.preview === "string" ? data.preview : "");
    } catch {
      toast.error(t("comun.error"));
    } finally {
      setArmandoPreview(false);
    }
  }

  return (
    <div className="ctr">
      <header className="rnt-head">
        <div className="rnt-head__row">
          <div style={{ minWidth: 0 }}>
            <h1 className="rnt-head__title">{t("plantillas.title")}</h1>
            <p className="rnt-head__sub">{t("plantillas.subtitle")}</p>
          </div>
          <div className="rnt-head__actions">
            <Link className="rnt-btn" href="/inmobiliaria/contratos">
              <ArrowLeft size={14} />
              {t("detalle.volver")}
            </Link>
            <button
              type="button"
              className="rnt-btn"
              onClick={verPrevia}
              disabled={armandoPreview}
            >
              <Eye size={14} />
              {armandoPreview ? t("plantillas.generandoPrevia") : t("plantillas.vistaPrevia")}
            </button>
            <button
              type="button"
              className="rnt-btn rnt-btn--primary"
              onClick={guardar}
              disabled={guardando || !sucio}
            >
              <Save size={14} />
              {guardando ? t("comun.guardando") : t("comun.guardar")}
            </button>
          </div>
        </div>
      </header>

      <Note tone="warning">{t("plantillas.avisoAbogado")}</Note>

      <div className="rnt-toolbar">
        <div className="rnt-toolbar__grow">
          <Tabs
            label={t("plantillas.tipo")}
            value={kind}
            onChange={cambiarTipo}
            tabs={REALTY_CONTRACT_KINDS.map((k) => ({ key: k, label: t(`kinds.${k}`) }))}
          />
        </div>
        <Pill tone={esBase ? "neutral" : "brand"} dot>
          {esBase ? t("plantillas.base") : t("plantillas.propia")}
        </Pill>
      </div>

      <div className="ctr-split">
        <Card>
          <Field label={t("plantillas.nombre")}>
            <input
              className="rnt-input"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          <div style={{ marginTop: 12 }}>
            <Field label={t("plantillas.cuerpo")} hint={t("plantillas.cuerpoHint")}>
              <textarea
                ref={areaRef}
                className="ctr-paper-edit"
                value={body}
                spellCheck={false}
                onChange={(e) => setBody(e.target.value)}
              />
            </Field>
          </div>

          {desconocidas.length > 0 ? (
            <div style={{ marginTop: 12 }}>
              <Note tone="danger">
                {t("plantillas.desconocidas", {
                  vars: desconocidas.map((v) => `{{${v}}}`).join(", "),
                })}
              </Note>
            </div>
          ) : null}

          {esBase ? null : (
            <div style={{ marginTop: 12 }}>
              <button type="button" className="rnt-btn" onClick={restaurar} disabled={guardando}>
                <RotateCcw size={14} />
                {t("plantillas.restaurar")}
              </button>
            </div>
          )}
        </Card>

        <Card title={t("plantillas.variables")} sub={t("plantillas.variablesHint")}>
          {esBase ? (
            <div style={{ marginBottom: 10 }}>
              <Note tone="info">{t("plantillas.baseHint")}</Note>
            </div>
          ) : null}
          <div className="ctr-vars">
            {variables.map((v) => (
              <button
                key={v.name}
                type="button"
                className="ctr-var"
                title={`${v.label} — ${v.sample}`}
                onClick={() => insertar(v.name)}
              >
                {v.label}
                <span className="ctr-var__code">{`{{${v.name}}}`}</span>
              </button>
            ))}
          </div>
        </Card>
      </div>

      <Modal
        open={preview !== null}
        title={t("plantillas.previaTitle")}
        sub={t("plantillas.vistaPreviaHint")}
        size="full"
        onClose={() => setPreview(null)}
        closeLabel={t("comun.cerrar")}
        footer={
          <button type="button" className="rnt-btn" onClick={() => setPreview(null)}>
            {t("comun.cerrar")}
          </button>
        }
      >
        <div className="ctr-paper ctr-paper--full">{preview ?? ""}</div>
      </Modal>
    </div>
  );
}
