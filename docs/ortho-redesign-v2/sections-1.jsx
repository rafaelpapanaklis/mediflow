/* eslint-disable */
// â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
// â•‘ MediFlow Orto Â· 7 secciones + drawers/modales                        â•‘
// â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

const { I, PATIENT, CURRENT_CASE, PHASES, ARCHES, PHOTO_KINDS_EXTRA, PHOTO_KINDS_INTRA, TX_CARDS, INSTALLMENTS } = window.OrthoCommon;
const { Avatar, StatCardKPI, ApplianceBadge, ToothPicker, PhotoSetCard, WireStepRow, InstallmentChip, TreatmentCard, IPRSlot, ComparisonSlider, PhotoTile, Collapsible } = window.OrthoAtoms;
const { useState, useMemo } = React;

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SECTION 1 Â· RESUMEN
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function SecResumen({onCmd, macroState}){
  // macroState: NEW / EVAL / ACCEPTED / ACTIVE / RETENTION / COMPLETED
  if(macroState==="NEW"){
    return (
      <div style={{display:"flex",flexDirection:"column",gap:18}}>
        <div className="card" style={{padding:"48px 32px",textAlign:"center",borderStyle:"dashed"}}>
          <div style={{width:64,height:64,borderRadius:16,background:"var(--violet-bg)",color:"var(--violet-500)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 14px"}}>
            <I n="sparkles" size={28}/>
          </div>
          <h2 className="h-section" style={{marginBottom:6}}>Caso ortodÃ³ntico nuevo</h2>
          <p style={{fontSize:13,color:"var(--text-2)",maxWidth:480,margin:"0 auto 18px"}}>
            AÃºn no se ha iniciado un expediente para este paciente. Empieza por donde el caso lo pida â€”no hay orden obligatorio.
          </p>
          <div style={{display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap"}}>
            <button className="btn-new btn-new--primary" onClick={()=>onCmd("nav-expediente")}><I n="clip"/>Capturar diagnÃ³stico</button>
            <button className="btn-new btn-new--ghost" onClick={()=>onCmd("nav-fotos")}><I n="cam"/>Subir foto-set T0</button>
            <button className="btn-new btn-new--ghost" onClick={()=>onCmd("nav-plan")}><I n="template"/>Cargar plantilla</button>
            <button className="btn-new btn-new--ghost" onClick={()=>onCmd("nav-financiero")}><I n="wallet"/>Plan financiero</button>
          </div>
        </div>
        <MacroStateLegend current="NEW"/>
      </div>
    );
  }

  return (
    <div style={{display:"flex",flexDirection:"column",gap:18}}>
      {/* hero KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4, 1fr)",gap:12}}>
        <StatCardKPI label="Fase actual" value="NivelaciÃ³n" sub="Arco 3 de 7" icon="layers" accent/>
        <StatCardKPI label="Arco colocado" value=".016 NiTi" sub="Sem 6 de 10" icon="wand"/>
        <StatCardKPI label="Compliance" value="82%" delta={4} sub="elÃ¡st + asist" icon="trending"/>
        <StatCardKPI label="Plan financiero" value="7/18" sub="$1,840 Â· dÃ­a 8" icon="wallet"/>
      </div>

      {/* fase stepper */}
      <div className="card" style={{padding:"14px 18px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
          <h3 className="h-card">Progreso por fase</h3>
          <span style={{fontSize:11,color:"var(--text-3)",fontFamily:"'JetBrains Mono',monospace"}}>14 sem completadas Â· 38 estimadas</span>
        </div>
        <div style={{display:"flex",gap:6}}>
          {PHASES.map((p,i)=>{
            const idx = PHASES.findIndex(x=>x.k==="LEVELING");
            const state = i<idx ? "done" : i===idx ? "current" : "future";
            return (
              <div key={p.k} style={{flex:1,padding:"10px 12px",borderRadius:9,
                background: state==="done"?"var(--success-bg)":state==="current"?"var(--brand-50)":"var(--bg-elev-2)",
                border: "1px solid "+(state==="current"?"var(--brand-500)":"var(--border-soft)"),
                boxShadow: state==="current"?"0 0 16px var(--violet-500)":"none"}}>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <span style={{width:18,height:18,borderRadius:"50%",background:state==="done"?"var(--success)":state==="current"?"var(--brand-500)":"var(--neutral-bg)",color:state==="future"?"var(--text-3)":"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:600,fontFamily:"'JetBrains Mono',monospace"}}>{i+1}</span>
                  <span style={{fontSize:12,fontWeight:500}}>{p.l}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* quick actions */}
      <div className="card" style={{padding:"14px 18px"}}>
        <h3 className="h-card" style={{marginBottom:10}}>Acciones rÃ¡pidas</h3>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
          <QuickAction icon="calplus" label="Registrar cita hoy" sub="N" onClick={()=>onCmd("drawer-new-tc")}/>
          <QuickAction icon="cam" label="Subir foto-set" sub="F" onClick={()=>onCmd("drawer-upload-photos")}/>
          <QuickAction icon="arrowright" label="Avanzar al arco siguiente" sub="A" onClick={()=>onCmd("advance-arch")}/>
          <QuickAction icon="dollar" label="Cobrar prÃ³xima Â· $1,840" sub="C" onClick={()=>onCmd("drawer-collect")}/>
        </div>
      </div>

      {/* summary cards */}
      <div style={{display:"grid",gridTemplateColumns:"1.3fr 1fr",gap:14}}>
        <div className="card" style={{padding:"14px 18px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
            <h3 className="h-card">DiagnÃ³stico â€” resumen</h3>
            <button className="btn-new btn-new--ghost btn-sm" onClick={()=>onCmd("nav-expediente")}>Ver completo <I n="chevright" size={11}/></button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,fontSize:12}}>
            <div><div className="h-eyebrow">Clase Angle</div><div style={{fontWeight:500,marginTop:2}}>Clase II Div 1</div></div>
            <div><div className="h-eyebrow">Resalte</div><div style={{fontWeight:500,marginTop:2,fontFamily:"'JetBrains Mono',monospace"}}>6 mm</div></div>
            <div><div className="h-eyebrow">Sobremordida</div><div style={{fontWeight:500,marginTop:2,fontFamily:"'JetBrains Mono',monospace"}}>4 mm</div></div>
            <div><div className="h-eyebrow">ApiÃ±. maxilar</div><div style={{fontWeight:500,marginTop:2,fontFamily:"'JetBrains Mono',monospace"}}>3 mm</div></div>
            <div><div className="h-eyebrow">ApiÃ±. mandibular</div><div style={{fontWeight:500,marginTop:2,fontFamily:"'JetBrains Mono',monospace"}}>5 mm</div></div>
            <div><div className="h-eyebrow">PatrÃ³n skeletal</div><div style={{fontWeight:500,marginTop:2}}>Mesofacial</div></div>
          </div>
        </div>
        <div className="card" style={{padding:"14px 18px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
            <h3 className="h-card">Ãšltima cita Â· #7</h3>
            <button className="btn-new btn-new--ghost btn-sm" onClick={()=>onCmd("nav-citas")}>Ver <I n="chevright" size={11}/></button>
          </div>
          <div style={{fontSize:12,display:"flex",flexDirection:"column",gap:6}}>
            <div style={{display:"flex",gap:8}}><span className="b b-brand">Control mensual</span><span className="mono" style={{color:"var(--text-3)"}}>15 oct 2025</span></div>
            <p style={{color:"var(--text-2)"}}>Bracket 24 recolocado. Continuar .016 NiTi 4 sem mÃ¡s. Compliance elÃ¡st 82%.</p>
            <div style={{display:"flex",gap:6,marginTop:4}}>
              <span className="b b-neutral" style={{fontSize:10}}>PrÃ³x: 12 nov Â· 10:30</span>
            </div>
          </div>
        </div>
      </div>

      <MacroStateLegend current={macroState}/>
    </div>
  );
}

function QuickAction({icon, label, sub, onClick}){
  return (
    <button onClick={onClick} className="card" style={{padding:"14px 12px",display:"flex",flexDirection:"column",gap:6,alignItems:"flex-start",cursor:"pointer",fontFamily:"inherit",textAlign:"left",border:"1px solid var(--border-soft)"}}>
      <span style={{width:30,height:30,borderRadius:8,background:"var(--brand-50)",color:"var(--brand-700)",display:"flex",alignItems:"center",justifyContent:"center"}}><I n={icon} size={15}/></span>
      <span style={{fontSize:12,fontWeight:500}}>{label}</span>
      <span className="mono" style={{fontSize:10,color:"var(--text-3)"}}>tecla {sub}</span>
    </button>
  );
}

function MacroStateLegend({current}){
  const STATES = [
    {k:"NEW", l:"Paciente nuevo", d:"Sin diagnÃ³stico ni plan", c:"b-neutral"},
    {k:"EVAL", l:"En evaluaciÃ³n", d:"Dx + fotos T0, sin plan firmado", c:"b-info"},
    {k:"ACCEPTED", l:"Plan aceptado", d:"Plan firmado, sin instalaciÃ³n", c:"b-violet"},
    {k:"ACTIVE", l:"En tratamiento", d:"Brackets instalados", c:"b-brand"},
    {k:"RETENTION", l:"RetenciÃ³n", d:"Post-debond, controles", c:"b-warn"},
    {k:"COMPLETED", l:"Completado", d:"3y+ post-debond", c:"b-success"},
  ];
  return (
    <div className="card" style={{padding:"12px 16px",background:"var(--bg-elev-2)"}}>
      <div className="h-eyebrow" style={{marginBottom:8}}>Estado macro del caso Â· 6 estados</div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
        {STATES.map(s=>(
          <span key={s.k} className={"b "+s.c} style={{fontSize:11,padding:"4px 10px",opacity:current===s.k?1:0.45,outline:current===s.k?"1px solid var(--brand-500)":"none",outlineOffset:2}}>
            <strong>{s.l}</strong> Â· {s.d}
          </span>
        ))}
      </div>
    </div>
  );
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SECTION 2 Â· EXPEDIENTE CLÃNICO
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function SecExpediente({onCmd, empty}){
  const [angle, setAngle] = useState("II_DIV1");
  const [openBite, setOpenBite] = useState("NONE");
  const [crossBite, setCrossBite] = useState("NONE");
  const [profile, setProfile] = useState("CONVEX");
  const [skel, setSkel] = useState("MESO");
  const [habits, setHabits] = useState(["resp_bucal","bruxismo"]);
  const [skelIssues, setSkelIssues] = useState(["Clase II esqueletal leve"]);
  const [tmj, setTmj] = useState({noise:true,pain:false});

  if(empty){
    return (
      <div className="card" style={{padding:"56px 32px",textAlign:"center",borderStyle:"dashed"}}>
        <I n="clip" size={36}/>
        <h2 className="h-section" style={{marginTop:12}}>Sin diagnÃ³stico capturado</h2>
        <p style={{fontSize:13,color:"var(--text-2)",maxWidth:420,margin:"6px auto 18px"}}>Captura la clasificaciÃ³n de Angle y los hallazgos clÃ­nicos para alimentar el plan de tratamiento.</p>
        <button className="btn-new btn-new--primary" onClick={()=>onCmd("drawer-edit-dx")}><I n="pencil"/>Capturar diagnÃ³stico</button>
      </div>
    );
  }

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      {/* header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <h2 className="h-section">Expediente clÃ­nico ortodÃ³ntico</h2>
          <p style={{fontSize:12,color:"var(--text-3)",marginTop:2}}>DiagnÃ³stico estructurado Â· alimenta plan de tratamiento</p>
        </div>
        <div style={{display:"flex",gap:6}}>
          <button className="btn-new btn-new--ghost btn-sm"><I n="chevsdown" size={12}/>Expandir todo</button>
          <button className="btn-new btn-new--primary" onClick={()=>onCmd("drawer-edit-dx")}><I n="pencil"/>Editar diagnÃ³stico</button>
        </div>
      </div>

      <Collapsible title="ClasificaciÃ³n de Angle" icon="layers" summary="Clase II Div 1 Â· sub-canino R: II Â· sub-molar R: II">
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
          <div>
            <label className="label-new">Clase general</label>
            <select className="select-new" value={angle} onChange={e=>setAngle(e.target.value)}>
              <option value="I">Clase I</option>
              <option value="II_DIV1">Clase II DivisiÃ³n 1</option>
              <option value="II_DIV2">Clase II DivisiÃ³n 2</option>
              <option value="III">Clase III</option>
              <option value="COMBO">Combinada</option>
            </select>
          </div>
          <div>
            <label className="label-new">Resalte (overjet) mm</label>
            <input className="input-new mono" defaultValue="6" type="number" step="0.5"/>
          </div>
          <div>
            <label className="label-new">Sobremordida (overbite) mm</label>
            <input className="input-new mono" defaultValue="4" type="number" step="0.5"/>
          </div>
          <div>
            <label className="label-new">Sub-canino R</label>
            <select className="select-new"><option>Clase II</option><option>Clase I</option><option>Clase III</option></select>
          </div>
          <div>
            <label className="label-new">Sub-canino L</label>
            <select className="select-new"><option>Clase II</option><option>Clase I</option><option>Clase III</option></select>
          </div>
          <div>
            <label className="label-new">Sub-molar R Â· L</label>
            <div style={{display:"flex",gap:6}}>
              <select className="select-new"><option>II</option><option>I</option><option>III</option></select>
              <select className="select-new"><option>II</option><option>I</option><option>III</option></select>
            </div>
          </div>
        </div>
      </Collapsible>

      <Collapsible title="Mordida & apiÃ±amiento" icon="ruler" summary="ApiÃ± max 3mm Â· mand 5mm Â· sin cruzada">
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
          <div>
            <label className="label-new">Mordida abierta</label>
            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
              {["Ninguna","Anterior","Posterior","Ambas"].map((o,i)=>(
                <button key={o} className="chip-sel" data-on={i===0?"true":"false"}>{o}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="label-new">Mordida cruzada</label>
            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
              {["Ninguna","Anterior","Lat R","Lat L","Posterior","Bilateral"].map((o,i)=>(
                <button key={o} className="chip-sel" data-on={i===0?"true":"false"}>{o}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="label-new">ApiÃ±amiento maxilar (mm)</label>
            <input className="input-new mono" defaultValue="3"/>
          </div>
          <div>
            <label className="label-new">ApiÃ±amiento mandibular (mm)</label>
            <input className="input-new mono" defaultValue="5"/>
          </div>
          <div>
            <label className="label-new">LÃ­nea media dental (desv. mm)</label>
            <input className="input-new mono" defaultValue="-1.5"/>
            <p className="help-new">Negativo = izquierda Â· positivo = derecha</p>
          </div>
          <div>
            <label className="label-new">LÃ­nea media facial</label>
            <select className="select-new"><option>Centrada</option><option>Desviada D</option><option>Desviada I</option></select>
          </div>
        </div>
      </Collapsible>

      <Collapsible title="Diastemas" icon="target" summary="2 diastemas Â· 11/21 (1.5mm) Â· 31/41 (0.8mm)">
        <p style={{fontSize:12,color:"var(--text-3)",marginBottom:10}}>Selecciona los dientes implicados (par interproximal). Click adicional para definir mm.</p>
        <div style={{display:"flex",justifyContent:"center"}}>
          <ToothPicker selected={[11,21,31,41]} onToggle={()=>{}}/>
        </div>
        <div style={{display:"flex",gap:8,marginTop:14,flexWrap:"wrap"}}>
          <span className="b b-brand b-lg">11 â€” 21 Â· 1.5 mm</span>
          <span className="b b-brand b-lg">31 â€” 41 Â· 0.8 mm</span>
          <button className="btn-new btn-new--ghost btn-sm"><I n="plus" size={12}/>Agregar diastema</button>
        </div>
      </Collapsible>

      <Collapsible title="Perfil & patrÃ³n skeletal" icon="fingerprint" summary="Convexo Â· Mesofacial Â· Clase II esqueletal leve">
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
          <div>
            <label className="label-new">Perfil facial</label>
            <div style={{display:"flex",gap:5}}>
              {[["CONCAVE","CÃ³ncavo"],["STRAIGHT","Recto"],["CONVEX","Convexo"]].map(([k,l])=>(
                <button key={k} className="chip-sel" data-on={profile===k?"true":"false"} onClick={()=>setProfile(k)}>{l}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="label-new">PatrÃ³n skeletal</label>
            <div style={{display:"flex",gap:5}}>
              {[["BRACHY","Braquifacial"],["MESO","Mesofacial"],["DOLICHO","Dolicofacial"]].map(([k,l])=>(
                <button key={k} className="chip-sel" data-on={skel===k?"true":"false"} onClick={()=>setSkel(k)}>{l}</button>
              ))}
            </div>
          </div>
          <div style={{gridColumn:"span 2"}}>
            <label className="label-new">Problemas esqueletales Â· selecciona los aplicables</label>
            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
              {["Clase II esqueletal","Clase III esqueletal","Hipoplasia maxilar","Prognatismo mandibular","Mordida cruzada esqueletal","AsimetrÃ­a facial"].map(l=>(
                <button key={l} className="chip-sel" data-on={skelIssues.includes(l)?"true":"false"} onClick={()=>setSkelIssues(s=>s.includes(l)?s.filter(x=>x!==l):[...s,l])}>{l}</button>
              ))}
            </div>
          </div>
        </div>
      </Collapsible>

      <Collapsible title="ATM" icon="activity" summary="Ruido articular Â· sin dolor Â· apertura normal">
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14}}>
          <div>
            <label className="label-new">Ruidos</label>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              <button className="chip-sel" data-on={tmj.noise?"true":"false"} onClick={()=>setTmj(t=>({...t,noise:!t.noise}))}>Presente</button>
            </div>
          </div>
          <div>
            <label className="label-new">Dolor</label>
            <button className="chip-sel" data-on={tmj.pain?"true":"false"} onClick={()=>setTmj(t=>({...t,pain:!t.pain}))}>Presente</button>
          </div>
          <div>
            <label className="label-new">DeflexiÃ³n (mm)</label>
            <input className="input-new mono" defaultValue="0"/>
          </div>
          <div>
            <label className="label-new">Apertura mÃ¡x (mm)</label>
            <input className="input-new mono" defaultValue="46"/>
          </div>
        </div>
      </Collapsible>

      <Collapsible title="HÃ¡bitos parafuncionales" icon="brain" summary="Respirador bucal Â· bruxismo">
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {[["resp_bucal","Respirador bucal"],["degl_atipica","DegluciÃ³n atÃ­pica"],["succion_digital","SucciÃ³n digital"],["onicofagia","Onicofagia"],["bruxismo","Bruxismo"],["interposicion","InterposiciÃ³n lingual"]].map(([k,l])=>(
            <button key={k} className="chip-sel" data-on={habits.includes(k)?"true":"false"} onClick={()=>setHabits(h=>h.includes(k)?h.filter(x=>x!==k):[...h,k])}>{l}</button>
          ))}
          <button className="chip-sel"><I n="plus" size={11}/>Agregar hÃ¡bito</button>
        </div>
      </Collapsible>

      <Collapsible title="Resumen narrativo del diagnÃ³stico" icon="filetext" defaultOpen={false} summary="texto del doctor">
        <textarea className="textarea-new" rows={5} defaultValue="Paciente femenino 24 aÃ±os, motivo de consulta estÃ©tico (alineaciÃ³n). Clase II DivisiÃ³n 1 con resalte aumentado de 6mm, sobremordida 4mm. ApiÃ±amiento mandibular moderado (5mm). PatrÃ³n mesofacial con perfil convexo, Clase II esqueletal leve. ATM con ruido articular bilateral sin dolor. RecomendaciÃ³n: tratamiento ortodÃ³ntico fijo con elÃ¡sticos Clase II, sin extracciones, duraciÃ³n estimada 18 meses."/>
      </Collapsible>
    </div>
  );
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SECTION 3 Â· FOTOS & Rx (todas las variantes A.1.1-A.1.7)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function SecFotos({onCmd, empty}){
  const [stage, setStage] = useState("T1");
  const [compareMode, setCompareMode] = useState("side");
  const [showCompare, setShowCompare] = useState(false);

  if(empty){
    return (
      <div className="card" style={{padding:"56px 32px",textAlign:"center",borderStyle:"dashed"}}>
        <I n="cam" size={36}/>
        <h2 className="h-section" style={{marginTop:12}}>AÃºn sin fotos Â· sube tu primer foto-set T0</h2>
        <p style={{fontSize:13,color:"var(--text-2)",maxWidth:420,margin:"6px auto 18px"}}>Las fotos T0 son la base para comparar despuÃ©s con T1, T2... Sube desde computadora o usa tu celular.</p>
        <div style={{display:"flex",gap:8,justifyContent:"center"}}>
          <button className="btn-new btn-new--primary" onClick={()=>onCmd("drawer-upload-photos")}><I n="uploadcloud"/>Subir desde computadora</button>
          <button className="btn-new btn-new--ghost" onClick={()=>onCmd("modal-mobile")}><I n="smart"/>Foto desde celular</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      {/* sets timeline */}
      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
        <PhotoSetCard stage="T0" date="15 jun 2025" count={11} total={11} active={stage==="T0"} onClick={()=>setStage("T0")}/>
        <PhotoSetCard stage="T1" date="15 oct 2025" count={11} total={11} active={stage==="T1"} onClick={()=>setStage("T1")}/>
        <PhotoSetCard stage="T2" date="â€”" count={0} total={11} active={stage==="T2"} onClick={()=>setStage("T2")}/>
        <button className="btn-new btn-new--ghost btn-sm"><I n="plus"/>Nueva etapa</button>
        <div style={{flex:1}}/>
        <button className="btn-new btn-new--ghost btn-sm" onClick={()=>setShowCompare(!showCompare)}><I n="gitcompare"/>Comparar</button>
        <button className="btn-new btn-new--ghost btn-sm" onClick={()=>onCmd("modal-mobile")}><I n="smart"/>MÃ³vil</button>
        <button className="btn-new btn-new--primary btn-sm" onClick={()=>onCmd("drawer-upload-photos")}><I n="uploadcloud"/>Subir</button>
      </div>

      {showCompare ? (
        <ComparePanel mode={compareMode} setMode={setCompareMode}/>
      ) : (
        <>
          {stage==="T2" ? (
            <UploadEmpty onCmd={onCmd} stage="T2"/>
          ) : (
            <>
              <PhotoGrid title="Extraorales" kinds={PHOTO_KINDS_EXTRA} stage={stage} onCmd={onCmd} populated={stage!=="T2"} favIndex={1}/>
              <PhotoGrid title="Intraorales" kinds={PHOTO_KINDS_INTRA} stage={stage} onCmd={onCmd} populated={stage!=="T2"}/>
              <PhotoGrid title="RadiografÃ­as y modelos 3D" kinds={[{k:"RX_PANO",l:"PanorÃ¡mica"},{k:"RX_CEPH",l:"Lateral crÃ¡neo"},{k:"STL_UP",l:"Modelo STL â†‘"},{k:"STL_LO",l:"Modelo STL â†“"},{k:"PDF",l:"PDF externo"}]} stage={stage} onCmd={onCmd} populated={stage!=="T2"} rx/>
            </>
          )}
        </>
      )}
    </div>
  );
}

function PhotoGrid({title, kinds, stage, onCmd, populated, favIndex, rx}){
  return (
    <div className="card" style={{padding:"14px 18px"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
        <h3 className="h-card">{title}</h3>
        <span className="b b-neutral">{kinds.length} fotos Â· {stage}</span>
      </div>
      <div style={{display:"grid",gridTemplateColumns:`repeat(${kinds.length>=6?6:5}, 1fr)`,gap:10}}>
        {kinds.map((k,i)=>(
          <div key={k.k} style={{display:"flex",flexDirection:"column",gap:5}}>
            <PhotoTile kind={k.k} stage={stage} fav={i===favIndex} onClick={()=>onCmd("lightbox")} onAct={(a)=>onCmd("lightbox-"+a)}/>
            <span style={{fontSize:11,color:"var(--text-3)",textAlign:"center"}}>{k.l}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ComparePanel({mode, setMode}){
  return (
    <div className="card" style={{padding:"14px 18px"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <h3 className="h-card">ComparaciÃ³n</h3>
          <select className="select-new" style={{width:180}}><option>Frontal sonrisa</option><option>Lateral derecha</option><option>Oclusal sup</option></select>
        </div>
        <div style={{display:"flex",gap:4,background:"var(--bg-elev-2)",padding:3,borderRadius:9}}>
          {[["side","Side-by-side"],["slider","Slider"],["timeline","Timeline"]].map(([k,l])=>(
            <button key={k} className="tab-pill" data-active={mode===k?"true":"false"} onClick={()=>setMode(k)}>{l}</button>
          ))}
        </div>
      </div>

      {mode==="side" && (
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <div>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
              <span className="b b-neutral">T0 Â· 15 jun 2025</span>
              <span className="mono" style={{fontSize:10,color:"var(--text-3)"}}>antes</span>
            </div>
            <PhotoTile kind="INTRA_FRONT" stage="T0"/>
          </div>
          <div>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
              <span className="b b-success">T1 Â· 15 oct 2025</span>
              <span className="mono" style={{fontSize:10,color:"var(--text-3)"}}>actual</span>
            </div>
            <PhotoTile kind="INTRA_LAT_R" stage="T1"/>
          </div>
        </div>
      )}

      {mode==="slider" && (
        <div>
          <p style={{fontSize:12,color:"var(--text-3)",marginBottom:10}}>Arrastra para revelar antes/despuÃ©s. Click + drag horizontal.</p>
          <ComparisonSlider a="INTRA_FRONT" b="INTRA_LAT_R"/>
        </div>
      )}

      {mode==="timeline" && (
        <div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:8}}>
          {["T0 Â· jun","T1 Â· oct","T2 Â· feb"].map((l,i)=>(
            <div key={l} style={{flex:"0 0 240px"}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                <span className={"b "+(i===0?"b-neutral":i===1?"b-success":"b-violet")}>{l}</span>
                {i===2 && <span className="b b-warn" style={{fontSize:10}}>pendiente</span>}
              </div>
              {i<2 ? <PhotoTile kind="INTRA_FRONT" stage={"T"+i}/> : <PhotoTile empty/>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UploadEmpty({onCmd, stage}){
  return (
    <div className="card" style={{padding:"36px 24px",border:"2px dashed var(--violet-500)",background:"var(--violet-bg)",textAlign:"center"}}>
      <div style={{width:54,height:54,borderRadius:14,background:"#fff",color:"var(--violet-500)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 12px",boxShadow:"0 0 24px var(--violet-500)"}}>
        <I n="uploadcloud" size={26}/>
      </div>
      <h3 className="h-card">Sube tus fotos {stage}</h3>
      <p style={{fontSize:12,color:"var(--text-2)",marginTop:4,marginBottom:14}}>Arrastra archivos aquÃ­ o usa tu celular con guÃ­a de encuadre.</p>
      <div style={{display:"flex",gap:8,justifyContent:"center"}}>
        <button className="btn-new btn-new--primary" onClick={()=>onCmd("drawer-upload-photos")}><I n="uploadcloud"/>Examinar archivos</button>
        <button className="btn-new btn-new--ghost" onClick={()=>onCmd("modal-mobile")}><I n="smart"/>Foto desde celular</button>
      </div>
    </div>
  );
}

window.OrthoSections1 = { SecResumen, SecExpediente, SecFotos };
