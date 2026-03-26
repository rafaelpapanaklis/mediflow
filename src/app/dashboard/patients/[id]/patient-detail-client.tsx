"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Phone, Mail, Calendar, AlertTriangle, Plus, Printer, Edit } from "lucide-react";
import { formatCurrency, formatDate, getInitials, avatarColor } from "@/lib/utils";
import { DentalForm }          from "@/components/clinical/dental-form";
import { NutritionForm }       from "@/components/clinical/nutrition-form";
import { PsychologyForm }      from "@/components/clinical/psychology-form";
import { GeneralMedicineForm } from "@/components/clinical/medicine-form";
import toast from "react-hot-toast";

const SPECIALTY_MAP: Record<string, string> = {
  dental: "dental", odontologia: "dental", odontología: "dental",
  nutrition: "nutrition", nutricion: "nutrition", nutrición: "nutrition",
  psychology: "psychology", psicologia: "psychology", psicología: "psychology",
};
function detectSpecialty(raw: string) {
  const lower = raw.toLowerCase();
  for (const [k, v] of Object.entries(SPECIALTY_MAP)) if (lower.includes(k)) return v;
  return "medicine";
}

const APPT_STATUS: Record<string, { label: string; cls: string }> = {
  PENDING:   { label: "Pendiente",  cls: "bg-amber-50 text-amber-700 border border-amber-200"      },
  CONFIRMED: { label: "Confirmada", cls: "bg-emerald-50 text-emerald-700 border border-emerald-200" },
  COMPLETED: { label: "Completada", cls: "bg-slate-100 text-slate-600 border border-slate-200"      },
  CANCELLED: { label: "Cancelada",  cls: "bg-rose-50 text-rose-700 border border-rose-200"          },
  NO_SHOW:   { label: "No asistió", cls: "bg-slate-50 text-slate-500 border border-slate-200"       },
};

const INV_STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "Pendiente", cls: "bg-amber-50 text-amber-700 border border-amber-200" },
  PARTIAL: { label: "Parcial",   cls: "bg-blue-50 text-blue-700 border border-blue-200"   },
  PAID:    { label: "Pagado",    cls: "bg-emerald-50 text-emerald-700 border border-emerald-200" },
  OVERDUE: { label: "Vencido",   cls: "bg-rose-50 text-rose-700 border border-rose-200"   },
};

const TABS = [
  { id: "resumen",     label: "Resumen"          },
  { id: "historia",    label: "Historia clínica"  },
  { id: "expediente",  label: "Nueva consulta"    },
  { id: "evolucion",   label: "Evolución / Notas" },
  { id: "tratamiento", label: "Plan de tratamiento" },
  { id: "agenda",      label: "Citas"             },
  { id: "facturacion", label: "Facturación"        },
];

interface Props {
  patient:      any;
  records:      any[];
  appointments: any[];
  invoices:     any[];
  doctors:      { id: string; firstName: string; lastName: string }[];
  currentUser:  { id: string; firstName: string; lastName: string };
  specialty:    string;
  totalPaid:    number;
  totalBalance: number;
  totalPlan:    number;
}

