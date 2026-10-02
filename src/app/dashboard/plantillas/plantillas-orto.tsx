"use client";

// Administración → Plantillas → «Notas de ortodoncia»: las plantillas que la
// hoja de control ofrece en «Plantillas» (ws1-t5 · 10b). Son las mismas filas
// que lee el selector de la hoja; aquí se ven, se copian, se editan y se apagan.

import { useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Copy, FileText, Pencil, Plus, Power, Search } from "lucide-react";
import { useLocale, useT } from "@/i18n/i18n-provider";
import { nombreDeCopia } from "@/lib/orthodontics/plantillas-nota";
import type { PlantillaNotaDTO } from "@/lib/orthodontics/plantillas-nota-service";
import { PlantillaOrtoModal } from "./plantilla-orto-modal";
import { fueEditada } from "./tarjeta";
import styles from "./plantillas.module.css";

interface Props {
  filas: PlantillaNotaDTO[];
  onChange: (filas: PlantillaNotaDTO[]) => void;
}

export type ModalOrto =
  | { modo: "nueva" }
  | { modo: "ver" | "editar"; fila: PlantillaNotaDTO }
  | { modo: "copia"; fila: PlantillaNotaDTO };

export function PlantillasOrto({ filas, onChange }: Props) {
  const t = useT();
  const locale = useLocale();
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<ModalOrto | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Primero las que están en uso; entre ellas las de la clínica antes que las de fábrica.
  const ordenadas = useMemo(
    () =>
      [...filas].sort(
        (a, b) =>
          Number(b.activa) - Number(a.activa) ||
          Number(a.deFabrica) - Number(b.deFabrica) ||
          a.name.localeCompare(b.name, locale),
      ),
    [filas, locale],
  );
  const visibles = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? ordenadas.filter((p) => p.name.toLowerCase().includes(q)) : ordenadas;
  }, [ordenadas, search]);

  const fecha = (iso: string) =>
    new Date(iso).toLocaleDateString(locale === "en" ? "en-US" : "es-MX", { day: "numeric", month: "short", year: "numeric" });

  function mensajeDeError(data: any): string {
    const code = typeof data?.code === "string" ? data.code : "";
    const clave = `pages.plantillas.orto.errores.${code}`;
    const traducido = code ? t(clave) : "";
    return traducido && traducido !== clave ? traducido : t("pages.plantillas.errores.generico");
  }

  function alGuardar(guardada: PlantillaNotaDTO, eraNueva: boolean) {
    onChange(eraNueva ? [...filas, guardada] : filas.map((f) => (f.id === guardada.id ? guardada : f)));
    setModal(null);
    toast.success(t(eraNueva ? "pages.plantillas.toastCreada" : "pages.plantillas.toastGuardada"));
  }

  // Siempre la lista más reciente: el «Deshacer» del aviso se pulsa segundos después y no debe pisar lo que
  // cambió mientras tanto (otra plantilla guardada, copiada…).
  const filasRef = useRef(filas);
  filasRef.current = filas;

  async function ponerActiva(id: string, activa: boolean, conDeshacer: boolean) {
    if (busyId) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/orthodontics/note-templates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activa }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.id) {
        toast.error(mensajeDeError(data));
        return;
      }
      onChange(filasRef.current.map((f) => (f.id === id ? (data as PlantillaNotaDTO) : f)));
      if (data.activa || !conDeshacer) {
        toast.success(t(data.activa ? "pages.plantillas.toastActivada" : "pages.plantillas.toastDesactivada"));
        return;
      }
      // «Desactivar» no pide confirmación (se apaga y se enciende en un clic), pero un clic en la fila
      // equivocada no puede pasar inadvertido: el aviso se queda 8 s con «Deshacer».
      toast(
        (aviso) => (
          <span>
            {t("pages.plantillas.toastDesactivada")}{" "}
            <button
              type="button"
              className={styles.toastDeshacer}
              onClick={() => {
                toast.dismiss(aviso.id);
                void ponerActiva(id, true, false);
              }}
            >
              {t("pages.plantillas.deshacer")}
            </button>
          </span>
        ),
        { duration: 8000 },
      );
    } catch {
      toast.error(t("pages.plantillas.errores.generico"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className={styles.headAcciones}>
        <p className={styles.notaAyuda}>{t("pages.plantillas.orto.ayuda")}</p>
        <button type="button" className={styles.btnPrimary} onClick={() => setModal({ modo: "nueva" })}>
          <Plus size={16} aria-hidden />
          {t("pages.plantillas.nueva")}
        </button>
      </div>

      {filas.length > 0 && (
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

      {filas.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon} aria-hidden>
            <FileText size={26} />
          </span>
          <p className={styles.emptyTitle}>{t("pages.plantillas.orto.vacio")}</p>
          <p className={styles.emptyHelp}>{t("pages.plantillas.orto.vacioAyuda")}</p>
          <button type="button" className={styles.btnPrimary} onClick={() => setModal({ modo: "nueva" })}>
            <Plus size={16} aria-hidden />
            {t("pages.plantillas.nueva")}
          </button>
        </div>
      ) : visibles.length === 0 ? (
        <p className={styles.noResults}>{t("pages.plantillas.sinResultados")}</p>
      ) : (
        <ul className={styles.list}>
          {visibles.map((p) => (
            <li key={p.id} className={`${styles.card} ${p.activa ? "" : styles.cardInactive}`}>
              <span className={`${styles.cardIcon} ${p.deFabrica ? "" : styles.cardIconPropia}`} aria-hidden>
                <FileText size={18} />
              </span>
              <div className={styles.cardMain}>
                <div className={styles.cardTitleRow}>
                  <h2 className={styles.cardTitle}>
                    <button
                      type="button"
                      className={styles.cardTitleBtn}
                      onClick={() => setModal({ modo: p.deFabrica ? "ver" : "editar", fila: p })}
                    >
                      {p.name}
                    </button>
                  </h2>
                  <span className={`${styles.badge} ${p.activa ? styles.badgeEnUso : ""}`}>
                    {t(p.activa ? "pages.plantillas.enUso" : "pages.plantillas.inactiva")}
                  </span>
                  <span className={`${styles.badge} ${p.deFabrica ? "" : styles.badgePropia}`}>
                    {t(p.deFabrica ? "pages.plantillas.orto.deFabrica" : "pages.plantillas.propia")}
                  </span>
                </div>
                <p className={styles.cardMeta}>
                  {t("pages.plantillas.creada", { fecha: fecha(p.createdAt) })}
                  {fueEditada(p.createdAt, p.updatedAt) &&
                    ` · ${t("pages.plantillas.actualizada", { fecha: fecha(p.updatedAt) })}`}
                </p>
              </div>
              <div className={styles.cardActions}>
                {!p.deFabrica && (
                  <button
                    type="button"
                    className={styles.iconBtn}
                    onClick={() => setModal({ modo: "editar", fila: p })}
                    title={t("pages.plantillas.editar")}
                    aria-label={`${t("pages.plantillas.editar")}: ${p.name}`}
                  >
                    <Pencil size={16} aria-hidden />
                  </button>
                )}
                <button
                  type="button"
                  className={styles.iconBtn}
                  onClick={() => setModal({ modo: "copia", fila: p })}
                  title={t("pages.plantillas.orto.copiar")}
                  aria-label={`${t("pages.plantillas.orto.copiar")}: ${p.name}`}
                >
                  <Copy size={16} aria-hidden />
                </button>
                <button
                  type="button"
                  className={styles.iconBtn}
                  disabled={busyId === p.id}
                  onClick={() => ponerActiva(p.id, !p.activa, p.activa)}
                  title={t(p.activa ? "pages.plantillas.desactivar" : "pages.plantillas.activar")}
                  aria-label={`${t(p.activa ? "pages.plantillas.desactivar" : "pages.plantillas.activar")}: ${p.name}`}
                >
                  <Power size={16} aria-hidden />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {modal && (
        <PlantillaOrtoModal
          modal={modal}
          nombreSugeridoDeCopia={(origen) => nombreDeCopia(origen, filas.map((f) => f.name), t("pages.plantillas.orto.sufijoCopia"))}
          onClose={() => setModal(null)}
          onCopiar={(fila) => setModal({ modo: "copia", fila })}
          onSaved={alGuardar}
          mensajeDeError={mensajeDeError}
        />
      )}
    </>
  );
}
