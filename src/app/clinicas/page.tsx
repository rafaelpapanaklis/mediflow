"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Search, MapPin, Stethoscope, Calendar, ChevronRight, X } from "lucide-react";

interface Doctor {
  id: string; name: string; specialty: string | null;
  color: string; services: string[];
}
interface Clinic {
  id: string; name: string; slug: string; specialty: string;
  city: string | null; address: string | null; phone: string | null;
  logoUrl: string | null; description: string | null;
  doctorCount: number; doctors: Doctor[]; openDays: number[];
  category?: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  DENTAL: "Odontología", MEDICINE: "Medicina General", NUTRITION: "Nutrición",
  PSYCHOLOGY: "Psicología", DERMATOLOGY: "Dermatología", AESTHETIC_MEDICINE: "Medicina Estética",
  HAIR_RESTORATION: "Capilares", BEAUTY_CENTER: "Estética", BROW_LASH: "Cejas y Pestañas",
  MASSAGE: "Masajes", LASER_HAIR_REMOVAL: "Láser", HAIR_SALON: "Peluquerías",
  ALTERNATIVE_MEDICINE: "Alternativa", NAIL_SALON: "Uñas", SPA: "Spas",
  PHYSIOTHERAPY: "Fisioterapia", PODIATRY: "Podología", OTHER: "Otra",
};

const SPECIALTY_ICONS: Record<string, string> = {
  dental: "🦷", odontología: "🦷", odontologia: "🦷",
  medicine: "🩺", medicina: "🩺",
  nutrition: "🥗", nutrición: "🥗", nutricion: "🥗",
  psychology: "🧠", psicología: "🧠", psicologia: "🧠",
  dermatology: "✨", dermatología: "✨", dermatologia: "✨",
};
function specialtyIcon(s: string) {
  return SPECIALTY_ICONS[s.toLowerCase()] ?? "🏥";
}

const POPULAR_SERVICES = [
  "Ortodoncia","Implantes","Limpieza dental","Blanqueamiento",
  "Consulta general","Nutrición","Psicología","Dermatología",
  "Resina","Endodoncia","Extracción","Coronas",
];

const DAYS_SHORT = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];

