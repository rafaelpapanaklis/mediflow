"use client";

import { useState, useEffect } from "react";
import { Plus, Image, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";

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
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold">{t("pages.beforeAfter.title")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t("pages.beforeAfter.subtitle")}</p>
        </div>
        <Button onClick={() => setShowAdd(true)} disabled={!selectedPatient}>
          <Plus className="w-5 h-5 mr-2" /> {t("pages.beforeAfter.addPhoto")}
        </Button>
      </div>

      {/* Patient selector */}
      <div className="mb-6 space-y-1.5">
        <Label className="text-sm">{t("pages.beforeAfter.patient")}</Label>
        <select
          className="flex h-11 w-full max-w-md rounded-xl border border-border bg-card px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
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

      {loading && <p className="text-sm text-muted-foreground">{t("pages.beforeAfter.loadingPhotos")}</p>}

      {!loading && selectedPatient && photos.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <Image className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p className="text-base font-semibold">{t("pages.beforeAfter.noPhotos")}</p>
        </div>
      )}

      {/* Side-by-side comparison */}
      {photos.length > 0 && (
        <div className="grid grid-cols-2 gap-6">
          <div>
            <h2 className="text-lg font-bold mb-3">{t("pages.beforeAfter.before")}</h2>
            <div className="space-y-3">
              {beforePhotos.map(photo => (
                <div key={photo.id} className="bg-card border border-border rounded-xl overflow-hidden">
                  <img src={photo.url} alt={t("pages.beforeAfter.before")} className="w-full h-48 object-cover" />
                  <div className="p-3">
                    <p className="text-sm font-medium">{photo.angle}</p>
                    {photo.notes && <p className="text-sm text-muted-foreground">{photo.notes}</p>}
                    <p className="text-xs text-muted-foreground mt-1">{new Date(photo.takenAt).toLocaleDateString("es-MX")}</p>
                  </div>
                </div>
              ))}
              {beforePhotos.length === 0 && <p className="text-sm text-muted-foreground">{t("pages.beforeAfter.noBeforePhotos")}</p>}
            </div>
          </div>
          <div>
            <h2 className="text-lg font-bold mb-3">{t("pages.beforeAfter.after")}</h2>
            <div className="space-y-3">
              {afterPhotos.map(photo => (
                <div key={photo.id} className="bg-card border border-border rounded-xl overflow-hidden">
                  <img src={photo.url} alt={t("pages.beforeAfter.after")} className="w-full h-48 object-cover" />
                  <div className="p-3">
                    <p className="text-sm font-medium">{photo.angle}</p>
                    {photo.notes && <p className="text-sm text-muted-foreground">{photo.notes}</p>}
                    <p className="text-xs text-muted-foreground mt-1">{new Date(photo.takenAt).toLocaleDateString("es-MX")}</p>
                  </div>
                </div>
              ))}
              {afterPhotos.length === 0 && <p className="text-sm text-muted-foreground">{t("pages.beforeAfter.noAfterPhotos")}</p>}
            </div>
          </div>
        </div>
      )}

      {/* Add Photo Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
              <h2 className="text-lg font-bold">{t("pages.beforeAfter.addPhoto")}</h2>
              <button onClick={() => setShowAdd(false)} className="p-2 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-6 py-5 space-y-4 flex-1 overflow-y-auto min-h-0">
              <div className="space-y-1.5">
                <Label className="text-sm">{t("pages.beforeAfter.category")}</Label>
                <select className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base focus:outline-none"
                  value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                  <option value="before">{t("pages.beforeAfter.before")}</option>
                  <option value="after">{t("pages.beforeAfter.after")}</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">{t("pages.beforeAfter.angle")}</Label>
                <select className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base focus:outline-none"
                  value={form.angle} onChange={e => setForm(f => ({ ...f, angle: e.target.value }))}>
                  <option value="front">{t("pages.beforeAfter.angleFront")}</option>
                  <option value="left">{t("pages.beforeAfter.angleLeft")}</option>
                  <option value="right">{t("pages.beforeAfter.angleRight")}</option>
                  <option value="top">{t("pages.beforeAfter.angleTop")}</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">{t("pages.beforeAfter.imageUrl")}</Label>
                <input className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                  placeholder="https://ejemplo.com/foto.jpg"
                  value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">{t("common.notes")}</Label>
                <input className="flex h-11 w-full rounded-xl border border-border bg-card px-4 text-base focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                  placeholder={t("pages.beforeAfter.optional")}
                  value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
            <div className="px-6 py-4 flex gap-3 shrink-0 border-t border-border">
              <Button variant="outline" onClick={() => setShowAdd(false)} className="flex-1 h-11 text-base">{t("common.cancel")}</Button>
              <Button onClick={handleAdd} className="flex-1 h-11 text-base">{t("common.add")}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
