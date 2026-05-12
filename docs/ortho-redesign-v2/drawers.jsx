/* eslint-disable */
// MediFlow Orto Â· 15 drawers/modales

const { I, PHOTO_KINDS_INTRA, PHOTO_KINDS_EXTRA, ARCHES } = window.OrthoCommon;
const { ToothPicker, ComparisonSlider, PhotoTile } = window.OrthoAtoms;
const { useState, useEffect } = React;

function Backdrop({onClose, children, side="right", width=620}){
  const node = (
    <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,width:"100vw",height:"100vh",zIndex:9999,display:"flex",justifyContent:side==="right"?"flex-end":"center",alignItems:side==="center"?"center":"stretch",background:"rgba(8,9,12,.62)",backdropFilter:"blur(4px)",WebkitBackdropFilter:"blur(4px)",animation:"fadein .15s ease-out"}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:"var(--bg-elev-1)",width:side==="right"?width:Math.min(width,900),height:side==="right"?"100vh":"auto",maxHeight:side==="center"?"86vh":"100vh",borderRadius:side==="center"?14:0,border:"1px solid var(--border-strong)",overflowY:"auto",animation:side==="right"?"slidein .2s cubic-bezier(.16,1,.3,1)":"popin .18s cubic-bezier(.16,1,.3,1)",boxShadow:"-30px 0 60px rgba(0,0,0,.35)",display:"flex",flexDirection:"column"}}>
        {children}
      </div>
    </div>
  );
  return ReactDOM.createPortal ? ReactDOM.createPortal(node, document.body) : node;
}

