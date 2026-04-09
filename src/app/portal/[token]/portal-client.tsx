"use client";
import { useState } from "react";
import { Calendar, FileText, CreditCard, Image, FileCheck, User, Phone, MapPin, ChevronRight, X, Check, Star, Clock } from "lucide-react";

function formatCurrency(n: number) {
  return new Intl.NumberFormat("es-MX", { style:"currency", currency:"MXN", maximumFractionDigits:0 }).format(n);
}
function formatDate(s: string) {
  return new Date(s).toLocaleDateString("es-MX", { day:"numeric", month:"long", year:"numeric" });
}

const STATUS_MAP: Record<string, { label:string; color:string }> = {
  PENDING:     { label:"Pendiente",  color:"#f59e0b" },
  CONFIRMED:   { label:"Confirmada", color:"#10b981" },
  COMPLETED:   { label:"Completada", color:"#6b7280" },
  CANCELLED:   { label:"Cancelada",  color:"#ef4444" },
  IN_PROGRESS: { label:"En curso",   color:"#3b82f6" },
};

const TABS = [
  { id:"inicio",        label:"Inicio",        icon:User },
  { id:"citas",         label:"Citas",         icon:Calendar },
  { id:"historial",     label:"Historial",     icon:FileText },
  { id:"pagos",         label:"Pagos",         icon:CreditCard },
  { id:"imagenes",      label:"Imágenes",      icon:Image },
  { id:"consentimientos", label:"Consentimientos", icon:FileCheck },
];

