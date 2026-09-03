"use client";

// ═══════════════════════════════════════════════════════════════════════
// EL PANEL DE COPIAR: los textos ya rellenados con el prospecto que se
// tiene delante.
//
// Es la mitad que hace que la libreta sirva. Un texto guardado que hay que
// ir a buscar a otra pantalla, copiar, pegar y luego editar a mano para
// meterle el nombre de la clínica es exactamente el trabajo que hace que
// nadie use las plantillas. Aquí se elige, se ve tal cual va a quedar, y
// se copia.
//
// Se monta en DOS sitios con el mismo componente: como modal desde el
// tablero y la lista, y como tarjeta dentro de la ficha del prospecto.
// Duplicarlo habría dejado dos previsualizaciones que un día discrepan.
//
// 🔴 LO QUE FALTA SE DICE. Si el texto trae {{ciudad}} y el prospecto no
// tiene ciudad, se copia igual —a veces se escribe a mano en WhatsApp— pero
// la pantalla avisa QUÉ le faltó. Un texto que se manda con un hueco vacío
// sin avisar es peor que no tener plantillas.
// ═══════════════════════════════════════════════════════════════════════
import { useMemo, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { Check, Copy, FileText, MessageCircle, Pencil, X } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { crmWhatsappLink } from "@/lib/admin/crm/crm-core";
import type { CrmProspectoDTO } from "@/lib/admin/crm/service";
import {
  crmAlcanceTexto,
  crmRellenarTexto,
  crmTextosParaProspecto,
  type CrmTextoDTO,
} from "@/lib/admin/crm/textos-core";
import { crmCopiar } from "./crm-copiar";

// ── El cuerpo, compartido por el modal y la tarjeta de la ficha ─────────

export function CrmTextosElegir({
  textos,
  prospecto,
  compacto,
}: {
  textos: CrmTextoDTO[];
  prospecto: CrmProspectoDTO;
  /** true en la ficha, donde ya hay poco sitio y el listado va más apretado. */
  compacto?: boolean;
}) {
  const { sugeridos, otros } = useMemo(
    () => crmTextosParaProspecto(textos, prospecto),
    [textos, prospecto],
  );

  const primero = sugeridos[0] ?? otros[0] ?? null;
  const [elegidoId, setElegidoId] = useState<string | null>(primero?.id ?? null);
  const [copiado, setCopiado] = useState(false);

  const elegido =
    textos.find((t) => t.id === elegidoId) ?? primero ?? null;

  const relleno = useMemo(
    () => (elegido ? crmRellenarTexto(elegido.body, prospecto) : null),
    [elegido, prospecto],
  );

  const wa = relleno ? crmWhatsappLink(prospecto.phone, relleno.texto) : null;

  async function copiar() {
    if (!relleno) return;
    const ok = await crmCopiar(relleno.texto);
    if (!ok) {
      toast.error("El navegador no dejó copiar. Selecciona el texto de la vista previa y usa Ctrl+C.");
      return;
    }
    setCopiado(true);
    toast.success("Copiado. Ya lo puedes pegar.");
    window.setTimeout(() => setCopiado(false), 2200);
  }

  if (textos.length === 0) {
    return (
      <div style={{ fontSize: 12.5, color: "var(--text-3)", lineHeight: 1.55 }}>
        Todavía no tienes ningún texto guardado.{" "}
        <Link href="/admin/crm/textos" style={{ color: "var(--brand)" }}>
          Escribe el primero
        </Link>{" "}
        y desde aquí lo copias ya con el nombre y la ciudad de cada prospecto puestos.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Los títulos. Los sugeridos primero, y los que no le quedan
          DESPUÉS pero visibles: esconderlos haría dudar de la lista. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {sugeridos.map((t) => (
          <ChipTexto key={t.id} t={t} activo={t.id === elegido?.id} alElegir={setElegidoId} />
        ))}
        {otros.length > 0 && (
          <>
            <span
              style={{
                alignSelf: "center",
                fontSize: 10.5,
                color: "var(--text-4)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                marginLeft: sugeridos.length > 0 ? 4 : 0,
              }}
            >
              Otros
            </span>
            {otros.map((t) => (
              <ChipTexto key={t.id} t={t} activo={t.id === elegido?.id} alElegir={setElegidoId} atenuado />
            ))}
          </>
        )}
      </div>

      {elegido && relleno && (
        <>
          <div
            style={{
              border: "1px solid var(--border-soft)",
              borderRadius: 9,
              background: "var(--bg-elev-2)",
              padding: "10px 12px",
              fontSize: 12.5,
              lineHeight: 1.55,
              color: "var(--text-1)",
              whiteSpace: "pre-wrap",
              maxHeight: compacto ? 190 : 260,
              overflowY: "auto",
              // Se puede seleccionar y copiar a mano: es el plan C cuando
              // el navegador no deja usar el portapapeles.
              userSelect: "text",
            }}
          >
            {relleno.texto}
          </div>

          {relleno.faltantes.length > 0 && (
            <p
              style={{
                margin: 0,
                fontSize: 11.5,
                color: "var(--warning)",
                lineHeight: 1.45,
              }}
            >
              A este prospecto le falta{relleno.faltantes.length === 1 ? "" : "n"}{" "}
              {relleno.faltantes.map((f) => f.toLowerCase()).join(", ")}, así que ese hueco se
              quedó vacío. Se copia igual — revísalo antes de mandarlo, o completa la ficha.
            </p>
          )}

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <ButtonNew
              variant="primary"
              size="sm"
              icon={copiado ? <Check size={13} /> : <Copy size={13} />}
              onClick={copiar}
            >
              {copiado ? "Copiado" : "Copiar"}
            </ButtonNew>
            {wa ? (
              <a
                href={wa}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-new btn-new--secondary btn-new--sm"
                style={{ textDecoration: "none" }}
                title="Abre WhatsApp con este texto ya escrito"
              >
                <MessageCircle size={13} />
                Abrir WhatsApp
              </a>
            ) : (
              <span style={{ fontSize: 11.5, color: "var(--text-4)" }}>
                Sin un número de 10 dígitos no se puede abrir WhatsApp.
              </span>
            )}
            <Link
              href="/admin/crm/textos"
              style={{
                marginLeft: "auto",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: 11.5,
                color: "var(--text-3)",
                textDecoration: "none",
              }}
            >
              <Pencil size={12} />
              Editar mis textos
            </Link>
          </div>

          <p style={{ margin: 0, fontSize: 11, color: "var(--text-4)", lineHeight: 1.45 }}>
            Abrir WhatsApp no manda nada: abre la app en este equipo con el texto puesto. A
            diferencia de los botones de contacto de la ficha, esto no anota nada en la bitácora
            — anótalo tú si acabas mandándolo.
          </p>
        </>
      )}
    </div>
  );
}

function ChipTexto({
  t,
  activo,
  atenuado,
  alElegir,
}: {
  t: CrmTextoDTO;
  activo: boolean;
  atenuado?: boolean;
  alElegir: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => alElegir(t.id)}
      aria-pressed={activo}
      title={crmAlcanceTexto(t)}
      style={{
        height: 28,
        maxWidth: 230,
        padding: "0 11px",
        borderRadius: 99,
        fontSize: 11.5,
        cursor: "pointer",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        border: `1px solid ${activo ? "var(--brand)" : "var(--border-soft)"}`,
        background: activo ? "var(--brand-soft)" : "var(--bg-elev-2)",
        color: activo ? "var(--text-1)" : atenuado ? "var(--text-4)" : "var(--text-2)",
      }}
    >
      {t.title}
    </button>
  );
}

// ── El modal, para el tablero y la lista ────────────────────────────────

export function CrmTextosModal({
  textos,
  prospecto,
  alCerrar,
}: {
  textos: CrmTextoDTO[];
  prospecto: CrmProspectoDTO;
  alCerrar: () => void;
}) {
  return (
    <div className="modal-overlay" onClick={alCerrar}>
      <div
        className="modal modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="crm-textos-titulo"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <div>
            <div
              className="modal__title"
              id="crm-textos-titulo"
              style={{ display: "flex", alignItems: "center", gap: 7 }}
            >
              <FileText size={15} />
              Mis textos para {prospecto.name}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
              Ya con sus datos puestos. Elige uno y cópialo.
            </div>
          </div>
          <ButtonNew
            size="sm"
            variant="ghost"
            icon={<X size={14} />}
            onClick={alCerrar}
            aria-label="Cerrar"
          />
        </div>
        <div className="modal__body">
          <CrmTextosElegir textos={textos} prospecto={prospecto} />
        </div>
      </div>
    </div>
  );
}
