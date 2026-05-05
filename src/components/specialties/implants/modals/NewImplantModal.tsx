"use client";
// Implants — modal de creación de implante (datos básicos). Spec §7.1 paso 2.

import { useState, useTransition } from "react";
import toast from "react-hot-toast";
import { X } from "lucide-react";
import { createImplant } from "@/app/actions/implants/createImplant";
import { isFailure } from "@/app/actions/implants/result";
import { IMPLANT_BRAND, IMPLANT_CONNECTION, IMPLANT_PROTOCOL, IMPLANT_SURFACE } from "@/lib/validation/implants";

export interface NewImplantModalProps {
  open: boolean;
  patientId: string;
  doctorId: string;
  onClose: () => void;
  onCreated?: (implantId: string) => void;
}

export function NewImplantModal(props: NewImplantModalProps) {
  const [pending, startTransition] = useTransition();
  const [toothFdi, setToothFdi] = useState<number | "">(36);
  const [brand, setBrand] = useState<(typeof IMPLANT_BRAND)[number]>("STRAUMANN");
  const [brandCustomName, setBrandCustomName] = useState("");
  const [modelName, setModelName] = useState("");
  const [diameterMm, setDiameterMm] = useState<number | "">(4.5);
  const [lengthMm, setLengthMm] = useState<number | "">(10);
  const [connectionType, setConnectionType] = useState<(typeof IMPLANT_CONNECTION)[number]>("CONICAL_MORSE");
  const [surfaceTreatment, setSurfaceTreatment] = useState<string>("");
  const [lotNumber, setLotNumber] = useState("");
  const [manufactureDate, setManufactureDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [placedAt, setPlacedAt] = useState(new Date().toISOString().slice(0, 16));
  const [protocol, setProtocol] = useState<(typeof IMPLANT_PROTOCOL)[number]>("ONE_STAGE");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!props.open) return null;

  const submit = () => {
    setError(null);
    if (!toothFdi || !modelName || !lotNumber || !diameterMm || !lengthMm) {
      setError("Completa los campos obligatorios");
      return;
    }
    if (brand === "OTRO" && !brandCustomName) {
      setError("brand=OTRO requiere brandCustomName");
      return;
    }
    startTransition(async () => {
      const r = await createImplant({
        patientId: props.patientId,
        toothFdi: Number(toothFdi),
        brand,
        brandCustomName: brand === "OTRO" ? brandCustomName : undefined,
        modelName,
        diameterMm: Number(diameterMm),
        lengthMm: Number(lengthMm),
        connectionType,
        surfaceTreatment: (surfaceTreatment || undefined) as (typeof IMPLANT_SURFACE)[number] | undefined,
        lotNumber,
        manufactureDate: manufactureDate ? new Date(manufactureDate) : undefined,
        expiryDate: expiryDate ? new Date(expiryDate) : undefined,
        placedAt: new Date(placedAt),
        placedByDoctorId: props.doctorId,
        protocol,
        initialStatus: "PLANNED",
        notes: notes || undefined,
      });
      if (isFailure(r)) {
        setError(r.error);
        return;
      }
      toast.success("Implante creado");
      props.onCreated?.(r.data.id);
      props.onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={props.onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="font-semibold">Nuevo implante</h2>
          <button onClick={props.onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-4 grid grid-cols-2 gap-3 text-sm">
          <Field label="FDI"><input type="number" value={toothFdi} onChange={(e) => setToothFdi(e.target.value === "" ? "" : Number(e.target.value))} className={inputCls} /></Field>
          <Field label="Marca">
            <select value={brand} onChange={(e) => setBrand(e.target.value as typeof brand)} className={inputCls}>
              {IMPLANT_BRAND.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </Field>
          {brand === "OTRO" && (
            <Field label="Nombre marca (OTRO)"><input value={brandCustomName} onChange={(e) => setBrandCustomName(e.target.value)} className={inputCls} /></Field>
          )}
          <Field label="Modelo"><input value={modelName} onChange={(e) => setModelName(e.target.value)} className={inputCls} placeholder="ej. BLX, Drive CM" /></Field>
          <Field label="Diámetro mm"><input type="number" step="0.1" value={diameterMm} onChange={(e) => setDiameterMm(e.target.value === "" ? "" : Number(e.target.value))} className={inputCls} /></Field>
          <Field label="Longitud mm"><input type="number" step="0.1" value={lengthMm} onChange={(e) => setLengthMm(e.target.value === "" ? "" : Number(e.target.value))} className={inputCls} /></Field>
          <Field label="Conexión">
            <select value={connectionType} onChange={(e) => setConnectionType(e.target.value as typeof connectionType)} className={inputCls}>
              {IMPLANT_CONNECTION.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Superficie">
            <select value={surfaceTreatment} onChange={(e) => setSurfaceTreatment(e.target.value)} className={inputCls}>
              <option value="">— Ninguna —</option>
              {IMPLANT_SURFACE.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Lote (COFEPRIS)" required><input value={lotNumber} onChange={(e) => setLotNumber(e.target.value)} className={inputCls + " font-mono"} /></Field>
          <Field label="Fecha manufactura"><input type="date" value={manufactureDate} onChange={(e) => setManufactureDate(e.target.value)} className={inputCls} /></Field>
          <Field label="Caducidad"><input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className={inputCls} /></Field>
          <Field label="Fecha colocación" required><input type="datetime-local" value={placedAt} onChange={(e) => setPlacedAt(e.target.value)} className={inputCls} /></Field>
          <Field label="Protocolo">
            <select value={protocol} onChange={(e) => setProtocol(e.target.value as typeof protocol)} className={inputCls}>
              {IMPLANT_PROTOCOL.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <div className="col-span-2">
            <Field label="Notas">
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputCls} />
            </Field>
          </div>
          {error && <div className="col-span-2 text-xs text-red-600 dark:text-red-400">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-gray-200 dark:border-gray-800">
          <button onClick={props.onClose} className="px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-700">Cancelar</button>
          <button disabled={pending} onClick={submit} className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">{pending ? "Guardando…" : "Crear implante"}</button>
        </div>
      </div>
    </div>
  );
}

const inputCls = "w-full rounded border border-gray-300 dark:border-gray-700 dark:bg-gray-800 px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500";

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
        {label}{required && <span className="text-red-500"> *</span>}
      </span>
      {children}
    </label>
  );
}
