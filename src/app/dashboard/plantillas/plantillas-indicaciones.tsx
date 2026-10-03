"use client";

// Administración → Plantillas → «Indicaciones» y «Constancia de asistencia»
// (ws1-t10, mejora 12). Misma forma que «Notas de ortodoncia»: las de fábrica se
// ven y se copian; las propias se editan; nada se borra, se apaga. Las de
// indicaciones, además, se ligan a procedimientos del catálogo (las de fábrica
// también: el texto no se toca, la liga sí).

import { useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { ClipboardList, Copy, FileBadge, Pencil, Plus, Power, Search } from "lucide-react";
import { useLocale } from "@/i18n/i18n-provider";
import { nombreDeCopiaHoja } from "@/lib/indicaciones/servicio";
import { conValores, useTextosIndicaciones } from "@/lib/indicaciones/textos";
import type { HojaDTO, ProcedimientoLigable, TipoHoja } from "@/lib/indicaciones/tipos";
import { PlantillaIndicacionesModal, type ModalHoja } from "./plantilla-indicaciones-modal";
import { fueEditada } from "./tarjeta";
import styles from "./plantillas.module.css";
import propios from "./plantillas-indicaciones.module.css";

interface Props {
  tipo: TipoHoja;
  /** Todas las hojas de la clínica (las dos pestañas); aquí se ven las de `tipo`. */
  hojas: HojaDTO[];
  procedimientos: ProcedimientoLigable[];
  onChange: (hojas: HojaDTO[]) => void;
}

export function PlantillasIndicaciones({ tipo, hojas, procedimientos, onChange }: Props) {
  const tx = useTextosIndicaciones();
  const locale = useLocale();
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<ModalHoja | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const hojasRef = useRef(hojas);
  hojasRef.current = hojas;

  const nombreProc = useMemo(() => new Map(procedimientos.map((p) => [p.id, p.name])), [procedimientos]);
  const delTipo = useMemo(
    () =>
      hojas
        .filter((h) => h.tipo === tipo)
        .sort(
          (a, b) =>
            Number(b.activa) - Number(a.activa) ||
            Number(a.deFabrica) - Number(b.deFabrica) ||
            a.nombre.localeCompare(b.nombre, locale),
        ),
    [hojas, tipo, locale],
  );
  const visibles = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? delTipo.filter((h) => h.nombre.toLowerCase().includes(q)) : delTipo;
  }, [delTipo, search]);

  const fecha = (iso: string) =>
    new Date(iso).toLocaleDateString(locale === "en" ? "en-US" : "es-MX", { day: "numeric", month: "short", year: "numeric" });

  function mensajeDeError(data: unknown): string {
    const code = (data as { code?: unknown } | null)?.code;
    return typeof code === "string" && code in tx.errores ? tx.errores[code as keyof typeof tx.errores] : tx.errores.generico;
  }

  function alGuardar(guardada: HojaDTO, eraNueva: boolean) {
    const actuales = hojasRef.current;
    onChange(eraNueva ? [...actuales, guardada] : actuales.map((h) => (h.id === guardada.id ? guardada : h)));
    setModal(null);
    toast.success(eraNueva ? tx.toastCreada : tx.toastGuardada);
  }

  async function ponerActiva(id: string, activa: boolean, conDeshacer: boolean) {
    if (busyId) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/indicaciones/plantillas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activa }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.id) {
        toast.error(mensajeDeError(data));
        return;
      }
      onChange(hojasRef.current.map((h) => (h.id === id ? (data as HojaDTO) : h)));
      if (data.activa || !conDeshacer) {
        toast.success(data.activa ? tx.toastActivada : tx.toastDesactivada);
        return;
      }
      toast(
        (aviso) => (
          <span>
            {tx.toastDesactivada}{" "}
            <button
              type="button"
              className={styles.toastDeshacer}
              onClick={() => {
                toast.dismiss(aviso.id);
                void ponerActiva(id, true, false);
              }}
            >
              {tx.deshacer}
            </button>
          </span>
        ),
        { duration: 8000 },
      );
    } catch {
      toast.error(tx.errores.generico);
    } finally {
      setBusyId(null);
    }
  }

  const Icono = tipo === "CONSTANCIA" ? FileBadge : ClipboardList;

  return (
    <>
      <div className={styles.headAcciones}>
        <p className={styles.notaAyuda}>{tipo === "CONSTANCIA" ? tx.ayudaConstancia : tx.ayudaIndicaciones}</p>
        <button type="button" className={styles.btnPrimary} onClick={() => setModal({ modo: "nueva", tipo })}>
          <Plus size={16} aria-hidden />
          {tx.nueva}
        </button>
      </div>

      {delTipo.length > 3 && (
        <label className={styles.search}>
          <Search size={16} aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tx.buscar}
            aria-label={tx.buscar}
          />
        </label>
      )}

      {delTipo.length === 0 ? (
        <p className={styles.noResults}>{tx.vacio}</p>
      ) : visibles.length === 0 ? (
        <p className={styles.noResults}>{tx.sinResultados}</p>
      ) : (
        <ul className={styles.list}>
          {visibles.map((h) => {
            const ligados = h.procedureIds.map((id) => nombreProc.get(id)).filter((n): n is string => !!n);
            return (
              <li key={h.id} className={`${styles.card} ${h.activa ? "" : styles.cardInactive}`}>
                <span className={`${styles.cardIcon} ${h.deFabrica ? "" : styles.cardIconPropia}`} aria-hidden>
                  <Icono size={18} />
                </span>
                <div className={styles.cardMain}>
                  <div className={styles.cardTitleRow}>
                    <h2 className={styles.cardTitle}>
                      <button
                        type="button"
                        className={styles.cardTitleBtn}
                        onClick={() => setModal({ modo: h.deFabrica ? "ver" : "editar", hoja: h })}
                      >
                        {h.nombre}
                      </button>
                    </h2>
                    <span className={`${styles.badge} ${h.activa ? styles.badgeEnUso : ""}`}>
                      {h.activa ? tx.enUso : tx.inactiva}
                    </span>
                    <span className={`${styles.badge} ${h.deFabrica ? "" : styles.badgePropia}`}>
                      {h.deFabrica ? tx.deFabrica : tx.propia}
                    </span>
                  </div>
                  {tipo === "INDICACIONES" && (
                    <p className={propios.liga}>
                      {ligados.length > 0 ? conValores(tx.ligadaA, { lista: ligados.join(", ") }) : tx.sinLiga}
                    </p>
                  )}
                  <p className={styles.cardMeta}>
                    {conValores(tx.creada, { fecha: fecha(h.createdAt) })}
                    {fueEditada(h.createdAt, h.updatedAt) && ` · ${conValores(tx.actualizada, { fecha: fecha(h.updatedAt) })}`}
                  </p>
                </div>
                <div className={styles.cardActions}>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    onClick={() => setModal({ modo: h.deFabrica ? "ver" : "editar", hoja: h })}
                    title={h.deFabrica ? tx.ver : tx.editar}
                    aria-label={`${h.deFabrica ? tx.ver : tx.editar}: ${h.nombre}`}
                  >
                    <Pencil size={16} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    onClick={() => setModal({ modo: "copia", hoja: h })}
                    title={tx.copiar}
                    aria-label={`${tx.copiar}: ${h.nombre}`}
                  >
                    <Copy size={16} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    disabled={busyId === h.id}
                    onClick={() => ponerActiva(h.id, !h.activa, h.activa)}
                    title={h.activa ? tx.desactivar : tx.activar}
                    aria-label={`${h.activa ? tx.desactivar : tx.activar}: ${h.nombre}`}
                  >
                    <Power size={16} aria-hidden />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {modal && (
        <PlantillaIndicacionesModal
          // Una ventana por modo y hoja: «Copiar y editar» desde «Ver» tiene que volver a sembrar
          // el nombre («… (copia)») y el texto; con la misma instancia se quedaba el nombre original.
          key={modal.modo === "nueva" ? `nueva-${modal.tipo}` : `${modal.modo}-${modal.hoja.id}`}
          modal={modal}
          procedimientos={procedimientos}
          nombreSugeridoDeCopia={(origen) =>
            nombreDeCopiaHoja(origen, hojas.filter((h) => h.tipo === tipo).map((h) => h.nombre), tx.sufijoCopia)
          }
          onClose={() => setModal(null)}
          onCopiar={(hoja) => setModal({ modo: "copia", hoja })}
          onSaved={alGuardar}
          mensajeDeError={mensajeDeError}
        />
      )}
    </>
  );
}
