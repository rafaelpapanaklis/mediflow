"use client";

// ═══════════════════════════════════════════════════════════════════════
// /afiliados/crm — la pantalla del socio.
//
// Idioma visual del panel de afiliados: primitivas de
// components/afiliados/ui/panel-ui + clases `dcafp-*` de panel.css. Sin
// Tailwind arbitrario: la raíz de este panel mide 13px y los rem no cuadran.
//
// 🔴 EL FORMULARIO VA EN LÍNEA, NO EN UN MODAL. `.dcafp-main` lleva
// `container-type: inline-size`, y eso convierte al contenedor en bloque
// contenedor de todo `position: fixed` que viva dentro: un `.modal-overlay`
// aquí se ancla al main —desplazado por el sidebar— en vez de a la ventana.
// No da error, sólo sale mal. Una tarjeta que se despliega arriba evita el
// problema por construcción y además se usa mejor en el celular.
//
// El único diálogo flotante es el de confirmar borrado (`useConfirm`), que
// se monta en el layout RAÍZ, fuera de todo contenedor de medida.
// ═══════════════════════════════════════════════════════════════════════
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Building2, Globe, Pencil, Phone, Plus, Trash2, X } from "lucide-react";
import {
  Chip,
  EmptyState,
  Footnote,
  Kpi,
  PageHead,
  PanelCard,
  StatRow,
  type ChipTone,
} from "@/components/afiliados/ui/panel-ui";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  crmEstadoParaAfiliado,
  crmTelLink,
  crmTelefonoLegible,
  crmValidarProspecto,
  crmVertical,
  crmWhatsappLink,
  CRM_VERTICALES,
} from "@/lib/admin/crm/crm-core";
import type { CrmAfiliadoListado, CrmProspectoAfiliadoDTO } from "@/lib/affiliates/crm";
import {
  editarRecomendacionAccion,
  quitarRecomendacionAccion,
  recomendarAccion,
} from "./actions";

/** `crmEstadoParaAfiliado` habla en tonos del panel de admin; aquí se traducen. */
const TONO_CHIP: Record<string, ChipTone> = {
  success: "ok",
  danger: "danger",
  warning: "amber",
  info: "brand",
  brand: "brand",
  neutral: "neutral",
};

interface Campos {
  name: string;
  vertical: string;
  city: string;
  country: string;
  phone: string;
  website: string;
  contactName: string;
  notes: string;
}

const VACIO: Campos = {
  name: "",
  vertical: "DENTAL",
  city: "",
  country: "México",
  phone: "",
  website: "",
  contactName: "",
  notes: "",
};

function desde(p: CrmProspectoAfiliadoDTO): Campos {
  return {
    name: p.name ?? "",
    vertical: p.vertical ?? "DENTAL",
    city: p.city ?? "",
    country: p.country ?? "",
    phone: p.phone ?? "",
    website: p.website ?? "",
    contactName: p.contactName ?? "",
    notes: p.notes ?? "",
  };
}

