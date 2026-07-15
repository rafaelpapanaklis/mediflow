"use client";

import { useState, useMemo } from "react";
import { Plus, X, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import toast from "react-hot-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useT } from "@/i18n/i18n-provider";

interface Booking {
  id: string;
  resourceType: string;
  resourceName: string;
  startTime: string;
  endTime: string;
}

export function ResourceBookingsClient({ initialBookings }: { initialBookings: Booking[] }) {
  const t = useT();
  const askConfirm = useConfirm();
  const [bookings, setBookings] = useState<Booking[]>(initialBookings);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ resourceType: "", resourceName: "", startTime: "", endTime: "" });

  const grouped = useMemo(() => {
    const map: Record<string, Booking[]> = {};
    for (const b of bookings) {
      const key = `${b.resourceType} — ${b.resourceName}`;
      if (!map[key]) map[key] = [];
      map[key].push(b);
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [bookings]);

  async function handleAdd() {
    if (!form.resourceType.trim() || !form.resourceName.trim() || !form.startTime || !form.endTime) {
      toast.error(t("pages.resourceBookings.allFieldsRequired"));
      return;
    }
    try {
      const today = new Date().toISOString().split("T")[0];
      const payload = {
        ...form,
        startTime: new Date(`${today}T${form.startTime}:00`).toISOString(),
        endTime: new Date(`${today}T${form.endTime}:00`).toISOString(),
      };
      const res = await fetch("/api/resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      const created = await res.json();
      setBookings(prev => [...prev, created].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()));
      setShowAdd(false);
      setForm({ resourceType: "", resourceName: "", startTime: "", endTime: "" });
      toast.success(t("pages.resourceBookings.bookingCreated"));
    } catch {
      toast.error(t("pages.resourceBookings.bookingCreateError"));
    }
  }

  async function handleDelete(id: string) {
    if (!(await askConfirm({
      title: t("pages.resourceBookings.deleteConfirmTitle"),
      description: t("pages.resourceBookings.deleteConfirmDescription"),
      variant: "danger",
      confirmText: t("common.delete"),
    }))) return;
    try {
      await fetch(`/api/resources/${id}`, { method: "DELETE" });
      setBookings(prev => prev.filter(b => b.id !== id));
      toast.success(t("pages.resourceBookings.bookingDeleted"));
    } catch {
      toast.error(t("pages.resourceBookings.deleteError"));
    }
  }

  function formatTime(dt: string) {
    return new Date(dt).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-[21px] font-bold tracking-[-0.01em]" style={{ color: "var(--text-1)" }}>
            {t("pages.resourceBookings.title")}
          </h1>
          <p className="text-[13px] mt-0.5" style={{ color: "var(--text-3)" }}>
            {t("pages.resourceBookings.subtitle", { count: bookings.length })}
          </p>
        </div>
        <Button onClick={() => setShowAdd(true)}>
          <Plus size={18} strokeWidth={1.75} className="mr-2" /> {t("pages.resourceBookings.newBooking")}
        </Button>
      </div>

      {grouped.length > 0 ? (
        <div className="space-y-6">
          {grouped.map(([resourceKey, items]) => (
            <section key={resourceKey} className="card">
              <div className="card__header">
                <h2 className="card__title">{resourceKey}</h2>
                <span className="badge-new badge-new--brand">{items.length}</span>
              </div>
              <div>
                {items.map((booking) => (
                  <div key={booking.id} className="list-row group" style={{ minHeight: 48 }}>
                    <span
                      aria-hidden
                      className="rounded-full shrink-0"
                      style={{ width: 3, height: 28, background: "var(--brand)" }}
                    />
                    <p
                      className="text-[13.5px] font-semibold tabular-nums"
                      style={{ color: "var(--text-1)" }}
                    >
                      {formatTime(booking.startTime)} — {formatTime(booking.endTime)}
                    </p>
                    <button
                      onClick={() => handleDelete(booking.id)}
                      aria-label={t("common.delete")}
                      className="ml-auto grid place-items-center w-9 h-9 rounded-lg opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity hover:bg-[var(--danger-soft)] text-[var(--text-3)] hover:text-[var(--danger)] focus-visible:outline-none focus-visible:[box-shadow:var(--ring)]"
                    >
                      <X size={16} strokeWidth={1.75} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="text-center py-16">
          <CalendarDays
            size={20}
            strokeWidth={1.75}
            className="mx-auto mb-3"
            style={{ color: "var(--text-4)" }}
            aria-hidden
          />
          <p className="text-[13px] font-medium" style={{ color: "var(--text-3)" }}>
            {t("pages.resourceBookings.emptyToday")}
          </p>
        </div>
      )}

      {showAdd && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal__header">
              <h2 className="modal__title">{t("pages.resourceBookings.newBooking")}</h2>
              <button
                onClick={() => setShowAdd(false)}
                aria-label={t("common.close")}
                className="grid place-items-center w-9 h-9 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors focus-visible:outline-none focus-visible:[box-shadow:var(--ring)]"
              >
                <X size={18} strokeWidth={1.75} />
              </button>
            </div>
            <div className="modal__body space-y-4">
              <div className="field-new">
                <label className="field-new__label" htmlFor="rb-type">{t("pages.resourceBookings.resourceTypeLabel")}</label>
                <input id="rb-type" className="input-new"
                  placeholder={t("pages.resourceBookings.resourceTypePlaceholder")}
                  value={form.resourceType} onChange={e => setForm(f => ({ ...f, resourceType: e.target.value }))} />
              </div>
              <div className="field-new">
                <label className="field-new__label" htmlFor="rb-name">{t("pages.resourceBookings.resourceNameLabel")}</label>
                <input id="rb-name" className="input-new"
                  placeholder={t("pages.resourceBookings.resourceNamePlaceholder")}
                  value={form.resourceName} onChange={e => setForm(f => ({ ...f, resourceName: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="field-new">
                  <label className="field-new__label" htmlFor="rb-start">{t("pages.resourceBookings.startTimeLabel")}</label>
                  <input id="rb-start" type="time"
                    className="input-new tabular-nums"
                    value={form.startTime} onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))} />
                </div>
                <div className="field-new">
                  <label className="field-new__label" htmlFor="rb-end">{t("pages.resourceBookings.endTimeLabel")}</label>
                  <input id="rb-end" type="time"
                    className="input-new tabular-nums"
                    value={form.endTime} onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))} />
                </div>
              </div>
            </div>
            <div className="modal__footer">
              <Button variant="outline" onClick={() => setShowAdd(false)} className="flex-1 h-11">{t("common.cancel")}</Button>
              <Button onClick={handleAdd} className="flex-1 h-11">{t("pages.resourceBookings.createBooking")}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
