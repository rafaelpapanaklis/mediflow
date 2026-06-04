"use client";
import { useState } from "react";
import toast from "react-hot-toast";
import { ExternalLink, Copy, Eye, Plus, Trash2, Upload, Check, Sparkles, RefreshCw, Users, ImagePlus, ChevronLeft, ChevronRight, Star } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";

interface Clinic {
  id: string; name: string; slug: string; phone: string|null; email: string|null;
  address: string|null; city: string|null; logoUrl: string|null; description: string|null;
  landingActive: boolean; landingThemeColor: string|null; landingCoverUrl: string|null;
  landingGallery: string[]; landingTestimonials: any; landingFaqs: any;
  landingServices: any; landingWhatsapp: string|null; landingInstagram: string|null;
  landingFacebook: string|null; landingTiktok: string|null; landingMapEmbed: string|null;
  landingTagline: string|null;
  landingTemplate: string|null; landingYearsExperience: number|null; landingPatients: string|null;
}

interface Props { clinic: Clinic; appUrl: string }

const TABS = [
  { id:"plantilla",    labelKey:"pages.landing.tabTemplate"   },
  { id:"general",      labelKey:"pages.landing.tabGeneral"    },
  { id:"servicios",    labelKey:"pages.landing.tabServices"   },
  { id:"testimonios",  labelKey:"pages.landing.tabTestimonials" },
  { id:"faqs",         labelKey:"pages.landing.tabFaqs"       },
  { id:"galeria",      labelKey:"pages.landing.tabGallery"    },
  { id:"redes",        labelKey:"pages.landing.tabSocial"     },
];

const TEMPLATES = [
  { id:"classic",    nameKey:"pages.landing.templateClassicName",    descKey:"pages.landing.templateClassicDesc" },
  { id:"futurista",  nameKey:"pages.landing.templateFuturistName",   descKey:"pages.landing.templateFuturistDesc" },
  { id:"healthtech", nameKey:"pages.landing.templateHealthtechName", descKey:"pages.landing.templateHealthtechDesc" },
  { id:"calido",     nameKey:"pages.landing.templateWarmName",       descKey:"pages.landing.templateWarmDesc" },
];

// Mini-mock CSS de cada plantilla (no usa fotos reales) para el selector.
function TemplateThumb({ variant }: { variant: string }) {
  const v: Record<string, { bg:string; bar:string; chip:string; text:string }> = {
    classic:    { bg:"bg-gradient-to-br from-blue-500 to-blue-700",                  bar:"bg-white/90",  chip:"bg-white/70",       text:"bg-white/40" },
    futurista:  { bg:"bg-gradient-to-br from-fuchsia-600 via-violet-700 to-slate-900", bar:"bg-cyan-300",  chip:"bg-fuchsia-300/80", text:"bg-white/30" },
    healthtech: { bg:"bg-gradient-to-br from-emerald-400 to-teal-700",               bar:"bg-white/90",  chip:"bg-emerald-100/80", text:"bg-white/40" },
    calido:     { bg:"bg-gradient-to-br from-amber-300 via-rose-300 to-orange-400",  bar:"bg-white/95",  chip:"bg-rose-100/90",    text:"bg-amber-900/25" },
  };
  const s = v[variant] ?? v.classic;
  return (
    <div className={`relative w-full aspect-[16/10] rounded-lg overflow-hidden p-2 flex flex-col gap-1.5 ${s.bg}`}>
      <div className="flex items-center gap-1">
        <div className={`h-1.5 w-6 rounded-full ${s.bar}`} />
        <div className="ml-auto flex gap-1">
          <div className={`h-1.5 w-3 rounded-full ${s.chip}`} />
          <div className={`h-1.5 w-3 rounded-full ${s.chip}`} />
        </div>
      </div>
      <div className="flex-1 flex flex-col justify-center gap-1">
        <div className={`h-2 w-2/3 rounded ${s.bar}`} />
        <div className={`h-1.5 w-1/2 rounded ${s.text}`} />
        <div className={`mt-1 h-2 w-10 rounded ${s.chip}`} />
      </div>
      <div className="flex gap-1">
        <div className={`h-3 flex-1 rounded ${s.text}`} />
        <div className={`h-3 flex-1 rounded ${s.text}`} />
        <div className={`h-3 flex-1 rounded ${s.text}`} />
      </div>
    </div>
  );
}