export default function ClinicasPage() {
  const [query,    setQuery]    = useState("");
  const [service,  setService]  = useState("");
  const [city,     setCity]     = useState("");
  const [category, setCategory] = useState("");
  const [clinics,  setClinics]  = useState<Clinic[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [searched, setSearched] = useState(false);

  const search = useCallback(async (q: string, svc: string, ct: string, cat: string = "") => {
    setLoading(true); setSearched(true);
    try {
      const params = new URLSearchParams();
      if (q)   params.set("q",        q);
      if (svc) params.set("service",  svc);
      if (ct)  params.set("city",     ct);
      if (cat) params.set("category", cat);
      const res  = await fetch(`/api/public/clinicas?${params}`);
      const data = await res.json();
      setClinics(Array.isArray(data) ? data : []);
    } catch { setClinics([]); }
    finally { setLoading(false); }
  }, []);

  // Load all public clinics on mount
  useEffect(() => { search("", "", "", ""); }, [search]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    search(query, service, city, category);
  }

  function selectService(svc: string) {
    setService(svc);
    search(query, svc, city, category);
  }

  function clearService() {
    setService("");
    search(query, "", city, category);
  }

  function selectCategory(cat: string) {
    setCategory(cat);
    search(query, service, city, cat);
  }

  return (
    <div className="min-h-screen" style={{ background:"#f8fafc", fontFamily:"system-ui,sans-serif" }}>

      {/* Header */}
      <header style={{ background:"#0f172a", padding:"16px 20px" }}>
        <div style={{ maxWidth:960, margin:"0 auto", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <Link href="/" style={{ display:"flex", alignItems:"center", gap:10, textDecoration:"none" }}>
            <div style={{ width:36, height:36, borderRadius:10, background:"#2563eb", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontWeight:800, fontSize:16 }}>M</div>
            <span style={{ fontWeight:800, fontSize:18, color:"#fff" }}>MediFlow</span>
          </Link>
          <div style={{ display:"flex", gap:12 }}>
            <Link href="/login"    style={{ color:"#94a3b8", fontSize:14, fontWeight:600, textDecoration:"none" }}>Iniciar sesión</Link>
            <Link href="/register" style={{ background:"#2563eb", color:"#fff", fontSize:14, fontWeight:700, padding:"8px 18px", borderRadius:10, textDecoration:"none" }}>Registrar clínica</Link>
          </div>
        </div>
      </header>

      {/* Hero search */}
      <div style={{ background:"linear-gradient(135deg,#1e3a8a,#2563eb)", padding:"48px 20px" }}>
        <div style={{ maxWidth:660, margin:"0 auto", textAlign:"center" }}>
          <h1 style={{ fontSize:32, fontWeight:800, color:"#fff", margin:"0 0 10px" }}>
            Encuentra tu clínica ideal
          </h1>
          <p style={{ fontSize:16, color:"#bfdbfe", margin:"0 0 28px" }}>
            Busca por tratamiento, especialidad o ciudad y agenda tu cita en línea
          </p>

          <form onSubmit={handleSearch}
            style={{ background:"#fff", borderRadius:16, padding:16, display:"flex", gap:10, flexWrap:"wrap" }}>
            <div style={{ flex:1, minWidth:180, display:"flex", alignItems:"center", gap:8, border:"1.5px solid #e2e8f0", borderRadius:12, padding:"10px 14px" }}>
              <Search size={16} color="#94a3b8" />
              <input style={{ border:"none", outline:"none", fontSize:14, color:"#0f172a", flex:1, background:"transparent" }}
                placeholder="Nombre, especialidad…"
                value={query} onChange={e => setQuery(e.target.value)} />
            </div>
            <div style={{ flex:1, minWidth:140, display:"flex", alignItems:"center", gap:8, border:"1.5px solid #e2e8f0", borderRadius:12, padding:"10px 14px" }}>
              <MapPin size={16} color="#94a3b8" />
              <input style={{ border:"none", outline:"none", fontSize:14, color:"#0f172a", flex:1, background:"transparent" }}
                placeholder="Ciudad"
                value={city} onChange={e => setCity(e.target.value)} />
            </div>
            <button type="submit"
              style={{ background:"#2563eb", color:"#fff", fontWeight:700, fontSize:14, padding:"10px 24px", borderRadius:12, border:"none", cursor:"pointer", whiteSpace:"nowrap" }}>
              Buscar
            </button>
          </form>
        </div>
      </div>

      <div style={{ maxWidth:960, margin:"0 auto", padding:"28px 16px" }}>

        {/* Category filter */}
        <div style={{ marginBottom:20 }}>
          <div style={{ fontSize:13, fontWeight:700, color:"#475569", marginBottom:10 }}>Categoría:</div>
          <div style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:4 }}>
            <button onClick={() => selectCategory("")}
              style={{
                padding:"10px 16px", borderRadius:999, fontSize:12, fontWeight:600, cursor:"pointer", border:"1.5px solid",
                whiteSpace:"nowrap",
                background: category === "" ? "#eff6ff" : "#fff",
                borderColor: category === "" ? "#2563eb" : "#e2e8f0",
                color: category === "" ? "#1d4ed8" : "#475569",
              }}>
              Todas
            </button>
            {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
              <button key={key} onClick={() => selectCategory(category === key ? "" : key)}
                style={{
                  padding:"10px 16px", borderRadius:999, fontSize:12, fontWeight:600, cursor:"pointer", border:"1.5px solid",
                  whiteSpace:"nowrap", display:"flex", alignItems:"center", gap:6,
                  background: category === key ? "#eff6ff" : "#fff",
                  borderColor: category === key ? "#2563eb" : "#e2e8f0",
                  color: category === key ? "#1d4ed8" : "#475569",
                }}>
                {label}
                {category === key && <X size={12} />}
              </button>
            ))}
          </div>
        </div>

        {/* Popular services filter */}
        <div style={{ marginBottom:24 }}>
          <div style={{ fontSize:13, fontWeight:700, color:"#475569", marginBottom:10 }}>Servicios populares:</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
            {POPULAR_SERVICES.map(s => (
              <button key={s} onClick={() => service === s ? clearService() : selectService(s)}
                style={{
                  padding:"10px 16px", borderRadius:999, fontSize:12, fontWeight:600, cursor:"pointer", border:"1.5px solid",
                  background: service === s ? "#eff6ff" : "#fff",
                  borderColor: service === s ? "#2563eb" : "#e2e8f0",
                  color: service === s ? "#1d4ed8" : "#475569",
                  display:"flex", alignItems:"center", gap:6,
                }}>
                {s}
                {service === s && <X size={12} />}
              </button>
            ))}
          </div>
        </div>

        {/* Results count */}
        {searched && !loading && (
          <div style={{ fontSize:14, color:"#64748b", marginBottom:16 }}>
            {clinics.length === 0
              ? "No se encontraron clínicas con esos criterios"
              : `${clinics.length} clínica${clinics.length !== 1 ? "s" : ""} encontrada${clinics.length !== 1 ? "s" : ""}${service ? ` que ofrecen "${service}"` : ""}`}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div style={{ textAlign:"center", padding:"48px 0", color:"#94a3b8", fontSize:15 }}>
            Buscando clínicas…
          </div>
        )}

        {/* Clinic cards */}
        {!loading && (
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))", gap:16 }}>
            {clinics.map(clinic => (
              <div key={clinic.id}
                style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:20, overflow:"hidden", transition:"box-shadow 0.15s" }}>

                {/* Card header */}
                <div style={{ padding:"20px 20px 16px", borderBottom:"1px solid #f1f5f9" }}>
                  <div style={{ display:"flex", alignItems:"flex-start", gap:14 }}>
                    {clinic.logoUrl
                      ? <img src={clinic.logoUrl} alt={clinic.name} style={{ width:48, height:48, borderRadius:12, objectFit:"contain", flexShrink:0 }} />
                      : <div style={{ width:48, height:48, borderRadius:12, background:"#eff6ff", display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, flexShrink:0 }}>
                          {specialtyIcon(clinic.specialty)}
                        </div>}
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontWeight:700, fontSize:16, color:"#0f172a", marginBottom:3 }}>{clinic.name}</div>
                      <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                        <span style={{ fontSize:12, fontWeight:600, color:"#2563eb", background:"#eff6ff", padding:"2px 8px", borderRadius:999 }}>
                          {specialtyIcon(clinic.specialty)} {clinic.specialty}
                        </span>
                        {clinic.category && CATEGORY_LABELS[clinic.category] && (
                          <span style={{ fontSize:11, fontWeight:600, color:"#7c3aed", background:"#f5f3ff", padding:"2px 8px", borderRadius:999 }}>
                            {CATEGORY_LABELS[clinic.category]}
                          </span>
                        )}
                        {clinic.city && (
                          <span style={{ fontSize:12, color:"#64748b", display:"flex", alignItems:"center", gap:3 }}>
                            <MapPin size={11} /> {clinic.city}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  {clinic.description && (
                    <p style={{ fontSize:13, color:"#64748b", margin:"10px 0 0", lineHeight:1.5 }}>{clinic.description}</p>
                  )}
                </div>

                {/* Doctors */}
                <div style={{ padding:"14px 20px", borderBottom:"1px solid #f1f5f9" }}>
                  <div style={{ fontSize:11, fontWeight:700, color:"#94a3b8", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>
                    <Stethoscope size={11} style={{ display:"inline", marginRight:4 }} />
                    {clinic.doctorCount} Doctor{clinic.doctorCount !== 1 ? "es" : ""}
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                    {clinic.doctors.slice(0,3).map(doc => (
                      <div key={doc.id} style={{ display:"flex", alignItems:"flex-start", gap:8 }}>
                        <div style={{ width:28, height:28, borderRadius:"50%", background:doc.color, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontWeight:700, fontSize:11, flexShrink:0 }}>
                          {doc.name.replace("Dr/a. ","")[0]}
                        </div>
                        <div>
                          <div style={{ fontSize:13, fontWeight:600, color:"#0f172a" }}>{doc.name}</div>
                          {doc.services.length > 0 && (
                            <div style={{ display:"flex", flexWrap:"wrap", gap:3, marginTop:3 }}>
                              {doc.services.slice(0,3).map(s => (
                                <span key={s}
                                  style={{ fontSize:10, fontWeight:600, color: service && s.toLowerCase().includes(service.toLowerCase()) ? "#1d4ed8" : "#64748b",
                                    background: service && s.toLowerCase().includes(service.toLowerCase()) ? "#eff6ff" : "#f1f5f9",
                                    padding:"1px 6px", borderRadius:999 }}>
                                  {s}
                                </span>
                              ))}
                              {doc.services.length > 3 && (
                                <span style={{ fontSize:10, color:"#94a3b8", padding:"1px 4px" }}>+{doc.services.length - 3}</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Open days */}
                <div style={{ padding:"12px 20px", borderBottom:"1px solid #f1f5f9", display:"flex", gap:4 }}>
                  {[0,1,2,3,4,5,6].map(day => (
                    <div key={day}
                      style={{ flex:1, textAlign:"center", fontSize:10, fontWeight:700, padding:"4px 0", borderRadius:6,
                        background: clinic.openDays.includes(day) ? "#f0fdf4" : "#f8fafc",
                        color: clinic.openDays.includes(day) ? "#16a34a" : "#cbd5e1" }}>
                      {DAYS_SHORT[day]}
                    </div>
                  ))}
                </div>

                {/* CTA */}
                <div style={{ padding:"14px 20px" }}>
                  <Link href={`/reservar/${clinic.slug}${service ? `?service=${encodeURIComponent(service)}` : ""}`}
                    style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8, width:"100%", background:"#2563eb", color:"#fff", fontWeight:700, fontSize:14, padding:"12px", borderRadius:12, textDecoration:"none", transition:"background 0.15s" }}>
                    <Calendar size={16} /> Agendar cita
                    <ChevronRight size={16} style={{ marginLeft:"auto" }} />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && searched && clinics.length === 0 && (
          <div style={{ textAlign:"center", padding:"64px 20px" }}>
            <div style={{ fontSize:48, marginBottom:16 }}>🏥</div>
            <div style={{ fontSize:18, fontWeight:700, color:"#0f172a", marginBottom:8 }}>No encontramos clínicas</div>
            <div style={{ fontSize:14, color:"#64748b", marginBottom:20 }}>
              Intenta con otro servicio o ciudad
            </div>
            <button onClick={() => { setQuery(""); setService(""); setCity(""); setCategory(""); search("","","",""); }}
              style={{ background:"#2563eb", color:"#fff", fontWeight:700, fontSize:14, padding:"10px 24px", borderRadius:12, border:"none", cursor:"pointer" }}>
              Ver todas las clínicas
            </button>
          </div>
        )}

        {/* CTA for clinics */}
        <div style={{ marginTop:40, background:"linear-gradient(135deg,#1e3a8a,#2563eb)", borderRadius:20, padding:"28px 24px", textAlign:"center" }}>
          <div style={{ fontSize:20, fontWeight:800, color:"#fff", marginBottom:8 }}>
            ¿Tienes una clínica?
          </div>
          <div style={{ fontSize:14, color:"#bfdbfe", marginBottom:18 }}>
            Regístrate en MediFlow y aparece en este directorio para recibir pacientes nuevos
          </div>
          <Link href="/register"
            style={{ display:"inline-block", background:"#fff", color:"#1d4ed8", fontWeight:700, fontSize:14, padding:"12px 28px", borderRadius:12, textDecoration:"none" }}>
            Registrar mi clínica gratis →
          </Link>
        </div>
      </div>
    </div>
  );
}
