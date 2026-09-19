"use client";

import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { FileText, Pencil, Plus, Power, Search, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useLocale, useT } from "@/i18n/i18n-provider";
import {
  DOCUMENT_TEMPLATE_KINDS,
  type DocumentTemplateKindValue,
} from "@/lib/document-templates/kinds";
import { PlantillaModal } from "./plantilla-modal";
import { fueEditada, ordenarPlantillas } from "./tarjeta";
import styles from "./plantillas.module.css";

export interface PlantillaFila {
  id: string;
  kind: DocumentTemplateKindValue;
  name: string;
  body: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /** Sembrada por DaleControl, no escrita por la clínica. Ver tarjeta.ts. */
  precargada: boolean;
}

interface Props {
  initialTemplates: PlantillaFila[];
}

// Pestañas y no dos listas: en la ficha del paciente cada sitio enseña SOLO las
// suyas, y aquí se trabaja igual — un tipo a la vez, y «Nueva plantilla» crea
// del tipo que se está mirando, sin preguntarlo.
const TAB_KEY: Record<DocumentTemplateKindValue, string> = {
  NOTA_EVOLUCION: "pages.plantillas.tabNota",
  CONSENTIMIENTO: "pages.plantillas.tabConsentimiento",
};
const VACIO_KEY: Record<DocumentTemplateKindValue, string> = {
  NOTA_EVOLUCION: "pages.plantillas.vacioNota",
  CONSENTIMIENTO: "pages.plantillas.vacioConsentimiento",
};