export function PatientPortalClient({ patient }: { patient: any }) {
  const [tab, setTab]               = useState("inicio");
  const [viewConsent, setViewConsent] = useState<any|null>(null);
  const [viewImage, setViewImage]   = useState<string|null>(null);

  const clinic    = patient.clinic;
  const upcoming  = patient.appointments.filter((a: any) => new Date(a.date) >= new Date() && a.status !== "CANCELLED");
  const past      = patient.appointments.filter((a: any) => new Date(a.date) < new Date() || a.status === "CANCELLED");
  const totalPaid = patient.invoices.reduce((s: number, i: any) => s + i.paid, 0);
  const totalOwed = patient.invoices.reduce((s: number, i: any) => s + i.balance, 0);
  const images    = patient.files.filter((f: any) => f.mimeType?.startsWith("image/") || f.url?.match(/\.(jpg|jpeg|png|gif|webp)/i));

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <div className="bg-slate-900 border-b border-slate-800 sticky top-0 z-30">
        <div className="max-w-xl mx-auto px-4">
          <div className="flex items-center gap-3 py-4">
            {clinic.logoUrl
              ? <img src={clinic.logoUrl} alt={clinic.name} className="w-9 h-9 rounded-xl object-contain bg-slate-800"/>
              : <div className="w-9 h-9 rounded-xl bg-brand-600 flex items-center justify-center font-bold text-sm">{clinic.name[0]}</div>
            }
            <div className="flex-1 min-w-0">
              <div className="font-bold text-sm truncate">{clinic.name}</div>
              <div className="text-xs text-slate-400">Portal del paciente</div>
            </div>
            <div className="text-right">
              <div className="font-bold text-sm">{patient.firstName} {patient.lastName}</div>
              <div className="text-xs text-slate-500">#{patient.patientNumber}</div>
            </div>
          </div>
          {/* Tabs */}
          <div className="flex gap-1 overflow-x-auto pb-0 no-scrollbar">
            {TABS.map(t => {
              const Icon = t.icon;
              return (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold whitespace-nowrap rounded-t-xl transition-colors border-b-2 ${tab===t.id ? "text-white border-brand-500 bg-slate-800" : "text-slate-400 border-transparent hover:text-slate-200"}`}>
                  <Icon size={13}/> {t.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="max-w-xl mx-auto px-4 py-5 space-y-4">

        {/* ── INICIO ── */}
        {tab === "inicio" && (
          <>
            {/* Welcome card */}
            <div className="rounded-2xl p-5 bg-gradient-to-br from-brand-600 to-brand-800">
              <div className="text-xs text-brand-200 mb-1">Bienvenido/a</div>
              <div className="text-2xl font-bold mb-0.5">{patient.firstName} {patient.lastName}</div>
              <div className="text-brand-300 text-xs">Expediente #{patient.patientNumber}</div>
              <div className="flex gap-4 mt-4 pt-4 border-t border-brand-500/40 text-sm">
                <div>
                  <div className="font-bold">{patient.appointments.filter((a:any)=>a.status==="COMPLETED").length}</div>
                  <div className="text-brand-300 text-xs">Visitas</div>
                </div>
                <div>
                  <div className="font-bold">{upcoming.length}</div>
                  <div className="text-brand-300 text-xs">Próximas citas</div>
                </div>
                <div>
                  <div className="font-bold">{formatCurrency(totalPaid)}</div>
                  <div className="text-brand-300 text-xs">Pagado total</div>
                </div>
              </div>
            </div>

            {/* Próxima cita */}
            {upcoming.length > 0 && (
              <div className="bg-slate-900 rounded-2xl p-4 border border-slate-800">
                <div className="text-xs text-slate-400 font-semibold uppercase tracking-wide mb-3">Próxima cita</div>
                {upcoming.slice(0,1).map((a: any) => (
                  <div key={a.id} className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center shrink-0">
                      <Calendar size={18} className="text-brand-400"/>
                    </div>
                    <div className="flex-1">
                      <div className="font-bold">{formatDate(a.date)}</div>
                      <div className="text-slate-400 text-sm">{a.startTime} · Dr/a. {a.doctor.firstName} {a.doctor.lastName}</div>
                      <div className="text-slate-500 text-xs mt-1">{a.type}</div>
                    </div>
                    <span className="text-xs font-bold px-2 py-1 rounded-lg" style={{background:`${(STATUS_MAP[a.status]?.color ?? "#6b7280")}22`, color:STATUS_MAP[a.status]?.color ?? "#6b7280"}}>
                      {STATUS_MAP[a.status]?.label ?? a.status}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Saldo pendiente */}
            {totalOwed > 0 && (
              <div className="bg-amber-950/50 border border-amber-800/50 rounded-2xl p-4">
                <div className="text-xs text-amber-400 font-semibold uppercase tracking-wide mb-1">Saldo pendiente</div>
                <div className="text-2xl font-bold text-amber-300">{formatCurrency(totalOwed)}</div>
                <div className="text-amber-500 text-xs mt-1">Contacta a tu clínica para liquidar</div>
              </div>
            )}

            {/* Datos del paciente */}
            <div className="bg-slate-900 rounded-2xl p-4 border border-slate-800">
              <div className="text-xs text-slate-400 font-semibold uppercase tracking-wide mb-3">Mis datos</div>
              <div className="space-y-2.5 text-sm">
                {patient.phone && <div className="flex items-center gap-2 text-slate-300"><Phone size={14} className="text-slate-500"/>{patient.phone}</div>}
                {patient.email && <div className="flex items-center gap-2 text-slate-300"><span className="text-slate-500 text-xs">@</span>{patient.email}</div>}
                {patient.dob && <div className="flex items-center gap-2 text-slate-300"><Calendar size={14} className="text-slate-500"/>{formatDate(patient.dob)}</div>}
                {patient.bloodType && <div className="flex items-center gap-2 text-slate-300"><span className="text-slate-500">🩸</span>Tipo {patient.bloodType}</div>}
                {patient.allergies?.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-slate-800">
                    <div className="text-xs text-red-400 font-semibold mb-1">⚠️ Alergias</div>
                    <div className="text-red-300 text-xs">{patient.allergies.join(", ")}</div>
                  </div>
                )}
                {patient.chronicConditions?.length > 0 && (
                  <div>
                    <div className="text-xs text-amber-400 font-semibold mb-1">Condiciones crónicas</div>
                    <div className="text-amber-300 text-xs">{patient.chronicConditions.join(", ")}</div>
                  </div>
                )}
              </div>
            </div>

            {/* Clínica */}
            <div className="bg-slate-900 rounded-2xl p-4 border border-slate-800">
              <div className="text-xs text-slate-400 font-semibold uppercase tracking-wide mb-3">Mi clínica</div>
              <div className="font-bold mb-1">{clinic.name}</div>
              {clinic.address && <div className="text-slate-400 text-sm flex items-start gap-2"><MapPin size={13} className="mt-0.5 shrink-0 text-slate-500"/>{clinic.address}{clinic.city?`, ${clinic.city}`:""}</div>}
              {clinic.phone && (
                <a href={`tel:${clinic.phone}`} className="inline-flex items-center gap-2 mt-3 text-sm font-semibold text-brand-400 hover:text-brand-300">
                  <Phone size={13}/> {clinic.phone}
                </a>
              )}
            </div>
          </>
        )}

        {/* ── CITAS ── */}
        {tab === "citas" && (
          <>
            {upcoming.length > 0 && (
              <div>
                <div className="text-xs text-slate-400 font-semibold uppercase tracking-wide mb-3">Próximas</div>
                <div className="space-y-3">
                  {upcoming.map((a: any) => (
                    <div key={a.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                          <div className="font-bold">{formatDate(a.date)}</div>
                          <div className="text-slate-400 text-sm">{a.startTime} · {a.durationMins} min</div>
                        </div>
                        <span className="text-xs font-bold px-2.5 py-1 rounded-xl shrink-0" style={{background:`${STATUS_MAP[a.status]?.color}22`, color:STATUS_MAP[a.status]?.color}}>
                          {STATUS_MAP[a.status]?.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-slate-400">
                        <div className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-white text-xs font-bold" style={{background:a.doctor.color}}>
                          {a.doctor.firstName[0]}
                        </div>
                        Dr/a. {a.doctor.firstName} {a.doctor.lastName}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">{a.type}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {past.length > 0 && (
              <div>
                <div className="text-xs text-slate-400 font-semibold uppercase tracking-wide mb-3 mt-2">Anteriores</div>
                <div className="space-y-2">
                  {past.map((a: any) => (
                    <div key={a.id} className="bg-slate-900/60 border border-slate-800/60 rounded-xl p-3.5 flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center text-white text-xs font-bold" style={{background:a.doctor.color}}>
                        {a.doctor.firstName[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate">{formatDate(a.date)} · {a.startTime}</div>
                        <div className="text-xs text-slate-500">{a.type}</div>
                      </div>
                      <span className="text-xs font-semibold shrink-0" style={{color:STATUS_MAP[a.status]?.color ?? "#6b7280"}}>
                        {STATUS_MAP[a.status]?.label ?? a.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {patient.appointments.length === 0 && (
              <div className="text-center py-16 text-slate-500">
                <Calendar size={40} className="mx-auto mb-3 opacity-30"/>
                <p className="text-sm">Sin citas registradas</p>
              </div>
            )}
          </>
        )}

        {/* ── HISTORIAL ── */}
        {tab === "historial" && (
          <>
            {patient.records.length === 0 ? (
              <div className="text-center py-16 text-slate-500">
                <FileText size={40} className="mx-auto mb-3 opacity-30"/>
                <p className="text-sm">Sin registros clínicos</p>
              </div>
            ) : patient.records.map((r: any) => (
              <div key={r.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="font-bold">{formatDate(r.visitDate)}</div>
                    <div className="text-slate-400 text-sm">Dr/a. {r.doctor.firstName} {r.doctor.lastName}</div>
                  </div>
                  <span className="text-xs bg-slate-800 text-slate-400 px-2 py-1 rounded-lg">{r.specialty}</span>
                </div>
                {r.clinicalNotes && (
                  <div className="mt-3 pt-3 border-t border-slate-800">
                    <div className="text-xs text-slate-500 mb-1">Notas clínicas</div>
                    <p className="text-sm text-slate-300 leading-relaxed">{r.clinicalNotes}</p>
                  </div>
                )}
                {r.diagnosis && (
                  <div className="mt-2">
                    <div className="text-xs text-slate-500 mb-1">Diagnóstico</div>
                    <p className="text-sm text-slate-300">{r.diagnosis}</p>
                  </div>
                )}
              </div>
            ))}
          </>
        )}

        {/* ── PAGOS ── */}
        {tab === "pagos" && (
          <>
            {/* Summary */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-emerald-950/50 border border-emerald-800/50 rounded-2xl p-4">
                <div className="text-xs text-emerald-400 mb-1">Pagado</div>
                <div className="text-xl font-bold text-emerald-300">{formatCurrency(totalPaid)}</div>
              </div>
              <div className={`rounded-2xl p-4 border ${totalOwed > 0 ? "bg-amber-950/50 border-amber-800/50" : "bg-slate-900 border-slate-800"}`}>
                <div className={`text-xs mb-1 ${totalOwed > 0 ? "text-amber-400" : "text-slate-400"}`}>Pendiente</div>
                <div className={`text-xl font-bold ${totalOwed > 0 ? "text-amber-300" : "text-slate-300"}`}>{formatCurrency(totalOwed)}</div>
              </div>
            </div>
            {/* Invoices */}
            {patient.invoices.length === 0 ? (
              <div className="text-center py-16 text-slate-500">
                <CreditCard size={40} className="mx-auto mb-3 opacity-30"/>
                <p className="text-sm">Sin facturas registradas</p>
              </div>
            ) : patient.invoices.map((inv: any) => (
              <div key={inv.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="font-bold">{inv.concept ?? "Tratamiento"}</div>
                    <div className="text-slate-500 text-xs">{formatDate(inv.createdAt)}</div>
                  </div>
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-xl ${inv.status==="PAID"?"bg-emerald-900/50 text-emerald-400":inv.status==="PARTIAL"?"bg-amber-900/50 text-amber-400":"bg-red-900/50 text-red-400"}`}>
                    {inv.status==="PAID"?"Pagado":inv.status==="PARTIAL"?"Parcial":"Pendiente"}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-slate-800 text-center">
                  <div>
                    <div className="text-xs text-slate-500">Total</div>
                    <div className="text-sm font-bold">{formatCurrency(inv.total)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Pagado</div>
                    <div className="text-sm font-bold text-emerald-400">{formatCurrency(inv.paid)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Pendiente</div>
                    <div className={`text-sm font-bold ${inv.balance > 0 ? "text-amber-400" : "text-slate-400"}`}>{formatCurrency(inv.balance)}</div>
                  </div>
                </div>
              </div>
            ))}
          </>
        )}

        {/* ── IMÁGENES ── */}
        {tab === "imagenes" && (
          <>
            {images.length === 0 ? (
              <div className="text-center py-16 text-slate-500">
                <Image size={40} className="mx-auto mb-3 opacity-30"/>
                <p className="text-sm">Sin imágenes en tu expediente</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {images.map((f: any) => (
                  <button key={f.id} onClick={() => setViewImage(f.url)}
                    className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden text-left hover:border-slate-600 transition-colors">
                    <img src={f.url} alt={f.name} className="w-full h-36 object-cover" />
                    <div className="p-2.5">
                      <div className="text-xs font-semibold text-slate-300 truncate">{f.name}</div>
                      {f.notes && <div className="text-xs text-slate-500 truncate">{f.notes}</div>}
                      <div className="text-xs text-slate-600 mt-1">{f.takenAt ? formatDate(f.takenAt) : formatDate(f.createdAt)}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── CONSENTIMIENTOS ── */}
        {tab === "consentimientos" && (
          <>
            {patient.consentForms.length === 0 ? (
              <div className="text-center py-16 text-slate-500">
                <FileCheck size={40} className="mx-auto mb-3 opacity-30"/>
                <p className="text-sm">Sin consentimientos registrados</p>
              </div>
            ) : patient.consentForms.map((c: any) => (
              <div key={c.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-bold truncate">{c.procedure}</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {c.signedAt ? `Firmado el ${formatDate(c.signedAt)}` : "Pendiente de firma"}
                    </div>
                  </div>
                  {c.signedAt
                    ? <span className="text-xs bg-emerald-900/40 text-emerald-400 font-bold px-2.5 py-1 rounded-xl shrink-0">✅ Firmado</span>
                    : <span className="text-xs bg-amber-900/40 text-amber-400 font-bold px-2.5 py-1 rounded-xl shrink-0">Pendiente</span>
                  }
                </div>
                {c.signedAt && (
                  <button onClick={() => setViewConsent(c)}
                    className="mt-3 text-xs font-semibold text-brand-400 hover:text-brand-300 flex items-center gap-1">
                    Ver documento <ChevronRight size={12}/>
                  </button>
                )}
              </div>
            ))}
          </>
        )}
      </div>

      {/* Image lightbox */}
      {viewImage && (
        <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4" onClick={() => setViewImage(null)}>
          <button className="absolute top-4 right-4 text-white/60 hover:text-white p-2 rounded-xl bg-white/10"><X size={20}/></button>
          <img src={viewImage} alt="" className="max-h-[88vh] max-w-full object-contain rounded-2xl" onClick={e=>e.stopPropagation()}/>
        </div>
      )}

      {/* Consent modal */}
      {viewConsent && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setViewConsent(null)}>
          <div className="bg-slate-900 border border-slate-700 w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl max-h-[90vh] overflow-y-auto" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-800">
              <div>
                <div className="font-bold">{viewConsent.procedure}</div>
                <div className="text-xs text-slate-400">Firmado el {formatDate(viewConsent.signedAt)}</div>
              </div>
              <button onClick={() => setViewConsent(null)} className="p-2 rounded-xl hover:bg-slate-800 text-slate-400"><X size={18}/></button>
            </div>
            <div className="p-5 space-y-5">
              <div>
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Contenido</div>
                <div className="bg-slate-800 rounded-xl p-4 text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{viewConsent.content}</div>
              </div>
              {viewConsent.signatureUrl && (
                <div>
                  <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Mi firma</div>
                  <div className="bg-white rounded-xl p-3">
                    <img src={viewConsent.signatureUrl} alt="Firma" className="max-h-28 mx-auto"/>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