export function PatientDetailClient({
  patient, records: initialRecords, appointments, invoices,
  doctors, currentUser, specialty, totalPaid, totalBalance, totalPlan,
}: Props) {
  const router = useRouter();
  const [tab, setTab]         = useState("resumen");
  const [records, setRecords] = useState(initialRecords);
  const [showNewAppt, setShowNewAppt] = useState(false);
  const [apptForm, setApptForm] = useState({
    doctorId: currentUser.id, type: "Consulta general",
    date: new Date().toISOString().split("T")[0],
    startTime: "09:00", endTime: "09:30", notes: "",
  });
  const [savingAppt, setSavingAppt] = useState(false);

  const detectedSpecialty = detectSpecialty(specialty);
  const age = patient.dob ? new Date().getFullYear() - new Date(patient.dob).getFullYear() : null;
  const initials = getInitials(patient.firstName, patient.lastName);
  const color    = avatarColor(patient.id);
  const nextAppt = appointments.find(a => new Date(a.date) >= new Date() && !["CANCELLED","NO_SHOW"].includes(a.status));
  const lastAppt = appointments.find(a => new Date(a.date) < new Date() && a.status === "COMPLETED");
  const pctPaid  = totalPlan > 0 ? Math.round((totalPaid / totalPlan) * 100) : 0;

  function handleRecordSaved(record: any) {
    setRecords(prev => [record, ...prev]);
    toast.success("Expediente guardado");
    setTab("evolucion");
  }

  async function createAppointment(e: React.FormEvent) {
    e.preventDefault();
    setSavingAppt(true);
    try {
      const res = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...apptForm, patientId: patient.id }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Cita agendada");
      setShowNewAppt(false);
      router.refresh();
    } catch (err: any) {
      toast.error(err.message ?? "Error al agendar");
    } finally {
      setSavingAppt(false);
    }
  }

  return (
    <div className="flex flex-col h-full -m-5 lg:-m-6">
      {/* Topbar */}
      <div className="bg-white border-b border-border px-5 h-13 flex items-center gap-3 flex-shrink-0">
        <Link href="/dashboard/patients" className="p-1.5 rounded-lg hover:bg-muted transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Link href="/dashboard/patients" className="text-brand-600 hover:underline">Pacientes</Link>
          <span>/</span>
          <span className="font-semibold text-foreground">{patient.firstName} {patient.lastName}</span>
        </div>
        <div className="flex items-center gap-1.5 ml-2 flex-wrap">
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">Activo</span>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-slate-50 text-slate-600 border-slate-200">#{patient.patientNumber}</span>
          {patient.allergies?.length > 0 && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-rose-50 text-rose-700 border-rose-200">
              🚨 Alergia: {patient.allergies[0]}
            </span>
          )}
          {totalBalance > 0 && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-blue-50 text-blue-700 border-blue-200">
              Saldo: {formatCurrency(totalBalance)}
            </span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setTab("expediente")} className="flex items-center gap-1.5 text-xs font-semibold bg-muted border border-border px-3 py-1.5 rounded-lg hover:bg-muted/80 transition-colors">
            📝 Nueva nota
          </button>
          <button onClick={() => setShowNewAppt(true)} className="flex items-center gap-1.5 text-xs font-semibold bg-brand-600 text-white px-3 py-1.5 rounded-lg hover:bg-brand-700 transition-colors">
            <Plus className="w-3.5 h-3.5" />
            Agendar cita
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Main content */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">

          {/* Patient header card */}
          <div className="bg-white border border-border rounded-xl p-4 flex gap-4">
            <div className={`w-14 h-14 rounded-full ${color} flex items-center justify-center text-xl font-bold text-white flex-shrink-0`}>
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-lg font-extrabold">{patient.firstName} {patient.lastName}</span>
                <button className="text-xs text-muted-foreground border border-border rounded-lg px-2 py-0.5 hover:bg-muted transition-colors flex items-center gap-1">
                  <Edit className="w-3 h-3" /> Editar
                </button>
              </div>
              <div className="flex gap-4 mt-1 flex-wrap">
                {age && <span className="text-xs text-muted-foreground flex items-center gap-1">👤 <strong className="text-foreground">{age} años</strong></span>}
                <span className="text-xs text-muted-foreground">♀♂ <strong className="text-foreground">{patient.gender === "M" ? "Masculino" : patient.gender === "F" ? "Femenino" : "Otro"}</strong></span>
                {patient.dob && <span className="text-xs text-muted-foreground">📅 <strong className="text-foreground">{formatDate(patient.dob)}</strong></span>}
                {patient.phone && <span className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="w-3 h-3" /> <strong className="text-foreground">{patient.phone}</strong></span>}
                {patient.email && <span className="text-xs text-muted-foreground flex items-center gap-1"><Mail className="w-3 h-3" /> <strong className="text-foreground">{patient.email}</strong></span>}
              </div>
              <div className="flex gap-1.5 mt-2 flex-wrap">
                {patient.allergies?.map((a: string) => (
                  <span key={a} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700">🚨 Alergia: {a}</span>
                ))}
                {patient.chronicConditions?.map((c: string) => (
                  <span key={c} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">⚕ {c}</span>
                ))}
                {patient.currentMedications?.map((m: string) => (
                  <span key={m} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-50 text-violet-700">💊 {m}</span>
                ))}
              </div>
              <div className="grid grid-cols-4 gap-2 mt-3">
                {[
                  { label: "Última visita",   val: lastAppt ? formatDate(lastAppt.date) : "Sin visitas",       sub: lastAppt?.type ?? "" },
                  { label: "Próxima cita",    val: nextAppt ? formatDate(nextAppt.date) : "Sin agendar",       sub: nextAppt?.type ?? "", highlight: !!nextAppt },
                  { label: "Total tratamiento", val: formatCurrency(totalPlan),                                 sub: `Pagado: ${formatCurrency(totalPaid)}` },
                  { label: "Visitas totales", val: String(appointments.filter(a => a.status === "COMPLETED").length), sub: `${appointments.length} total` },
                ].map(s => (
                  <div key={s.label} className="bg-slate-50 rounded-lg p-2">
                    <div className="text-[10px] text-muted-foreground font-medium">{s.label}</div>
                    <div className={`text-sm font-extrabold mt-0.5 ${s.highlight ? "text-brand-700" : "text-foreground"}`}>{s.val}</div>
                    <div className="text-[10px] text-muted-foreground">{s.sub}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex bg-white border border-border rounded-xl p-1 gap-0.5 overflow-x-auto flex-shrink-0">
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${tab === t.id ? "bg-brand-600 text-white" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}>
                {t.label}
              </button>
            ))}
          </div>

          {/* ===== TAB: RESUMEN ===== */}
          {tab === "resumen" && (
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white border border-border rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-brand-500" />
                  <span className="text-xs font-bold">Resumen clínico</span>
                </div>
                {records.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Sin registros clínicos aún.</p>
                ) : (
                  <div className="space-y-1.5">
                    {[
                      { label: "Motivo último consulta", val: records[0]?.subjective?.slice(0, 50) ?? "—" },
                      { label: "Diagnóstico",            val: records[0]?.assessment?.slice(0, 50) ?? "—" },
                      { label: "Plan",                   val: records[0]?.plan?.slice(0, 50) ?? "—" },
                    ].map(r => (
                      <div key={r.label} className="flex justify-between items-start py-1.5 border-b border-slate-50 text-xs">
                        <span className="text-muted-foreground">{r.label}</span>
                        <span className="font-semibold text-right max-w-[55%]">{r.val}</span>
                      </div>
                    ))}
                  </div>
                )}
                {records[0]?.specialtyData?.periodontal && (
                  <div className="mt-3">
                    <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-2">Semáforo clínico</div>
                    <div className="grid grid-cols-3 gap-1.5 text-[10px] font-bold text-center">
                      <div className="bg-emerald-50 text-emerald-700 rounded-lg py-1.5">✓ Higiene<br/>Buena</div>
                      <div className="bg-amber-50 text-amber-700 rounded-lg py-1.5">⚠ Caries<br/>Moderado</div>
                      <div className="bg-rose-50 text-rose-700 rounded-lg py-1.5">✕ Perio<br/>{records[0]?.specialtyData?.periodontal?.gingival ?? "Sin datos"}</div>
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-white border border-border rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-xs font-bold">Historia clínica</span>
                </div>
                <div className="space-y-1.5 text-xs">
                  {[
                    { label: "Enfermedades sistémicas", val: patient.chronicConditions?.join(", ") || "Ninguna" },
                    { label: "Alergias",                val: patient.allergies?.join(", ") || "Ninguna" },
                    { label: "Medicamentos",            val: patient.currentMedications?.join(", ") || "Ninguno" },
                    { label: "Tipo de sangre",          val: patient.bloodType || "No registrado" },
                    { label: "Seguro",                  val: patient.insuranceProvider || "Sin seguro" },
                    { label: "Notas",                   val: patient.notes?.slice(0, 60) || "—" },
                  ].map(r => (
                    <div key={r.label} className="flex justify-between items-start py-1.5 border-b border-slate-50">
                      <span className="text-muted-foreground">{r.label}</span>
                      <span className="font-semibold text-right max-w-[55%]">{r.val}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Próxima cita */}
              {nextAppt && (
                <div className="bg-white border border-border rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 rounded-full bg-brand-500" />
                    <span className="text-xs font-bold">Próxima cita</span>
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                    <div className="text-sm font-extrabold text-brand-700">{formatDate(nextAppt.date)}</div>
                    <div className="text-xs text-foreground mt-1">{nextAppt.type}</div>
                    <div className="text-[10px] text-muted-foreground">{nextAppt.startTime}h · Dr/a. {nextAppt.doctor?.firstName} {nextAppt.doctor?.lastName}</div>
                  </div>
                </div>
              )}

              {/* Finanzas resumen */}
              <div className="bg-white border border-border rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-amber-500" />
                  <span className="text-xs font-bold">Finanzas</span>
                </div>
                <div className="space-y-1.5 text-xs mb-3">
                  <div className="flex justify-between py-1.5 border-b border-slate-50">
                    <span className="text-muted-foreground">Total plan</span>
                    <span className="font-bold">{formatCurrency(totalPlan)}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-slate-50">
                    <span className="text-muted-foreground">Pagado</span>
                    <span className="font-bold text-emerald-600">{formatCurrency(totalPaid)}</span>
                  </div>
                  <div className="flex justify-between py-1.5">
                    <span className="text-muted-foreground">Pendiente</span>
                    <span className="font-bold text-rose-600">{formatCurrency(totalBalance)}</span>
                  </div>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${pctPaid}%` }} />
                </div>
                <div className="text-[10px] text-muted-foreground text-right mt-1">{pctPaid}% cubierto</div>
              </div>
            </div>
          )}

          {/* ===== TAB: HISTORIA CLINICA ===== */}
          {tab === "historia" && (
            <div className="bg-white border border-border rounded-xl p-5">
              <h2 className="text-sm font-bold mb-4">Historia clínica completa</h2>
              <div className="grid grid-cols-2 gap-6 text-sm">
                <div>
                  <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-3">Datos personales</h3>
                  <div className="space-y-2">
                    {[
                      { label: "Nombre completo", val: `${patient.firstName} ${patient.lastName}` },
                      { label: "Fecha de nacimiento", val: patient.dob ? formatDate(patient.dob) : "—" },
                      { label: "Género", val: patient.gender === "M" ? "Masculino" : patient.gender === "F" ? "Femenino" : "Otro" },
                      { label: "Teléfono", val: patient.phone ?? "—" },
                      { label: "Email", val: patient.email ?? "—" },
                      { label: "Dirección", val: patient.address ?? "—" },
                      { label: "Tipo de sangre", val: patient.bloodType ?? "No registrado" },
                    ].map(r => (
                      <div key={r.label} className="flex justify-between py-1.5 border-b border-slate-50 text-xs">
                        <span className="text-muted-foreground">{r.label}</span>
                        <span className="font-semibold">{r.val}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-3">Antecedentes médicos</h3>
                  <div className="space-y-2">
                    <div className="py-1.5 border-b border-slate-50">
                      <div className="text-xs text-muted-foreground mb-1">Enfermedades crónicas</div>
                      <div className="flex flex-wrap gap-1">
                        {patient.chronicConditions?.length > 0
                          ? patient.chronicConditions.map((c: string) => <span key={c} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">{c}</span>)
                          : <span className="text-xs font-semibold">Ninguna</span>}
                      </div>
                    </div>
                    <div className="py-1.5 border-b border-slate-50">
                      <div className="text-xs text-muted-foreground mb-1">Alergias</div>
                      <div className="flex flex-wrap gap-1">
                        {patient.allergies?.length > 0
                          ? patient.allergies.map((a: string) => <span key={a} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700">🚨 {a}</span>)
                          : <span className="text-xs font-semibold">Ninguna</span>}
                      </div>
                    </div>
                    <div className="py-1.5 border-b border-slate-50">
                      <div className="text-xs text-muted-foreground mb-1">Medicamentos actuales</div>
                      <div className="flex flex-wrap gap-1">
                        {patient.currentMedications?.length > 0
                          ? patient.currentMedications.map((m: string) => <span key={m} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-50 text-violet-700">💊 {m}</span>)
                          : <span className="text-xs font-semibold">Ninguno</span>}
                      </div>
                    </div>
                    <div className="py-1.5 border-b border-slate-50">
                      <div className="text-xs text-muted-foreground mb-1">Seguro médico</div>
                      <span className="text-xs font-semibold">{patient.insuranceProvider ?? "Sin seguro"}</span>
                      {patient.insurancePolicy && <span className="text-xs text-muted-foreground ml-2">Póliza: {patient.insurancePolicy}</span>}
                    </div>
                  </div>
                  {patient.notes && (
                    <div className="mt-4 p-3 bg-muted/30 rounded-xl">
                      <div className="text-xs font-bold text-muted-foreground mb-1">Notas clínicas</div>
                      <p className="text-xs">{patient.notes}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ===== TAB: NUEVA CONSULTA (specialty form) ===== */}
          {tab === "expediente" && (
            <div className="bg-white border border-border rounded-xl p-5">
              <h2 className="text-sm font-bold mb-4">
                {detectedSpecialty === "dental"     ? "🦷 Nueva consulta dental" :
                 detectedSpecialty === "nutrition"  ? "🥗 Nueva consulta nutricional" :
                 detectedSpecialty === "psychology" ? "🧠 Nueva sesión" :
                 "🩺 Nueva consulta médica"}
              </h2>
              {detectedSpecialty === "dental"     && <DentalForm          patientId={patient.id} onSaved={handleRecordSaved} />}
              {detectedSpecialty === "nutrition"  && <NutritionForm       patientId={patient.id} patient={patient} onSaved={handleRecordSaved} />}
              {detectedSpecialty === "psychology" && <PsychologyForm      patientId={patient.id} sessionNum={records.length + 1} onSaved={handleRecordSaved} />}
              {detectedSpecialty === "medicine"   && <GeneralMedicineForm patientId={patient.id} onSaved={handleRecordSaved} />}
            </div>
          )}

          {/* ===== TAB: EVOLUCION ===== */}
          {tab === "evolucion" && (
            <div className="bg-white border border-border rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <h2 className="text-sm font-bold">Evolución clínica — {records.length} consulta{records.length !== 1 ? "s" : ""}</h2>
                <button onClick={() => setTab("expediente")} className="text-xs font-semibold text-brand-600 hover:underline">+ Nueva nota SOAP</button>
              </div>
              <div className="p-5">
                {records.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-sm text-muted-foreground mb-3">No hay notas clínicas aún</p>
                    <button onClick={() => setTab("expediente")} className="text-xs font-semibold text-brand-600 hover:underline">Crear primera consulta →</button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {records.map((record, idx) => (
                      <div key={record.id} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <div className="w-7 h-7 rounded-full bg-blue-100 border-2 border-brand-500 flex items-center justify-center text-[9px] font-bold text-brand-700 flex-shrink-0 z-10">
                            {records.length - idx}
                          </div>
                          {idx < records.length - 1 && <div className="w-px flex-1 bg-border mt-1" />}
                        </div>
                        <div className="flex-1 bg-slate-50 rounded-xl border border-border p-3 mb-1">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] text-muted-foreground">{formatDate(record.visitDate)}</span>
                            <span className="text-[10px] font-bold text-brand-600">Dr/a. {record.doctor?.firstName} {record.doctor?.lastName}</span>
                          </div>
                          {record.subjective && (
                            <p className="text-xs text-foreground mb-1.5 leading-relaxed">{record.subjective}</p>
                          )}
                          {record.assessment && (
                            <div className="text-xs"><span className="font-bold text-muted-foreground">Dx:</span> {record.assessment}</div>
                          )}
                          {record.plan && (
                            <div className="text-xs mt-1"><span className="font-bold text-muted-foreground">Plan:</span> {record.plan}</div>
                          )}
                          {/* Specialty badges */}
                          {record.specialtyData?.procedures?.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {record.specialtyData.procedures.map((p: string) => (
                                <span key={p} className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">{p}</span>
                              ))}
                            </div>
                          )}
                          {record.specialtyData?.scales && (
                            <div className="flex gap-2 mt-2">
                              <span className="text-[10px] bg-white border border-border rounded px-2 py-0.5">PHQ-9: {record.specialtyData.scales.phq9?.score}/27 ({record.specialtyData.scales.phq9?.severity})</span>
                              <span className="text-[10px] bg-white border border-border rounded px-2 py-0.5">GAD-7: {record.specialtyData.scales.gad7?.score}/21 ({record.specialtyData.scales.gad7?.severity})</span>
                            </div>
                          )}
                          {record.specialtyData?.anthropometrics && (
                            <div className="flex gap-3 mt-2 text-[10px] text-muted-foreground">
                              {record.specialtyData.anthropometrics.weight && <span>Peso: <strong>{record.specialtyData.anthropometrics.weight}kg</strong></span>}
                              {record.specialtyData.anthropometrics.bmi    && <span>IMC: <strong>{record.specialtyData.anthropometrics.bmi}</strong></span>}
                            </div>
                          )}
                          {record.specialtyData?.medications?.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {record.specialtyData.medications.filter((m: any) => m.drug).map((m: any, i: number) => (
                                <span key={i} className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200">💊 {m.drug}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ===== TAB: PLAN DE TRATAMIENTO ===== */}
          {tab === "tratamiento" && (
            <div className="bg-white border border-border rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <h2 className="text-sm font-bold">Plan de tratamiento</h2>
                <button onClick={() => setTab("expediente")} className="text-xs font-semibold text-brand-600 hover:underline">+ Agregar procedimiento</button>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/30 border-b border-border">
                    {["#","Procedimiento","Diente","Estado","Doctor","Fecha","Costo"].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {records.flatMap((r, ri) =>
                    (r.specialtyData?.procedures ?? []).map((proc: string, pi: number) => (
                      <tr key={`${ri}-${pi}`} className="border-b border-border/50 hover:bg-muted/20">
                        <td className="px-4 py-2 text-muted-foreground">{pi + 1}</td>
                        <td className="px-4 py-2 font-semibold">{proc}</td>
                        <td className="px-4 py-2 text-muted-foreground">—</td>
                        <td className="px-4 py-2"><span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Realizado</span></td>
                        <td className="px-4 py-2 text-muted-foreground">{r.doctor?.firstName} {r.doctor?.lastName}</td>
                        <td className="px-4 py-2 text-muted-foreground">{formatDate(r.visitDate)}</td>
                        <td className="px-4 py-2 font-bold">—</td>
                      </tr>
                    ))
                  )}
                  {records.flatMap(r => r.specialtyData?.procedures ?? []).length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">Sin procedimientos registrados</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* ===== TAB: CITAS ===== */}
          {tab === "agenda" && (
            <div className="bg-white border border-border rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <h2 className="text-sm font-bold">Citas — {appointments.length} total</h2>
                <button onClick={() => setShowNewAppt(true)} className="text-xs font-semibold text-brand-600 hover:underline">+ Agendar</button>
              </div>

              {showNewAppt && (
                <div className="border-b border-border p-4 bg-brand-50">
                  <h3 className="text-xs font-bold text-brand-700 mb-3">Nueva cita para {patient.firstName} {patient.lastName}</h3>
                  <form onSubmit={createAppointment} className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                    <div>
                      <label className="text-[10px] font-bold text-muted-foreground">Doctor</label>
                      <select className="flex h-8 w-full rounded-lg border border-border bg-white px-2 text-xs mt-0.5"
                        value={apptForm.doctorId} onChange={e => setApptForm(f => ({ ...f, doctorId: e.target.value }))}>
                        {doctors.map(d => <option key={d.id} value={d.id}>Dr/a. {d.firstName} {d.lastName}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-muted-foreground">Tipo</label>
                      <select className="flex h-8 w-full rounded-lg border border-border bg-white px-2 text-xs mt-0.5"
                        value={apptForm.type} onChange={e => setApptForm(f => ({ ...f, type: e.target.value }))}>
                        {["Consulta general","Control","Urgencia","Primera vez","Cirugía","Seguimiento","Otro"].map(t => <option key={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-muted-foreground">Fecha</label>
                      <input type="date" className="flex h-8 w-full rounded-lg border border-border bg-white px-2 text-xs mt-0.5"
                        value={apptForm.date} onChange={e => setApptForm(f => ({ ...f, date: e.target.value }))} />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-muted-foreground">Hora inicio</label>
                      <input type="time" className="flex h-8 w-full rounded-lg border border-border bg-white px-2 text-xs mt-0.5"
                        value={apptForm.startTime} onChange={e => setApptForm(f => ({ ...f, startTime: e.target.value }))} />
                    </div>
                    <div className="col-span-2 lg:col-span-4 flex gap-2 mt-1">
                      <button type="submit" disabled={savingAppt} className="text-xs font-bold bg-brand-600 text-white px-4 py-1.5 rounded-lg hover:bg-brand-700 disabled:opacity-50">
                        {savingAppt ? "Agendando…" : "Confirmar cita"}
                      </button>
                      <button type="button" onClick={() => setShowNewAppt(false)} className="text-xs font-semibold border border-border px-4 py-1.5 rounded-lg hover:bg-muted">Cancelar</button>
                    </div>
                  </form>
                </div>
              )}

              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/30 border-b border-border">
                    {["Fecha","Hora","Tipo","Doctor","Estado"].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {appointments.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">Sin citas registradas</td></tr>
                  ) : appointments.map(a => {
                    const s = APPT_STATUS[a.status] ?? APPT_STATUS.PENDING;
                    return (
                      <tr key={a.id} className="border-b border-border/50 hover:bg-muted/20">
                        <td className="px-4 py-2 font-medium">{formatDate(a.date)}</td>
                        <td className="px-4 py-2 text-muted-foreground font-mono">{a.startTime}</td>
                        <td className="px-4 py-2">{a.type}</td>
                        <td className="px-4 py-2 text-muted-foreground">{a.doctor?.firstName} {a.doctor?.lastName}</td>
                        <td className="px-4 py-2"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ===== TAB: FACTURACION ===== */}
          {tab === "facturacion" && (
            <div className="bg-white border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-border">
                <h2 className="text-sm font-bold">Facturación</h2>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/30 border-b border-border">
                    {["Factura","Fecha","Monto","Pagado","Saldo","Estado"].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {invoices.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">Sin facturas</td></tr>
                  ) : invoices.map(inv => {
                    const s = INV_STATUS[inv.status] ?? INV_STATUS.PENDING;
                    return (
                      <tr key={inv.id} className="border-b border-border/50 hover:bg-muted/20">
                        <td className="px-4 py-2 font-mono font-bold">{inv.invoiceNumber}</td>
                        <td className="px-4 py-2 text-muted-foreground">{formatDate(inv.createdAt)}</td>
                        <td className="px-4 py-2 font-bold">{formatCurrency(inv.total)}</td>
                        <td className="px-4 py-2 text-emerald-600 font-bold">{formatCurrency(inv.paid)}</td>
                        <td className="px-4 py-2 text-rose-600 font-bold">{formatCurrency(inv.balance)}</td>
                        <td className="px-4 py-2"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

        </div>

        {/* Right panel - Quick actions */}
        <div className="w-52 flex-shrink-0 bg-white border-l border-border overflow-y-auto p-4 flex flex-col gap-3">
          <div>
            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-2">Acciones rápidas</div>
            <div className="space-y-1.5">
              {[
                { icon: "📅", label: "Agendar cita",        action: () => setShowNewAppt(true) },
                { icon: "📝", label: "Nueva consulta",       action: () => setTab("expediente")  },
                { icon: "📊", label: "Ver evolución",        action: () => setTab("evolucion")   },
                { icon: "🦷", label: "Plan tratamiento",     action: () => setTab("tratamiento") },
                { icon: "💳", label: "Ver facturación",      action: () => setTab("facturacion") },
              ].map(btn => (
                <button key={btn.label} onClick={btn.action}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold border border-border bg-white hover:bg-muted/50 transition-colors text-left">
                  <span>{btn.icon}</span>
                  {btn.label}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-border pt-3">
            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-2">Finanzas</div>
            <div className="space-y-1.5 text-xs mb-2">
              <div className="flex justify-between"><span className="text-muted-foreground">Total plan</span><span className="font-bold">{formatCurrency(totalPlan)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Pagado</span><span className="font-bold text-emerald-600">{formatCurrency(totalPaid)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Pendiente</span><span className="font-bold text-rose-600">{formatCurrency(totalBalance)}</span></div>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pctPaid}%` }} />
            </div>
            <div className="text-[10px] text-muted-foreground text-right mt-1">{pctPaid}% cubierto</div>
          </div>

          <div className="border-t border-border pt-3">
            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-2">Próxima cita</div>
            {nextAppt ? (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-2.5">
                <div className="text-xs font-extrabold text-brand-700">{formatDate(nextAppt.date)}</div>
                <div className="text-[11px] text-foreground mt-0.5">{nextAppt.type}</div>
                <div className="text-[10px] text-muted-foreground">{nextAppt.startTime}h</div>
              </div>
            ) : (
              <button onClick={() => setShowNewAppt(true)} className="w-full text-xs text-brand-600 hover:underline text-left">Agendar primera cita →</button>
            )}
          </div>

          <div className="border-t border-border pt-3">
            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-2">Alertas</div>
            {patient.allergies?.length > 0 && (
              <div className="flex items-start gap-1.5 bg-rose-50 border border-rose-200 rounded-lg p-2 mb-1.5">
                <AlertTriangle className="w-3 h-3 text-rose-600 flex-shrink-0 mt-0.5" />
                <span className="text-[10px] font-bold text-rose-700">Alergia: {patient.allergies.join(", ")}</span>
              </div>
            )}
            {totalBalance > 0 && (
              <div className="flex items-start gap-1.5 bg-amber-50 border border-amber-200 rounded-lg p-2">
                <span className="text-[10px] font-bold text-amber-700">💰 Saldo pendiente: {formatCurrency(totalBalance)}</span>
              </div>
            )}
            {patient.allergies?.length === 0 && totalBalance === 0 && (
              <p className="text-[10px] text-muted-foreground">Sin alertas activas</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
