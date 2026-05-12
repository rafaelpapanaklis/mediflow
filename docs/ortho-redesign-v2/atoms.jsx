/* eslint-disable */
// â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
// â•‘ MediFlow Â· MÃ³dulo Ortodoncia Â· Hi-fi Â· Single-file React app         â•‘
// â•‘ Atoms Â· 7 secciones Â· 15 drawers Â· 6 estados macro Â· light+dark      â•‘
// â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

const { useState, useMemo, useRef, useEffect, Fragment } = React;

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• ICON SYSTEM (lucide-inspired inline SVG) â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const ic = (p) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const ICONS = {
  pencil:'<path d="M21.2 5.6 18.4 2.8a2 2 0 0 0-2.8 0L3 15.4V21h5.6L21.2 8.4a2 2 0 0 0 0-2.8Z"/><path d="m15 5 3 3"/>',
  more:'<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  calplus:'<path d="M3 6h18v15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6Z"/><path d="M3 10h18M8 3v4M16 3v4M12 14v6M9 17h6"/>',
  globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  note:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M9 13l3 3 5-5"/>',
  chevdown:'<path d="m6 9 6 6 6-6"/>',
  chevright:'<path d="m9 6 6 6-6 6"/>',
  chevleft:'<path d="m15 6-6 6 6 6"/>',
  chevsdown:'<path d="m7 6 5 5 5-5M7 13l5 5 5-5"/>',
  layers:'<path d="m12 2 10 6-10 6L2 8l10-6Z"/><path d="m2 14 10 6 10-6M2 8v6m20-6v6"/>',
  wand:'<path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M17.8 6.2 19 5M3 21l9-9M12.2 6.2 11 5"/>',
  trending:'<path d="m22 7-9 9-4-4-7 7"/><path d="M16 7h6v6"/>',
  wallet:'<path d="M3 7h18v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z"/><path d="M16 12h4M3 7l3-3h13v3"/>',
  calclock:'<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><circle cx="16" cy="16" r="3"/><path d="M16 14.5V16l1 1"/>',
  cam:'<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/><circle cx="12" cy="13" r="3.5"/>',
  smart:'<rect x="6" y="2" width="12" height="20" rx="2"/><circle cx="12" cy="18" r="1"/>',
  uploadcloud:'<path d="M16 16l-4-4-4 4M12 12v9"/><path d="M20 16.6A5 5 0 0 0 18 7h-1.3A8 8 0 1 0 4 16"/>',
  imageplus:'<rect x="3" y="3" width="14" height="14" rx="2"/><circle cx="9" cy="9" r="1.5"/><path d="m17 17-3-3-4 4M21 11v6M18 14h6"/>',
  gitcompare:'<circle cx="5" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><path d="M5 8v8a2 2 0 0 0 2 2h2M19 16V8a2 2 0 0 0-2-2h-2"/><path d="m11 4-2 2 2 2M13 20l2-2-2-2"/>',
  ruler:'<path d="M21 3 3 21l-2-2L19 1l2 2Z"/><path d="m5 14 2 2M9 10l2 2M13 6l2 2M17 11l2 2M11 19l2 2"/>',
  pen:'<path d="m12 19 7-7-4-4-7 7v4h4Z"/><path d="m18 13 4-4-3-3-4 4"/>',
  star:'<path d="m12 2 3.1 6.4 7.1 1-5.1 5 1.2 7-6.3-3.3L5.7 21.4l1.2-7L1.8 9.4l7.1-1Z"/>',
  trash:'<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6 18 21H6L5 6"/>',
  zap:'<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>',
  arrow:'<path d="M7 17 17 7M17 7H7m10 0v10"/>',
  circle:'<circle cx="12" cy="12" r="9"/>',
  type:'<path d="M3 5h18M12 5v14M9 19h6"/>',
  triangle:'<path d="M12 3 2 21h20L12 3Z"/>',
  send:'<path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z"/>',
  msg:'<path d="M21 12a8.5 8.5 0 0 1-13 7L3 21l2-5A8.5 8.5 0 1 1 21 12Z"/>',
  msgs:'<path d="M21 12a8.5 8.5 0 0 1-13 7L3 21l2-5A8.5 8.5 0 1 1 21 12Z"/><path d="M16 8.5h.01M12 8.5h.01M8 8.5h.01"/>',
  beaker:'<path d="M9 3v6L3 19a2 2 0 0 0 1.7 3h14.6A2 2 0 0 0 21 19L15 9V3"/><path d="M8 3h8M6 14h12"/>',
  filesign:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M10 15s.5-1 2-1 2 2 4 2"/>',
  mail:'<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 7 10-7"/>',
  truck:'<path d="M14 17h-4V5h11v12h-3M9 17H3v-6l3-4h4"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
  hash:'<path d="M4 9h16M4 15h16M9 3 7 21M17 3l-2 18"/>',
  share:'<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5 8.6 10.5"/>',
  shield:'<path d="m12 2 9 4v6c0 5-3.5 9.4-9 10-5.5-.6-9-5-9-10V6l9-4Z"/><path d="m9 12 2 2 4-4"/>',
  download:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  filedown:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M12 12v6m-3-3 3 3 3-3"/>',
  folder:'<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z"/>',
  layoutdash:'<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  clip:'<rect x="6" y="4" width="12" height="18" rx="2"/><path d="M9 2h6v4H9z"/><path d="M9 11h6M9 15h6"/>',
  filebar:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M9 18v-3M12 18v-6M15 18v-2"/>',
  calheart:'<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M12 17a1.5 1.5 0 0 0-3 0c0 1.5 3 3 3 3s3-1.5 3-3a1.5 1.5 0 0 0-3 0Z"/>',
  shieldcheck:'<path d="m12 2 9 4v6c0 5-3.5 9.4-9 10-5.5-.6-9-5-9-10V6l9-4Z"/><path d="m9 12 2 2 4-4"/>',
  check:'<path d="m5 12 5 5 9-12"/>',
  checkcheck:'<path d="m3 12 4 4 8-10M15 14l3 3 6-8"/>',
  loader:'<path d="M12 2v4M12 18v4M5 5l3 3M16 16l3 3M2 12h4M18 12h4M5 19l3-3M16 8l3-3"/>',
  alert:'<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  x:'<path d="M18 6 6 18M6 6l12 12"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  filter:'<path d="M4 4h16l-6 8v6l-4 2v-8L4 4Z"/>',
  list:'<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  cal:'<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  grip:'<circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>',
  gitbranch:'<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  scissors:'<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="m9 8 12 12M20 4 9 15"/>',
  target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  template:'<rect x="3" y="3" width="18" height="6" rx="1.5"/><rect x="3" y="13" width="9" height="8" rx="1.5"/><rect x="16" y="13" width="5" height="8" rx="1.5"/>',
  save:'<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  toggle:'<rect x="2" y="7" width="20" height="10" rx="5"/><circle cx="17" cy="12" r="3" fill="currentColor"/>',
  togglel:'<rect x="2" y="7" width="20" height="10" rx="5"/><circle cx="7" cy="12" r="3" fill="currentColor"/>',
  sparkles:'<path d="m12 3 2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5ZM19 14l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2ZM5 14l.7 1.4L7 16l-1.3.6L5 18l-.7-1.4L3 16l1.3-.6L5 14Z"/>',
  printer:'<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z"/>',
  eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  scope:'<circle cx="12" cy="12" r="9"/><path d="M12 3v6M12 15v6M3 12h6M15 12h6M12 12h.01"/>',
  pulse:'<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  activity:'<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  fingerprint:'<path d="M9 12a3 3 0 1 1 6 0v3M7 12c0-3 2-5 5-5s5 2 5 5v1M5 12c0-4 3-7 7-7M19 12v4M12 17v4M12 12v3"/>',
  movehor:'<path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/>',
  refresh:'<path d="M21 12a9 9 0 1 1-3-7M21 5v6h-6"/>',
  copy:'<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  link:'<path d="M9 17h-3a5 5 0 0 1 0-10h3M15 7h3a5 5 0 0 1 0 10h-3M8 12h8"/>',
  reply:'<path d="M9 17 4 12l5-5M4 12h11a5 5 0 0 1 5 5v2"/>',
  archive:'<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v12a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V8M10 12h4"/>',
  power:'<path d="M12 2v10M5.5 7a8 8 0 1 0 13 0"/>',
  movez:'<path d="M5 9 12 2l7 7M5 15l7 7 7-7"/>',
  badge:'<path d="M12 2 4 6v6c0 5 8 10 8 10s8-5 8-10V6l-8-4Z"/>',
  brain:'<path d="M9 5a3 3 0 1 0 0 6 3 3 0 1 0 0 6h3v-6h-3M15 5a3 3 0 1 1 0 6 3 3 0 1 1 0 6h-3"/>',
  tag:'<path d="M20 12 12 20l-9-9V3h8l9 9Z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  notebook:'<rect x="3" y="4" width="16" height="18" rx="2"/><path d="M3 9h2M3 13h2M3 17h2M19 4v18"/>',
  microsope:'<path d="M6 18h8M3 22h18M14 22a7 7 0 1 0 0-14h-1M9 14h2"/><path d="M8 8h.01M9 6h.01M10 4h.01"/>',
  listcheck:'<path d="M7 7h11M7 12h11M7 17h11M3 7h.01M3 12h.01M3 17h.01"/>',
  pal:'<circle cx="12" cy="12" r="9"/><circle cx="7" cy="11" r="1.5" fill="currentColor"/><circle cx="12" cy="8" r="1.5" fill="currentColor"/><circle cx="17" cy="11" r="1.5" fill="currentColor"/><circle cx="14" cy="16" r="1.5" fill="currentColor"/>',
  alertCircle:'<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>',
  dollar:'<path d="M12 2v20M16 6H10a3 3 0 0 0 0 6h4a3 3 0 0 1 0 6H8"/>',
  arrowright:'<path d="M5 12h14M13 5l7 7-7 7"/>',
  arrowleft:'<path d="M19 12H5M11 19l-7-7 7-7"/>',
  flask:'<path d="M9 3v6L4 19a2 2 0 0 0 1.7 3h12.6A2 2 0 0 0 20 19L15 9V3"/><path d="M8 3h8"/>',
  wrench:'<path d="M14.7 6.3a4 4 0 0 0 5.4 5.4l-7.6 7.6a3 3 0 0 1-4.2-4.2l7.6-7.6 1.4-1.4a4 4 0 0 1 5.4 5.4l-1.4 1.4"/>',
  cleft:'<path d="m15 18-6-6 6-6"/>',
  msquare:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6M9 15h6M9 12h6"/>',
  filetext:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M9 13h6M9 17h6M9 9h2"/>',
};
function I({n, size=14, cls=""}){ return <span className={"icon "+cls} style={{width:size,height:size,display:"inline-flex",flex:"0 0 auto"}} dangerouslySetInnerHTML={{__html:ic(ICONS[n]||ICONS.circle).replace('<svg ',`<svg width="${size}" height="${size}" `)}}/> }

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• MOCK DATA â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const PATIENT = {
  id:"pt_001", caseCode:"ORT-2026-014",
  name:"Gabriela Fuentes Camarena", age:24, sex:"F",
  initials:"GF", color:"#9b5cf6",
  email:"gaby.fuentes@gmail.com", phone:"+52 33 1845 9921", code:"GABY26",
};
const CURRENT_CASE = {
  status:"ACTIVE", currentPhase:"LEVELING",
  startedAt:"2025-09-08", estimatedEnd:"2027-03-15",
  monthNow:7, monthTotal:18,
  compliance:82, complianceDelta:+4,
  nextAppt:"Vie 22 nov Â· 10:30",
  currentArch:".016 NiTi",
  doctor:"Dr. Rafael MÃ©ndez",
};
const PHASES = [
  {k:"ALIGNMENT", l:"AlineaciÃ³n"}, {k:"LEVELING", l:"NivelaciÃ³n"},
  {k:"SPACE_CLOSE", l:"Cierre"}, {k:"DETAIL", l:"Detalles"},
  {k:"FINISHING", l:"FinalizaciÃ³n"}, {k:"RETENTION", l:"RetenciÃ³n"},
];
const ARCHES = [
  {n:1, phase:"ALIGNMENT", material:"NITI", gauge:".014", dur:6, status:"PAST"},
  {n:2, phase:"ALIGNMENT", material:"NITI", gauge:".016", dur:8, status:"PAST"},
  {n:3, phase:"LEVELING", material:"NITI", gauge:".016", dur:10, status:"CURRENT"},
  {n:4, phase:"LEVELING", material:"SS", gauge:".018", dur:8, status:"FUTURE"},
  {n:5, phase:"SPACE_CLOSE", l:"Cierre", material:"SS", gauge:".019 x .025", dur:12, status:"FUTURE"},
  {n:6, phase:"DETAIL", material:"TMA", gauge:".017 x .025", dur:8, status:"FUTURE"},
  {n:7, phase:"FINISHING", material:"BETA_TI", gauge:".019 x .025", dur:6, status:"FUTURE"},
];
const SECTIONS = [
  {k:"resumen", l:"Resumen", ic:"layoutdash"},
  {k:"expediente", l:"Expediente clÃ­nico", ic:"clip"},
  {k:"fotos", l:"Fotos & Rx", ic:"cam"},
  {k:"plan", l:"Plan de tratamiento", ic:"filebar"},
  {k:"citas", l:"Citas & evoluciÃ³n", ic:"calheart"},
  {k:"financiero", l:"Plan financiero", ic:"wallet"},
  {k:"retencion", l:"RetenciÃ³n", ic:"shieldcheck"},
  {k:"documentos", l:"Documentos", ic:"folder"},
];

