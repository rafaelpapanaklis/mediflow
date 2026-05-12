/* eslint-disable */
// â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
// â•‘ MediFlow Orto Â· Plan Tx + Citas + Financiero + RetenciÃ³n + Docs      â•‘
// â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

const { I, ARCHES, PHASES, INSTALLMENTS, TX_CARDS } = window.OrthoCommon;
const { ApplianceBadge, ToothPicker, WireStepRow, InstallmentChip, TreatmentCard, IPRSlot, Collapsible } = window.OrthoAtoms;
const { useState } = React;

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SECTION 4 Â· PLAN DE TRATAMIENTO
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function SecPlan({onCmd, empty}){
  const [tab, setTab] = useState("aparatologia");
  const [appliances, setAppliances] = useState(["METAL","SELF_LIG"]);
  const [extractions, setExtractions] = useState(false);

  if(empty){
    return (
      <div className="card" style={{padding:"56px 32px",textAlign:"center",borderStyle:"dashed"}}>
        <I n="layers" size={36}/>
        <h2 className="h-section" style={{marginTop:12}}>Sin plan de tratamiento</h2>
        <p style={{fontSize:13,color:"var(--text-2)",maxWidth:420,margin:"6px auto 18px"}}>Crea un plan desde cero o carga una plantilla pre-armada para acelerar.</p>
        <div style={{display:"flex",gap:8,justifyContent:"center"}}>
          <button className="btn-new btn-new--primary"><I n="plus"/>Plan en blanco</button>
          <button className="btn-new btn-new--ghost" onClick={()=>onCmd("modal-template")}><I n="template"/>Cargar plantilla</button>
        </div>
      </div>
    );
  }

  const TABS = [
    {k:"aparatologia",l:"AparatologÃ­a",i:"wand"},
    {k:"decisiones",l:"Decisiones del caso",i:"clip"},
    {k:"wires",l:"Wire sequencing",i:"git"},
    {k:"ipr",l:"IPR map",i:"ruler"},
    {k:"objetivos",l:"Objetivos & notas",i:"target"},
  ];

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <h2 className="h-section">Plan de tratamiento</h2>
          <p style={{fontSize:12,color:"var(--text-3)",marginTop:2}}>Plantilla base Â· "Clase II Div 1 sin extracciones" Â· 18 meses estimados</p>
        </div>
        <div style={{display:"flex",gap:6}}>
          <button className="btn-new btn-new--ghost btn-sm" onClick={()=>onCmd("modal-template")}><I n="template"/>Cargar plantilla</button>
          <button className="btn-new btn-new--ghost btn-sm"><I n="save"/>Guardar como plantilla</button>
          <button className="btn-new btn-new--primary btn-sm"><I n="check"/>Aceptar plan</button>
        </div>
      </div>

      {/* sub-tabs */}
      <div style={{display:"flex",gap:4,background:"var(--bg-elev-2)",padding:4,borderRadius:11,width:"fit-content"}}>
        {TABS.map(t=>(
          <button key={t.k} className="tab-pill" data-active={tab===t.k?"true":"false"} onClick={()=>setTab(t.k)}>
            <I n={t.i} size={13}/>{t.l}
          </button>
        ))}
      </div>

      {tab==="aparatologia" && <PlanAparatologia appliances={appliances} setAppliances={setAppliances} onCmd={onCmd}/>}
      {tab==="decisiones" && <PlanDecisiones extractions={extractions} setExtractions={setExtractions}/>}
      {tab==="wires" && <PlanWires onCmd={onCmd}/>}
      {tab==="ipr" && <PlanIPR/>}
      {tab==="objetivos" && <PlanObjetivos/>}

      {/* timeline footer */}
      <div className="card" style={{padding:"14px 18px",display:"flex",alignItems:"center",justifyContent:"space-between",background:"var(--bg-elev-2)"}}>
        <div style={{display:"flex",gap:18}}>
          <div><div className="h-eyebrow">Inicio</div><div className="mono" style={{fontWeight:500,marginTop:2}}>20 jun 2025</div></div>
          <div><div className="h-eyebrow">Fin estimado</div><div className="mono" style={{fontWeight:500,marginTop:2}}>20 dic 2026</div></div>
          <div><div className="h-eyebrow">DuraciÃ³n</div><div style={{fontWeight:500,marginTop:2}}>18 meses Â· 76 sem</div></div>
        </div>
        <span style={{fontSize:11,color:"var(--text-3)"}}>Auto-calculado de wire sequencing</span>
      </div>
    </div>
  );
}

