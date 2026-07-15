"use client";

import { useState, useEffect } from "react";
import { Plus, ImageOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";
import styles from "./before-after.module.css";

interface Patient {
  id: string;
  firstName: string;
  lastName: string;
  _count: { beforeAfterPhotos: number };
}

interface Photo {
  id: string;
  category: string;
  angle: string;
  url: string;
  notes: string | null;
  takenAt: string;
}

export function BeforeAfterClient({ patients }: { patients: Patient[] }) {
  const t = useT();
  const [selectedPatient, setSelectedPatient] = useState<string>("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ category: "before", angle: "front", url: "", notes: "" });

  useEffect(() => {
    if (!selectedPatient) { setPhotos([]); return; }
    const ctrl = new AbortController();
    setLoading(true);
    fetch(`/api/before-after?patientId=${selectedPatient}`, { signal: ctrl.signal })
      .then(r => { if (!r.ok) throw new Error("Error"); return r.json(); })
      .then(data => setPhotos(Array.isArray(data) ? data : []))
      .catch(err => { if (err.name !== "AbortError") toast.error(t("pages.beforeAfter.errorLoadPhotos")); })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    return () => ctrl.abort();
  }, [selectedPatient, t]);

  async function handleAdd() {
    if (!form.url.trim()) { toast.error(t("pages.beforeAfter.errorUrlRequired")); return; }
    if (!selectedPatient) { toast.error(t("pages.beforeAfter.errorSelectPatient")); return; }
    try {
      const res = await fetch("/api/before-after", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId: selectedPatient, ...form }),
      });
      if (!res.ok) throw new Error();
      const created = await res.json();
      setPhotos(prev => [created, ...prev]);
      setShowAdd(false);
      setForm({ category: "before", angle: "front", url: "", notes: "" });
      toast.success(t("pages.beforeAfter.photoAdded"));
    } catch {
      toast.error(t("pages.beforeAfter.errorAddPhoto"));
    }
  }

  const beforePhotos = photos.filter(p => p.category === "before");
  const afterPhotos = photos.filter(p => p.category === "after");

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>{t("pages.beforeAfter.title")}</h1>
          <p className={styles.subtitle}>{t("pages.beforeAfter.subtitle")}</p>
        </div>
        <Button onClick={() => setShowAdd(true)} disabled={!selectedPatient}>
          <Plus className="w-5 h-5 mr-2" strokeWidth={1.75} /> {t("pages.beforeAfter.addPhoto")}
        </Button>
      </div>

      {/* Patient selector */}
      <div className={styles.selector}>
        <Label className={styles.fieldLabel}>{t("pages.beforeAfter.patient")}</Label>
        <select
          className={styles.select}
          value={selectedPatient}
          onChange={e => setSelectedPatient(e.target.value)}
        >
          <option value="">{t("pages.beforeAfter.selectPatient")}</option>
          {patients.map(p => (
            <option key={p.id} value={p.id}>
              {p.firstName} {p.lastName} ({t("pages.beforeAfter.photosCount", { count: p._count.beforeAfterPhotos })})
            </option>
          ))}
        </select>
      </div>

      {loading && <p className={styles.loading}>{t("pages.beforeAfter.loadingPhotos")}</p>}

      {!loading && selectedPatient && photos.length === 0 && (
        <div className={styles.empty}>
          <span className={styles.emptyIcon} aria-hidden="true">
            <ImageOff size={22} strokeWidth={1.75} />
          </span>
          <p className={styles.emptyTitle}>{t("pages.beforeAfter.noPhotos")}</p>
        </div>
      )}

      {/* Side-by-side comparison */}
      {photos.length > 0 && (
        <div className={styles.compareGrid}>
          <div>
            <div className={styles.colHead}>
              <h2 className={styles.colTitle}>{t("pages.beforeAfter.before")}</h2>
              <span className={styles.colCount}>{beforePhotos.length}</span>
            </div>
            <div className={styles.colStack}>
              {beforePhotos.map(photo => (
                <div key={photo.id} className={styles.mediaCard}>
                  <img src={photo.url} alt={t("pages.beforeAfter.before")} className={styles.mediaImg} />
                  <div className={styles.mediaBody}>
                    <p className={styles.mediaAngle}>{photo.angle}</p>
                    {photo.notes && <p className={styles.mediaNotes}>{photo.notes}</p>}
                    <p className={styles.mediaDate}>{new Date(photo.takenAt).toLocaleDateString("es-MX")}</p>
                  </div>
                </div>
              ))}
              {beforePhotos.length === 0 && <p className={styles.colEmpty}>{t("pages.beforeAfter.noBeforePhotos")}</p>}
            </div>
          </div>
          <div>
            <div className={styles.colHead}>
              <h2 className={styles.colTitle}>{t("pages.beforeAfter.after")}</h2>
              <span className={styles.colCount}>{afterPhotos.length}</span>
            </div>
            <div className={styles.colStack}>
              {afterPhotos.map(photo => (
                <div key={photo.id} className={styles.mediaCard}>
                  <img src={photo.url} alt={t("pages.beforeAfter.after")} className={styles.mediaImg} />
                  <div className={styles.mediaBody}>
                    <p className={styles.mediaAngle}>{photo.angle}</p>
                    {photo.notes && <p className={styles.mediaNotes}>{photo.notes}</p>}
                    <p className={styles.mediaDate}>{new Date(photo.takenAt).toLocaleDateString("es-MX")}</p>
                  </div>
                </div>
              ))}
              {afterPhotos.length === 0 && <p className={styles.colEmpty}>{t("pages.beforeAfter.noAfterPhotos")}</p>}
            </div>
          </div>
        </div>
      )}

      {/* Add Photo Modal */}
      {showAdd && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHead}>
              <h2 className={styles.modalTitle}>{t("pages.beforeAfter.addPhoto")}</h2>
              <button onClick={() => setShowAdd(false)} className={styles.modalClose} aria-label={t("common.close")}>
                <X size={18} strokeWidth={1.75} />
              </button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.field}>
                <Label className={styles.fieldLabel}>{t("pages.beforeAfter.category")}</Label>
                <select className={styles.input}
                  value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                  <option value="before">{t("pages.beforeAfter.before")}</option>
                  <option value="after">{t("pages.beforeAfter.after")}</option>
                </select>
              </div>
              <div className={styles.field}>
                <Label className={styles.fieldLabel}>{t("pages.beforeAfter.angle")}</Label>
                <select className={styles.input}
                  value={form.angle} onChange={e => setForm(f => ({ ...f, angle: e.target.value }))}>
                  <option value="front">{t("pages.beforeAfter.angleFront")}</option>
                  <option value="left">{t("pages.beforeAfter.angleLeft")}</option>
                  <option value="right">{t("pages.beforeAfter.angleRight")}</option>
                  <option value="top">{t("pages.beforeAfter.angleTop")}</option>
                </select>
              </div>
              <div className={styles.field}>
                <Label className={styles.fieldLabel}>{t("pages.beforeAfter.imageUrl")}</Label>
                <input className={styles.input}
                  placeholder="https://ejemplo.com/foto.jpg"
                  value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} />
              </div>
              <div className={styles.field}>
                <Label className={styles.fieldLabel}>{t("common.notes")}</Label>
                <input className={styles.input}
                  placeholder={t("pages.beforeAfter.optional")}
                  value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
            <div className={styles.modalFoot}>
              <Button variant="outline" onClick={() => setShowAdd(false)} className="flex-1 h-11 text-base">{t("common.cancel")}</Button>
              <Button onClick={handleAdd} className="flex-1 h-11 text-base">{t("common.add")}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