// FDI dentition (32 teeth)
const FDI_UPPER_R = [18,17,16,15,14,13,12,11];
const FDI_UPPER_L = [21,22,23,24,25,26,27,28];
const FDI_LOWER_L = [38,37,36,35,34,33,32,31];
const FDI_LOWER_R = [41,42,43,44,45,46,47,48];

const PHOTO_KINDS_EXTRA = [
  {k:"EXTRA_FRONTAL_REST", l:"Frontal natural"},
  {k:"EXTRA_FRONTAL_SMILE", l:"Frontal sonrisa"},
  {k:"EXTRA_LAT34", l:"3/4 derecho"},
  {k:"EXTRA_PROFILE_R", l:"Perfil derecho"},
  {k:"EXTRA_PROFILE_L", l:"Perfil izquierdo"},
];
const PHOTO_KINDS_INTRA = [
  {k:"INTRA_FRONT", l:"Frontal oclusiÃ³n"},
  {k:"INTRA_LAT_R", l:"Lateral derecha"},
  {k:"INTRA_LAT_L", l:"Lateral izquierda"},
  {k:"INTRA_OCCL_UP", l:"Oclusal superior"},
  {k:"INTRA_OCCL_LO", l:"Oclusal inferior"},
  {k:"INTRA_OVERJET", l:"Sobremordida"},
];