export function PlantillasClient({ initialTemplates }: Props) {
  const t = useT();
  const locale = useLocale();
  const askConfirm = useConfirm();
  const [templates, setTemplates] = useState<PlantillaFila[]>(initialTemplates);
  const [kind, setKind] = useState<DocumentTemplateKindValue>("NOTA_EVOLUCION");
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<{ editing: PlantillaFila | null } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const conteo = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of templates) c[p.kind] = (c[p.kind] ?? 0) + 1;
    return c;
  }, [templates]);

  const delTipo = useMemo(
    () => ordenarPlantillas(templates.filter((p) => p.kind === kind), locale),
    [templates, kind, locale],
  );

  const visibles = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? delTipo.filter((p) => p.name.toLowerCase().includes(q)) : delTipo;
  }, [delTipo, search]);

  const fecha = (iso: string) =>
    new Date(iso).toLocaleDateString(locale === "en" ? "en-US" : "es-MX", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

  function mensajeDeError(data: any): string {
    const code = typeof data?.code === "string" ? data.code : "";
    const clave = `pages.plantillas.errores.${code}`;
    const traducido = code ? t(clave) : "";
    return traducido && traducido !== clave ? traducido : t("pages.plantillas.errores.generico");
  }

  function alGuardar(guardada: PlantillaFila, eraNueva: boolean) {
    setTemplates((prev) => (eraNueva ? [...prev, guardada] : prev.map((p) => (p.id === guardada.id ? guardada : p))));
    setModal(null);
    toast.success(t(eraNueva ? "pages.plantillas.toastCreada" : "pages.plantillas.toastGuardada"));
  }

  async function alternarActiva(p: PlantillaFila) {
    if (busyId) return;
    setBusyId(p.id);
    try {
      const res = await fetch(`/api/document-templates/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !p.isActive }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(mensajeDeError(data));
        return;
      }
      setTemplates((prev) => prev.map((x) => (x.id === p.id ? { ...x, isActive: data.isActive, updatedAt: data.updatedAt } : x)));
      toast.success(t(data.isActive ? "pages.plantillas.toastActivada" : "pages.plantillas.toastDesactivada"));
    } catch {
      toast.error(t("pages.plantillas.errores.generico"));
    } finally {
      setBusyId(null);
    }
  }

  async function eliminar(p: PlantillaFila) {
    if (busyId) return;
    const ok = await askConfirm({
      title: t("pages.plantillas.confirmarEliminarTitulo", { nombre: p.name }),
      description: t("pages.plantillas.confirmarEliminarTexto"),
      confirmText: t("pages.plantillas.eliminar"),
      variant: "danger",
    });
    if (!ok) return;
    setBusyId(p.id);
    try {
      const res = await fetch(`/api/document-templates/${p.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok && res.status !== 404) {
        toast.error(mensajeDeError(data));
        return;
      }
      setTemplates((prev) => prev.filter((x) => x.id !== p.id));
      toast.success(t("pages.plantillas.toastEliminada"));
    } catch {
      toast.error(t("pages.plantillas.errores.generico"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div>
          <h1 className={styles.title}>{t("pages.plantillas.title")}</h1>
          <p className={styles.subtitle}>{t("pages.plantillas.subtitle")}</p>
        </div>
        <button type="button" className={styles.btnPrimary} onClick={() => setModal({ editing: null })}>
          <Plus size={16} aria-hidden />
          {t("pages.plantillas.nueva")}
        </button>
      </header>

      <div className={styles.tabs} role="tablist" aria-label={t("pages.plantillas.title")}>
        {DOCUMENT_TEMPLATE_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            id={`plantillas-tab-${k}`}
            aria-selected={kind === k}
            aria-controls="plantillas-panel"
            className={`${styles.tab} ${kind === k ? styles.tabActive : ""}`}
            onClick={() => {
              setKind(k);
              setSearch("");
            }}
          >
            {t(TAB_KEY[k])}
            <span className={styles.tabCount}>{conteo[k] ?? 0}</span>
          </button>
        ))}
      </div>

      <section id="plantillas-panel" role="tabpanel" aria-labelledby={`plantillas-tab-${kind}`} className={styles.panel}>
        {delTipo.length > 0 && (
          <label className={styles.search}>
            <Search size={16} aria-hidden />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("pages.plantillas.buscar")}
              aria-label={t("pages.plantillas.buscar")}
            />
          </label>
        )}

        {delTipo.length === 0 ? (
          <div className={styles.empty}>
            <span className={styles.emptyIcon} aria-hidden>
              <FileText size={26} />
            </span>
            <p className={styles.emptyTitle}>{t(VACIO_KEY[kind])}</p>
            <p className={styles.emptyHelp}>{t("pages.plantillas.vacioAyuda")}</p>
            <button type="button" className={styles.btnPrimary} onClick={() => setModal({ editing: null })}>
              <Plus size={16} aria-hidden />
              {t("pages.plantillas.nueva")}
            </button>
          </div>
        ) : visibles.length === 0 ? (
          <p className={styles.noResults}>{t("pages.plantillas.sinResultados")}</p>
        ) : (
          <ul className={styles.list}>
            {visibles.map((p) => (
              <li key={p.id} className={`${styles.card} ${p.isActive ? "" : styles.cardInactive}`}>
                <span className={`${styles.cardIcon} ${p.precargada ? "" : styles.cardIconPropia}`} aria-hidden>
                  <FileText size={18} />
                </span>
                {/* La tarjeta enseña el título, las fechas y los botones. El texto
                    de la carta NO: ocupaba la fila entera y no ayudaba a encontrarla. */}
                <div className={styles.cardMain}>
                  <div className={styles.cardTitleRow}>
                    <h2 className={styles.cardTitle}>
                      <button type="button" className={styles.cardTitleBtn} onClick={() => setModal({ editing: p })}>
                        {p.name}
                      </button>
                    </h2>
                    <span className={`${styles.badge} ${p.isActive ? styles.badgeEnUso : ""}`}>
                      {t(p.isActive ? "pages.plantillas.enUso" : "pages.plantillas.inactiva")}
                    </span>
                    <span className={`${styles.badge} ${p.precargada ? "" : styles.badgePropia}`}>
                      {t(p.precargada ? "pages.plantillas.precargada" : "pages.plantillas.propia")}
                    </span>
                  </div>
                  <p className={styles.cardMeta}>
                    {t("pages.plantillas.creada", { fecha: fecha(p.createdAt) })}
                    {fueEditada(p.createdAt, p.updatedAt) &&
                      ` · ${t("pages.plantillas.actualizada", { fecha: fecha(p.updatedAt) })}`}
                  </p>
                </div>
                <div className={styles.cardActions}>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    onClick={() => setModal({ editing: p })}
                    title={t("pages.plantillas.editar")}
                    aria-label={`${t("pages.plantillas.editar")}: ${p.name}`}
                  >
                    <Pencil size={16} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    disabled={busyId === p.id}
                    onClick={() => alternarActiva(p)}
                    title={t(p.isActive ? "pages.plantillas.desactivar" : "pages.plantillas.activar")}
                    aria-label={`${t(p.isActive ? "pages.plantillas.desactivar" : "pages.plantillas.activar")}: ${p.name}`}
                  >
                    <Power size={16} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                    disabled={busyId === p.id}
                    onClick={() => eliminar(p)}
                    title={t("pages.plantillas.eliminar")}
                    aria-label={`${t("pages.plantillas.eliminar")}: ${p.name}`}
                  >
                    <Trash2 size={16} aria-hidden />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {modal && (
        <PlantillaModal
          kind={modal.editing?.kind ?? kind}
          editing={modal.editing}
          onClose={() => setModal(null)}
          onSaved={alGuardar}
          mensajeDeError={mensajeDeError}
        />
      )}
    </div>
  );
}