export function LandingConfigClient({ clinic: initial, appUrl }: Props) {
  const t = useT();
  const [clinic, setClinic] = useState(initial);
  const [tab, setTab]       = useState("plantilla");
  const [saving, setSaving] = useState(false);
  const [templateSel, setTemplateSel] = useState(initial.landingTemplate ?? "classic");

  const landingUrl = `${appUrl}/${clinic.slug}`;

  function updateLocal(key: string, value: any) {
    setClinic(c => ({ ...c, [key]: value }));
  }

  async function save(data: Record<string, any>, successMsg = t("pages.landing.saved")) {
    setSaving(true);
    try {
      const res = await fetch("/api/clinic-landing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const updated = await res.json();
      setClinic(c => ({ ...c, ...updated }));
      toast.success(successMsg);
    } catch(e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  async function uploadImage(file: File, field: string) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("field", field);
    const res = await fetch("/api/landing-upload", { method:"POST", body:formData });
    if (!res.ok) throw new Error(t("pages.landing.uploadImageError"));
    const { url } = await res.json();
    return url;
  }

  // ── Plantilla: previsualizar (sin publicar) y aplicar (publica)
  function previewTemplate(id: string = templateSel) {
    window.open(`/${clinic.slug}?preview=${id}`, "_blank", "noopener");
  }

  async function applyTemplate() {
    const tpl = TEMPLATES.find(item => item.id === templateSel);
    const name = tpl ? t(tpl.nameKey) : templateSel;
    updateLocal("landingTemplate", templateSel);
    if (!clinic.landingActive) updateLocal("landingActive", true);
    await save({ landingTemplate: templateSel, landingActive: true }, t("pages.landing.templateApplied", { name }));
  }

  // ── Servicios state
  const [services, setServices] = useState<any[]>(Array.isArray(clinic.landingServices) ? clinic.landingServices : []);
  function addService() { setServices(s => [...s, { name:"", desc:"", price:"", icon:"🦷" }]); }
  function removeService(i: number) { setServices(s => s.filter((_,j) => j !== i)); }
  function updateService(i: number, k: string, v: string) { setServices(s => s.map((x,j) => j===i ? {...x,[k]:v} : x)); }

  // ── Testimonios state
  const [testimonials, setTestimonials] = useState<any[]>(Array.isArray(clinic.landingTestimonials) ? clinic.landingTestimonials : []);
  function addTestimonial() { setTestimonials(prev => [...prev, { name:"", text:"", rating:5, date:"" }]); }
  function removeTestimonial(i: number) { setTestimonials(prev => prev.filter((_,j) => j !== i)); }
  function updateTestimonial(i: number, k: string, v: any) { setTestimonials(prev => prev.map((x,j) => j===i ? {...x,[k]:v} : x)); }

  // ── FAQs state
  const [faqs, setFaqs] = useState<any[]>(Array.isArray(clinic.landingFaqs) ? clinic.landingFaqs : []);
  function addFaq() { setFaqs(f => [...f, { question:"", answer:"" }]); }
  function removeFaq(i: number) { setFaqs(f => f.filter((_,j) => j !== i)); }
  function updateFaq(i: number, k: string, v: string) { setFaqs(f => f.map((x,j) => j===i ? {...x,[k]:v} : x)); }

  // ── Galería: reordenar (intercambia i con su vecino) y elegir portada
  async function moveGalleryPhoto(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= clinic.landingGallery.length) return;
    const nuevo = [...clinic.landingGallery];
    [nuevo[i], nuevo[j]] = [nuevo[j], nuevo[i]];
    updateLocal("landingGallery", nuevo);
    await save({ landingGallery: nuevo }, t("pages.landing.orderUpdated"));
  }
  async function setGalleryCover(url: string) {
    updateLocal("landingCoverUrl", url);
    await save({ landingCoverUrl: url }, t("pages.landing.coverUpdated"));
  }

  return (
    <div className="flex-1 min-w-0 p-4 sm:p-6 space-y-5 max-w-4xl">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{t("pages.landing.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("pages.landing.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Active toggle */}
          <div className="flex items-center gap-2 bg-card border border-border rounded-xl px-3 py-2">
            <span className="text-sm font-semibold">{clinic.landingActive ? t("pages.landing.statusPublished") : t("pages.landing.statusHidden")}</span>
            <button onClick={async () => {
              const newVal = !clinic.landingActive;
              updateLocal("landingActive", newVal);
              await save({ landingActive: newVal });
            }} className={`w-10 h-5 rounded-full relative transition-colors ${clinic.landingActive ? "bg-emerald-500" : "bg-muted"}`}>
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-card shadow transition-all ${clinic.landingActive ? "left-[22px]" : "left-0.5"}`} />
            </button>
          </div>
          {/* View link */}
          <a href={landingUrl} target="_blank" rel="noreferrer"
            className="flex items-center gap-1.5 text-sm font-semibold text-brand-600 border border-brand-300 px-3 py-2 rounded-xl hover:bg-brand-600/15">
            <ExternalLink size={14}/> {t("pages.landing.viewPage")}
          </a>
          {/* Copy link */}
          <button onClick={() => { navigator.clipboard.writeText(landingUrl); toast.success(t("pages.landing.linkCopied")); }}
            className="flex items-center gap-1.5 text-sm font-semibold border border-border px-3 py-2 rounded-xl hover:bg-muted">
            <Copy size={14}/> {t("pages.landing.copyLink")}
          </button>
        </div>
      </div>

      {/* Link preview */}
      <div className="bg-brand-600/15 border border-brand-200 dark:border-brand-800 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs text-brand-600 font-semibold mb-0.5">{t("pages.landing.publicLink")}</div>
          <div className="text-sm font-mono font-bold">{landingUrl}</div>
        </div>
        <button onClick={() => { navigator.clipboard.writeText(landingUrl); toast.success(t("pages.landing.linkCopied")); }}
          className="shrink-0 text-xs font-semibold text-brand-600 hover:underline">{t("pages.landing.copy")}</button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 flex-wrap border-b border-border">
        {TABS.map(tb => (
          <button key={tb.id} onClick={() => setTab(tb.id)}
            className={`px-4 py-2 text-sm font-semibold rounded-t-xl transition-colors ${tab===tb.id ? "bg-card border border-b-0 border-border text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            {t(tb.labelKey)}
          </button>
        ))}
      </div>

      {/* ── PLANTILLA ── */}
      {tab === "plantilla" && (
        <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
          <div>
            <h3 className="font-bold flex items-center gap-1.5"><Sparkles size={16} className="text-brand-600"/> {t("pages.landing.templateHeading")}</h3>
            <p className="text-xs text-muted-foreground">{t("pages.landing.templateHelp")}</p>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {TEMPLATES.map(tpl => {
              const selected = templateSel === tpl.id;
              return (
                <div key={tpl.id} role="button" tabIndex={0} aria-pressed={selected}
                  onClick={() => setTemplateSel(tpl.id)}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setTemplateSel(tpl.id); } }}
                  className={`cursor-pointer rounded-2xl border p-2.5 transition-all outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 ${selected ? "border-brand-500 ring-2 ring-brand-500/40 bg-brand-600/5" : "border-border hover:border-brand-300"}`}>
                  <div className="relative">
                    <TemplateThumb variant={tpl.id} />
                    {selected && (
                      <div className="absolute top-1.5 right-1.5 bg-brand-600 text-white rounded-full p-0.5 shadow">
                        <Check size={12}/>
                      </div>
                    )}
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-sm font-bold">{t(tpl.nameKey)}</span>
                    {clinic.landingTemplate === tpl.id && (
                      <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-500/15 px-1.5 py-0.5 rounded-full">{t("pages.landing.templateActive")}</span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{t(tpl.descKey)}</p>
                  <button type="button" onClick={e => { e.stopPropagation(); previewTemplate(tpl.id); }}
                    className="mt-2 w-full flex items-center justify-center gap-1 text-[11px] font-semibold text-brand-600 border border-brand-300 rounded-lg py-1 hover:bg-brand-600/10">
                    <Eye size={12}/> {t("pages.landing.preview")}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button type="button" onClick={() => previewTemplate()}
              className="flex items-center gap-1.5 text-sm font-semibold border border-border px-4 py-2.5 rounded-xl hover:bg-muted">
              <Eye size={15}/> {t("pages.landing.previewSelection")}
            </button>
            <button type="button" onClick={applyTemplate} disabled={saving}
              className="flex items-center gap-1.5 text-sm font-bold text-white bg-brand-600 px-4 py-2.5 rounded-xl disabled:opacity-50">
              <Check size={15}/> {saving ? t("pages.landing.applying") : t("pages.landing.applyTemplate")}
            </button>
            {!clinic.landingActive && (
              <span className="text-xs text-amber-600">{t("pages.landing.applyWillPublish")}</span>
            )}
          </div>
        </div>
      )}

      {/* ── GENERAL ── */}
      {tab === "general" && (
        <div className="bg-card border border-border rounded-2xl p-5 space-y-5">
          {/* Theme color */}
          <div>
            <label className="text-sm font-semibold block mb-2">{t("pages.landing.primaryColor")}</label>
            <div className="flex items-center gap-3">
              <input type="color" value={clinic.landingThemeColor ?? "#2563eb"}
                onChange={e => updateLocal("landingThemeColor", e.target.value)}
                className="h-10 w-20 rounded-lg cursor-pointer border border-border" />
              <span className="text-sm text-muted-foreground">{clinic.landingThemeColor ?? "#2563eb"}</span>
              <button onClick={() => save({ landingThemeColor: clinic.landingThemeColor })}
                className="text-xs font-semibold bg-brand-600 text-white px-3 py-1.5 rounded-lg">{t("common.save")}</button>
            </div>
          </div>

          {/* Tagline */}
          <div>
            <label className="text-sm font-semibold block mb-1">{t("pages.landing.taglineLabel")}</label>
            <p className="text-xs text-muted-foreground mb-2">{t("pages.landing.taglineHelp")}</p>
            <input value={clinic.landingTagline ?? ""}
              onChange={e => updateLocal("landingTagline", e.target.value)}
              placeholder={t("pages.landing.taglinePlaceholder")}
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-background" />
            <button onClick={() => save({ landingTagline: clinic.landingTagline })}
              className="mt-2 text-xs font-semibold bg-brand-600 text-white px-3 py-1.5 rounded-lg">{t("common.save")}</button>
          </div>

          {/* Sobre la clínica + estadísticas */}
          <div className="border-t border-border pt-5">
            <label className="text-sm font-semibold block mb-1">{t("pages.landing.aboutClinic")}</label>
            <p className="text-xs text-muted-foreground mb-2">{t("pages.landing.aboutClinicHelp")}</p>
            <textarea value={clinic.description ?? ""}
              onChange={e => updateLocal("description", e.target.value)}
              placeholder={t("pages.landing.aboutClinicPlaceholder")} rows={3}
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-background resize-none" />
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <label className="text-sm font-semibold block mb-1">{t("pages.landing.yearsExperience")}</label>
                <input type="number" min={0} value={clinic.landingYearsExperience ?? ""}
                  onChange={e => updateLocal("landingYearsExperience", e.target.value === "" ? null : Math.trunc(Number(e.target.value)))}
                  placeholder="12"
                  className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-background" />
              </div>
              <div>
                <label className="text-sm font-semibold block mb-1">{t("pages.landing.patientsServed")}</label>
                <input value={clinic.landingPatients ?? ""}
                  onChange={e => updateLocal("landingPatients", e.target.value)}
                  placeholder="8,500+"
                  className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-background" />
              </div>
            </div>
            <button onClick={() => save({
              description: clinic.description,
              landingYearsExperience: clinic.landingYearsExperience,
              landingPatients: clinic.landingPatients,
            })} disabled={saving}
              className="mt-3 text-xs font-semibold bg-brand-600 text-white px-3 py-1.5 rounded-lg disabled:opacity-50">
              {t("pages.landing.saveInfo")}
            </button>
          </div>

          {/* Cover photo */}
          <div>
            <label className="text-sm font-semibold block mb-1">{t("pages.landing.coverPhoto")}</label>
            <p className="text-xs text-muted-foreground mb-2">{t("pages.landing.coverPhotoHelp")}</p>
            {clinic.landingCoverUrl && (
              <div className="relative mb-3">
                <img src={clinic.landingCoverUrl} alt={t("pages.landing.coverAlt")} className="w-full h-32 object-cover rounded-xl" />
                <button onClick={() => { updateLocal("landingCoverUrl", null); save({ landingCoverUrl: null }); }}
                  className="absolute top-2 right-2 bg-red-500 text-white p-1 rounded-lg"><Trash2 size={12}/></button>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm font-semibold border border-border rounded-xl px-4 py-3 cursor-pointer hover:bg-muted w-fit">
              <Upload size={16}/> {clinic.landingCoverUrl ? t("pages.landing.replacePhoto") : t("pages.landing.uploadCoverPhoto")}
              <input type="file" accept="image/*" className="hidden" onChange={async e => {
                const file = e.target.files?.[0]; if (!file) return;
                try {
                  const url = await uploadImage(file, "cover");
                  updateLocal("landingCoverUrl", url);
                  await save({ landingCoverUrl: url });
                } catch { toast.error(t("pages.landing.uploadError")); }
              }} />
            </label>
          </div>

          {/* Map embed */}
          <div>
            <label className="text-sm font-semibold block mb-1">{t("pages.landing.mapEmbedLabel")}</label>
            <p className="text-xs text-muted-foreground mb-2">
              {t("pages.landing.mapEmbedHelp")}
            </p>
            <input value={clinic.landingMapEmbed ?? ""}
              onChange={e => updateLocal("landingMapEmbed", e.target.value)}
              placeholder="https://www.google.com/maps/embed?pb=..."
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-background" />
            <button onClick={() => save({ landingMapEmbed: clinic.landingMapEmbed })}
              className="mt-2 text-xs font-semibold bg-brand-600 text-white px-3 py-1.5 rounded-lg">{t("common.save")}</button>
          </div>
        </div>
      )}

      {/* ── SERVICIOS ── */}
      {tab === "servicios" && (
        <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold">{t("pages.landing.servicesHeading")}</h3>
              <p className="text-xs text-muted-foreground">{t("pages.landing.servicesHelp")}</p>
            </div>
            <button onClick={addService} className="flex items-center gap-1.5 text-sm font-semibold bg-brand-600 text-white px-3 py-2 rounded-xl">
              <Plus size={14}/> {t("common.add")}
            </button>
          </div>
          {services.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-sm">
              {t("pages.landing.servicesEmpty")}
            </div>
          )}
          {services.map((svc, i) => (
            <div key={i} className="border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-muted-foreground">{t("pages.landing.serviceN", { n: i+1 })}</span>
                <button onClick={() => removeService(i)} className="text-red-500 hover:text-red-700"><Trash2 size={14}/></button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">{t("pages.landing.emojiIcon")}</label>
                  <input value={svc.icon} onChange={e => updateService(i,"icon",e.target.value)}
                    placeholder="🦷" className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">{t("pages.landing.priceOptional")}</label>
                  <input value={svc.price} onChange={e => updateService(i,"price",e.target.value)}
                    placeholder={t("pages.landing.priceFromPlaceholder")} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background" />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">{t("pages.landing.serviceName")}</label>
                <input value={svc.name} onChange={e => updateService(i,"name",e.target.value)}
                  placeholder={t("pages.landing.serviceNamePlaceholder")} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">{t("common.description")}</label>
                <textarea value={svc.desc} onChange={e => updateService(i,"desc",e.target.value)}
                  placeholder={t("pages.landing.serviceDescPlaceholder")} rows={2}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background resize-none" />
              </div>
            </div>
          ))}
          {services.length > 0 && (
            <button onClick={() => save({ landingServices: services })} disabled={saving}
              className="w-full py-3 rounded-xl font-bold text-white bg-brand-600 disabled:opacity-50">
              {saving ? t("common.saving") : t("pages.landing.saveServices")}
            </button>
          )}
        </div>
      )}

      {/* ── TESTIMONIOS ── */}
      {tab === "testimonios" && (
        <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold">{t("pages.landing.testimonialsHeading")}</h3>
              <p className="text-xs text-muted-foreground">{t("pages.landing.testimonialsHelp")}</p>
            </div>
            <button onClick={addTestimonial} className="flex items-center gap-1.5 text-sm font-semibold bg-brand-600 text-white px-3 py-2 rounded-xl">
              <Plus size={14}/> {t("common.add")}
            </button>
          </div>
          {testimonials.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-sm">{t("pages.landing.testimonialsEmpty")}</div>
          )}
          {testimonials.map((item, i) => (
            <div key={i} className="border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-muted-foreground">{t("pages.landing.testimonialN", { n: i+1 })}</span>
                <button onClick={() => removeTestimonial(i)} className="text-red-500 hover:text-red-700"><Trash2 size={14}/></button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">{t("pages.landing.testimonialPatientName")}</label>
                  <input value={item.name} onChange={e => updateTestimonial(i,"name",e.target.value)}
                    placeholder="María García" className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">{t("pages.landing.rating")}</label>
                  <select value={item.rating} onChange={e => updateTestimonial(i,"rating",parseInt(e.target.value))}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background">
                    {[5,4,3,2,1].map(n => <option key={n} value={n}>{"⭐".repeat(n)}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">{t("pages.landing.comment")}</label>
                <textarea value={item.text} onChange={e => updateTestimonial(i,"text",e.target.value)}
                  placeholder={t("pages.landing.commentPlaceholder")} rows={2}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background resize-none" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">{t("pages.landing.dateOptional")}</label>
                <input value={item.date ?? ""} onChange={e => updateTestimonial(i,"date",e.target.value)}
                  placeholder={t("pages.landing.datePlaceholder")} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background" />
              </div>
            </div>
          ))}
          {testimonials.length > 0 && (
            <button onClick={() => save({ landingTestimonials: testimonials })} disabled={saving}
              className="w-full py-3 rounded-xl font-bold text-white bg-brand-600 disabled:opacity-50">
              {saving ? t("common.saving") : t("pages.landing.saveTestimonials")}
            </button>
          )}
        </div>
      )}

      {/* ── FAQs ── */}
      {tab === "faqs" && (
        <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold">{t("pages.landing.faqsHeading")}</h3>
              <p className="text-xs text-muted-foreground">{t("pages.landing.faqsHelp")}</p>
            </div>
            <button onClick={addFaq} className="flex items-center gap-1.5 text-sm font-semibold bg-brand-600 text-white px-3 py-2 rounded-xl">
              <Plus size={14}/> {t("common.add")}
            </button>
          </div>
          {faqs.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-sm">{t("pages.landing.faqsEmpty")}</div>
          )}
          {faqs.map((faq, i) => (
            <div key={i} className="border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-muted-foreground">{t("pages.landing.questionN", { n: i+1 })}</span>
                <button onClick={() => removeFaq(i)} className="text-red-500 hover:text-red-700"><Trash2 size={14}/></button>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">{t("pages.landing.question")}</label>
                <input value={faq.question} onChange={e => updateFaq(i,"question",e.target.value)}
                  placeholder={t("pages.landing.questionPlaceholder")} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">{t("pages.landing.answer")}</label>
                <textarea value={faq.answer} onChange={e => updateFaq(i,"answer",e.target.value)}
                  placeholder={t("pages.landing.answerPlaceholder")} rows={2}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background resize-none" />
              </div>
            </div>
          ))}
          {faqs.length > 0 && (
            <button onClick={() => save({ landingFaqs: faqs })} disabled={saving}
              className="w-full py-3 rounded-xl font-bold text-white bg-brand-600 disabled:opacity-50">
              {saving ? t("common.saving") : t("pages.landing.saveFaqs")}
            </button>
          )}
        </div>
      )}

      {/* ── GALERÍA ── */}
      {tab === "galeria" && (
        <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-bold">{t("pages.landing.galleryHeading")}</h3>
              <p className="text-xs text-muted-foreground">{t("pages.landing.galleryHelp")}</p>
            </div>
            <label className={`flex items-center gap-1.5 text-sm font-semibold rounded-xl px-3 py-2 cursor-pointer shrink-0 ${clinic.landingGallery.length >= 12 ? "opacity-50 pointer-events-none border border-border" : "bg-brand-600 text-white"}`}>
              <ImagePlus size={15}/> {t("pages.landing.addPhoto")}
              <input type="file" accept="image/*" className="hidden" disabled={clinic.landingGallery.length >= 12}
                onChange={async e => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  if (clinic.landingGallery.length >= 12) { toast.error(t("pages.landing.maxPhotos")); return; }
                  try {
                    const url = await uploadImage(file, "gallery");
                    const newGallery = [...clinic.landingGallery, url];
                    updateLocal("landingGallery", newGallery);
                    await save({ landingGallery: newGallery });
                  } catch { toast.error(t("pages.landing.uploadError")); }
                }} />
            </label>
          </div>

          {/* Nota: las fotos de los doctores viven en Equipo */}
          <div className="flex items-center gap-2 text-xs bg-brand-600/10 border border-brand-200 dark:border-brand-800 rounded-xl px-3 py-2">
            <Users size={14} className="text-brand-600 shrink-0"/>
            <span className="text-muted-foreground">
              {t("pages.landing.doctorPhotosNote")}{" "}
              <a href="/dashboard/team" className="font-semibold text-brand-600 hover:underline">{t("pages.landing.teamLink")}</a>.
            </span>
          </div>

          {/* Ayuda: cómo ordenar y qué es la portada */}
          {clinic.landingGallery.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t("pages.landing.galleryOrderHelp")}
            </p>
          )}

          {clinic.landingGallery.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {clinic.landingGallery.map((url, i) => {
                const isCover = url === clinic.landingCoverUrl;
                const isFirst = i === 0;
                const isLast  = i === clinic.landingGallery.length - 1;
                return (
                  <div key={i}
                    className={`relative aspect-square rounded-xl overflow-hidden border ${isCover ? "border-brand-500 ring-2 ring-brand-500/50" : "border-border"}`}>
                    <img src={url} alt={t("pages.landing.photoN", { n: i+1 })} className="w-full h-full object-cover" />

                    {/* Badge de posición — SIEMPRE visible */}
                    <span className="absolute top-1.5 left-1.5 bg-black/65 text-white text-[11px] font-bold rounded-md px-1.5 py-0.5 leading-none">
                      #{i+1}
                    </span>

                    {/* Portada — badge si ya lo es, botón "Usar como portada" si no */}
                    {isCover ? (
                      <span className="absolute top-1.5 right-1.5 flex items-center gap-1 bg-brand-600 text-white text-[10px] font-bold rounded-md px-1.5 py-0.5 leading-none shadow">
                        <Star size={10} className="fill-current"/> {t("pages.landing.cover")}
                      </span>
                    ) : (
                      <button type="button" onClick={() => setGalleryCover(url)} disabled={saving}
                        aria-label={t("pages.landing.useAsCover")} title={t("pages.landing.useAsCover")}
                        className="absolute top-1.5 right-1.5 flex items-center gap-1 bg-black/65 hover:bg-brand-600 text-white text-[10px] font-semibold rounded-md px-1.5 py-0.5 leading-none transition-colors disabled:opacity-50">
                        <Star size={10}/> {t("pages.landing.cover")}
                      </button>
                    )}

                    {/* Flechas de reordenar — SIEMPRE visibles (deshabilitadas en los extremos) */}
                    <div className="absolute top-1/2 -translate-y-1/2 inset-x-1.5 flex justify-between pointer-events-none">
                      <button type="button" onClick={() => moveGalleryPhoto(i, -1)} disabled={saving || isFirst}
                        aria-label={t("pages.landing.moveLeftAria")} title={t("pages.landing.moveLeft")}
                        className="pointer-events-auto bg-black/55 hover:bg-black/85 text-white rounded-full p-1 transition-colors disabled:opacity-30 disabled:pointer-events-none disabled:cursor-not-allowed">
                        <ChevronLeft size={16}/>
                      </button>
                      <button type="button" onClick={() => moveGalleryPhoto(i, 1)} disabled={saving || isLast}
                        aria-label={t("pages.landing.moveRightAria")} title={t("pages.landing.moveRight")}
                        className="pointer-events-auto bg-black/55 hover:bg-black/85 text-white rounded-full p-1 transition-colors disabled:opacity-30 disabled:pointer-events-none disabled:cursor-not-allowed">
                        <ChevronRight size={16}/>
                      </button>
                    </div>

                    {/* Barra de acciones — SIEMPRE visible */}
                    <div className="absolute inset-x-0 bottom-0 flex divide-x divide-white/20 bg-black/65">
                      <label aria-label={t("pages.landing.replacePhotoAria")} title={t("pages.landing.replace")}
                        className="flex-1 flex items-center justify-center gap-1 text-[11px] font-semibold text-white py-1.5 cursor-pointer hover:bg-white/15">
                        <RefreshCw size={12}/> <span className="hidden sm:inline">{t("pages.landing.replace")}</span>
                        <input type="file" accept="image/*" className="hidden" onChange={async e => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (!file) return;
                          try {
                            const newUrl = await uploadImage(file, "gallery");
                            const newGallery = clinic.landingGallery.map((u,j) => j===i ? newUrl : u);
                            updateLocal("landingGallery", newGallery);
                            await save({ landingGallery: newGallery });
                          } catch { toast.error(t("pages.landing.uploadError")); }
                        }} />
                      </label>
                      <button type="button" aria-label={t("pages.landing.deletePhotoAria")} title={t("common.delete")}
                        onClick={async () => {
                          const newGallery = clinic.landingGallery.filter((_,j) => j !== i);
                          updateLocal("landingGallery", newGallery);
                          await save({ landingGallery: newGallery });
                        }}
                        className="flex-1 flex items-center justify-center gap-1 text-[11px] font-semibold text-white py-1.5 hover:bg-red-600/70">
                        <Trash2 size={12}/> <span className="hidden sm:inline">{t("common.delete")}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground text-sm">{t("pages.landing.galleryEmpty")}</div>
          )}
        </div>
      )}

      {/* ── REDES Y CONTACTO ── */}
      {tab === "redes" && (
        <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
          <h3 className="font-bold">{t("pages.landing.socialHeading")}</h3>
          {[
            { key:"landingWhatsapp",  label:"WhatsApp",  placeholder:"+52 999 123 4567", descKey:"pages.landing.whatsappDesc" },
            { key:"landingInstagram", label:"Instagram",  placeholder:"@tuclinica",      descKey:"pages.landing.handleDesc" },
            { key:"landingFacebook",  label:"Facebook",   placeholder:"https://facebook.com/tuclinica", descKey:"pages.landing.facebookDesc" },
            { key:"landingTiktok",    label:"TikTok",     placeholder:"@tuclinica",      descKey:"pages.landing.handleDesc" },
          ].map(field => (
            <div key={field.key}>
              <label className="text-sm font-semibold block mb-0.5">{field.label}</label>
              <p className="text-xs text-muted-foreground mb-1.5">{t(field.descKey)}</p>
              <input value={(clinic as any)[field.key] ?? ""}
                onChange={e => updateLocal(field.key, e.target.value)}
                placeholder={field.placeholder}
                className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-background" />
            </div>
          ))}
          <button onClick={() => save({
            landingWhatsapp: clinic.landingWhatsapp,
            landingInstagram: clinic.landingInstagram,
            landingFacebook: clinic.landingFacebook,
            landingTiktok: clinic.landingTiktok,
          })} disabled={saving}
            className="w-full py-3 rounded-xl font-bold text-white bg-brand-600 disabled:opacity-50">
            {saving ? t("common.saving") : t("pages.landing.saveSocial")}
          </button>
        </div>
      )}
    </div>
  );
}