const TX_CARDS = [
  {n:7, date:"15 Oct 2025", type:"CONTROL", arch:".016 NiTi", elastics:"II Â· 12h", comp:82, soap:{s:"Refiere ligera molestia 2-3 dÃ­as post-control previo.",o:"Higiene buena. Bracket 24 desprendido el lunes.",a:"Progreso adecuado en alineaciÃ³n.",p:"Recolocar 24. Continuar con .016 NiTi 4 sem mÃ¡s."}, signed:true},
  {n:6, date:"17 Sep 2025", type:"CONTROL", arch:".014 NiTi", elastics:"II Â· 12h", comp:78, signed:true},
  {n:5, date:"22 Aug 2025", type:"EMERGENCY", arch:".014 NiTi", elastics:"â€”", comp:null, signed:true, note:"Bracket caÃ­do #34"},
  {n:4, date:"15 Aug 2025", type:"CONTROL", arch:".014 NiTi", elastics:"II Â· 12h", comp:88, signed:true},
  {n:3, date:"18 Jul 2025", type:"INSTALLATION", arch:".014 NiTi", elastics:"â€”", comp:null, signed:true},
  {n:2, date:"02 Jul 2025", type:"FOLLOWUP", note:"AceptaciÃ³n plan", signed:true},
  {n:1, date:"15 Jun 2025", type:"FOLLOWUP", note:"Primera consulta", signed:true},
];