function PlanAparatologia({appliances, setAppliances, onCmd}){
  const TYPES = [
    {k:"METAL", l:"Brackets metÃ¡licos", d:"Slot .022 estÃ¡ndar", i:"square"},
    {k:"SELF_LIG", l:"Autoligado (Damon)", d:"Pasivo Â· low-friction", i:"target"},
    {k:"CERAMIC", l:"EstÃ©ticos (cerÃ¡mica/zafiro)", d:"TranslÃºcidos", i:"sparkles"},
    {k:"ALIGNERS", l:"Alineadores (Invisalign/ClearCorrect)", d:"Removibles", i:"layers"},
  ];
  return (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div className="card" style={{padding:"14px 18px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
          <h3 className="h-card">AparatologÃ­a seleccionada</h3>
          <button className="btn-new btn-new--ghost btn-sm" onClick={()=>onCmd("drawer-new-appliance")}><I n="plus"/>Tipo nuevo</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:10}}>
          {TYPES.map(t=>{
            const on = appliances.includes(t.k);
            return (
              <button key={t.k} onClick={()=>setAppliances(a=>a.includes(t.k)?a.filter(x=>x!==t.k):[...a,t.k])}
                className="card" style={{padding:"14px 16px",display:"flex",alignItems:"center",gap:12,textAlign:"left",border:"1.5px solid "+(on?"var(--brand-500)":"var(--border-soft)"),background:on?"var(--brand-50)":"var(--bg-elev-1)",cursor:"pointer",fontFamily:"inherit",boxShadow:on?"0 0 16px var(--violet-500)":"none"}}>
                <span style={{width:36,height:36,borderRadius:10,background:on?"var(--brand-500)":"var(--bg-elev-2)",color:on?"#fff":"var(--text-2)",display:"flex",alignItems:"center",justifyContent:"center"}}><I n={t.i}/></span>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:500}}>{t.l}</div>
                  <div style={{fontSize:11,color:"var(--text-3)",marginTop:2}}>{t.d}</div>
                </div>
                <span style={{width:18,height:18,borderRadius:5,border:"1.5px solid "+(on?"var(--brand-500)":"var(--border-soft)"),background:on?"var(--brand-500)":"transparent",display:"flex",alignItems:"center",justifyContent:"center"}}>
                  {on && <I n="check" size={12} color="#fff"/>}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="card" style={{padding:"14px 18px"}}>
        <h3 className="h-card" style={{marginBottom:10}}>CatÃ¡logo extensible</h3>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          <ApplianceBadge type="METAL"/>
          <ApplianceBadge type="SELF_LIG"/>
          <ApplianceBadge type="CERAMIC"/>
          <ApplianceBadge type="ALIGNERS"/>
          <ApplianceBadge type="LINGUAL"/>
          <button className="chip-sel"><I n="plus" size={11}/>Tipo nuevo</button>
        </div>
        <p className="help-new" style={{marginTop:8}}>Los tipos nuevos quedan disponibles para futuros pacientes y otros doctores de la clÃ­nica.</p>
      </div>
    </div>
  );
}

function PlanDecisiones({extractions, setExtractions}){
  return (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <Collapsible title="Extracciones" icon="x" summary={extractions?"Premolares 14, 24, 34, 44":"No requiere extracciones"} defaultOpen>
        <div style={{display:"flex",gap:8,marginBottom:14}}>
          <button className="chip-sel" data-on={!extractions?"true":"false"} onClick={()=>setExtractions(false)}>No extracciones</button>
          <button className="chip-sel" data-on={extractions?"true":"false"} onClick={()=>setExtractions(true)}>SÃ­ extracciones</button>
        </div>
        {extractions && (
          <>
            <p style={{fontSize:12,color:"var(--text-3)",marginBottom:8}}>Selecciona los dientes a extraer.</p>
            <div style={{display:"flex",justifyContent:"center"}}><ToothPicker selected={[14,24,34,44]} mode="extract"/></div>
          </>
        )}
      </Collapsible>

      <Collapsible title="ElÃ¡sticos" icon="link" summary="Clase II R+L Â· 18 hrs/dÃ­a">
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
          <div>
            <label className="label-new">Tipo</label>
            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
              {["Clase II","Clase III","Box anterior","Box posterior","Cruzados"].map((l,i)=>(
                <button key={l} className="chip-sel" data-on={i===0?"true":"false"}>{l}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="label-new">Horas de uso prescritas</label>
            <div style={{display:"flex",gap:5}}>
              {["24/7","18 hrs/dÃ­a","Nocturno","Custom"].map((l,i)=>(
                <button key={l} className="chip-sel" data-on={i===1?"true":"false"}>{l}</button>
              ))}
            </div>
          </div>
          <div style={{gridColumn:"span 2"}}>
            <label className="label-new">Lado</label>
            <div style={{display:"flex",gap:5}}>
              {["Derecho","Izquierdo","Bilateral"].map((l,i)=>(
                <button key={l} className="chip-sel" data-on={i===2?"true":"false"}>{l}</button>
              ))}
            </div>
          </div>
        </div>
      </Collapsible>

      <Collapsible title="Expansores" icon="ruler" summary="No requiere">
        <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
          {["Ninguno","RPE","Quad-Helix","Hyrax","Schwarz"].map((l,i)=>(
            <button key={l} className="chip-sel" data-on={i===0?"true":"false"}>{l}</button>
          ))}
        </div>
      </Collapsible>

      <Collapsible title="Microtornillos / TADs" icon="target" summary="No requiere">
        <div style={{display:"flex",justifyContent:"center"}}><ToothPicker selected={[]} mode="tad"/></div>
      </Collapsible>

      <Collapsible title="Aparatos auxiliares" icon="plus" summary="Ninguno">
        <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
          {["Lip bumper","BotÃ³n lingual","Resorte abierto","Resorte cerrado","Power chain"].map(l=>(
            <button key={l} className="chip-sel">{l}</button>
          ))}
          <button className="chip-sel"><I n="plus" size={11}/>Agregar</button>
        </div>
      </Collapsible>
    </div>
  );
}

function PlanWires({onCmd}){
  return (
    <div className="card" style={{padding:"14px 18px"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
        <div>
          <h3 className="h-card">Wire sequencing</h3>
          <p style={{fontSize:11,color:"var(--text-3)",marginTop:2}}>Secuencia planeada de arcos Â· arrastrable</p>
        </div>
        <div style={{display:"flex",gap:6}}>
          <button className="btn-new btn-new--ghost btn-sm"><I n="copy"/>Duplicar fase</button>
          <button className="btn-new btn-new--primary btn-sm"><I n="plus"/>Agregar arco</button>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"32px 1.4fr 1.2fr 1fr 0.7fr 0.7fr 0.9fr 40px",gap:8,fontSize:10,color:"var(--text-3)",textTransform:"uppercase",letterSpacing:".08em",fontWeight:600,padding:"0 8px 8px",borderBottom:"1px solid var(--border-soft)",marginBottom:6}}>
        <div>#</div><div>Fase</div><div>Material</div><div>Calibre</div><div>Sem</div><div>Inicio</div><div>Estado</div><div></div>
      </div>

      {ARCHES.map((a,i)=>(
        <WireStepRow key={i} idx={i+1} arch={a}/>
      ))}

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:12,padding:"10px 12px",background:"var(--bg-elev-2)",borderRadius:9}}>
        <div style={{display:"flex",gap:14,fontSize:11}}>
          <span><span className="h-eyebrow">Total fases</span><span className="mono" style={{marginLeft:6,fontWeight:500}}>5</span></span>
          <span><span className="h-eyebrow">Total arcos</span><span className="mono" style={{marginLeft:6,fontWeight:500}}>7</span></span>
          <span><span className="h-eyebrow">DuraciÃ³n</span><span className="mono" style={{marginLeft:6,fontWeight:500}}>76 sem</span></span>
        </div>
        <span className="b b-info">Arco actual: #3 Â· .016 NiTi (sem 6/10)</span>
      </div>
    </div>
  );
}

function PlanIPR(){
  return (
    <div className="card" style={{padding:"14px 18px"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
        <div>
          <h3 className="h-card">IPR map Â· Interproximal reduction</h3>
          <p style={{fontSize:11,color:"var(--text-3)",marginTop:2}}>16 slots superiores + 16 inferiores Â· click para editar</p>
        </div>
        <div style={{display:"flex",gap:14,fontSize:11}}>
          <span><span className="dotmark" style={{background:"var(--brand-500)"}}/>Planeado</span>
          <span><span className="dotmark" style={{background:"var(--warn)"}}/>Parcial</span>
          <span><span className="dotmark" style={{background:"var(--success)"}}/>Completo</span>
          <span><span className="dotmark" style={{background:"var(--border-soft)"}}/>Sin acciÃ³n</span>
        </div>
      </div>
      <IPRMap/>
      <div className="kpi-row" style={{marginTop:14}}>
        <div className="kpi"><div className="kpi-label">Planeado total</div><div className="kpi-value">3.4 mm</div></div>
        <div className="kpi"><div className="kpi-label">Realizado</div><div className="kpi-value">1.8 mm</div></div>
        <div className="kpi"><div className="kpi-label">Slots completos</div><div className="kpi-value">6 / 14</div></div>
        <div className="kpi"><div className="kpi-label">% avance</div><div className="kpi-value">53%</div></div>
      </div>
    </div>
  );
}

function IPRMap(){
  // 16 superior slots (between teeth 17-16, 16-15, ..., 26-27)
  // 16 inferior slots (between 37-36, ..., 47-46)
  const SLOTS = [
    // upper
    {pos:[17,16],planned:0,done:0},{pos:[16,15],planned:0,done:0},{pos:[15,14],planned:0.3,done:0.3,s:"complete"},{pos:[14,13],planned:0.3,done:0,s:"planned"},
    {pos:[13,12],planned:0.2,done:0.2,s:"complete"},{pos:[12,11],planned:0,done:0},{pos:[11,21],planned:0,done:0},{pos:[21,22],planned:0,done:0},
    {pos:[22,23],planned:0.2,done:0.1,s:"partial"},{pos:[23,24],planned:0.3,done:0,s:"planned"},{pos:[24,25],planned:0.3,done:0.3,s:"complete"},{pos:[25,26],planned:0,done:0},
    {pos:[26,27],planned:0,done:0},
  ];
  const LOWER = [
    {pos:[37,36],planned:0,done:0},{pos:[36,35],planned:0.3,done:0,s:"planned"},{pos:[35,34],planned:0.3,done:0.3,s:"complete"},{pos:[34,33],planned:0.4,done:0.2,s:"partial"},
    {pos:[33,32],planned:0.3,done:0.3,s:"complete"},{pos:[32,31],planned:0.2,done:0,s:"planned"},{pos:[31,41],planned:0,done:0},{pos:[41,42],planned:0.2,done:0.2,s:"complete"},
    {pos:[42,43],planned:0.3,done:0,s:"planned"},{pos:[43,44],planned:0.4,done:0,s:"planned"},{pos:[44,45],planned:0.3,done:0.3,s:"complete"},{pos:[45,46],planned:0,done:0},
    {pos:[46,47],planned:0,done:0},
  ];
  return (
    <div>
      <div style={{textAlign:"center",fontSize:10,color:"var(--text-3)",marginBottom:4,fontFamily:"'JetBrains Mono',monospace"}}>SUPERIOR</div>
      <div style={{display:"flex",justifyContent:"center",gap:3,flexWrap:"nowrap"}}>
        {SLOTS.map((s,i)=>(<IPRSlot key={i} {...s}/>))}
      </div>
      <div style={{height:14}}/>
      <div style={{display:"flex",justifyContent:"center",gap:3,flexWrap:"nowrap"}}>
        {LOWER.map((s,i)=>(<IPRSlot key={i} {...s}/>))}
      </div>
      <div style={{textAlign:"center",fontSize:10,color:"var(--text-3)",marginTop:4,fontFamily:"'JetBrains Mono',monospace"}}>INFERIOR</div>
    </div>
  );
}

function PlanObjetivos(){
  const goals = ["AlineaciÃ³n completa de arcadas","CorrecciÃ³n Clase II a Clase I","Cerrar overjet a 2-3mm","Cerrar diastemas 11-21 y 31-41","Centrar lÃ­nea media dental","Conservar perfil facial"];
  return (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div className="card" style={{padding:"14px 18px"}}>
        <h3 className="h-card" style={{marginBottom:10}}>Objetivos del tratamiento</h3>
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {goals.map((g,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",background:"var(--bg-elev-2)",borderRadius:8}}>
              <span style={{width:22,height:22,borderRadius:"50%",background:i<2?"var(--success-bg)":"var(--bg-elev-1)",color:i<2?"var(--success)":"var(--text-3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:600,fontFamily:"'JetBrains Mono',monospace",border:"1px solid var(--border-soft)"}}>{i<2?"âœ“":i+1}</span>
              <span style={{flex:1,fontSize:13}}>{g}</span>
              <button className="btn-icon-sm"><I n="pencil" size={12}/></button>
              <button className="btn-icon-sm"><I n="x" size={12}/></button>
            </div>
          ))}
          <button className="btn-new btn-new--ghost btn-sm" style={{alignSelf:"flex-start",marginTop:4}}><I n="plus"/>Agregar objetivo</button>
        </div>
      </div>

      <div className="card" style={{padding:"14px 18px"}}>
        <h3 className="h-card" style={{marginBottom:10}}>Notas del caso</h3>
        <div style={{display:"flex",gap:4,marginBottom:6}}>
          {["B","I","U","H1","H2","â€¢","1.","ðŸ”—"].map((t,i)=>(
            <button key={i} className="btn-icon-sm" style={{fontWeight:t==="B"?700:400,fontStyle:t==="I"?"italic":"normal",textDecoration:t==="U"?"underline":"none"}}>{t}</button>
          ))}
        </div>
        <textarea className="textarea-new" rows={4} defaultValue="Paciente motivada. Iniciar con .014 NiTi sup/inf, control mensual. Considerar IPR sup canino-canino fase de detalles si persiste apiÃ±amiento residual. ElÃ¡sticos Clase II desde fase de cierre."/>
      </div>
    </div>
  );
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SECTION 5 Â· CITAS Y EVOLUCIÃ“N
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function SecCitas({onCmd, empty}){
  const [view, setView] = useState("timeline");
  if(empty){
    return (
      <div className="card" style={{padding:"56px 32px",textAlign:"center",borderStyle:"dashed"}}>
        <I n="cal" size={36}/>
        <h2 className="h-section" style={{marginTop:12}}>Sin Treatment Cards</h2>
        <p style={{fontSize:13,color:"var(--text-2)",maxWidth:420,margin:"6px auto 18px"}}>Las Treatment Cards se llenan despuÃ©s de cada cita. Empieza por la instalaciÃ³n inicial.</p>
        <button className="btn-new btn-new--primary" onClick={()=>onCmd("drawer-new-tc")}><I n="plus"/>Nueva Treatment Card</button>
      </div>
    );
  }
  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <h2 className="h-section">Citas y evoluciÃ³n Â· Treatment Cards</h2>
          <p style={{fontSize:12,color:"var(--text-3)",marginTop:2}}>7 cards Â· prÃ³xima sugerida 12 nov Â· arco siguiente .018 NiTi</p>
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <div style={{display:"flex",gap:3,background:"var(--bg-elev-2)",padding:3,borderRadius:9}}>
            {[["timeline","Timeline","trending"],["table","Tabla","layers"],["cal","Calendario","cal"]].map(([k,l,i])=>(
              <button key={k} className="tab-pill" data-active={view===k?"true":"false"} onClick={()=>setView(k)}><I n={i} size={12}/>{l}</button>
            ))}
          </div>
          <button className="btn-new btn-new--primary btn-sm" onClick={()=>onCmd("drawer-new-tc")}><I n="plus"/>Nueva card</button>
        </div>
      </div>

      {/* compliance bar */}
      <div className="card" style={{padding:"14px 18px",display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14}}>
        <div><div className="h-eyebrow">Compliance global</div><div style={{fontSize:28,fontWeight:600,fontFamily:"'JetBrains Mono',monospace",color:"var(--brand-700)"}}>82%</div><div style={{fontSize:11,color:"var(--text-3)"}}>asist + elÃ¡st</div></div>
        <div><div className="h-eyebrow">Asistencia</div><div style={{fontSize:28,fontWeight:600,fontFamily:"'JetBrains Mono',monospace"}}>7/7</div><div style={{fontSize:11,color:"var(--success)"}}>100% Â· sin faltas</div></div>
        <div><div className="h-eyebrow">Uso elÃ¡sticos prom.</div><div style={{fontSize:28,fontWeight:600,fontFamily:"'JetBrains Mono',monospace",color:"var(--warn)"}}>65%</div><div style={{fontSize:11,color:"var(--text-3)"}}>14 de 18 hrs/dÃ­a</div></div>
        <div><div className="h-eyebrow">Brackets caÃ­dos</div><div style={{fontSize:28,fontWeight:600,fontFamily:"'JetBrains Mono',monospace"}}>2</div><div style={{fontSize:11,color:"var(--text-3)"}}>14, 24 recolocados</div></div>
      </div>

      {view==="timeline" && (
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {TX_CARDS.map((c,i)=>(<TreatmentCard key={i} card={c} onOpen={()=>onCmd("drawer-edit-tc-"+i)}/>))}
          <div className="card" style={{padding:"14px 18px",borderStyle:"dashed",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div>
              <div style={{fontSize:13,fontWeight:500,color:"var(--text-2)"}}>PrÃ³xima cita sugerida Â· 12 nov Â· 10:30</div>
              <div style={{fontSize:12,color:"var(--text-3)",marginTop:2}}>Control mensual Â· activaciÃ³n Â· arco .018 NiTi sugerido</div>
            </div>
            <div style={{display:"flex",gap:6}}>
              <button className="btn-new btn-new--ghost btn-sm">Re-agendar</button>
              <button className="btn-new btn-new--primary btn-sm">Confirmar</button>
            </div>
          </div>
        </div>
      )}

      {view==="table" && (
        <div className="card" style={{padding:0,overflow:"hidden"}}>
          <table className="t-new">
            <thead><tr><th>#</th><th>Fecha</th><th>Tipo</th><th>Arco</th><th>ElÃ¡st</th><th>Brk caÃ­dos</th><th>Compliance</th><th>PrÃ³x.</th><th></th></tr></thead>
            <tbody>
              {TX_CARDS.map((c,i)=>(
                <tr key={i}><td className="mono">#{c.idx}</td><td>{c.date}</td><td><span className="b b-brand" style={{fontSize:10}}>{c.type}</span></td><td className="mono">{c.arch||"â€”"}</td><td>{c.elast||"â€”"}</td><td className="mono">{c.brokenBrackets||"0"}</td><td><span style={{color:c.compliance>=80?"var(--success)":c.compliance>=60?"var(--warn)":"var(--danger)",fontFamily:"'JetBrains Mono',monospace"}}>{c.compliance||"â€”"}%</span></td><td className="mono" style={{color:"var(--text-3)"}}>{c.next}</td><td><button className="btn-icon-sm" onClick={()=>onCmd("drawer-edit-tc-"+i)}><I n="more" size={14}/></button></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view==="cal" && <MiniCalendar/>}
    </div>
  );
}

function MiniCalendar(){
  return (
    <div className="card" style={{padding:"14px 18px"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
        <h3 className="h-card">Noviembre 2025</h3>
        <div style={{display:"flex",gap:4}}>
          <button className="btn-icon-sm"><I n="chev" size={14} style={{transform:"rotate(90deg)"}}/></button>
          <button className="btn-icon-sm"><I n="chev" size={14} style={{transform:"rotate(-90deg)"}}/></button>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,fontSize:11,color:"var(--text-3)",textAlign:"center",marginBottom:4}}>
        {["L","M","M","J","V","S","D"].map((d,i)=>(<div key={i} style={{padding:"4px 0"}}>{d}</div>))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4}}>
        {Array.from({length:35}).map((_,i)=>{
          const day = i-2;
          const has = [4,12,19,26].includes(day);
          const past = day<8 && day>0;
          return (
            <div key={i} style={{aspectRatio:"1",padding:6,background:has?"var(--brand-50)":"var(--bg-elev-2)",borderRadius:7,fontSize:12,opacity:day<=0||day>30?0.25:1,position:"relative",border:has?"1px solid var(--brand-500)":"1px solid transparent",fontFamily:"'JetBrains Mono',monospace",fontWeight:has?600:400,color:has?"var(--brand-700)":"inherit"}}>
              {day>0&&day<=30?day:""}
              {has && <span style={{position:"absolute",bottom:4,right:4,width:6,height:6,borderRadius:"50%",background:past?"var(--text-3)":"var(--brand-500)"}}/>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SECTION 6 Â· PLAN FINANCIERO
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function SecFinanciero({onCmd, empty}){
  if(empty){
    return (
      <div className="card" style={{padding:"56px 32px",textAlign:"center",borderStyle:"dashed"}}>
        <I n="wallet" size={36}/>
        <h2 className="h-section" style={{marginTop:12}}>Sin plan financiero</h2>
        <p style={{fontSize:13,color:"var(--text-2)",maxWidth:420,margin:"6px auto 18px"}}>Crea hasta 3 escenarios de cotizaciÃ³n para enviar al paciente vÃ­a Sign@Home.</p>
        <button className="btn-new btn-new--primary" onClick={()=>onCmd("drawer-edit-financial")}><I n="plus"/>Crear escenarios</button>
      </div>
    );
  }
  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <h2 className="h-section">Plan financiero</h2>
          <p style={{fontSize:12,color:"var(--text-3)",marginTop:2}}>Escenario activo Â· 18 meses Â· enganche $8,000 Â· CFDI 4.0 con Facturapi</p>
        </div>
        <div style={{display:"flex",gap:6}}>
          <button className="btn-new btn-new--ghost btn-sm"><I n="send"/>Enviar 3 escenarios Â· WhatsApp</button>
          <button className="btn-new btn-new--ghost btn-sm" onClick={()=>onCmd("drawer-edit-financial")}><I n="pencil"/>Editar plan</button>
        </div>
      </div>

      {/* scenarios */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
        <ScenarioCard label="Escenario A Â· 12 meses" enganche="$15,000" mensual="$2,917" total="$50,000"/>
        <ScenarioCard label="Escenario B Â· 18 meses" enganche="$8,000" mensual="$2,333" total="$50,000" active/>
        <ScenarioCard label="Escenario C Â· 24 meses" enganche="$5,000" mensual="$1,875" total="$50,000"/>
      </div>

      {/* main plan summary */}
      <div className="card" style={{padding:"14px 18px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
          <h3 className="h-card">Calendario de mensualidades</h3>
          <button className="btn-new btn-new--primary btn-sm" onClick={()=>onCmd("drawer-collect")}><I n="dollar"/>Cobrar siguiente Â· $1,840</button>
        </div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {INSTALLMENTS.map((m,i)=>(<InstallmentChip key={i} inst={m} onClick={()=>onCmd("drawer-collect-"+i)}/>))}
        </div>

        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginTop:16,padding:"14px 0 0",borderTop:"1px solid var(--border-soft)"}}>
          <div><div className="h-eyebrow">Total tratamiento</div><div style={{fontSize:22,fontWeight:600,fontFamily:"'JetBrains Mono',monospace",marginTop:2}}>$50,000</div></div>
          <div><div className="h-eyebrow">Enganche</div><div style={{fontSize:22,fontWeight:600,fontFamily:"'JetBrains Mono',monospace",marginTop:2}}>$8,000</div></div>
          <div><div className="h-eyebrow">Mensualidades</div><div style={{fontSize:22,fontWeight:600,fontFamily:"'JetBrains Mono',monospace",marginTop:2}}>18 Ã— $2,333</div></div>
          <div><div className="h-eyebrow">Cobrado</div><div style={{fontSize:22,fontWeight:600,fontFamily:"'JetBrains Mono',monospace",marginTop:2,color:"var(--success)"}}>$20,331</div></div>
        </div>
      </div>

      {/* CFDI */}
      <div className="card" style={{padding:"14px 18px",background:"var(--violet-bg)",border:"1px solid var(--violet-500)"}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <span style={{width:38,height:38,borderRadius:9,background:"#fff",color:"var(--violet-500)",display:"flex",alignItems:"center",justifyContent:"center"}}><I n="filetext"/></span>
          <div style={{flex:1}}>
            <div style={{fontSize:13,fontWeight:500}}>CFDI 4.0 con Facturapi</div>
            <div style={{fontSize:11,color:"var(--text-2)"}}>Stub Fase 2 Â· contratar para activar timbrado automÃ¡tico</div>
          </div>
          <button className="btn-new btn-new--ghost btn-sm">Conectar Facturapi</button>
        </div>
      </div>
    </div>
  );
}

function ScenarioCard({label, enganche, mensual, total, active}){
  return (
    <div className="card" style={{padding:"14px 16px",border:"1.5px solid "+(active?"var(--brand-500)":"var(--border-soft)"),background:active?"var(--brand-50)":"var(--bg-elev-1)",boxShadow:active?"0 0 14px var(--violet-500)":"none",position:"relative"}}>
      {active && <span className="b b-brand" style={{position:"absolute",top:-8,left:14,fontSize:10}}>ACTIVO</span>}
      <div style={{fontSize:11,color:"var(--text-3)",marginBottom:8,textTransform:"uppercase",letterSpacing:".08em"}}>{label}</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
        <div><div className="h-eyebrow">Enganche</div><div className="mono" style={{fontWeight:600,marginTop:2}}>{enganche}</div></div>
        <div><div className="h-eyebrow">Mensual</div><div className="mono" style={{fontWeight:600,marginTop:2}}>{mensual}</div></div>
        <div style={{gridColumn:"span 2"}}><div className="h-eyebrow">Total</div><div className="mono" style={{fontWeight:600,marginTop:2,fontSize:18}}>{total}</div></div>
      </div>
      <div style={{display:"flex",gap:5}}>
        <button className="btn-new btn-new--ghost btn-sm" style={{flex:1}}><I n="pencil" size={11}/>Editar</button>
        {!active && <button className="btn-new btn-new--primary btn-sm" style={{flex:1}}>Activar</button>}
      </div>
    </div>
  );
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SECTION 7 Â· RETENCIÃ“N Y POST-TRATAMIENTO
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function SecRetencion({onCmd, macroState}){
  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <h2 className="h-section">RetenciÃ³n y post-tratamiento</h2>
          <p style={{fontSize:12,color:"var(--text-3)",marginTop:2}}>{macroState==="RETENTION"?"Activo Â· debonding 18 jul 2026 Â· aÃ±o 1 de retenciÃ³n":"PlanificaciÃ³n pre-debonding"}</p>
        </div>
        <button className="btn-new btn-new--primary btn-sm"><I n="pencil"/>Editar rÃ©gimen</button>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
        <div className="card" style={{padding:"14px 18px"}}>
          <h3 className="h-card" style={{marginBottom:10}}>Retenedor superior</h3>
          <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:10}}>
            {["Hawley","Essix","Fijo lingual","Ninguno"].map((l,i)=>(
              <button key={l} className="chip-sel" data-on={i===1?"true":"false"}>{l}</button>
            ))}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div><label className="label-new">Calibre</label><input className="input-new mono" defaultValue="â€”"/></div>
            <div><label className="label-new">Material</label><input className="input-new" defaultValue="Essix 1.5mm"/></div>
          </div>
        </div>

        <div className="card" style={{padding:"14px 18px"}}>
          <h3 className="h-card" style={{marginBottom:10}}>Retenedor inferior</h3>
          <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:10}}>
            {["Hawley","Essix","Fijo 3-3","Fijo extendido","Ninguno"].map((l,i)=>(
              <button key={l} className="chip-sel" data-on={i===2?"true":"false"}>{l}</button>
            ))}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div><label className="label-new">Calibre</label><input className="input-new mono" defaultValue=".0195"/></div>
            <div><label className="label-new">PosiciÃ³n</label><input className="input-new" defaultValue="33 a 43"/></div>
          </div>
        </div>
      </div>

      <div className="card" style={{padding:"14px 18px"}}>
        <h3 className="h-card" style={{marginBottom:10}}>RÃ©gimen de uso</h3>
        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8}}>
          {[["AÃ‘O 1","24/7","actual"],["AÃ‘O 2","Nocturno","futuro"],["AÃ‘O 3","Nocturno","futuro"],["AÃ‘O 4","3x sem","futuro"],["AÃ‘O 5+","2x sem","futuro"]].map(([y,u,s],i)=>(
            <div key={y} style={{padding:"10px 12px",background:s==="actual"?"var(--brand-50)":"var(--bg-elev-2)",borderRadius:9,border:"1px solid "+(s==="actual"?"var(--brand-500)":"var(--border-soft)")}}>
              <div className="h-eyebrow">{y}</div>
              <div style={{fontSize:14,fontWeight:500,marginTop:4}}>{u}</div>
              {s==="actual" && <span className="b b-brand" style={{marginTop:6,fontSize:10}}>actual</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{padding:"14px 18px"}}>
        <h3 className="h-card" style={{marginBottom:10}}>Controles post-debonding</h3>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {[["+3 m","18 oct 2026","done"],["+6 m","18 ene 2027","done"],["+12 m","18 jul 2027","upcoming"],["+24 m","18 jul 2028","future"],["+36 m","18 jul 2029","future"]].map(([l,d,s],i)=>(
            <div key={i} style={{padding:"10px 14px",borderRadius:9,background:s==="done"?"var(--success-bg)":s==="upcoming"?"var(--brand-50)":"var(--bg-elev-2)",border:"1px solid "+(s==="upcoming"?"var(--brand-500)":"var(--border-soft)"),minWidth:130}}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                  <span style={{width:18,height:18,borderRadius:"50%",background:s==="done"?"var(--success)":s==="upcoming"?"var(--brand-500)":"var(--bg-elev-1)",color:s==="future"?"var(--text-3)":"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontFamily:"'JetBrains Mono',monospace",fontWeight:600}}>{s==="done"?"âœ“":i+1}</span>
                  <span style={{fontSize:13,fontWeight:500}}>{l}</span>
                </div>
                <div className="mono" style={{fontSize:11,color:"var(--text-3)"}}>{d}</div>
                {s==="upcoming" && <div style={{fontSize:10,color:"var(--brand-700)",marginTop:4}}>WA en 5 dÃ­as</div>}
              </div>
          ))}
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
        <div className="card" style={{padding:"14px 18px"}}>
          <h3 className="h-card" style={{marginBottom:10}}>NPS post-debond</h3>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {[["+3 dÃ­as","21 jul 2026","9/10","done"],["+6 meses","18 ene 2027","â€”","upcoming"],["+12 meses","18 jul 2027","â€”","future"]].map(([l,d,n,s],i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",background:"var(--bg-elev-2)",borderRadius:8}}>
                <span style={{width:24,height:24,borderRadius:"50%",background:s==="done"?"var(--success)":"var(--bg-elev-1)",color:s==="done"?"#fff":"var(--text-3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:600}}>{s==="done"?"âœ“":i+1}</span>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:500}}>{l}</div>
                  <div className="mono" style={{fontSize:11,color:"var(--text-3)"}}>{d}</div>
                </div>
                <span className="mono" style={{fontSize:13,fontWeight:600,color:s==="done"?"var(--success)":"var(--text-3)"}}>{n}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{padding:"14px 18px"}}>
          <h3 className="h-card" style={{marginBottom:10}}>Programa de referidos</h3>
          <div style={{padding:"12px 14px",background:"var(--violet-bg)",borderRadius:9,border:"1px solid var(--violet-500)",marginBottom:10}}>
            <div className="h-eyebrow">CÃ³digo del paciente</div>
            <div className="mono" style={{fontSize:28,fontWeight:600,marginTop:4,color:"var(--violet-500)",letterSpacing:".06em"}}>GABY26</div>
          </div>
          <label className="label-new">Premio configurable</label>
          <select className="select-new"><option>1 mes gratis</option><option>10% descuento</option><option>Limpieza gratis</option><option>Custom</option></select>
          <div style={{display:"flex",justifyContent:"space-between",marginTop:10,fontSize:12}}>
            <span style={{color:"var(--text-3)"}}>Referidos generados</span>
            <span className="mono" style={{fontWeight:600}}>3 Â· 1 convertido</span>
          </div>
        </div>
      </div>

      <div className="card" style={{padding:"14px 18px",background:"var(--bg-elev-2)",display:"flex",alignItems:"center",gap:14}}>
        <span style={{width:42,height:42,borderRadius:10,background:"var(--brand-500)",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center"}}><I n="filetext" size={22}/></span>
        <div style={{flex:1}}>
          <div style={{fontSize:14,fontWeight:500}}>PDF antes/despuÃ©s automÃ¡tico</div>
          <div style={{fontSize:12,color:"var(--text-2)"}}>Se genera al marcar debonding completado Â· template branding MediFlow ClÃ­nica</div>
        </div>
        <button className="btn-new btn-new--primary btn-sm"><I n="download"/>Generar PDF</button>
      </div>
    </div>
  );
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SECTION 8 Â· DOCUMENTOS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function SecDocumentos({onCmd}){
  const [tab,setTab] = useState("consent");
  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <h2 className="h-section">Documentos y comunicaciÃ³n</h2>
          <p style={{fontSize:12,color:"var(--text-3)",marginTop:2}}>Consentimientos Â· cartas Â· lab orders Â· log WhatsApp</p>
        </div>
        <button className="btn-new btn-new--primary btn-sm"><I n="plus"/>Nuevo documento</button>
      </div>

      <div style={{display:"flex",gap:4,background:"var(--bg-elev-2)",padding:4,borderRadius:11,width:"fit-content"}}>
        {[["consent","Consentimientos","check"],["refer","Cartas referencia","send"],["lab","Lab orders","layers"],["wa","Log WhatsApp","whats"]].map(([k,l,i])=>(
          <button key={k} className="tab-pill" data-active={tab===k?"true":"false"} onClick={()=>setTab(k)}><I n={i} size={13}/>{l}</button>
        ))}
      </div>

      {tab==="consent" && (
        <div className="card" style={{padding:0,overflow:"hidden"}}>
          <table className="t-new">
            <thead><tr><th>Documento</th><th>Plantilla</th><th>Estado</th><th>Firmado</th><th>Vence</th><th></th></tr></thead>
            <tbody>
              <tr><td><div style={{display:"flex",alignItems:"center",gap:8}}><I n="filetext" size={14}/>Consentimiento informado ortodoncia</div></td><td>EstÃ¡ndar v3.2</td><td><span className="b b-success">Firmado</span></td><td className="mono">18 jun 2025</td><td className="mono">â€”</td><td><button className="btn-icon-sm"><I n="more" size={14}/></button></td></tr>
              <tr><td><div style={{display:"flex",alignItems:"center",gap:8}}><I n="filetext" size={14}/>AutorizaciÃ³n fotografÃ­as clÃ­nicas</div></td><td>EstÃ¡ndar v1.0</td><td><span className="b b-success">Firmado</span></td><td className="mono">18 jun 2025</td><td className="mono">â€”</td><td><button className="btn-icon-sm"><I n="more" size={14}/></button></td></tr>
              <tr><td><div style={{display:"flex",alignItems:"center",gap:8}}><I n="filetext" size={14}/>Consentimiento extracciones</div></td><td>Custom</td><td><span className="b b-warn">Pendiente firma</span></td><td className="mono">â€”</td><td className="mono">25 nov 2025</td><td><button className="btn-icon-sm"><I n="more" size={14}/></button></td></tr>
            </tbody>
          </table>
        </div>
      )}

      {tab==="refer" && (
        <div className="card" style={{padding:0,overflow:"hidden"}}>
          <table className="t-new">
            <thead><tr><th>Destinatario</th><th>Motivo</th><th>Fecha</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              <tr><td>Dr. Mario AragÃ³n Â· Periodoncia</td><td>Pre-tratamiento Â· evaluaciÃ³n encÃ­a</td><td className="mono">10 jun 2025</td><td><span className="b b-success">Enviada</span></td><td><button className="btn-icon-sm"><I n="more" size={14}/></button></td></tr>
              <tr><td>Dra. Ana SolÃ­s Â· ATM</td><td>Ruido articular bilateral</td><td className="mono">12 jul 2025</td><td><span className="b b-info">Borrador</span></td><td><button className="btn-icon-sm"><I n="more" size={14}/></button></td></tr>
            </tbody>
          </table>
        </div>
      )}

      {tab==="lab" && (
        <div className="card" style={{padding:0,overflow:"hidden"}}>
          <table className="t-new">
            <thead><tr><th>Producto</th><th>Lab</th><th>Tracking</th><th>Enviada</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              <tr><td>Retenedor Essix superior</td><td>OrthoLab MX</td><td className="mono">OLX-44821</td><td className="mono">02 jul 2025</td><td><span className="b b-success">Recibida</span></td><td><button className="btn-icon-sm"><I n="more" size={14}/></button></td></tr>
              <tr><td>Retenedor fijo lingual 3-3 inf</td><td>OrthoLab MX</td><td className="mono">OLX-44822</td><td className="mono">02 jul 2025</td><td><span className="b b-success">Recibida</span></td><td><button className="btn-icon-sm"><I n="more" size={14}/></button></td></tr>
              <tr><td>Modelo estudio digital STL</td><td>3D Dental</td><td className="mono">3DD-2210</td><td className="mono">18 jun 2025</td><td><span className="b b-success">Recibida</span></td><td><button className="btn-icon-sm"><I n="more" size={14}/></button></td></tr>
              <tr><td>Alineadores serie refinement #2</td><td>ClearCorrect MX</td><td className="mono">CC-99182</td><td className="mono">10 oct 2025</td><td><span className="b b-warn">Enviada</span></td><td><button className="btn-icon-sm"><I n="more" size={14}/></button></td></tr>
            </tbody>
          </table>
        </div>
      )}

      {tab==="wa" && <WhatsAppLog/>}
    </div>
  );
}

function WhatsAppLog(){
  const MSGS = [
    {from:"clinic",time:"15 oct Â· 14:30",text:"Hola Gabriela ðŸ‘‹ te confirmamos tu cita maÃ±ana 10:30 con Dr. Rafael. Recuerda traer tus elÃ¡sticos."},
    {from:"patient",time:"15 oct Â· 17:42",text:"Confirmado, ahÃ­ estarÃ© gracias"},
    {from:"clinic",time:"15 oct Â· 19:00",text:"Tu prÃ³xima mensualidad #8 vence el 30 oct Â· monto $2,333. Paga aquÃ­: link"},
    {from:"clinic",time:"20 oct Â· 09:00",text:"ðŸ“‹ Â¿EstÃ¡s usando tus elÃ¡sticos las horas prescritas? Responde SÃ / NO / A VECES"},
    {from:"patient",time:"20 oct Â· 12:14",text:"A veces, se me olvidan en la noche"},
  ];
  return (
    <div className="card" style={{padding:"14px 18px",background:"var(--bg-elev-2)"}}>
      <div style={{display:"flex",flexDirection:"column",gap:10,maxHeight:420,overflowY:"auto"}}>
        {MSGS.map((m,i)=>(
          <div key={i} style={{display:"flex",justifyContent:m.from==="clinic"?"flex-start":"flex-end"}}>
            <div style={{maxWidth:"70%",padding:"8px 12px",borderRadius:m.from==="clinic"?"3px 12px 12px 12px":"12px 3px 12px 12px",background:m.from==="clinic"?"var(--bg-elev-1)":"var(--brand-500)",color:m.from==="clinic"?"var(--text-1)":"#fff",border:m.from==="clinic"?"1px solid var(--border-soft)":"none"}}>
              <div style={{fontSize:13}}>{m.text}</div>
              <div className="mono" style={{fontSize:10,opacity:.6,marginTop:4}}>{m.time}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{marginTop:10,padding:"8px 10px",background:"var(--bg-elev-1)",borderRadius:9,fontSize:11,color:"var(--text-3)",textAlign:"center",border:"1px dashed var(--border-soft)"}}>
        Read-only Â· canal Twilio (Fase 2) â€” la clÃ­nica responde desde WhatsApp Business
      </div>
    </div>
  );
}

window.OrthoSections2 = { SecPlan, SecCitas, SecFinanciero, SecRetencion, SecDocumentos };