function DrawerHead({title, sub, onClose, badge, actions}){
  return (
    <div style={{position:"sticky",top:0,background:"var(--bg-elev-1)",zIndex:2,padding:"16px 20px",borderBottom:"1px solid var(--border-soft)",display:"flex",alignItems:"center",gap:12}}>
      <div style={{flex:1}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <h2 style={{fontSize:18,fontWeight:600,fontFamily:"'Sora',sans-serif"}}>{title}</h2>
          {badge && <span className="b b-brand">{badge}</span>}
        </div>
        {sub && <p style={{fontSize:12,color:"var(--text-3)",marginTop:2}}>{sub}</p>}
      </div>
      {actions}
      <button className="btn-icon-sm" onClick={onClose} title="Cerrar Â· Esc"><I n="x" size={16}/></button>
    </div>
  );
}

function DrawerFoot({left, right}){
  return (
    <div style={{position:"sticky",bottom:0,background:"var(--bg-elev-1)",padding:"12px 20px",borderTop:"1px solid var(--border-soft)",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
      <div style={{display:"flex",gap:6,alignItems:"center"}}>{left}</div>
      <div style={{display:"flex",gap:6}}>{right}</div>
    </div>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 1. DRAWER Â· Editar diagnÃ³stico
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function DrEditDx({onClose}){
  return (
    <Backdrop onClose={onClose} width={720}>
      <DrawerHead title="Editar diagnÃ³stico" sub="Captura completa o secciÃ³n por secciÃ³n" onClose={onClose}/>
      <div style={{padding:"18px 20px",display:"flex",flexDirection:"column",gap:14}}>
        <div className="card" style={{padding:"14px 16px",background:"var(--bg-elev-2)"}}>
          <div className="h-eyebrow">ClasificaciÃ³n de Angle</div>
          <div style={{display:"flex",gap:5,marginTop:8,flexWrap:"wrap"}}>
            {["I","II Div 1","II Div 2","III","Combinada"].map((l,i)=>(<button key={l} className="chip-sel" data-on={i===1?"true":"false"}>{l}</button>))}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginTop:10}}>
            <div><label className="label-new">Overjet (mm)</label><input className="input-new mono" defaultValue="6"/></div>
            <div><label className="label-new">Overbite (mm)</label><input className="input-new mono" defaultValue="4"/></div>
            <div><label className="label-new">Tipo de mordida</label><select className="select-new"><option>Normal</option><option>Profunda</option><option>Abierta</option></select></div>
          </div>
        </div>

        <div className="card" style={{padding:"14px 16px",background:"var(--bg-elev-2)"}}>
          <div className="h-eyebrow">ApiÃ±amiento</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:8}}>
            <div><label className="label-new">Maxilar (mm)</label><input className="input-new mono" defaultValue="3"/></div>
            <div><label className="label-new">Mandibular (mm)</label><input className="input-new mono" defaultValue="5"/></div>
          </div>
        </div>

        <div className="card" style={{padding:"14px 16px",background:"var(--bg-elev-2)"}}>
          <div className="h-eyebrow">Diastemas Â· selecciona dientes implicados</div>
          <div style={{marginTop:10,display:"flex",justifyContent:"center"}}>
            <ToothPicker selected={[11,21,31,41]} compact/>
          </div>
        </div>

        <div className="card" style={{padding:"14px 16px",background:"var(--bg-elev-2)"}}>
          <div className="h-eyebrow">HÃ¡bitos parafuncionales</div>
          <div style={{display:"flex",gap:5,flexWrap:"wrap",marginTop:8}}>
            {["Respirador bucal","DegluciÃ³n atÃ­pica","SucciÃ³n digital","Onicofagia","Bruxismo","Interp. lingual"].map((l,i)=>(
              <button key={l} className="chip-sel" data-on={i===0||i===4?"true":"false"}>{l}</button>
            ))}
          </div>
        </div>

        <div className="card" style={{padding:"14px 16px",background:"var(--bg-elev-2)"}}>
          <div className="h-eyebrow">Resumen narrativo</div>
          <textarea className="textarea-new" rows={4} style={{marginTop:8}} defaultValue="Paciente femenino 24 aÃ±os Â· Clase II Div 1 Â· resalte 6mm Â· apiÃ± mand 5mm Â· mesofacial..."/>
        </div>
      </div>
      <DrawerFoot
        left={<span style={{fontSize:11,color:"var(--text-3)"}}>Auto-guardado Â· hace 8 seg</span>}
        right={<>
          <button className="btn-new btn-new--ghost btn-sm" onClick={onClose}>Cancelar</button>
          <button className="btn-new btn-new--primary btn-sm" onClick={onClose}><I n="check"/>Guardar</button>
        </>}
      />
    </Backdrop>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 2. DRAWER Â· Upload fotos
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function DrUploadPhotos({onClose}){
  const [stage, setStage] = useState("T1");
  return (
    <Backdrop onClose={onClose} width={680}>
      <DrawerHead title="Subir foto-set" sub={`Asigna a una etapa y arrastra tus archivos. ${stage} â€¢ Gabriela R.`} onClose={onClose}/>
      <div style={{padding:"18px 20px",display:"flex",flexDirection:"column",gap:14}}>
        <div>
          <label className="label-new">Asignar a etapa</label>
          <div style={{display:"flex",gap:5}}>
            {["T0","T1","T2","T3 Â· nueva"].map((s,i)=>(<button key={s} className="chip-sel" data-on={s===stage?"true":"false"} onClick={()=>setStage(s)}>{s}</button>))}
          </div>
        </div>

        <div style={{padding:36,border:"2.5px dashed var(--brand-500)",borderRadius:14,background:"var(--brand-50)",textAlign:"center"}}>
          <I n="uploadcloud" size={36}/>
          <h3 style={{marginTop:10,fontSize:16,fontWeight:600}}>Arrastra archivos aquÃ­</h3>
          <p style={{fontSize:12,color:"var(--text-2)",marginTop:4}}>JPG, PNG, DICOM, STL, OBJ Â· hasta 50 MB cada uno</p>
          <button className="btn-new btn-new--primary btn-sm" style={{marginTop:12}}>Examinar archivos</button>
        </div>

        <div>
          <div className="h-eyebrow" style={{marginBottom:8}}>Cola de subida Â· 4 archivos</div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {[
              ["IMG_2034.jpg","Frontal sonrisa","done","100%"],
              ["IMG_2035.jpg","Lateral derecha","uploading","68%"],
              ["IMG_2036.jpg","Oclusal sup","pending","â€”"],
              ["pano-15-oct.dcm","PanorÃ¡mica","pending","â€”"],
            ].map((f,i)=>(
              <div key={i} style={{padding:"10px 12px",background:"var(--bg-elev-2)",borderRadius:8,display:"grid",gridTemplateColumns:"24px 1fr 160px 60px 24px",gap:10,alignItems:"center"}}>
                <I n={f[2]==="done"?"check":"filetext"} size={14} color={f[2]==="done"?"var(--success)":"var(--text-2)"}/>
                <div>
                  <div className="mono" style={{fontSize:12}}>{f[0]}</div>
                  <div style={{fontSize:10,color:"var(--text-3)",marginTop:2}}>{f[1]}</div>
                </div>
                <select className="select-new" style={{height:30,fontSize:12}}><option>{f[1]}</option><option>Frontal natural</option><option>Lateral I</option></select>
                <span className="mono" style={{fontSize:11,color:f[2]==="done"?"var(--success)":"var(--text-3)"}}>{f[3]}</span>
                <button className="btn-icon-sm"><I n="x" size={11}/></button>
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{padding:"12px 14px",background:"var(--violet-bg)",border:"1px solid var(--violet-500)",display:"flex",alignItems:"center",gap:10}}>
          <I n="smart" size={20} color="var(--violet-500)"/>
          <div style={{flex:1,fontSize:12}}>
            <strong>Â¿Tomarlas desde tu celular?</strong> Escanea QR y captura con guÃ­a de encuadre nativa.
          </div>
          <button className="btn-new btn-new--ghost btn-sm">Ver QR</button>
        </div>
      </div>
      <DrawerFoot
        left={<span style={{fontSize:11,color:"var(--text-3)"}}>1 de 4 subidos</span>}
        right={<>
          <button className="btn-new btn-new--ghost btn-sm" onClick={onClose}>Cancelar</button>
          <button className="btn-new btn-new--primary btn-sm"><I n="uploadcloud"/>Subir 3 archivos</button>
        </>}
      />
    </Backdrop>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 3. MODAL Â· Lightbox + anotaciones
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function ModalLightbox({onClose, action}){
  const [tool, setTool] = useState(action==="ruler"?"ruler":action==="annot"?"arrow":"none");
  return (
    <Backdrop onClose={onClose} side="center" width={1080}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 260px",height:"86vh"}}>
        <div style={{background:"#0f1115",position:"relative",display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{position:"absolute",top:12,left:12,display:"flex",gap:6,zIndex:2}}>
            <span className="b b-brand">T1</span>
            <span className="b b-neutral" style={{background:"rgba(255,255,255,.1)",color:"#fff"}}>Frontal sonrisa Â· 15 oct 2025</span>
          </div>
          <div style={{position:"absolute",top:12,right:12,display:"flex",gap:6,zIndex:2}}>
            <button className="btn-icon-sm" style={{background:"rgba(255,255,255,.1)",color:"#fff"}}><I n="star" size={14}/></button>
            <button className="btn-icon-sm" style={{background:"rgba(255,255,255,.1)",color:"#fff"}}><I n="download" size={14}/></button>
            <button className="btn-icon-sm" style={{background:"rgba(255,255,255,.1)",color:"#fff"}} onClick={onClose}><I n="x" size={14}/></button>
          </div>
          <div style={{width:"80%",aspectRatio:"4/3",borderRadius:9,background:"linear-gradient(135deg, #e8d4c0 0%, #c9a98a 60%, #8b6f4f 100%)",position:"relative",overflow:"hidden"}}>
            <svg viewBox="0 0 400 300" style={{position:"absolute",inset:0,width:"100%",height:"100%"}}>
              <ellipse cx="200" cy="180" rx="60" ry="22" fill="rgba(0,0,0,.65)"/>
              <g fill="#fff">{Array.from({length:8}).map((_,i)=>(<rect key={i} x={155+i*12} y={170} width={8} height={14} rx={1}/>))}</g>
              {tool==="ruler" && <>
                <line x1="155" y1="170" x2="251" y2="170" stroke="#FFE259" strokeWidth="2"/>
                <circle cx="155" cy="170" r="4" fill="#FFE259"/>
                <circle cx="251" cy="170" r="4" fill="#FFE259"/>
                <text x="203" y="160" fill="#FFE259" fontSize="14" textAnchor="middle" fontFamily="JetBrains Mono">9.6 mm</text>
              </>}
              {tool==="arrow" && <>
                <path d="M 110 100 L 175 165" stroke="#FF6B6B" strokeWidth="3" fill="none" markerEnd="url(#arr)"/>
                <defs><marker id="arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#FF6B6B"/></marker></defs>
                <text x="80" y="92" fill="#FF6B6B" fontSize="12" fontFamily="Sora">Diastema 11â€“21</text>
              </>}
            </svg>
          </div>
          <div style={{position:"absolute",bottom:12,left:"50%",transform:"translateX(-50%)",display:"flex",gap:4,padding:6,background:"rgba(255,255,255,.1)",borderRadius:10,backdropFilter:"blur(8px)"}}>
            {[["none","mouse"],["ruler","ruler"],["angle","target"],["arrow","arrowright"],["circle","activity"],["text","filetext"]].map(([k,i])=>(
              <button key={k} className="btn-icon-sm" style={{background:tool===k?"var(--brand-500)":"transparent",color:"#fff"}} onClick={()=>setTool(k)}><I n={i} size={14}/></button>
            ))}
          </div>
        </div>
        <div style={{padding:"14px 16px",background:"var(--bg-elev-1)",display:"flex",flexDirection:"column",gap:14}}>
          <div>
            <h3 className="h-card">Detalles</h3>
            <div style={{display:"flex",flexDirection:"column",gap:4,marginTop:8,fontSize:12}}>
              <div style={{display:"flex",justifyContent:"space-between"}}><span style={{color:"var(--text-3)"}}>Tipo</span><span>Frontal sonrisa</span></div>
              <div style={{display:"flex",justifyContent:"space-between"}}><span style={{color:"var(--text-3)"}}>Etapa</span><span>T1</span></div>
              <div style={{display:"flex",justifyContent:"space-between"}}><span style={{color:"var(--text-3)"}}>Tomada</span><span className="mono">15 oct 25 Â· 11:08</span></div>
              <div style={{display:"flex",justifyContent:"space-between"}}><span style={{color:"var(--text-3)"}}>TamaÃ±o</span><span className="mono">2.4 MB Â· 3024Ã—2016</span></div>
              <div style={{display:"flex",justifyContent:"space-between"}}><span style={{color:"var(--text-3)"}}>Favorita</span><span style={{color:"var(--brand-500)"}}>â˜… SÃ­</span></div>
            </div>
          </div>
          <div>
            <div className="h-eyebrow">Mediciones Â· 1</div>
            <div style={{marginTop:6,padding:"8px 10px",background:"var(--bg-elev-2)",borderRadius:7,fontSize:12,display:"flex",alignItems:"center",gap:8}}>
              <I n="ruler" size={14}/><span style={{flex:1}}>Diastema central</span><span className="mono">9.6 mm</span>
              <button className="btn-icon-sm"><I n="x" size={11}/></button>
            </div>
          </div>
          <div>
            <div className="h-eyebrow">Anotaciones Â· 2</div>
            <div style={{display:"flex",flexDirection:"column",gap:5,marginTop:6}}>
              {["Diastema 11â€“21","LÃ­nea media desviada"].map(t=>(
                <div key={t} style={{padding:"8px 10px",background:"var(--bg-elev-2)",borderRadius:7,fontSize:12,display:"flex",gap:8}}>
                  <span style={{width:8,height:8,borderRadius:"50%",background:"#FF6B6B",marginTop:6}}/>{t}
                </div>
              ))}
            </div>
          </div>
          <div style={{marginTop:"auto",display:"flex",flexDirection:"column",gap:6}}>
            <button className="btn-new btn-new--ghost btn-sm"><I n="gitcompare"/>Comparar con T0</button>
            <button className="btn-new btn-new--primary btn-sm"><I n="check"/>Guardar cambios</button>
          </div>
        </div>
      </div>
    </Backdrop>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 4. DRAWER Â· Nueva Treatment Card
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function DrNewTC({onClose}){
  const [tmpl, setTmpl] = useState("control");
  return (
    <Backdrop onClose={onClose} width={760}>
      <DrawerHead title="Nueva Treatment Card" sub="Llena despuÃ©s de la consulta Â· plantilla pre-llena 80%" onClose={onClose} badge="Cita #8"/>
      <div style={{padding:"18px 20px",display:"flex",flexDirection:"column",gap:14}}>
        <div>
          <label className="label-new">Plantilla de nota rÃ¡pida</label>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6}}>
            {[["control","Control mensual"],["arch","Cambio de arco"],["elast","ActivaciÃ³n elÃ¡st"],["bracket","Bracket caÃ­do"]].map(([k,l])=>(
              <button key={k} className="card" data-on={tmpl===k?"true":"false"} onClick={()=>setTmpl(k)} style={{padding:"10px 12px",fontSize:12,border:"1.5px solid "+(tmpl===k?"var(--brand-500)":"var(--border-soft)"),background:tmpl===k?"var(--brand-50)":"var(--bg-elev-2)",cursor:"pointer",fontFamily:"inherit",fontWeight:500}}>{l}</button>
            ))}
          </div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
          <div><label className="label-new">Fecha</label><input className="input-new mono" defaultValue="2025-11-12"/></div>
          <div><label className="label-new">Hora</label><input className="input-new mono" defaultValue="10:30"/></div>
          <div><label className="label-new">Tipo</label><select className="select-new"><option>Control mensual</option><option>InstalaciÃ³n</option><option>Urgencia</option><option>Debonding</option></select></div>
        </div>

        <div className="card" style={{padding:"14px 16px",background:"var(--bg-elev-2)"}}>
          <div className="h-eyebrow">Arco colocado Â· auto-completado desde wire sequencing</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginTop:8}}>
            <div><label className="label-new">Material</label><select className="select-new"><option>NiTi</option><option>SS</option><option>TMA</option></select></div>
            <div><label className="label-new">Calibre</label><input className="input-new mono" defaultValue=".018"/></div>
            <div><label className="label-new">DimensiÃ³n</label><input className="input-new mono" defaultValue="redondo"/></div>
          </div>
          <div style={{marginTop:8,display:"flex",alignItems:"center",gap:8,fontSize:11,color:"var(--violet-500)"}}><I n="link" size={12}/>Plan #4 Â· auto-avanza al colocarse</div>
        </div>

        <div className="card" style={{padding:"14px 16px",background:"var(--bg-elev-2)"}}>
          <div className="h-eyebrow">Activaciones realizadas</div>
          <div style={{display:"flex",gap:5,flexWrap:"wrap",marginTop:8}}>
            {["Closing loop","T-loop","Omega bend","DistalizaciÃ³n","Step bend","Torque ant","Torque post"].map((l,i)=>(<button key={l} className="chip-sel" data-on={i===0?"true":"false"}>{l}</button>))}
          </div>
          <textarea className="textarea-new" rows={2} style={{marginTop:8}} placeholder="Detalle adicional..." defaultValue="Closing loop 24-26 para cierre de extracciÃ³n."/>
        </div>

        <div className="card" style={{padding:"14px 16px",background:"var(--bg-elev-2)"}}>
          <div className="h-eyebrow">ElÃ¡sticos & compliance</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginTop:8}}>
            <div><label className="label-new">Clase</label><select className="select-new"><option>Clase II</option><option>Clase III</option><option>Box</option></select></div>
            <div><label className="label-new">Hrs/dÃ­a prescritas</label><input className="input-new mono" defaultValue="18"/></div>
            <div><label className="label-new">Compliance reportado</label>
              <div style={{display:"flex",gap:5}}>{["Bueno","Regular","Malo"].map((l,i)=>(<button key={l} className="chip-sel" data-on={i===0?"true":"false"}>{l}</button>))}</div>
            </div>
          </div>
        </div>

        <div className="card" style={{padding:"14px 16px",background:"var(--bg-elev-2)"}}>
          <div className="h-eyebrow">Brackets caÃ­dos / recolocados</div>
          <p style={{fontSize:11,color:"var(--text-3)",marginTop:4,marginBottom:8}}>Selecciona dientes afectados</p>
          <div style={{display:"flex",justifyContent:"center"}}><ToothPicker selected={[24]} compact mode="bracket"/></div>
        </div>

        <div className="card" style={{padding:"14px 16px",background:"var(--bg-elev-2)"}}>
          <div className="h-eyebrow">Notas SOAP</div>
          {[["S â€” Subjetivo","Paciente refiere molestia leve dÃ­a 3, tolera bien elÃ¡sticos."],
            ["O â€” Objetivo","Bracket 24 desadaptado. Resto bien. EncÃ­as sin inflamaciÃ³n."],
            ["A â€” AnÃ¡lisis","Progreso esperado Â· alineaciÃ³n avanzada."],
            ["P â€” Plan","Recolocar 24. Cambio a .018 NiTi. Continuar elÃ¡st II R+L 18 hrs."]].map(([l,d],i)=>(
              <div key={i} style={{marginTop:8}}>
                <label className="label-new">{l}</label>
                <textarea className="textarea-new" rows={2} defaultValue={d}/>
              </div>
          ))}
        </div>

        <div className="card" style={{padding:"14px 16px",background:"var(--bg-elev-2)"}}>
          <div className="h-eyebrow">Indicaciones para casa</div>
          <div style={{display:"flex",gap:5,flexWrap:"wrap",marginTop:8,marginBottom:8}}>
            {["ElÃ¡sticos 18 hrs","Cera ortodÃ³ntica si molestia","Cepillo interdental","Evitar duros 24h","AnalgÃ©sico PRN"].map((l,i)=>(<button key={l} className="chip-sel" data-on={i<3?"true":"false"}>{l}</button>))}
          </div>
          <textarea className="textarea-new" rows={2} defaultValue="Llamar si bracket vuelve a caerse antes de prÃ³xima cita."/>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div><label className="label-new">PrÃ³xima cita sugerida</label><input className="input-new mono" defaultValue="2025-12-10"/></div>
          <div><label className="label-new">Foto-set asociado</label><button className="btn-new btn-new--ghost" style={{width:"100%",justifyContent:"flex-start"}}><I n="cam"/>Vincular T2 (opcional)</button></div>
        </div>
      </div>
      <DrawerFoot
        left={<span style={{fontSize:11,color:"var(--text-3)"}}>Auto-guardado Â· hace 3 seg</span>}
        right={<>
          <button className="btn-new btn-new--ghost btn-sm" onClick={onClose}>Borrador</button>
          <button className="btn-new btn-new--primary btn-sm" onClick={onClose}><I n="check"/>Cerrar card</button>
        </>}
      />
    </Backdrop>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 5. DRAWER Â· Editar plan financiero  (reactivo + 3 modalidades)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const MXN = (n)=> "$"+Math.round(n).toLocaleString("en-US");

function DrEditFinancial({onClose, onSaved}){
  const [mod, setMod] = useState("plan");           // contado | plan | credito
  const [total, setTotal] = useState(50000);
  const [descuento, setDescuento] = useState(8);    // % pronto pago
  const [enganche, setEnganche] = useState(8000);
  const [meses, setMeses] = useState(18);
  const [mensualManual, setMensualManual] = useState(null);
  const [apr, setApr] = useState(12);               // tasa anual % (modalidad crÃ©dito)
  const [firstDate, setFirstDate] = useState("2025-12-01");
  const [frecuencia, setFrecuencia] = useState("mensual");
  const [graciaDias, setGraciaDias] = useState(5);
  const [recargoPct, setRecargoPct] = useState(3);
  const [showLate, setShowLate] = useState(false);
  const [saved, setSaved] = useState(false);
  const [scenarios, setScenarios] = useState([
    {id:"A",label:"12 meses", mod:"plan",   total:50000, enganche:15000, meses:12, apr:0},
    {id:"B",label:"18 meses", mod:"plan",   total:50000, enganche:8000,  meses:18, apr:0, active:true},
    {id:"C",label:"24 meses", mod:"credito",total:50000, enganche:5000,  meses:24, apr:12},
  ]);

  // Reactividad: cÃ¡lculos derivados
  const totalContado = Math.max(0, Math.round(total * (1 - descuento/100)));
  const ahorroContado = total - totalContado;

  const financiado = Math.max(0, total - enganche);
  const nPagos = mod==="contado" ? 0 : meses;
  const r = apr/100/12;
  const mensualCalc = nPagos>0
    ? (mod==="credito" && r>0
        ? financiado * r / (1 - Math.pow(1+r, -nPagos))
        : financiado / nPagos)
    : 0;
  const mensual = mensualManual!=null ? mensualManual : Math.round(mensualCalc);
  const totalPlan = enganche + mensual*nPagos;
  const intereses = mod==="credito" ? Math.max(0, totalPlan - total) : 0;
  const variance = nPagos>0 ? Math.abs(totalPlan - (mod==="credito"? Math.round(enganche + mensualCalc*nPagos) : total)) : 0;
  const validOk = mod==="contado" ? true : variance <= 10;

  const setEngPct = (p)=> setEnganche(Math.round(total*p/100));
  const engPct = total>0 ? Math.round(enganche/total*100) : 0;

  const onTotalChange = (v)=>{ setTotal(v); setMensualManual(null); };
  const onMesesChange = (n)=>{ setMeses(n); setMensualManual(null); };
  const onEngChange = (v)=>{ setEnganche(v); setMensualManual(null); };
  const onAprChange = (v)=>{ setApr(v); setMensualManual(null); };

  function save(){
    setSaved(true);
    setTimeout(()=>{ onSaved && onSaved({mod,total,enganche,meses,mensual,apr,totalPlan,intereses,totalContado}); onClose(); }, 850);
  }

  const [flash, setFlash] = useState(null);
  function loadScenario(s){
    setMod(s.mod); setTotal(s.total); setEnganche(s.enganche); setMeses(s.meses); setApr(s.apr||0); setMensualManual(null);
    setScenarios(prev => prev.map(x => ({...x, active: x.id===s.id})));
    setFlash(s.id);
    setTimeout(()=>setFlash(null), 1200);
    // scroll drawer to top so user sees the values it loaded
    requestAnimationFrame(()=>{
      const sc = document.querySelector('[data-drawer-scroll="fin"]');
      if(sc) sc.scrollTo({top:0, behavior:"smooth"});
    });
  }

  function saveScenario(){
    const next = [...scenarios];
    const idx = next.findIndex(x=>x.active);
    next.forEach(x=>x.active=false);
    if(idx>=0) next[idx] = {...next[idx], mod,total,enganche,meses,apr,active:true,label: mod==="contado"?"Contado":`${meses} meses${apr?" Â· "+apr+"%":""}`};
    setScenarios(next);
  }

  return (
    <Backdrop onClose={onClose} width={680}>
      <DrawerHead title="Editar plan financiero" sub="Reactivo Â· cualquier cambio recalcula al instante" onClose={onClose}/>

      <div data-drawer-scroll="fin" style={{flex:1,padding:"18px 20px",display:"flex",flexDirection:"column",gap:14,overflowY:"auto"}}>

        {/* MODALIDAD selector */}
        <div>
          <div className="h-eyebrow" style={{marginBottom:8}}>Modalidad de pago</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
            {[
              {k:"contado", t:"Pago de contado", d:"1 sola exhibiciÃ³n Â· descuento opcional", i:"dollar"},
              {k:"plan",    t:"Plan sin intereses", d:"Enganche + N mensualidades fijas", i:"calplus"},
              {k:"credito", t:"Plan con intereses", d:"Tasa anual + amortizaciÃ³n Â· CAT", i:"trending"},
            ].map(o=>(
              <button key={o.k} onClick={()=>setMod(o.k)} className="card" style={{padding:"12px 12px",textAlign:"left",cursor:"pointer",border:"1.5px solid "+(mod===o.k?"var(--brand-500)":"var(--border-soft)"),background:mod===o.k?"var(--brand-50)":"var(--bg-elev-2)",fontFamily:"inherit",color:"inherit",display:"flex",flexDirection:"column",gap:6}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{width:24,height:24,borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",background:mod===o.k?"var(--brand-500)":"var(--bg-elev-3,var(--bg-elev-1))",color:mod===o.k?"#fff":"var(--text-2)"}}><I n={o.i} size={13}/></span>
                  <span style={{fontSize:13,fontWeight:600}}>{o.t}</span>
                </div>
                <div style={{fontSize:11,color:"var(--text-3)",lineHeight:1.35}}>{o.d}</div>
              </button>
            ))}
          </div>
        </div>

        {/* TOTAL */}
        <div className="card" style={{padding:"14px 16px",background:"var(--bg-elev-2)"}}>
          <div className="h-eyebrow">Total del tratamiento</div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginTop:6}}>
            <input className="input-new mono" style={{flex:1,fontSize:18,fontWeight:600}} value={total} onChange={e=>onTotalChange(+e.target.value||0)}/>
            <span className="b b-neutral" style={{whiteSpace:"nowrap"}}>MXN</span>
          </div>
        </div>

        {/* === Pago de contado === */}
        {mod==="contado" && (
          <div className="card" style={{padding:"14px 16px",background:"var(--bg-elev-2)"}}>
            <div className="h-eyebrow">Descuento pronto pago</div>
            <div style={{display:"flex",gap:5,flexWrap:"wrap",marginTop:8}}>
              {[0,5,8,10,15].map(p=>(<button key={p} className="chip-sel" data-on={p===descuento?"true":"false"} onClick={()=>setDescuento(p)}>{p}%</button>))}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:10}}>
              <div><label className="label-new">Descuento %</label><input className="input-new mono" value={descuento} onChange={e=>setDescuento(+e.target.value||0)}/></div>
              <div><label className="label-new">Fecha esperada</label><input className="input-new mono" type="date" value={firstDate} onChange={e=>setFirstDate(e.target.value)}/></div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:12,padding:"12px 14px",background:"var(--brand-50)",borderRadius:9,border:"1px solid var(--brand-500)"}}>
              <div><div className="h-eyebrow">Total a pagar</div><div className="mono" style={{fontSize:22,fontWeight:600,color:"var(--brand-700)",marginTop:2}}>{MXN(totalContado)}</div></div>
              <div><div className="h-eyebrow">Ahorro vs lista</div><div className="mono" style={{fontSize:22,fontWeight:600,color:"var(--success)",marginTop:2}}>âˆ’{MXN(ahorroContado)}</div></div>
            </div>
          </div>
        )}

        {/* === Plan / CrÃ©dito === */}
        {mod!=="contado" && (
          <>
            <div className="card" style={{padding:"14px 16px",background:"var(--bg-elev-2)"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
                <div className="h-eyebrow">Enganche</div>
                <span className="mono" style={{fontSize:11,color:"var(--text-3)"}}>{engPct}% del total</span>
              </div>
              <div style={{display:"flex",gap:5,flexWrap:"wrap",marginTop:8}}>
                {[0,10,15,20,30,50].map(p=>(<button key={p} className="chip-sel" data-on={engPct===p?"true":"false"} onClick={()=>setEngPct(p)}>{p}%</button>))}
              </div>
              <input className="input-new mono" style={{marginTop:10,fontWeight:600}} value={enganche} onChange={e=>onEngChange(+e.target.value||0)}/>
            </div>

            <div className="card" style={{padding:"14px 16px",background:"var(--bg-elev-2)"}}>
              <div className="h-eyebrow">Plazo</div>
              <div style={{display:"flex",gap:5,flexWrap:"wrap",marginTop:8}}>
                {[3,6,9,12,18,24,36].map(n=>(<button key={n} className="chip-sel" data-on={n===meses?"true":"false"} onClick={()=>onMesesChange(n)}>{n}</button>))}
                <button className="chip-sel">Custom</button>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:10}}>
                <div><label className="label-new">NÂ° pagos</label><input className="input-new mono" value={meses} onChange={e=>onMesesChange(+e.target.value||0)}/></div>
                <div><label className="label-new">Frecuencia</label>
                  <select className="select-new" value={frecuencia} onChange={e=>setFrecuencia(e.target.value)}>
                    <option value="mensual">Mensual</option>
                    <option value="quincenal">Quincenal</option>
                  </select>
                </div>
              </div>
            </div>

            {mod==="credito" && (
              <div className="card" style={{padding:"14px 16px",background:"var(--bg-elev-2)"}}>
                <div className="h-eyebrow">Tasa de interÃ©s anual</div>
                <div style={{display:"flex",alignItems:"center",gap:10,marginTop:8}}>
                  <input type="range" min="0" max="36" step="0.5" value={apr} onChange={e=>onAprChange(+e.target.value)} style={{flex:1,accentColor:"var(--brand-500)"}}/>
                  <input className="input-new mono" style={{width:90,fontWeight:600}} value={apr} onChange={e=>onAprChange(+e.target.value||0)}/>
                  <span className="mono" style={{fontSize:12,color:"var(--text-3)"}}>%</span>
                </div>
                <p style={{fontSize:11,color:"var(--text-3)",marginTop:6}}>Equivale a CAT informativo â‰ˆ <span className="mono">{(apr*1.05).toFixed(1)}%</span> Â· cÃ¡lculo amortizaciÃ³n francesa</p>
              </div>
            )}

            <div className="card" style={{padding:"14px 16px",background:"var(--bg-elev-2)"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
                <div className="h-eyebrow">Monto por pago</div>
                {mensualManual!=null && <button className="btn-icon-sm" style={{fontSize:10,padding:"2px 8px",width:"auto"}} onClick={()=>setMensualManual(null)}>Auto</button>}
              </div>
              <div style={{display:"flex",alignItems:"center",gap:10,marginTop:6}}>
                <input className="input-new mono" style={{flex:1,fontSize:18,fontWeight:600}} value={mensual} onChange={e=>setMensualManual(+e.target.value||0)}/>
                <span className="b" style={{whiteSpace:"nowrap",background: mensualManual==null?"var(--success-bg)":"var(--warning-bg)",color: mensualManual==null?"var(--success)":"var(--warning)"}}>{mensualManual==null?"Auto":"Manual"}</span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginTop:12,paddingTop:12,borderTop:"1px solid var(--border-soft)"}}>
                <div><div className="h-eyebrow">Total a pagar</div><div className="mono" style={{fontWeight:600,marginTop:2}}>{MXN(totalPlan)}</div></div>
                <div><div className="h-eyebrow">Financiado</div><div className="mono" style={{fontWeight:600,marginTop:2}}>{MXN(financiado)}</div></div>
                <div><div className="h-eyebrow">{mod==="credito"?"Intereses":"Costo extra"}</div><div className="mono" style={{fontWeight:600,marginTop:2,color: intereses>0?"var(--warning)":"var(--text-3)"}}>{intereses>0?"+":""}{MXN(intereses)}</div></div>
              </div>
              <div><label className="label-new" style={{marginTop:10}}>Fecha del 1er pago</label><input className="input-new mono" type="date" value={firstDate} onChange={e=>setFirstDate(e.target.value)}/></div>
            </div>
          </>
        )}

        {/* ValidaciÃ³n */}
        {mod!=="contado" && (
          <div style={{padding:"10px 14px",background:validOk?"var(--success-bg)":"var(--danger-bg)",borderRadius:9,border:"1px solid "+(validOk?"var(--success)":"var(--danger)"),display:"flex",alignItems:"center",gap:8}}>
            <I n={validOk?"check":"alert"} size={16} color={validOk?"var(--success)":"var(--danger)"}/>
            <span style={{fontSize:12,color:validOk?"var(--success)":"var(--danger)"}}>
              {validOk?"ValidaciÃ³n OK Â· ":"Diferencia $"+variance+" Â· "}
              <span className="mono">{MXN(enganche)} + ({MXN(mensual)} Ã— {meses}) = {MXN(totalPlan)}</span>
            </span>
          </div>
        )}

        {/* PolÃ­tica mora colapsible */}
        {mod!=="contado" && (
          <div className="card" style={{padding:"0",background:"var(--bg-elev-2)",overflow:"hidden"}}>
            <button onClick={()=>setShowLate(!showLate)} style={{width:"100%",padding:"12px 16px",display:"flex",alignItems:"center",gap:8,background:"transparent",border:"none",cursor:"pointer",fontFamily:"inherit",color:"inherit",textAlign:"left"}}>
              <I n={showLate?"chevdown":"chevright"} size={14}/>
              <div className="h-eyebrow" style={{flex:1}}>PolÃ­tica de pagos tardÃ­os</div>
              <span style={{fontSize:11,color:"var(--text-3)"}}>{graciaDias}d gracia Â· {recargoPct}% recargo</span>
            </button>
            {showLate && (
              <div style={{padding:"4px 16px 14px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div><label className="label-new">DÃ­as de gracia</label><input className="input-new mono" value={graciaDias} onChange={e=>setGraciaDias(+e.target.value||0)}/></div>
                <div><label className="label-new">Recargo % sobre monto</label><input className="input-new mono" value={recargoPct} onChange={e=>setRecargoPct(+e.target.value||0)}/></div>
                <div style={{gridColumn:"span 2",fontSize:11,color:"var(--text-3)"}}>Recordatorio automÃ¡tico WhatsApp 2 dÃ­as antes de cada vencimiento</div>
              </div>
            )}
          </div>
        )}

        {/* ESCENARIOS */}
        <div className="card" style={{padding:"14px 16px",background:"var(--bg-elev-2)"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:8}}>
            <div>
              <div className="h-eyebrow">Escenarios cotizaciÃ³n Â· G5 Open Choice</div>
              <p style={{fontSize:11,color:"var(--text-3)",marginTop:4}}>Carga uno para editarlo Â· guarda como nuevo Â· envÃ­a hasta 3 al paciente</p>
            </div>
            <button className="btn-new btn-new--ghost btn-sm" onClick={saveScenario}><I n="save"/>Guardar actual</button>
          </div>
          {scenarios.map((s,i)=>{
            const mEst = s.mod==="contado" ? 0 : (s.apr>0 ? Math.round((s.total-s.enganche)*(s.apr/100/12)/(1-Math.pow(1+s.apr/100/12,-s.meses))) : Math.round((s.total-s.enganche)/s.meses));
            return (
              <div key={s.id} style={{display:"grid",gridTemplateColumns:"32px 1fr 1fr 1fr 60px",gap:10,padding:"10px 12px",background:s.active?"var(--brand-50)":"var(--bg-elev-1)",borderRadius:8,marginBottom:6,fontSize:12,alignItems:"center",border:"1px solid "+(s.active?"var(--brand-500)":"transparent"),transition:"all .25s",boxShadow: flash===s.id ? "0 0 0 3px var(--brand-500), 0 6px 18px rgba(45,127,249,.25)" : "none"}}>
                <span className="mono" style={{fontWeight:600,fontSize:13}}>{s.id}</span>
                <div>
                  <div style={{fontWeight:500}}>{s.label}{s.active?" Â· actual":""}</div>
                  <div style={{fontSize:10,color:"var(--text-3)",textTransform:"uppercase",letterSpacing:".06em"}}>{s.mod==="contado"?"Contado":s.mod==="credito"?`CrÃ©dito ${s.apr}%`:"Sin intereses"}</div>
                </div>
                <span className="mono">{s.mod==="contado"?"â€”":MXN(s.enganche)+" eng"}</span>
                <span className="mono">{s.mod==="contado"?MXN(Math.round(s.total*0.92)):MXN(mEst)+"/mes"}</span>
                <div style={{display:"flex",gap:4,justifyContent:"flex-end"}}>
                  <button className="btn-icon-sm" title="Cargar para editar" onClick={()=>loadScenario(s)}><I n="pencil" size={11}/></button>
                  <button className="btn-icon-sm" title="Eliminar" onClick={()=>setScenarios(scenarios.filter(x=>x.id!==s.id))}><I n="trash" size={11}/></button>
                </div>
              </div>
            );
          })}
          {scenarios.length<3 && <button className="btn-new btn-new--ghost btn-sm" style={{marginTop:6}} onClick={()=>setScenarios([...scenarios,{id:String.fromCharCode(65+scenarios.length),label:`${meses} meses`,mod,total,enganche,meses,apr}])}><I n="plus"/>Agregar como nuevo escenario</button>}
        </div>
      </div>

      <DrawerFoot
        left={
          <span style={{fontSize:11,color:"var(--text-3)",display:"flex",alignItems:"center",gap:6}}>
            <I n="info" size={12}/>
            {mod==="contado" ? `1 pago de ${MXN(totalContado)}` : `${MXN(enganche)} + ${meses} Ã— ${MXN(mensual)}`}
          </span>
        }
        right={<>
          <button className="btn-new btn-new--ghost btn-sm"><I n="send"/>Enviar al paciente Â· WhatsApp</button>
          <button className="btn-new btn-new--ghost btn-sm" onClick={onClose}>Cancelar</button>
          <button className="btn-new btn-new--primary btn-sm" onClick={save} disabled={!validOk||saved}>
            <I n={saved?"check":"save"}/>{saved?"Guardado":"Guardar plan"}
          </button>
        </>}
      />
      {saved && (
        <div style={{position:"absolute",top:70,right:24,padding:"10px 14px",background:"var(--success)",color:"#fff",borderRadius:8,fontSize:12,fontWeight:500,display:"flex",alignItems:"center",gap:6,boxShadow:"0 8px 24px rgba(0,0,0,.2)",animation:"popin .2s",zIndex:5}}>
          <I n="check" size={14} color="#fff"/>Plan financiero guardado
        </div>
      )}
    </Backdrop>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 6. DRAWER Â· Cobrar mensualidad
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function DrCollect({onClose}){
  return (
    <Backdrop onClose={onClose} width={520}>
      <DrawerHead title="Cobrar mensualidad #8" sub="Vence 12 nov 2025 Â· CFDI 4.0 automÃ¡tico" onClose={onClose} badge="$2,333"/>
      <div style={{padding:"18px 20px",display:"flex",flexDirection:"column",gap:14}}>
        <div style={{padding:18,background:"var(--brand-50)",borderRadius:12,border:"1.5px solid var(--brand-500)",textAlign:"center"}}>
          <div className="h-eyebrow">Monto a cobrar</div>
          <div className="mono" style={{fontSize:36,fontWeight:600,marginTop:4,color:"var(--brand-700)"}}>$2,333.00</div>
          <div style={{fontSize:11,color:"var(--text-3)",marginTop:4}}>Mensualidad 8 de 18 Â· Plan B activo</div>
        </div>

        <div>
          <label className="label-new">MÃ©todo de pago</label>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6}}>
            {[["card","Tarjeta","wand"],["cash","Efectivo","dollar"],["transfer","Transfer","send"],["wa","Link WA","whats"]].map(([k,l,i],idx)=>(
              <button key={k} className="card" data-on={idx===0?"true":"false"} style={{padding:"10px 8px",fontSize:11,fontWeight:500,border:"1.5px solid "+(idx===0?"var(--brand-500)":"var(--border-soft)"),background:idx===0?"var(--brand-50)":"var(--bg-elev-2)",cursor:"pointer",fontFamily:"inherit",display:"flex",flexDirection:"column",gap:4,alignItems:"center"}}>
                <I n={i} size={16}/>{l}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label-new">Datos de facturaciÃ³n CFDI</label>
          <div style={{padding:"10px 12px",background:"var(--bg-elev-2)",borderRadius:8,fontSize:12,display:"flex",alignItems:"center",gap:8}}>
            <I n="filetext" size={14}/>
            <div style={{flex:1}}>
              <div className="mono">GAR240615ABC</div>
              <div style={{fontSize:11,color:"var(--text-3)"}}>Gabriela Reyes Â· Uso CFDI: G03</div>
            </div>
            <button className="btn-icon-sm"><I n="pencil" size={11}/></button>
          </div>
        </div>

        <div className="card" style={{padding:"12px 14px",background:"var(--violet-bg)",border:"1px solid var(--violet-500)",display:"flex",alignItems:"center",gap:10}}>
          <I n="zap" size={18} color="var(--violet-500)"/>
          <div style={{flex:1,fontSize:12}}>
            <strong>CFDI con Facturapi</strong> â€” timbrado automÃ¡tico tras cobro Â· stub Fase 2
          </div>
        </div>

        <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:"var(--text-2)"}}>
          <input type="checkbox" defaultChecked/>Enviar recibo + CFDI por WhatsApp al paciente
        </label>
      </div>
      <DrawerFoot
        left={<span style={{fontSize:11,color:"var(--text-3)"}}>Pagos previos: $20,331</span>}
        right={<>
          <button className="btn-new btn-new--ghost btn-sm" onClick={onClose}>Cancelar</button>
          <button className="btn-new btn-new--primary btn-sm" onClick={onClose}><I n="check"/>Cobrar $2,333</button>
        </>}
      />
    </Backdrop>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 7. DRAWER Â· Tipo aparatologÃ­a nueva
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function DrNewAppliance({onClose}){
  return (
    <Backdrop onClose={onClose} width={500}>
      <DrawerHead title="Agregar tipo de aparatologÃ­a" sub="Queda disponible para futuros pacientes y otros doctores" onClose={onClose}/>
      <div style={{padding:"18px 20px",display:"flex",flexDirection:"column",gap:14}}>
        <div><label className="label-new">Nombre</label><input className="input-new" placeholder="Ej: Brackets pasivos H4"/></div>
        <div><label className="label-new">CÃ³digo corto</label><input className="input-new mono" placeholder="H4"/></div>
        <div><label className="label-new">CategorÃ­a</label>
          <select className="select-new"><option>Fijos Â· metÃ¡licos</option><option>Fijos Â· autoligado</option><option>Fijos Â· estÃ©ticos</option><option>Removibles Â· alineadores</option><option>Linguales</option><option>Otros</option></select>
        </div>
        <div><label className="label-new">Slot</label>
          <div style={{display:"flex",gap:5}}>{[".018",".022","Otro"].map((l,i)=>(<button key={l} className="chip-sel" data-on={i===1?"true":"false"}>{l}</button>))}</div>
        </div>
        <div><label className="label-new">DescripciÃ³n</label><textarea className="textarea-new" rows={3} placeholder="CaracterÃ­sticas distintivas del sistema..."/></div>
        <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:"var(--text-2)"}}>
          <input type="checkbox" defaultChecked/>Compartir con toda la clÃ­nica
        </label>
      </div>
      <DrawerFoot right={<>
        <button className="btn-new btn-new--ghost btn-sm" onClick={onClose}>Cancelar</button>
        <button className="btn-new btn-new--primary btn-sm" onClick={onClose}><I n="check"/>Agregar tipo</button>
      </>}/>
    </Backdrop>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 8. MODAL Â· Cargar plantilla de plan
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function ModalTemplate({onClose}){
  const T = [
    {n:"Clase II Div 1 con extracciones premolares",d:"ExtracciÃ³n 14Â·24 + elÃ¡stica II + 8 arcos Â· 22 meses",pop:"148 usos"},
    {n:"Clase II Div 1 sin extracciones",d:"7 arcos NiTiâ†’SS + elÃ¡stica II R+L Â· 18 meses",pop:"222 usos Â· mÃ¡s usada"},
    {n:"Apinamiento severo con expansor",d:"RPE 4 sem activaciÃ³n + 8 arcos Â· 24 meses",pop:"67 usos"},
    {n:"Mordida cruzada lateral simple",d:"Quad-Helix + 5 arcos Â· 12 meses",pop:"54 usos"},
    {n:"Caso alineadores Invisalign estÃ¡ndar",d:"40 alineadores + refinements Â· 20 meses",pop:"91 usos"},
    {n:"Caso pediÃ¡trico fase 1 Â· interceptivo",d:"Aparato funcional + control Â· 9 meses",pop:"32 usos"},
  ];
  return (
    <Backdrop onClose={onClose} side="center" width={780}>
      <DrawerHead title="Cargar plantilla de plan" sub="Pre-llena diagnÃ³stico, aparatologÃ­a y wire sequencing. DespuÃ©s personalizas." onClose={onClose}/>
      <div style={{padding:"18px 20px"}}>
        <div style={{display:"flex",gap:8,marginBottom:14}}>
          <input className="input-new" placeholder="Buscar plantilla..." style={{flex:1}}/>
          <select className="select-new" style={{width:140}}><option>Todas</option><option>MÃ¡s usadas</option><option>MÃ­as</option></select>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          {T.map((t,i)=>(
            <button key={i} className="card" style={{padding:"12px 14px",textAlign:"left",cursor:"pointer",fontFamily:"inherit",border:"1.5px solid "+(i===1?"var(--brand-500)":"var(--border-soft)"),background:i===1?"var(--brand-50)":"var(--bg-elev-1)"}}>
              <div style={{fontSize:13,fontWeight:500}}>{t.n}</div>
              <div style={{fontSize:11,color:"var(--text-2)",marginTop:4}}>{t.d}</div>
              <div className="mono" style={{fontSize:10,color:"var(--text-3)",marginTop:8}}>{t.pop}</div>
            </button>
          ))}
        </div>
      </div>
      <DrawerFoot
        left={<button className="btn-new btn-new--ghost btn-sm"><I n="plus"/>Crear plantilla nueva</button>}
        right={<>
          <button className="btn-new btn-new--ghost btn-sm" onClick={onClose}>Cancelar</button>
          <button className="btn-new btn-new--primary btn-sm" onClick={onClose}>Cargar plantilla</button>
        </>}
      />
    </Backdrop>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 9. MODAL Â· Foto desde celular (QR)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function ModalMobile({onClose}){
  return (
    <Backdrop onClose={onClose} side="center" width={460}>
      <DrawerHead title="Foto desde celular" sub="Escanea con la cÃ¡mara nativa de tu telÃ©fono" onClose={onClose}/>
      <div style={{padding:"20px",textAlign:"center"}}>
        <div style={{width:220,height:220,background:"#fff",borderRadius:14,margin:"0 auto",padding:14,border:"1px solid var(--border-soft)"}}>
          <svg viewBox="0 0 100 100" width="100%" height="100%" style={{shapeRendering:"crispEdges"}}>
            <rect width="100" height="100" fill="#fff"/>
            {Array.from({length:200}).map((_,i)=>{
              const x = (i*7)%100, y = Math.floor((i*7)/100)*5%100;
              return <rect key={i} x={x} y={y} width="4" height="4" fill={(i*3)%5<2?"#0f1115":"#fff"}/>;
            })}
            <rect x={4} y={4} width={18} height={18} fill="none" stroke="#0f1115" strokeWidth="3"/>
            <rect x={9} y={9} width={8} height={8} fill="#0f1115"/>
            <rect x={78} y={4} width={18} height={18} fill="none" stroke="#0f1115" strokeWidth="3"/>
            <rect x={83} y={9} width={8} height={8} fill="#0f1115"/>
            <rect x={4} y={78} width={18} height={18} fill="none" stroke="#0f1115" strokeWidth="3"/>
            <rect x={9} y={83} width={8} height={8} fill="#0f1115"/>
          </svg>
        </div>
        <p style={{fontSize:13,marginTop:14,color:"var(--text-2)"}}>El link abre la cÃ¡mara con <strong>guÃ­a de encuadre por tipo de foto</strong> (frontal, lateral, oclusal...) y sube directo al expediente.</p>
        <div className="mono" style={{padding:"8px 12px",background:"var(--bg-elev-2)",borderRadius:7,marginTop:10,fontSize:11,color:"var(--text-2)",wordBreak:"break-all"}}>mediflow.mx/m/scan/8XK4-2J9</div>
        <button className="btn-new btn-new--ghost btn-sm" style={{marginTop:10}}><I n="copy"/>Copiar link</button>
      </div>
    </Backdrop>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 10. MODAL Â· Command palette (Cmd+K)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function ModalCmd({onClose}){
  return (
    <Backdrop onClose={onClose} side="center" width={560}>
      <div style={{padding:"14px 18px",borderBottom:"1px solid var(--border-soft)",display:"flex",alignItems:"center",gap:10}}>
        <I n="cmd" size={16}/>
        <input className="input-new" autoFocus placeholder="Saltar a secciÃ³n, paciente o acciÃ³n..." style={{flex:1,border:"none",background:"transparent",fontSize:15}}/>
        <span className="mono" style={{fontSize:10,color:"var(--text-3)",padding:"3px 6px",background:"var(--bg-elev-2)",borderRadius:5}}>ESC</span>
      </div>
      <div style={{padding:"10px 8px",maxHeight:380,overflowY:"auto"}}>
        {[
          {g:"NavegaciÃ³n",items:[["nav-resumen","Ir a Resumen","R"],["nav-expediente","Ir a Expediente clÃ­nico","E"],["nav-fotos","Ir a Fotos y radiografÃ­as","F"],["nav-plan","Ir a Plan de tratamiento","P"],["nav-citas","Ir a Citas y evoluciÃ³n","T"],["nav-financiero","Ir a Plan financiero","$"],["nav-retencion","Ir a RetenciÃ³n","R"],["nav-docs","Ir a Documentos","D"]]},
          {g:"Acciones rÃ¡pidas",items:[["drawer-new-tc","Nueva Treatment Card","N"],["drawer-upload-photos","Subir foto-set","U"],["advance-arch","Avanzar arco siguiente","A"],["drawer-collect","Cobrar prÃ³xima mensualidad","C"]]},
          {g:"Pacientes recientes",items:[["p1","Gabriela Reyes Â· activo","â†’"],["p2","Mauricio Lozano Â· retenciÃ³n","â†’"],["p3","SofÃ­a Castillo Â· nuevo","â†’"]]},
        ].map(group=>(
          <div key={group.g}>
            <div style={{padding:"8px 12px 4px",fontSize:10,textTransform:"uppercase",letterSpacing:".1em",color:"var(--text-3)",fontWeight:600}}>{group.g}</div>
            {group.items.map(([k,l,kb])=>(
              <button key={k} className="cmd-item" onClick={onClose}>
                <span style={{flex:1,textAlign:"left"}}>{l}</span>
                <span className="mono" style={{fontSize:10,padding:"2px 6px",background:"var(--bg-elev-2)",borderRadius:4,color:"var(--text-3)"}}>{kb}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </Backdrop>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 11. DRAWER Â· Editar Treatment Card existente (preview lectura)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function DrEditTC({onClose, idx}){
  return (
    <Backdrop onClose={onClose} width={680}>
      <DrawerHead title={`Treatment Card #${idx+1}`} sub={`Cita ${["20 jun","18 jul","18 ago","15 sep","15 oct"][idx]||"15 oct"} 2025`} onClose={onClose} badge="Cerrada" actions={<button className="btn-new btn-new--ghost btn-sm"><I n="pencil"/>Editar</button>}/>
      <div style={{padding:"18px 20px",display:"flex",flexDirection:"column",gap:12}}>
        {[
          {l:"Tipo de cita",v:"Control mensual"},
          {l:"Arco colocado",v:".016 NiTi (redondo)"},
          {l:"Activaciones",v:"Closing loop 24-26"},
          {l:"ElÃ¡sticos",v:"Clase II R+L Â· 18 hrs/dÃ­a Â· compliance regular"},
          {l:"Brackets caÃ­dos",v:"24 (recolocado)"},
          {l:"PrÃ³xima cita",v:"12 nov 2025 Â· 10:30"},
        ].map(r=>(
          <div key={r.l} style={{display:"grid",gridTemplateColumns:"160px 1fr",gap:12,padding:"10px 0",borderBottom:"1px solid var(--border-soft)"}}>
            <span style={{fontSize:12,color:"var(--text-3)"}}>{r.l}</span>
            <span style={{fontSize:13}}>{r.v}</span>
          </div>
        ))}
        <div style={{padding:"12px 14px",background:"var(--bg-elev-2)",borderRadius:9}}>
          <div className="h-eyebrow">SOAP</div>
          <div style={{fontSize:12,marginTop:6,lineHeight:1.6,color:"var(--text-2)"}}>
            <strong>S:</strong> Paciente refiere molestia leve dÃ­a 3.<br/>
            <strong>O:</strong> Bracket 24 desadaptado.<br/>
            <strong>A:</strong> Progreso esperado.<br/>
            <strong>P:</strong> Recolocar 24. Cambio a .018 NiTi. Continuar elÃ¡st.
          </div>
        </div>
      </div>
    </Backdrop>
  );
}

window.OrthoDrawers = { DrEditDx, DrUploadPhotos, ModalLightbox, DrNewTC, DrEditFinancial, DrCollect, DrNewAppliance, ModalTemplate, ModalMobile, ModalCmd, DrEditTC };