const INSTALLMENTS = Array.from({length:18}, (_,i)=>{
  const status = i<6 ? "PAID" : i===6 ? "PENDING" : i===7 ? "PENDING" : "FUTURE";
  return {n:i+1, amount:1840, due:`DÃ­a ${8} Â· M${i+1}`, status, cfdi: status==="PAID"};
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• ATOM 1: PatientHeader â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function PatientHeader({onCmd}){
  return (
    <div className="card" style={{padding:"18px 22px", display:"flex", alignItems:"center", gap:18, borderRadius:16}}>
      <Avatar size={64} name={PATIENT.name} color={PATIENT.color}/>
      <div style={{flex:1, minWidth:0}}>
        <div style={{display:"flex", alignItems:"center", gap:10, marginBottom:4}}>
          <h1 style={{fontSize:22, fontWeight:600, letterSpacing:"-0.015em", lineHeight:1.15}}>{PATIENT.name}</h1>
          <span className="b b-success"><I n="check" size={11}/>Activo</span>
          <span className="b b-violet">Caso ortodÃ³ntico</span>
        </div>
        <div style={{display:"flex", alignItems:"center", gap:14, fontSize:12, color:"var(--text-3)"}}>
          <span className="mono">{PATIENT.caseCode}</span>
          <span>Â·</span>
          <span>{PATIENT.age} aÃ±os Â· {PATIENT.sex}</span>
          <span>Â·</span>
          <span>{PATIENT.phone}</span>
          <span>Â·</span>
          <span>Dr. Rafael MÃ©ndez</span>
        </div>
      </div>
      <div style={{display:"flex", gap:6}}>
        <button className="btn-new btn-new--ghost" onClick={()=>onCmd("edit-patient")}><I n="pencil"/>Editar</button>
        <button className="btn-new btn-new--ghost btn-icon"><I n="more"/></button>
        <button className="btn-new btn-new--ghost" onClick={()=>onCmd("new-note")}><I n="note"/>Nota</button>
        <button className="btn-new btn-new--ghost"><I n="globe"/>Portal</button>
        <button className="btn-new btn-new--primary"><I n="calplus"/>Agendar cita</button>
      </div>
    </div>
  );
}

// Avatar atom (used in header + small refs)
function Avatar({size=64, name, color="#5da3f8"}){
  const initials = name.split(" ").slice(0,2).map(s=>s[0]).join("").toUpperCase();
  return (
    <div style={{width:size,height:size,borderRadius:"50%",background:`linear-gradient(135deg, ${color}, ${color}aa)`,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:600,fontSize:size*0.36,fontFamily:"'Sora',sans-serif",letterSpacing:"-0.02em",flex:"0 0 auto",boxShadow:"inset 0 -2px 6px rgba(0,0,0,.15)"}}>{initials}</div>
  );
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• ATOM 2: StatCardKPI â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function StatCardKPI({label, value, delta, icon, sub, accent}){
  return (
    <div className="kpi" style={accent?{borderColor:"var(--brand-500)", boxShadow:"var(--shadow-glow-brand)"}:{}}>
      <div style={{display:"flex", alignItems:"center", justifyContent:"space-between"}}>
        <span className="kpi-label">{label}</span>
        {icon && <span style={{color:"var(--text-3)"}}><I n={icon} size={14}/></span>}
      </div>
      <span className="kpi-value">{value}</span>
      <div style={{display:"flex",alignItems:"center",gap:8,fontSize:11}}>
        {delta!=null && <span className={"kpi-delta "+(delta>0?"kpi-delta-pos":delta<0?"kpi-delta-neg":"")}>{delta>0?"â–²":delta<0?"â–¼":"Â·"} {Math.abs(delta)}%</span>}
        {sub && <span style={{color:"var(--text-3)",fontFamily:"'JetBrains Mono',monospace"}}>{sub}</span>}
      </div>
    </div>
  );
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• ATOM 3: ApplianceBadge â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function ApplianceBadge({code, on, onClick}){
  const map = {
    brackets_metal:{l:"MetÃ¡licos", c:"b-neutral"},
    damon:{l:"Damon (auto.)", c:"b-info"},
    cer:{l:"CerÃ¡mica", c:"b-violet"},
    invisalign:{l:"Invisalign", c:"b-brand"},
    clearcorrect:{l:"ClearCorrect", c:"b-brand"},
    rpe:{l:"RPE Hyrax", c:"b-warn"},
    quad:{l:"Quad-Helix", c:"b-warn"},
  };
  const m = map[code] || {l:code, c:"b-neutral"};
  return (
    <button onClick={onClick} className="chip-sel" data-on={on?"true":"false"} style={{fontFamily:"'Sora',sans-serif"}}>
      <span className="dot" style={{background: on?"#fff":"var(--brand-500)"}}/>{m.l}
    </button>
  );
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• ATOM 4: ToothPicker â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function ToothPicker({selected=[], onToggle, mode="select", interproxOk=false, size="md"}){
  const SZ = size==="sm" ? 22 : 28;
  const F = SZ*0.4;
  function Tooth({n}){
    const on = selected.includes(n);
    return (
      <button onClick={()=>onToggle && onToggle(n)}
        style={{width:SZ,height:SZ+4,borderRadius:6,
          background:on?"var(--brand-500)":"var(--bg-elev)",
          color:on?"#fff":"var(--text-2)",
          border:"1px solid "+(on?"var(--brand-600)":"var(--border-soft)"),
          fontSize:F,fontWeight:500,fontFamily:"'JetBrains Mono',monospace",
          cursor:"pointer",transition:"all .08s",lineHeight:1,
          boxShadow:on?"0 0 12px var(--violet-500)":"none"}}>{n}</button>
    );
  }
  return (
    <div style={{display:"flex",flexDirection:"column",gap:4,alignItems:"center"}}>
      <div style={{display:"flex",gap:3,alignItems:"center"}}>
        <span className="mono" style={{fontSize:9,color:"var(--text-3)",width:18,textAlign:"right"}}>R</span>
        {FDI_UPPER_R.map(n=><Tooth key={n} n={n}/>)}
        <div style={{width:8}}/>
        {FDI_UPPER_L.map(n=><Tooth key={n} n={n}/>)}
        <span className="mono" style={{fontSize:9,color:"var(--text-3)",width:18}}>L</span>
      </div>
      <div style={{height:1,width:"95%",background:"var(--border-soft)"}}/>
      <div style={{display:"flex",gap:3,alignItems:"center"}}>
        <span className="mono" style={{fontSize:9,color:"var(--text-3)",width:18,textAlign:"right"}}>R</span>
        {FDI_LOWER_R.map(n=><Tooth key={n} n={n}/>)}
        <div style={{width:8}}/>
        {FDI_LOWER_L.map(n=><Tooth key={n} n={n}/>)}
        <span className="mono" style={{fontSize:9,color:"var(--text-3)",width:18}}>L</span>
      </div>
    </div>
  );
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• ATOM 5: PhotoSetCard â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function PhotoSetCard({stage, count, total, date, onClick, active}){
  return (
    <button onClick={onClick}
      style={{textAlign:"left",padding:"10px 14px",borderRadius:10,
        background:active?"var(--brand-500)":"var(--bg-elev-2)",
        color:active?"#fff":"var(--text-1)",
        border:"1px solid "+(active?"var(--brand-600)":"var(--border-soft)"),
        cursor:"pointer",display:"flex",alignItems:"center",gap:10,fontFamily:"inherit",
        boxShadow:active?"0 0 18px var(--violet-500)":"none",transition:"all .1s"}}>
      <span className="mono" style={{fontWeight:600,fontSize:14}}>{stage}</span>
      <div style={{display:"flex",flexDirection:"column",gap:1}}>
        <span style={{fontSize:11,opacity:.8}}>{date}</span>
        <span className="mono" style={{fontSize:10,opacity:.7}}>{count}/{total} fotos</span>
      </div>
    </button>
  );
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• ATOM 6: WireStepRow â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function WireStepRow({arch, onAct}){
  const statusMap = {
    PAST:{l:"Pasado", c:"b-neutral"},
    CURRENT:{l:"â— Actual", c:"b-brand"},
    FUTURE:{l:"Futuro", c:"b-neutral"},
    SKIPPED:{l:"Saltado", c:"b-warn"},
  };
  const phaseLabel = PHASES.find(p=>p.k===arch.phase)?.l;
  const mat = {NITI:"NiTi", SS:"SS", TMA:"TMA", BETA_TI:"Î²-Ti", ESTHETIC:"EstÃ©tico"}[arch.material];
  return (
    <div style={{display:"grid",gridTemplateColumns:"24px 30px 110px 60px 110px 60px auto",alignItems:"center",gap:10,padding:"9px 12px",borderBottom:"1px solid var(--border-soft)",background:arch.status==="CURRENT"?"var(--brand-50)":"transparent"}}>
      <button style={{color:"var(--text-3)",background:"none",border:"none",cursor:"grab"}}><I n="grip"/></button>
      <span className="mono" style={{fontWeight:600,color:arch.status==="CURRENT"?"var(--brand-700)":"var(--text-1)"}}>{arch.n}</span>
      <span style={{fontSize:13,color:"var(--text-1)"}}>{phaseLabel}</span>
      <span className="mono" style={{fontSize:12,color:"var(--text-2)"}}>{mat}</span>
      <span className="mono" style={{fontSize:12,color:"var(--text-1)",fontWeight:500}}>{arch.gauge}</span>
      <span className="mono" style={{fontSize:11,color:"var(--text-3)"}}>{arch.dur} sem</span>
      <div style={{display:"flex",gap:6,justifyContent:"flex-end"}}>
        <span className={"b "+statusMap[arch.status].c}>{statusMap[arch.status].l}</span>
        <button className="btn-new btn-new--ghost btn-icon btn-sm"><I n="pencil" size={12}/></button>
        <button className="btn-new btn-new--ghost btn-icon btn-sm" style={{color:"var(--danger)"}}><I n="trash" size={12}/></button>
      </div>
    </div>
  );
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• ATOM 7: InstallmentChip â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function InstallmentChip({inst, onClick}){
  const map = {
    PAID:{bg:"var(--success-bg)",fg:"var(--success)",icon:"check",l:"Pagado"},
    PENDING:{bg:"var(--warning-bg)",fg:"var(--warning)",icon:"alertCircle",l:"Pendiente"},
    FUTURE:{bg:"transparent",fg:"var(--text-3)",icon:"circle",l:"Futuro"},
    OVERDUE:{bg:"var(--danger-bg)",fg:"var(--danger)",icon:"alertCircle",l:"Vencido"},
  };
  const s = map[inst.status];
  return (
    <button onClick={onClick} className="card" style={{
      padding:"10px 12px",minWidth:96,display:"flex",flexDirection:"column",gap:3,cursor:"pointer",
      background:s.bg,border:"1px solid "+(inst.status==="FUTURE"?"var(--border-soft)":"transparent"),
      fontFamily:"inherit",textAlign:"left",
    }}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <span className="mono" style={{fontSize:10,fontWeight:600,color:s.fg}}>M{inst.n}</span>
        <span style={{color:s.fg}}><I n={s.icon} size={10}/></span>
      </div>
      <span className="mono" style={{fontSize:13,fontWeight:600,color:"var(--text-1)"}}>${inst.amount.toLocaleString()}</span>
      <span style={{fontSize:9,color:"var(--text-3)",fontFamily:"'JetBrains Mono',monospace"}}>{inst.due}</span>
      {inst.cfdi && <span className="mono" style={{fontSize:9,color:"var(--success)"}}>CFDI âœ“</span>}
    </button>
  );
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• ATOM 8: TreatmentCard â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function TreatmentCard({card, expanded, onToggle, onEdit, onPrint}){
  const typeMap = {
    INSTALLATION:{l:"InstalaciÃ³n", c:"b-violet"},
    CONTROL:{l:"Control mensual", c:"b-brand"},
    EMERGENCY:{l:"Urgencia", c:"b-warn"},
    DEBONDING:{l:"Debonding", c:"b-success"},
    RETAINER_FIT:{l:"Coloc. retenedor", c:"b-info"},
    FOLLOWUP:{l:"Seguimiento", c:"b-neutral"},
  };
  const t = typeMap[card.type];
  return (
    <div className="card" style={{padding:"14px 16px"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer"}} onClick={onToggle}>
        <span className="mono" style={{fontSize:11,color:"var(--text-3)",fontWeight:500,width:24}}>#{card.n}</span>
        <span className={"b "+t.c}>{t.l}</span>
        <span style={{fontSize:12,color:"var(--text-2)"}}>{card.date}</span>
        {card.arch && <span className="mono" style={{fontSize:11,color:"var(--text-2)"}}>{card.arch}</span>}
        {card.elastics && card.elastics!=="â€”" && <span className="b b-neutral" style={{fontSize:10}}>ElÃ¡st {card.elastics}</span>}
        {card.comp!=null && <span className={"b "+(card.comp>=80?"b-success":card.comp>=60?"b-warn":"b-danger")} style={{fontSize:10}}>{card.comp}%</span>}
        <div style={{flex:1}}/>
        {card.note && <span style={{fontSize:11,color:"var(--text-3)",fontStyle:"italic"}}>{card.note}</span>}
        {card.signed && <span style={{color:"var(--success)"}} title="Firmado"><I n="check" size={12}/></span>}
        <I n={expanded?"chevdown":"chevright"} size={14} cls=""/>
      </div>
      {expanded && card.soap && (
        <div style={{marginTop:12,paddingTop:12,borderTop:"1px solid var(--border-soft)",display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
          {[["S","Subjetivo",card.soap.s,"msg"],["O","Objetivo",card.soap.o,"eye"],["A","AnÃ¡lisis",card.soap.a,"microsope"],["P","Plan",card.soap.p,"listcheck"]].map(([k,l,v,ic])=>(
            <div key={k}>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}>
                <span className="mono" style={{fontSize:10,fontWeight:600,color:"var(--brand-500)",width:14}}>{k}</span>
                <span className="h-eyebrow">{l}</span>
              </div>
              <p style={{fontSize:12,color:"var(--text-2)",paddingLeft:20}}>{v}</p>
            </div>
          ))}
          <div style={{gridColumn:"span 2",display:"flex",gap:6,justifyContent:"flex-end",marginTop:4}}>
            <button className="btn-new btn-new--ghost btn-sm" onClick={onPrint}><I n="printer" size={12}/>Imprimir indicaciones</button>
            <button className="btn-new btn-new--ghost btn-sm" onClick={onEdit}><I n="pencil" size={12}/>Editar</button>
          </div>
        </div>
      )}
    </div>
  );
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• ATOM 9: IPRSlot â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function IPRSlot({label, planned, done, status}){
  const colorMap = {PENDING:"var(--text-3)", PARTIAL:"var(--warning)", DONE:"var(--success)"};
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2,minWidth:36,padding:"4px 2px",borderRadius:6,background:"var(--bg-elev-2)",border:"1px solid var(--border-soft)",cursor:"pointer"}}>
      <span className="mono" style={{fontSize:9,color:"var(--text-3)"}}>{label}</span>
      <span className="mono" style={{fontSize:11,fontWeight:600,color:colorMap[status]}}>{done?`${done}/${planned}`:planned}</span>
      <span style={{width:18,height:2,borderRadius:2,background:colorMap[status]}}/>
    </div>
  );
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• ATOM 10: ComparisonSlider â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function ComparisonSlider({a, b, label}){
  const [pct, setPct] = useState(50);
  return (
    <div style={{position:"relative",aspectRatio:"4/3",borderRadius:10,overflow:"hidden",background:"#000",border:"1px solid var(--border-soft)",cursor:"ew-resize",userSelect:"none"}}
      onMouseMove={e=>{
        if(e.buttons!==1) return;
        const r=e.currentTarget.getBoundingClientRect();
        setPct(Math.max(0, Math.min(100, ((e.clientX-r.left)/r.width)*100)));
      }}>
      <PhotoTile kind={b} stage="T1" full/>
      <div style={{position:"absolute",inset:0,clipPath:`inset(0 ${100-pct}% 0 0)`}}>
        <PhotoTile kind={a} stage="T0" full/>
      </div>
      <div style={{position:"absolute",top:0,bottom:0,left:`${pct}%`,width:3,background:"#fff",boxShadow:"0 0 20px rgba(0,0,0,.7)"}}/>
      <div style={{position:"absolute",top:"50%",left:`${pct}%`,transform:"translate(-50%,-50%)",width:32,height:32,borderRadius:"50%",background:"#fff",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 4px 12px rgba(0,0,0,.4)"}}>
        <I n="movehor" size={14}/>
      </div>
      <span style={{position:"absolute",top:10,left:12,padding:"3px 8px",background:"rgba(0,0,0,.6)",color:"#fff",fontSize:11,borderRadius:6,fontFamily:"'JetBrains Mono',monospace"}}>T0 Â· 15 jun</span>
      <span style={{position:"absolute",top:10,right:12,padding:"3px 8px",background:"rgba(0,0,0,.6)",color:"#fff",fontSize:11,borderRadius:6,fontFamily:"'JetBrains Mono',monospace"}}>T1 Â· 15 oct</span>
    </div>
  );
}

// Placeholder photo tile
function PhotoTile({kind, stage, full, empty, onClick, onAct, fav}){
  const hue = (kind||"").charCodeAt(0)*7%360;
  if(empty){
    return (
      <button onClick={onClick} style={{
        width:"100%",aspectRatio:"4/3",borderRadius:8,border:"1.5px dashed var(--border-default)",
        background:"var(--bg-elev-2)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:4,
        cursor:"pointer",fontFamily:"inherit",color:"var(--text-3)"}}>
        <I n="imageplus" size={20}/>
        <span style={{fontSize:11}}>+ subir</span>
      </button>
    );
  }
  return (
    <div onClick={onClick} style={{
      width:"100%", height: full?"100%":"auto", aspectRatio: full?undefined:"4/3", borderRadius: full?0:8,
      background:`linear-gradient(135deg, hsl(${hue} 40% 35%), hsl(${(hue+40)%360} 50% 25%))`,
      position:"relative", overflow:"hidden", cursor:"pointer", border: full?"none":"1px solid var(--border-soft)"
    }}>
      {/* placeholder face */}
      <svg viewBox="0 0 100 75" style={{width:"100%",height:"100%",opacity:0.45}}>
        <ellipse cx="50" cy="40" rx="22" ry="28" fill="rgba(255,255,255,.18)"/>
        <ellipse cx="50" cy="50" rx="14" ry="6" fill="rgba(255,255,255,.1)"/>
        <rect x="40" y="48" width="20" height="4" fill="rgba(255,255,255,.4)" rx="1"/>
      </svg>
      {!full && (
        <div style={{position:"absolute",bottom:0,left:0,right:0,padding:"4px 8px",background:"linear-gradient(to top, rgba(0,0,0,.7), transparent)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontSize:10,color:"#fff",fontFamily:"'JetBrains Mono',monospace"}}>{stage}</span>
          {fav && <span style={{color:"#fbbf24"}}><I n="star" size={12}/></span>}
        </div>
      )}
      {!full && onAct && (
        <div style={{position:"absolute",top:6,right:6,display:"flex",gap:3,opacity:0.85}}>
          <button onClick={e=>{e.stopPropagation();onAct("expand")}} style={{width:22,height:22,borderRadius:6,background:"rgba(0,0,0,.55)",border:"none",color:"#fff",cursor:"pointer"}}><I n="search" size={11}/></button>
          <button onClick={e=>{e.stopPropagation();onAct("annotate")}} style={{width:22,height:22,borderRadius:6,background:"rgba(0,0,0,.55)",border:"none",color:"#fff",cursor:"pointer"}}><I n="pen" size={11}/></button>
        </div>
      )}
    </div>
  );
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• COLLAPSIBLE CARD â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function Collapsible({title, icon, summary, defaultOpen=true, children, badge}){
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card" style={{padding:"14px 18px"}}>
      <div onClick={()=>setOpen(!open)} style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer"}}>
        {icon && <span style={{color:"var(--text-3)"}}><I n={icon} size={15}/></span>}
        <h3 className="h-card">{title}</h3>
        {badge && <span className="b b-neutral">{badge}</span>}
        <div style={{flex:1}}/>
        {summary && <span style={{fontSize:12,color:"var(--text-3)"}}>{summary}</span>}
        <I n={open?"chevdown":"chevright"} size={14}/>
      </div>
      {open && <div style={{marginTop:14,paddingTop:14,borderTop:"1px solid var(--border-soft)"}}>{children}</div>}
    </div>
  );
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• SUB-SIDEBAR â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function SubSidebar({active, onChange}){
  return (
    <nav style={{display:"flex",flexDirection:"column",gap:2,padding:8}}>
      <div style={{padding:"8px 12px 14px",borderBottom:"1px solid var(--border-soft)",marginBottom:8}}>
        <div className="h-eyebrow">MÃ³dulo</div>
        <div style={{display:"flex",alignItems:"center",gap:6,marginTop:4}}>
          <span style={{width:22,height:22,borderRadius:6,background:"linear-gradient(135deg, var(--violet-500), var(--brand-500))",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff"}}><I n="shieldcheck" size={12}/></span>
          <span style={{fontSize:13,fontWeight:600}}>Ortodoncia</span>
        </div>
      </div>
      {SECTIONS.map(s=>(
        <button key={s.k} onClick={()=>onChange(s.k)}
          style={{display:"flex",alignItems:"center",gap:9,padding:"8px 12px",borderRadius:9,
            background:active===s.k?"var(--brand-50)":"transparent",
            color:active===s.k?"var(--brand-700)":"var(--text-2)",
            border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:active===s.k?500:400,textAlign:"left",
            boxShadow:active===s.k?"inset 2px 0 0 var(--brand-500)":"none",transition:"all .1s"}}>
          <I n={s.ic} size={15}/>
          <span>{s.l}</span>
        </button>
      ))}
      <div style={{padding:"14px 12px 8px",borderTop:"1px solid var(--border-soft)",marginTop:12}}>
        <div className="h-eyebrow" style={{marginBottom:6}}>Atajos</div>
        <div style={{display:"flex",flexDirection:"column",gap:3,fontSize:11,color:"var(--text-3)",fontFamily:"'JetBrains Mono',monospace"}}>
          <div style={{display:"flex",justifyContent:"space-between"}}><span>+ TC</span><kbd>N</kbd></div>
          <div style={{display:"flex",justifyContent:"space-between"}}><span>+ Foto</span><kbd>F</kbd></div>
          <div style={{display:"flex",justifyContent:"space-between"}}><span>Cobrar</span><kbd>C</kbd></div>
          <div style={{display:"flex",justifyContent:"space-between"}}><span>? ayuda</span><kbd>?</kbd></div>
        </div>
      </div>
    </nav>
  );
}

window.OrthoCommon = { I, ICONS, ic, PATIENT, CURRENT_CASE, PHASES, ARCHES, SECTIONS, PHOTO_KINDS_EXTRA, PHOTO_KINDS_INTRA, TX_CARDS, INSTALLMENTS, FDI_UPPER_R, FDI_UPPER_L, FDI_LOWER_L, FDI_LOWER_R };
window.OrthoAtoms = { Avatar, PatientHeader, StatCardKPI, ApplianceBadge, ToothPicker, PhotoSetCard, WireStepRow, InstallmentChip, TreatmentCard, IPRSlot, ComparisonSlider, PhotoTile, Collapsible, SubSidebar };