export function CrmAfiliadoClient({ listado }: { listado: CrmAfiliadoListado }) {
  const router = useRouter();
  const askConfirm = useConfirm();
  const [, startTransition] = useTransition();

  /** null = cerrado · "nuevo" = alta · un id = editando esa recomendación. */
  const [abierto, setAbierto] = useState<string | null>(null);
  const [c, setC] = useState<Campos>(VACIO);

  const editando = abierto && abierto !== "nuevo" ? abierto : null;
  const invalido = useMemo(() => crmValidarProspecto(c), [c]);

  function abrirNuevo() {
    setC(VACIO);
    setAbierto("nuevo");
  }

  function abrirEdicion(p: CrmProspectoAfiliadoDTO) {
    setC(desde(p));
    setAbierto(p.id);
  }

  function set<K extends keyof Campos>(campo: K, valor: string) {
    setC((prev) => ({ ...prev, [campo]: valor }));
  }

  function guardar() {
    if (invalido) {
      toast.error(invalido);
      return;
    }
    startTransition(async () => {
      const r = editando
        ? await editarRecomendacionAccion(editando, c)
        : await recomendarAccion(c);
      if (!r.ok) {
        toast.error(r.error ?? "No se pudo guardar.");
        return;
      }
      toast.success(r.mensaje ?? "Guardado.");
      setAbierto(null);
      setC(VACIO);
      router.refresh();
    });
  }

  async function quitar(p: CrmProspectoAfiliadoDTO) {
    const ok = await askConfirm({
      title: `¿Quitar a ${p.name}?`,
      description:
        "Se saca de tus recomendaciones. Sólo se puede mientras DaleControl no lo haya empezado a trabajar.",
      variant: "danger",
      confirmText: "Quitar",
    });
    if (!ok) return;
    startTransition(async () => {
      const r = await quitarRecomendacionAccion(p.id);
      if (!r.ok) {
        toast.error(r.error ?? "No se pudo quitar.");
        return;
      }
      toast.success(r.mensaje ?? "Listo.");
      router.refresh();
    });
  }

  return (
    <>
      <PageHead
        title="Recomienda negocios"
        sub="Da de alta las clínicas, universidades y negocios que conozcas. Le llegan directo al equipo de DaleControl, que se encarga de contactarlos — y aquí ves cómo va cada uno."
        action={
          <button type="button" className="dcafp-btn dcafp-btn--primary" onClick={abrirNuevo}>
            <Plus size={15} />
            Recomendar un negocio
          </button>
        }
      />

      <StatRow>
        <Kpi label="Recomendados" value={listado.total} sub="Negocios que has mandado" />
        <Kpi
          label="En seguimiento"
          value={listado.enProceso}
          sub="DaleControl ya está en contacto"
        />
        <Kpi label="Ya son clientes" value={listado.ganados} sub="Cerrados gracias a ti" />
      </StatRow>

      {/* ── Alta / edición, EN LÍNEA (ver la cabecera del archivo) ────── */}
      {abierto && (
        <PanelCard
          accent
          title={editando ? "Editar recomendación" : "Nuevo negocio recomendado"}
          sub={
            editando
              ? "Corrige lo que haga falta. El equipo ve los cambios enseguida."
              : "Con el nombre y el giro basta para empezar; entre más datos, más rápido lo contactan."
          }
          action={
            <button
              type="button"
              className="dcafp-btn dcafp-btn--ghost dcafp-btn--sm"
              onClick={() => setAbierto(null)}
              aria-label="Cerrar"
            >
              <X size={14} />
            </button>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="dcafp-grid2">
              <div>
                <label className="dcafp-label" htmlFor="af-crm-name">
                  Nombre del negocio *
                </label>
                <input
                  id="af-crm-name"
                  className="dcafp-input"
                  autoFocus
                  placeholder="Clínica Dental Sonrisa"
                  value={c.name}
                  onChange={(e) => set("name", e.target.value)}
                />
              </div>
              <div>
                <label className="dcafp-label" htmlFor="af-crm-vertical">
                  Tipo
                </label>
                <select
                  id="af-crm-vertical"
                  className="dcafp-select"
                  value={c.vertical}
                  onChange={(e) => set("vertical", e.target.value)}
                >
                  {CRM_VERTICALES.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="dcafp-grid2">
              <div>
                <label className="dcafp-label" htmlFor="af-crm-city">
                  Ciudad
                </label>
                <input
                  id="af-crm-city"
                  className="dcafp-input"
                  placeholder="Puebla"
                  value={c.city}
                  onChange={(e) => set("city", e.target.value)}
                />
              </div>
              <div>
                <label className="dcafp-label" htmlFor="af-crm-country">
                  País
                </label>
                <input
                  id="af-crm-country"
                  className="dcafp-input"
                  placeholder="México"
                  value={c.country}
                  onChange={(e) => set("country", e.target.value)}
                />
              </div>
            </div>

            <div className="dcafp-grid2">
              <div>
                <label className="dcafp-label" htmlFor="af-crm-phone">
                  Teléfono o WhatsApp
                </label>
                <input
                  id="af-crm-phone"
                  className="dcafp-input"
                  placeholder="55 1234 5678"
                  value={c.phone}
                  onChange={(e) => set("phone", e.target.value)}
                />
              </div>
              <div>
                <label className="dcafp-label" htmlFor="af-crm-web">
                  Página web o redes
                </label>
                <input
                  id="af-crm-web"
                  className="dcafp-input"
                  placeholder="instagram.com/clinicasonrisa"
                  value={c.website}
                  onChange={(e) => set("website", e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="dcafp-label" htmlFor="af-crm-contact">
                ¿Con quién hay que hablar? <span style={{ opacity: 0.6 }}>(opcional)</span>
              </label>
              <input
                id="af-crm-contact"
                className="dcafp-input"
                placeholder="Dra. Ana Ruiz, la dueña"
                value={c.contactName}
                onChange={(e) => set("contactName", e.target.value)}
              />
            </div>

            <div>
              <label className="dcafp-label" htmlFor="af-crm-notes">
                Notas
              </label>
              <textarea
                id="af-crm-notes"
                className="dcafp-textarea"
                placeholder="Lo que nos sirva saber: si ya los conoces, qué usan hoy, cuándo conviene buscarlos…"
                value={c.notes}
                onChange={(e) => set("notes", e.target.value)}
              />
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
              {invalido && (
                <span
                  style={{
                    fontSize: 12,
                    color: "var(--dcafp-danger, #b3261e)",
                    marginRight: "auto",
                    alignSelf: "center",
                  }}
                >
                  {invalido}
                </span>
              )}
              <button
                type="button"
                className="dcafp-btn dcafp-btn--ghost"
                onClick={() => setAbierto(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="dcafp-btn dcafp-btn--primary"
                onClick={guardar}
                disabled={!!invalido}
              >
                {editando ? "Guardar cambios" : "Mandar la recomendación"}
              </button>
            </div>
          </div>
        </PanelCard>
      )}

      {/* ── Lo recomendado ───────────────────────────────────────────── */}
      <PanelCard title={`Tus recomendaciones (${listado.total})`}>
        {listado.filas.length === 0 ? (
          <EmptyState
            icon={<Building2 size={22} />}
            title="Todavía no has recomendado ningún negocio"
            action={
              <button type="button" className="dcafp-btn dcafp-btn--primary" onClick={abrirNuevo}>
                <Plus size={15} />
                Recomendar el primero
              </button>
            }
          >
            Piensa en las clínicas dentales, universidades o barberías que ya conoces. Las das de
            alta aquí, el equipo de DaleControl las contacta, y tú ves en esta misma pantalla si
            se convirtieron en clientes.
          </EmptyState>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {listado.filas.map((p) => (
              <Recomendacion
                key={p.id}
                p={p}
                alEditar={() => abrirEdicion(p)}
                alQuitar={() => quitar(p)}
              />
            ))}
          </div>
        )}
      </PanelCard>

      <Footnote>
        {listado.truncado
          ? `Se muestran los ${listado.filas.length} más recientes de ${listado.total}. `
          : ""}
        Una recomendación cuenta como tuya desde que la das de alta. Si el negocio ya estaba
        registrado en DaleControl, el alta te lo avisa y no se duplica.
      </Footnote>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════

function Recomendacion({
  p,
  alEditar,
  alQuitar,
}: {
  p: CrmProspectoAfiliadoDTO;
  alEditar: () => void;
  alQuitar: () => void;
}) {
  const estado = crmEstadoParaAfiliado(p.stage);
  const v = crmVertical(p.vertical);
  const wa = crmWhatsappLink(p.phone);
  const tel = crmTelLink(p.phone);
  const web = p.website
    ? /^https?:\/\//i.test(p.website)
      ? p.website
      : `https://${p.website}`
    : null;
  // Sólo se puede quitar mientras DaleControl no lo haya movido; el servidor
  // lo vuelve a comprobar, esto es para no ofrecer un botón que va a fallar.
  const sePuedeQuitar = p.stage === "NUEVO";

  return (
    <div
      style={{
        border: "1px solid var(--dcafp-line)",
        borderRadius: 12,
        padding: 14,
        display: "flex",
        gap: 14,
        flexWrap: "wrap",
        alignItems: "flex-start",
      }}
    >
      <div style={{ flex: "1 1 240px", minWidth: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span className="dcafp-td--name">{p.name}</span>
          <Chip tone={TONO_CHIP[estado.tono] ?? "neutral"} dot sm>
            {estado.label}
          </Chip>
        </div>
        <div
          style={{
            fontSize: 12,
            color: "var(--dcafp-ink-3)",
            marginTop: 3,
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <span>{v.label}</span>
          {(p.city || p.country) && <span>· {[p.city, p.country].filter(Boolean).join(", ")}</span>}
          {p.contactName && <span>· {p.contactName}</span>}
        </div>
        {p.notes && (
          <p
            style={{
              margin: "8px 0 0",
              fontSize: 12.5,
              color: "var(--dcafp-ink-2)",
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
            }}
          >
            {p.notes}
          </p>
        )}
        <p style={{ margin: "6px 0 0", fontSize: 11.5, color: "var(--dcafp-ink-4)" }}>
          {estado.ayuda}
        </p>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {p.phone && (
          <a
            className="dcafp-btn dcafp-btn--outline dcafp-btn--sm"
            href={wa ?? tel ?? "#"}
            target={wa ? "_blank" : undefined}
            rel="noopener noreferrer"
            title={crmTelefonoLegible(p.phone)}
          >
            <Phone size={14} />
            {crmTelefonoLegible(p.phone)}
          </a>
        )}
        {web && (
          <a
            className="dcafp-btn dcafp-btn--outline dcafp-btn--sm"
            href={web}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Globe size={14} />
            Sitio
          </a>
        )}
        <button
          type="button"
          className="dcafp-btn dcafp-btn--ghost dcafp-btn--sm"
          onClick={alEditar}
        >
          <Pencil size={14} />
          Editar
        </button>
        {sePuedeQuitar && (
          <button
            type="button"
            className="dcafp-btn dcafp-btn--ghost dcafp-btn--sm"
            onClick={alQuitar}
            aria-label={`Quitar ${p.name}`}
            title="Quitar de mis recomendaciones"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
