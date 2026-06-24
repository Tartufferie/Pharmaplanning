import { useState, useMemo, useEffect, useRef } from "react";

// ─── SUPABASE ────────────────────────────────────────────────────────────────
const SB_URL = "https://fqbitotkkmuglicyusoa.supabase.co";
const SB_KEY = "sb_publishable_dDcUP9NlIaifEFNlvx3MXg_aQdpYQsR";

async function sbFetch(path, options = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      "apikey": SB_KEY,
      "Authorization": `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      "Prefer": options.prefer || "return=representation",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase error ${res.status}: ${err}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const db = {
  // Employees
  async getEmployees(sector) {
    return sbFetch(`employees?sector=eq.${sector}&order=created_at.asc`);
  },
  async upsertEmployee(emp) {
    return sbFetch("employees", {
      method: "POST",
      prefer: "return=representation",
      headers: { "Prefer": "return=representation,resolution=merge-duplicates" },
      body: JSON.stringify(emp),
    });
  },
  async deleteEmployee(id) {
    return sbFetch(`employees?id=eq.${id}`, { method: "DELETE", prefer: "" });
  },

  // Weeks
  async getWeeks(sector) {
    return sbFetch(`weeks?sector=eq.${sector}&order=monday.asc`);
  },
  async upsertWeek(week) {
    return sbFetch("weeks", {
      method: "POST",
      prefer: "return=representation",
      headers: { "Prefer": "return=representation,resolution=merge-duplicates" },
      body: JSON.stringify(week),
    });
  },

  // Exchanges
  async getExchanges(sector) {
    return sbFetch(`exchanges?sector=eq.${sector}&order=created_at.desc`);
  },
  async upsertExchange(ex) {
    return sbFetch("exchanges", {
      method: "POST",
      prefer: "return=representation",
      headers: { "Prefer": "return=representation,resolution=merge-duplicates" },
      body: JSON.stringify(ex),
    });
  },
};

// SQL to create tables (shown in setup screen)
const SETUP_SQL = `
-- Run this in your Supabase SQL editor

create table if not exists employees (
  id text primary key,
  "firstName" text not null,
  "lastName" text,
  email text,
  role text,
  contract integer,
  sector text,
  created_at timestamptz default now()
);

create table if not exists weeks (
  id text primary key,
  monday timestamptz,
  sector text,
  data jsonb,
  locked boolean default false,
  "lockedAt" timestamptz,
  created_at timestamptz default now()
);

create table if not exists exchanges (
  id text primary key,
  "weekId" text,
  "from" text,
  "to" text,
  "fromName" text,
  "toName" text,
  day text,
  "timeFrom" text,
  "timeTo" text,
  "workedSlots" jsonb,
  note text,
  status text default 'pending',
  sector text,
  "createdAt" text,
  created_at timestamptz default now()
);

-- Disable RLS for now (enable and configure later for multi-user)
alter table employees disable row level security;
alter table weeks disable row level security;
alter table exchanges disable row level security;
`.trim();

// ─── DESIGN TOKENS ───────────────────────────────────────────────────────────
const C = {
  bg:"#0F1923",surface:"#162232",surfaceHover:"#1C2D42",border:"#1E3048",
  accent:"#00C896",accentDim:"#00C89622",text:"#E8EDF2",textMuted:"#6B8299",textDim:"#3A5570",
  pharma:"#4A9EFF",pharmaDim:"#4A9EFF22",
  pause:"#F59E0B",pauseDim:"#F59E0B22",
  danger:"#FF5C5C",dangerDim:"#FF5C5C22",
  warning:"#F59E0B",warningDim:"#F59E0B22",
  purple:"#A855F7",purpleDim:"#A855F722",
  locked:"#3A5570",lockedDim:"#3A557022",
};

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const SLOTS = ["7h45","8h","8h30","9h","9h30","10h","10h30","11h","11h30","12h","12h30","13h","13h30","14h","14h30","15h","15h30","16h","16h30","17h","17h30","18h","18h30","19h","19h30"];
const DAYS  = ["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];
const DAYS_SHORT = ["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"];
const MONTHS = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
const CLOSING_SLOT = {Lundi:"19h30",Mardi:"19h30",Mercredi:"19h30",Jeudi:"19h30",Vendredi:"19h30",Samedi:"19h",Dimanche:"off"};
const OPENING_SLOT = "7h45";
const PAUSE_SLOTS  = ["12h","12h30","13h","13h30"];
const UNLOCK_SECRET = 5;
const UNLOCK_WINDOW = 3000;

function slotToMin(s){const m=s.match(/(\d+)h(\d+)?/);return parseInt(m[1])*60+parseInt(m[2]||0);}
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,6);}

// ─── DATE HELPERS ─────────────────────────────────────────────────────────────
function getMondayOf(date){
  const d=new Date(date);const day=d.getDay();
  d.setDate(d.getDate()+(day===0?-6:1-day));d.setHours(0,0,0,0);return d;
}
function formatDate(d,short=false){
  if(!d)return"";const dd=new Date(d);
  if(short)return`${String(dd.getDate()).padStart(2,"0")}/${String(dd.getMonth()+1).padStart(2,"0")}`;
  return`${String(dd.getDate()).padStart(2,"0")}/${String(dd.getMonth()+1).padStart(2,"0")}/${dd.getFullYear()}`;
}
function getDayDate(monday,dayIndex){const d=new Date(monday);d.setDate(d.getDate()+dayIndex);return d;}

// ─── INITIAL DATA ─────────────────────────────────────────────────────────────
const INIT_PHARMA_EMPS = [
  {id:"johana",    firstName:"Johana",    lastName:"",      role:"pharmacien",  contract:35,email:"johana@pharmacie.fr",    sector:"pharmacie"},
  {id:"seyfullah", firstName:"Seyfullah", lastName:"",      role:"pharmacien",  contract:35,email:"seyfullah@pharmacie.fr", sector:"pharmacie"},
  {id:"navin",     firstName:"Navin",     lastName:"",      role:"pharmacien",  contract:30,email:"navin@pharmacie.fr",     sector:"pharmacie"},
  {id:"mathpharma",firstName:"Mathieu",   lastName:"Ph.",   role:"pharmacien",  contract:14,email:"mathieu.ph@pharmacie.fr",sector:"pharmacie"},
  {id:"evelyne",   firstName:"Évelyne",   lastName:"",      role:"preparateur", contract:35,email:"evelyne@pharmacie.fr",   sector:"pharmacie"},
  {id:"suheda",    firstName:"Suheda",    lastName:"",      role:"preparateur", contract:35,email:"suheda@pharmacie.fr",    sector:"pharmacie"},
  {id:"veronique", firstName:"Véronique", lastName:"",      role:"preparateur", contract:35,email:"veronique@pharmacie.fr", sector:"pharmacie"},
  {id:"anita",     firstName:"Anita",     lastName:"",      role:"preparateur", contract:30,email:"anita@pharmacie.fr",     sector:"pharmacie"},
  {id:"matthieu",  firstName:"Matthieu",  lastName:"",      role:"preparateur", contract:35,email:"matthieu@pharmacie.fr",  sector:"pharmacie"},
  {id:"sydney",    firstName:"Sydney",    lastName:"",      role:"preparateur", contract:35,email:"sydney@pharmacie.fr",    sector:"pharmacie"},
  {id:"melissa",   firstName:"Mélissa",   lastName:"",      role:"preparateur", contract:35,email:"melissa@pharmacie.fr",   sector:"pharmacie"},
  {id:"stephanie", firstName:"Stéphanie", lastName:"",      role:"preparateur", contract:35,email:"stephanie@pharmacie.fr", sector:"pharmacie"},
];
const INIT_PARA_EMPS = [
  {id:"para_lea",    firstName:"Léa",    lastName:"Martin", role:"preparateur",contract:35,email:"lea.martin@pharmacie.fr",    sector:"parapharmacie"},
  {id:"para_camille",firstName:"Camille",lastName:"Dupont", role:"preparateur",contract:35,email:"camille.dupont@pharmacie.fr", sector:"parapharmacie"},
  {id:"para_sarah",  firstName:"Sarah",  lastName:"Bernard",role:"preparateur",contract:28,email:"sarah.bernard@pharmacie.fr",  sector:"parapharmacie"},
];

function buildDaySlots(pattern){
  if(pattern==="repos")return Object.fromEntries(SLOTS.map(s=>[s,"repos"]));
  if(!pattern||pattern==="off")return Object.fromEntries(SLOTS.map(s=>[s,"off"]));
  const ranges=pattern.split(",").map(r=>{const[a,b]=r.trim().split("-");return[slotToMin(a),slotToMin(b)];});
  return Object.fromEntries(SLOTS.map(s=>{const t=slotToMin(s);return[s,ranges.some(([f,to])=>t>=f&&t<to)?"work":"off"];}));
}

function buildBaseTemplate(employees,sector){
  if(sector==="pharmacie"){
    const pats={
      johana:     {L:"8h-12h,14h-20h",Ma:"9h-12h,14h-20h",Me:"off",J:"off",V:"8h-12h,14h-20h",S:"13h-19h30",D:"off"},
      seyfullah:  {L:"off",Ma:"7h45-12h,13h30-20h",Me:"8h30-12h30,13h30-20h",J:"8h30-12h30,13h30-20h",V:"off",S:"8h-13h",D:"off"},
      navin:      {L:"off",Ma:"9h-12h,13h-20h",Me:"8h-12h,13h-20h",J:"off",V:"off",S:"9h-12h30,13h-19h",D:"off"},
      mathpharma: {L:"off",Ma:"off",Me:"15h30-20h",J:"14h-20h",V:"off",S:"8h30-12h30",D:"off"},
      evelyne:    {L:"off",Ma:"9h-12h,13h30-20h",Me:"12h-20h",J:"9h-12h,13h-20h",V:"9h-12h30",S:"off",D:"off"},
      suheda:     {L:"9h-12h,14h-20h",Ma:"8h30-12h30",Me:"8h-12h,13h-20h",J:"7h45-12h,14h-20h",V:"off",S:"off",D:"off"},
      veronique:  {L:"9h-12h,13h-20h",Ma:"14h-19h30",Me:"9h-12h,13h-20h",J:"off",V:"8h-12h",S:"off",D:"off"},
      anita:      {L:"9h-12h30",Ma:"8h-12h",Me:"9h-20h",J:"off",V:"7h45-12h",S:"9h-19h30",D:"off"},
      matthieu:   {L:"7h45-12h",Ma:"off",Me:"9h-12h,13h-20h",J:"8h-12h,13h-20h",V:"14h-20h",S:"8h30-12h30",D:"off"},
      sydney:     {L:"9h-12h30,13h-20h",Ma:"8h-12h30",Me:"7h45-12h,13h-20h",J:"off",V:"14h-20h",S:"12h-19h",D:"off"},
      melissa:    {L:"8h30-12h30",Ma:"off",Me:"9h-12h30,13h-20h",J:"9h-12h,13h-20h",V:"12h30-20h",S:"7h45-12h",D:"off"},
      stephanie:  {L:"repos",Ma:"repos",Me:"repos",J:"repos",V:"repos",S:"repos",D:"repos"},
    };
    const t={};
    DAYS.forEach((day,di)=>{
      const dk=["L","Ma","Me","J","V","S","D"][di];
      t[day]={};
      employees.forEach(emp=>{t[day][emp.id]=buildDaySlots(pats[emp.id]?.[dk]||"off");});
    });
    return t;
  } else {
    const pats={
      para_lea:     {L:"9h-19h",Ma:"9h-19h",Me:"off",J:"9h-19h",V:"9h-19h",S:"9h-17h",D:"off"},
      para_camille: {L:"10h-19h",Ma:"off",Me:"9h-19h",J:"10h-19h",V:"10h-19h",S:"9h-17h",D:"off"},
      para_sarah:   {L:"off",Ma:"9h-17h",Me:"9h-17h",J:"off",V:"9h-17h",S:"off",D:"off"},
    };
    const t={};
    DAYS.forEach((day,di)=>{
      const dk=["L","Ma","Me","J","V","S","D"][di];
      t[day]={};
      employees.forEach(emp=>{t[day][emp.id]=buildDaySlots(pats[emp.id]?.[dk]||"off");});
    });
    return t;
  }
}

function createWeekSchedule(monday,baseTemplate,sector){
  const m=new Date(monday);
  return {
    id:m.toISOString().slice(0,10),
    monday:m.toISOString(),
    sector,
    data:JSON.parse(JSON.stringify(baseTemplate)),
    locked:false,
    lockedAt:null,
  };
}

function initWeeks(baseTemplate,sector){
  const today=new Date();
  const thisMonday=getMondayOf(today);
  return Array.from({length:4},(_,i)=>{
    const m=new Date(thisMonday);m.setDate(m.getDate()+i*7);
    return createWeekSchedule(m,baseTemplate,sector);
  });
}

// ─── RULE ENGINE ─────────────────────────────────────────────────────────────
function checkRules(weekData,employees,day){
  const alerts=[];
  if(day==="Dimanche")return alerts;
  const dayData=weekData[day]||{};
  const pharmaEmps=employees.filter(e=>e.role==="pharmacien");
  function staffAt(slot){return employees.filter(e=>{const s=dayData[e.id]?.[slot];return s==="work"||s==="pause";});}
  function pharmaAt(slot){return pharmaEmps.filter(e=>{const s=dayData[e.id]?.[slot];return s==="work"||s==="pause";});}
  const oS=staffAt(OPENING_SLOT),oP=pharmaAt(OPENING_SLOT);
  if(oS.length<1)alerts.push({type:"danger",slot:OPENING_SLOT,rule:"Ouverture : personne à 7h45 !"});
  else if(oP.length<1)alerts.push({type:"danger",slot:OPENING_SLOT,rule:"Ouverture : aucun pharmacien à 7h45 !"});
  const cSlot=CLOSING_SLOT[day];
  if(cSlot&&cSlot!=="off"){
    const cS=staffAt(cSlot),cP=pharmaAt(cSlot);
    if(cS.length<3)alerts.push({type:"danger",slot:cSlot,rule:`Fermeture : ${cS.length}/3 personnes à ${cSlot}`});
    if(cP.length<1)alerts.push({type:"danger",slot:cSlot,rule:`Fermeture : aucun pharmacien à ${cSlot}`});
  }
  PAUSE_SLOTS.forEach(slot=>{const c=staffAt(slot).length;if(c<3)alerts.push({type:"warning",slot,rule:`Pause ${slot} : ${c}/3 personnes`});});
  return alerts;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function calcHours(dd){return Object.values(dd||{}).filter(s=>s==="work"||s==="pause").length*0.5;}
function calcWeekHours(weekData,empId){return DAYS.reduce((a,d)=>a+calcHours(weekData[d]?.[empId]||{}),0);}
function getStatusBg(s){return s==="work"?"#00C89622":s==="pause"?"#F59E0B22":s==="repos"?"#1a203044":"transparent";}
function getStatusBorder(s){return s==="work"?C.accent:s==="pause"?C.pause:s==="repos"?C.textDim:C.border;}

function getSlotsInRange(tf,tt){const f=slotToMin(tf),t=slotToMin(tt);return SLOTS.filter(s=>{const v=slotToMin(s);return v>=f&&v<t;});}
function getWorkedInRange(weekData,day,empId,tf,tt){
  const range=getSlotsInRange(tf,tt),dd=weekData?.[day]?.[empId]||{};
  return range.filter(s=>dd[s]==="work"||dd[s]==="pause");
}
function getConflicts(weekData,day,aId,bId,tf,tt){
  const worked=getWorkedInRange(weekData,day,aId,tf,tt),dd=weekData?.[day]?.[bId]||{};
  return worked.filter(s=>dd[s]==="work"||dd[s]==="pause");
}

// ─── UI PRIMITIVES ────────────────────────────────────────────────────────────
function Badge({color,children}){return <span style={{display:"inline-flex",alignItems:"center",gap:4,padding:"2px 8px",borderRadius:99,background:`${color}22`,color,fontSize:11,fontWeight:600,letterSpacing:"0.05em",whiteSpace:"nowrap"}}>{children}</span>;}
function Card({children,style}){return <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:12,padding:20,...style}}>{children}</div>;}
function Btn({children,onClick,variant="primary",size="md",disabled,style={}}){
  const base={display:"inline-flex",alignItems:"center",gap:6,border:"none",borderRadius:8,cursor:disabled?"not-allowed":"pointer",fontFamily:"inherit",fontWeight:600,transition:"all 0.15s",opacity:disabled?0.4:1};
  const v={
    primary:{background:C.accent,color:"#0F1923",padding:size==="sm"?"5px 11px":"9px 17px",fontSize:size==="sm"?12:14},
    ghost:{background:"transparent",color:C.textMuted,padding:size==="sm"?"5px 11px":"9px 17px",fontSize:size==="sm"?12:14,border:`1px solid ${C.border}`},
    danger:{background:C.dangerDim,color:C.danger,padding:size==="sm"?"5px 11px":"9px 17px",fontSize:size==="sm"?12:14,border:`1px solid ${C.danger}44`},
    success:{background:C.accentDim,color:C.accent,padding:size==="sm"?"5px 11px":"9px 17px",fontSize:size==="sm"?12:14,border:`1px solid ${C.accent}44`},
  };
  return <button style={{...base,...v[variant],...style}} onClick={onClick} disabled={disabled}>{children}</button>;
}
function Inp({label,value,onChange,placeholder,type="text"}){
  return <div>{label&&<label style={{color:C.textMuted,fontSize:12,display:"block",marginBottom:4}}>{label}</label>}<input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={{width:"100%",padding:"8px 10px",borderRadius:8,background:C.bg,border:`1px solid ${C.border}`,color:C.text,fontFamily:"inherit",fontSize:13,boxSizing:"border-box"}}/></div>;
}
function Sel({label,value,onChange,children}){
  return <div>{label&&<label style={{color:C.textMuted,fontSize:12,display:"block",marginBottom:4}}>{label}</label>}<select value={value} onChange={e=>onChange(e.target.value)} style={{width:"100%",padding:"8px 10px",borderRadius:8,background:C.bg,border:`1px solid ${C.border}`,color:C.text,fontFamily:"inherit",fontSize:13}}>{children}</select></div>;
}

// ─── SETUP SCREEN ─────────────────────────────────────────────────────────────
function SetupScreen({onDone}){
  const [copied,setCopied]=useState(false);
  function copy(){navigator.clipboard.writeText(SETUP_SQL).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);});}
  return(
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{maxWidth:640,width:"100%",display:"flex",flexDirection:"column",gap:20}}>
        <div style={{textAlign:"center"}}>
          <div style={{width:56,height:56,borderRadius:14,background:`linear-gradient(135deg,${C.accent},${C.pharma})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,color:"#0F1923",fontWeight:900,margin:"0 auto 16px"}}>⊕</div>
          <h1 style={{color:C.text,fontWeight:800,fontSize:22,margin:"0 0 6px"}}>Configuration Supabase</h1>
          <p style={{color:C.textMuted,fontSize:14,margin:0}}>Une seule étape : créer les tables dans votre base de données.</p>
        </div>
        <Card>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <span style={{color:C.text,fontWeight:700,fontSize:14}}>1. Copiez ce SQL</span>
            <Btn size="sm" variant="ghost" onClick={copy}>{copied?"✓ Copié !":"Copier"}</Btn>
          </div>
          <pre style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:8,padding:14,fontSize:11,color:C.textMuted,overflow:"auto",maxHeight:320,margin:0,whiteSpace:"pre-wrap"}}>{SETUP_SQL}</pre>
        </Card>
        <Card>
          <span style={{color:C.text,fontWeight:700,fontSize:14,display:"block",marginBottom:10}}>2. Collez-le dans Supabase</span>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {[
              "Ouvrez votre projet Supabase",
              "Menu gauche → SQL Editor",
              "Collez le SQL et cliquez Run",
              "Revenez ici et cliquez Démarrer",
            ].map((s,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{width:22,height:22,borderRadius:"50%",background:C.accentDim,border:`1px solid ${C.accent}`,display:"flex",alignItems:"center",justifyContent:"center",color:C.accent,fontSize:11,fontWeight:700,flexShrink:0}}>{i+1}</div>
                <span style={{color:C.textMuted,fontSize:13}}>{s}</span>
              </div>
            ))}
          </div>
        </Card>
        <Btn onClick={onDone}>Démarrer PharmaPlanning →</Btn>
      </div>
    </div>
  );
}

// ─── LOADING / SAVING INDICATOR ───────────────────────────────────────────────
function SyncBadge({syncing,error}){
  if(error)return <span style={{color:C.danger,fontSize:11,fontWeight:600}}>⚠ Erreur sync</span>;
  if(syncing)return <span style={{color:C.textMuted,fontSize:11}}>Sauvegarde…</span>;
  return <span style={{color:C.accent,fontSize:11}}>✓ Sauvegardé</span>;
}

// ─── TRAME GRID ───────────────────────────────────────────────────────────────
function TrameGrid({weekData,weekId,monday,employees,onToggleSlot,locked,sector}){
  const [selectedDay,setSelectedDay]=useState("Lundi");
  const [filter,setFilter]=useState("all");
  const mondayDate=new Date(monday);
  const LABEL_SLOTS=new Set(["7h45","8h","9h","10h","11h","12h","13h","14h","15h","16h","17h","18h","19h","19h30"]);
  const filtered=employees.filter(e=>filter==="all"||e.role===(filter==="pharma"?"pharmacien":"preparateur"));
  const closeSlot=CLOSING_SLOT[selectedDay];
  const alerts=sector==="pharmacie"?checkRules(weekData,employees,selectedDay):[];
  const alertSlots=new Set(alerts.map(a=>a.slot));
  const coverage=useMemo(()=>Object.fromEntries(SLOTS.map(slot=>{
    const staff=employees.filter(e=>{const s=weekData[selectedDay]?.[e.id]?.[slot];return s==="work"||s==="pause";});
    return[slot,{total:staff.length,pharma:staff.filter(e=>e.role==="pharmacien").length}];
  })),[weekData,selectedDay,employees]);
  const dayTabs=DAYS.map((day,i)=>({day,date:getDayDate(mondayDate,i),label:`${DAYS_SHORT[i]} ${getDayDate(mondayDate,i).getDate()}`}));

  return(
    <div>
      {locked&&<div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderRadius:8,background:C.lockedDim,border:`1px solid ${C.locked}`,marginBottom:14}}><span style={{fontSize:18}}>🔒</span><span style={{color:C.textMuted,fontWeight:600,fontSize:13}}>Planning verrouillé — modifications directes désactivées</span></div>}
      <div style={{display:"flex",gap:5,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
        {dayTabs.map(({day,label})=>(
          <button key={day} onClick={()=>setSelectedDay(day)} style={{padding:"6px 12px",borderRadius:8,border:`1px solid ${selectedDay===day?C.accent:C.border}`,cursor:"pointer",fontFamily:"inherit",fontWeight:600,fontSize:12,background:selectedDay===day?C.accentDim:"transparent",color:selectedDay===day?C.accent:C.textMuted}}>{label}</button>
        ))}
        <div style={{marginLeft:"auto",display:"flex",gap:5}}>
          {[["all","Tous"],["pharma","Pharm."],["prepa","Prép."]].map(([f,l])=>(
            <button key={f} onClick={()=>setFilter(f)} style={{padding:"5px 10px",borderRadius:7,border:`1px solid ${C.border}`,cursor:"pointer",fontFamily:"inherit",fontSize:11,fontWeight:600,background:filter===f?C.surfaceHover:"transparent",color:filter===f?C.text:C.textMuted}}>{l}</button>
          ))}
        </div>
      </div>
      {alerts.length>0&&<div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:12}}>{alerts.map((a,i)=><div key={i} style={{padding:"7px 12px",borderRadius:7,background:a.type==="danger"?C.dangerDim:C.warningDim,border:`1px solid ${a.type==="danger"?C.danger:C.warning}44`}}><span style={{color:a.type==="danger"?C.danger:C.warning,fontSize:12,fontWeight:600}}>{a.type==="danger"?"⚠":"ℹ"} {a.rule}</span></div>)}</div>}
      {selectedDay==="Dimanche"?(
        <div style={{textAlign:"center",padding:"40px 0",color:C.textDim}}><div style={{fontSize:32,marginBottom:8}}>🏖</div><div style={{fontWeight:600}}>Dimanche — Pharmacie fermée</div></div>
      ):(
        <div style={{overflowX:"auto"}}>
          <div style={{minWidth:1000}}>
            {/* Time labels */}
            <div style={{display:"flex",marginBottom:2,paddingLeft:120}}>
              {SLOTS.map(slot=>{
                const isOpen=slot===OPENING_SLOT,isClose=slot===closeSlot,isPause=PAUSE_SLOTS.includes(slot),show=LABEL_SLOTS.has(slot);
                return(
                  <div key={slot} style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",alignItems:"center",position:"relative"}}>
                    {isOpen&&<div style={{position:"absolute",top:-15,whiteSpace:"nowrap",fontSize:8,color:C.accent,fontWeight:700}}>↓OUV</div>}
                    {isClose&&<div style={{position:"absolute",top:-15,whiteSpace:"nowrap",fontSize:8,color:C.danger,fontWeight:700}}>↓FER</div>}
                    <span style={{fontSize:show?9:0,color:alertSlots.has(slot)?C.danger:isPause?C.pause:C.textDim,fontWeight:(isOpen||isClose||isPause)?700:400,whiteSpace:"nowrap",overflow:"hidden",maxWidth:"100%"}}>{show?slot:""}</span>
                  </div>
                );
              })}
            </div>
            {/* Coverage bar */}
            <div style={{display:"flex",marginBottom:7,paddingLeft:120}}>
              {SLOTS.map(slot=>{
                const{total,pharma}=coverage[slot]||{total:0,pharma:0};
                const minR=sector==="parapharmacie"?1:PAUSE_SLOTS.includes(slot)?3:1;
                const isClose=slot===closeSlot,isOpen=slot===OPENING_SLOT;
                const bad=total<minR||(isClose&&(total<3||pharma<1))||(isOpen&&pharma<1);
                return <div key={slot} title={`${slot}: ${total} pers.`} style={{flex:1,minWidth:0,height:20,margin:"0 1px",borderRadius:3,background:bad?C.dangerDim:C.accentDim,border:`1px solid ${bad?C.danger:C.accent}44`,display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{fontSize:9,fontWeight:700,color:bad?C.danger:C.accent}}>{total||""}</span></div>;
              })}
            </div>
            <div style={{display:"flex",marginBottom:7,paddingLeft:120}}>{SLOTS.map(slot=><div key={slot} style={{flex:1,height:1,background:PAUSE_SLOTS.includes(slot)?`${C.pause}55`:C.border}}/>)}</div>
            {/* Rows */}
            {(sector==="pharmacie"?["pharmacien","preparateur"]:["preparateur"]).map(role=>(
              <div key={role}>
                <div style={{padding:"4px 0 3px",color:C.textDim,fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase"}}>{role==="pharmacien"?"◆ Pharmaciens":"◆ "+(sector==="parapharmacie"?"Parapharmacie":"Préparateurs")}</div>
                {filtered.filter(e=>e.role===role).map(emp=>{
                  const dd=weekData[selectedDay]?.[emp.id]||{};
                  const h=calcHours(dd);
                  return(
                    <div key={emp.id} style={{display:"flex",alignItems:"center",marginBottom:3}}>
                      <div style={{width:120,flexShrink:0,display:"flex",alignItems:"center",gap:5,paddingRight:6}}>
                        <div style={{width:5,height:5,borderRadius:"50%",flexShrink:0,background:emp.role==="pharmacien"?C.pharma:C.accent}}/>
                        <span style={{color:C.text,fontSize:11,fontWeight:500,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:88}} title={`${emp.firstName} ${emp.lastName}`}>{emp.firstName}</span>
                        <span style={{color:C.textDim,fontSize:10,flexShrink:0}}>{h}h</span>
                      </div>
                      {SLOTS.map(slot=>{
                        const status=dd[slot]||"off";const active=status==="work"||status==="pause";
                        const isOpen=slot===OPENING_SLOT,isClose=slot===closeSlot;
                        return <div key={slot} onClick={()=>!locked&&onToggleSlot(weekId,selectedDay,emp.id,slot)} title={`${emp.firstName}·${slot}·${status}`} style={{flex:1,height:26,margin:"0 1px",borderRadius:3,cursor:locked?"not-allowed":"pointer",background:getStatusBg(status),border:`1px solid ${active?getStatusBorder(status):locked?"#1E304833":getStatusBorder(status)+"44"}`,outline:active&&(isOpen||isClose)?`2px solid ${isOpen?C.accent:C.danger}`:"none",boxSizing:"border-box",transition:"all 0.08s",opacity:locked?0.8:1}}/>;
                      })}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
      <div style={{display:"flex",gap:14,marginTop:12,flexWrap:"wrap",alignItems:"center"}}>
        {[["work","Travaillé",C.accent],["pause","Pause",C.pause],["repos","Repos",C.textDim]].map(([s,l,color])=>(
          <div key={s} style={{display:"flex",alignItems:"center",gap:5}}><div style={{width:13,height:13,borderRadius:3,background:getStatusBg(s),border:`1px solid ${color}66`}}/><span style={{color:C.textMuted,fontSize:11}}>{l}</span></div>
        ))}
        {!locked&&<span style={{color:C.textDim,fontSize:11,marginLeft:"auto"}}>Clic : absent → travaillé → pause → absent</span>}
      </div>
    </div>
  );
}

// ─── CALENDAR VIEW ────────────────────────────────────────────────────────────
function CalendarView({weeks,sector,employees,onSelectWeek,onLockWeek}){
  const today=new Date();today.setHours(0,0,0,0);
  const byMonth=useMemo(()=>{
    const groups={};
    weeks.forEach(w=>{const m=new Date(w.monday);const key=`${m.getFullYear()}-${m.getMonth()}`;if(!groups[key])groups[key]={year:m.getFullYear(),month:m.getMonth(),weeks:[]};groups[key].weeks.push(w);});
    return Object.values(groups);
  },[weeks]);
  return(
    <div style={{display:"flex",flexDirection:"column",gap:24}}>
      {byMonth.map(group=>(
        <div key={`${group.year}-${group.month}`}>
          <h3 style={{color:C.text,fontWeight:700,fontSize:16,margin:"0 0 12px"}}>{MONTHS[group.month]} {group.year}</h3>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {group.weeks.map(week=>{
              const monday=new Date(week.monday),sunday=new Date(monday);sunday.setDate(sunday.getDate()+6);
              const isCurrent=today>=monday&&today<=sunday,isPast=sunday<today;
              const alertCount=sector==="pharmacie"?DAYS.flatMap(d=>checkRules(week.data,employees,d)).filter(a=>a.type==="danger").length:0;
              return(
                <div key={week.id} onClick={()=>onSelectWeek(week.id)} style={{display:"flex",alignItems:"center",gap:14,padding:"13px 16px",borderRadius:10,cursor:"pointer",transition:"all 0.15s",border:`2px solid ${week.locked?C.locked:isCurrent?`${C.accent}66`:C.border}`,background:week.locked?C.lockedDim:isCurrent?C.accentDim:C.surface}}>
                  <div style={{minWidth:170}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}>
                      {isCurrent&&<Badge color={C.accent}>En cours</Badge>}
                      {isPast&&!isCurrent&&<Badge color={C.textDim}>Passée</Badge>}
                      {week.locked&&<Badge color={C.locked}>🔒 Verrouillé</Badge>}
                    </div>
                    <div style={{color:C.text,fontWeight:700,fontSize:14}}>{formatDate(monday)} → {formatDate(sunday)}</div>
                  </div>
                  <div style={{flex:1,display:"flex",gap:3}}>
                    {DAYS.map((day,di)=>{
                      const staffCount=employees.filter(e=>SLOTS.some(s=>{const st=week.data[day]?.[e.id]?.[s];return st==="work"||st==="pause";})).length;
                      const hasAlerts=sector==="pharmacie"&&checkRules(week.data,employees,day).some(a=>a.type==="danger");
                      return <div key={day} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                        <div style={{width:"100%",height:26,borderRadius:4,background:hasAlerts?C.dangerDim:staffCount>0?C.accentDim:C.border,border:`1px solid ${hasAlerts?C.danger:staffCount>0?C.accent:C.border}`,display:"flex",alignItems:"center",justifyContent:"center"}}>
                          <span style={{fontSize:10,fontWeight:700,color:hasAlerts?C.danger:staffCount>0?C.accent:C.textDim}}>{day==="Dimanche"?"—":staffCount}</span>
                        </div>
                        <span style={{fontSize:9,color:C.textDim}}>{DAYS_SHORT[di]}</span>
                      </div>;
                    })}
                  </div>
                  {alertCount>0&&<Badge color={C.danger}>{alertCount} alerte{alertCount>1?"s":""}</Badge>}
                  <div onClick={e=>e.stopPropagation()}>
                    {!week.locked?<Btn size="sm" variant="success" onClick={()=>onLockWeek(week.id)}>✓ Valider</Btn>:<span style={{color:C.textDim,fontSize:14}}>🔒</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}


// ─── SEND PLANNING BUTTON ────────────────────────────────────────────────────
function SendPlanningBtn({emp, week}) {
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error

  async function send() {
    if(!emp.email || !week) return;
    setStatus("sending");
    const monday = new Date(week.monday);

    const days = DAYS.map((day, di) => {
      const dd = week.data[day]?.[emp.id] || {};
      const h = calcHours(dd);
      const blocks = [];
      let inB = false, bS = null;
      SLOTS.forEach((s, i) => {
        const st = dd[s];
        if ((st === "work" || st === "pause") && !inB) { inB = true; bS = s; }
        else if (st !== "work" && st !== "pause" && inB) { blocks.push(`${bS}→${SLOTS[i-1]}`); inB = false; }
      });
      if (inB) blocks.push(`${bS}→${SLOTS[SLOTS.length-1]}`);
      const date = getDayDate(monday, di);
      return {
        day,
        date: formatDate(date),
        hours: h,
        blocks: blocks.join("  |  ") || "—",
      };
    });

    const sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6);
    const weekLabel = `${formatDate(monday, true)} au ${formatDate(sunday, true)}`;

    try {
      const res = await fetch("/api/send-planning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: emp.email, name: emp.firstName, weekLabel, days }),
      });
      if (res.ok) { setStatus("sent"); setTimeout(() => setStatus("idle"), 3000); }
      else { setStatus("error"); setTimeout(() => setStatus("idle"), 3000); }
    } catch(e) {
      setStatus("error"); setTimeout(() => setStatus("idle"), 3000);
    }
  }

  const label = status === "sending" ? "Envoi…" : status === "sent" ? "✓ Envoyé !" : status === "error" ? "⚠ Erreur" : `📧 Envoyer à ${emp.firstName}`;
  const variant = status === "sent" ? "success" : status === "error" ? "danger" : "ghost";
  return <Btn size="sm" variant={variant} onClick={send} disabled={status === "sending" || !emp.email}>{label}</Btn>;
}

// ─── INDIVIDUAL PLANNING ──────────────────────────────────────────────────────
function IndividualPlanning({weeks,employees}){
  const [selEmpId,setSelEmpId]=useState(employees[0]?.id||"");
  const [selWeekId,setSelWeekId]=useState(weeks[0]?.id||"");
  const emp=employees.find(e=>e.id===selEmpId)||employees[0];
  const week=weeks.find(w=>w.id===selWeekId)||weeks[0];
  if(!emp||!week)return <Card><p style={{color:C.textMuted}}>Aucune donnée.</p></Card>;
  const weekH=calcWeekHours(week.data,emp.id),diff=weekH-emp.contract;
  const monday=new Date(week.monday);
  return(
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div style={{display:"flex",gap:14,flexWrap:"wrap"}}>
        <div style={{flex:1,minWidth:200}}>
          <label style={{color:C.textMuted,fontSize:12,display:"block",marginBottom:6}}>Salarié</label>
          <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
            {employees.map(e=><button key={e.id} onClick={()=>setSelEmpId(e.id)} style={{padding:"5px 11px",borderRadius:7,border:`1px solid ${selEmpId===e.id?(e.role==="pharmacien"?C.pharma:C.accent):C.border}`,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:500,background:selEmpId===e.id?(e.role==="pharmacien"?C.pharmaDim:C.accentDim):"transparent",color:selEmpId===e.id?(e.role==="pharmacien"?C.pharma:C.accent):C.textMuted}}>{e.firstName}</button>)}
          </div>
        </div>
        <div style={{flex:1,minWidth:200}}>
          <label style={{color:C.textMuted,fontSize:12,display:"block",marginBottom:6}}>Semaine</label>
          <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
            {weeks.map(w=>{const m=new Date(w.monday),s=new Date(m);s.setDate(s.getDate()+6);return <button key={w.id} onClick={()=>setSelWeekId(w.id)} style={{padding:"5px 11px",borderRadius:7,border:`1px solid ${selWeekId===w.id?C.accent:C.border}`,cursor:"pointer",fontFamily:"inherit",fontSize:11,fontWeight:500,background:selWeekId===w.id?C.accentDim:"transparent",color:selWeekId===w.id?C.accent:C.textMuted}}>{formatDate(m,true)}–{formatDate(s,true)}{w.locked?" 🔒":""}</button>;})}
          </div>
        </div>
      </div>
      <Card style={{display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
        <div style={{width:50,height:50,borderRadius:"50%",background:emp.role==="pharmacien"?C.pharmaDim:C.accentDim,border:`2px solid ${emp.role==="pharmacien"?C.pharma:C.accent}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,color:emp.role==="pharmacien"?C.pharma:C.accent,fontWeight:700}}>{emp.firstName[0]}</div>
        <div style={{flex:1}}><div style={{fontSize:17,fontWeight:700,color:C.text}}>{emp.firstName} {emp.lastName}</div><div style={{color:C.textMuted,fontSize:12}}>{emp.email}</div><div style={{marginTop:3}}><Badge color={emp.role==="pharmacien"?C.pharma:C.accent}>{emp.role==="pharmacien"?"Pharmacien":"Préparateur"}</Badge></div></div>
        <div style={{textAlign:"right",display:"flex",flexDirection:"column",alignItems:"flex-end",gap:8}}>
          <div><div style={{fontSize:24,fontWeight:700,color:diff>0?C.warning:diff<-1?C.danger:C.accent}}>{weekH}h</div><div style={{color:C.textMuted,fontSize:12}}>/ {emp.contract}h</div>{Math.abs(diff)>0.25&&<Badge color={diff>0?C.warning:C.danger}>{diff>0?"+":""}{diff.toFixed(1)}h</Badge>}</div>
          <SendPlanningBtn emp={emp} week={week}/>
        </div>
      </Card>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:10}}>
        {DAYS.map((day,di)=>{
          const dd=week.data[day]?.[emp.id]||{};const h=calcHours(dd);const isOff=h===0;
          const dateLabel=formatDate(getDayDate(monday,di));
          const blocks=[];let inB=false,bS=null,bT=null;
          SLOTS.forEach((s,i)=>{const st=dd[s];if((st==="work"||st==="pause")&&!inB){inB=true;bS=s;bT=st;}else if(st!=="work"&&st!=="pause"&&inB){blocks.push({from:bS,to:SLOTS[i-1],type:bT});inB=false;}});
          if(inB)blocks.push({from:bS,to:SLOTS[SLOTS.length-1],type:bT});
          return(
            <Card key={day} style={{borderColor:isOff?C.border:`${C.accent}33`,padding:13}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:7}}>
                <div><span style={{fontWeight:700,color:isOff?C.textMuted:C.text,fontSize:13}}>{day}</span><span style={{color:C.textDim,fontSize:11,marginLeft:5}}>{dateLabel}</span></div>
                <span style={{color:isOff?C.textDim:C.accent,fontSize:13,fontWeight:600}}>{isOff?"—":`${h}h`}</span>
              </div>
              {isOff?<div style={{color:C.textDim,fontSize:11,fontStyle:"italic"}}>Repos / Absent</div>:(
                <div style={{display:"flex",flexDirection:"column",gap:4}}>
                  {blocks.map((b,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 8px",borderRadius:5,background:b.type==="pause"?C.pauseDim:C.accentDim,border:`1px solid ${b.type==="pause"?C.pause:C.accent}33`}}><span style={{color:b.type==="pause"?C.pause:C.accent,fontSize:12,fontWeight:600}}>{b.from}→{b.to}</span>{b.type==="pause"&&<Badge color={C.pause}>Pause</Badge>}</div>)}
                  <div style={{display:"flex",height:4,borderRadius:2,overflow:"hidden",marginTop:3}}>{SLOTS.map(s=><div key={s} style={{flex:1,background:dd[s]==="work"?C.accent:dd[s]==="pause"?C.pause:"transparent"}}/>)}</div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ─── EXCHANGES ────────────────────────────────────────────────────────────────
function Exchanges({exchanges,setExchanges,weeks,setWeeks,employees}){
  const [form,setForm]=useState({from:"",to:"",day:"Lundi",timeFrom:"9h",timeTo:"14h",weekId:"",note:""});
  const [showForm,setShowForm]=useState(false);
  const [saving,setSaving]=useState(false);
  const selWeek=weeks.find(w=>w.id===form.weekId);
  const aWorked=useMemo(()=>{if(!form.from||!selWeek)return[];return getWorkedInRange(selWeek.data,form.day,form.from,form.timeFrom,form.timeTo);},[form.from,form.day,form.timeFrom,form.timeTo,form.weekId,weeks]);
  const candidates=useMemo(()=>{
    if(!form.from||aWorked.length===0||!selWeek)return[];
    return employees.filter(e=>e.id!==form.from).map(e=>{const conflicts=getConflicts(selWeek.data,form.day,form.from,e.id,form.timeFrom,form.timeTo);return{...e,available:conflicts.length===0,conflicts};}).sort((a,b)=>b.available-a.available);
  },[form.from,form.day,form.timeFrom,form.timeTo,form.weekId,aWorked,weeks,employees]);
  const selB=candidates.find(c=>c.id===form.to);
  const canSubmit=form.from&&form.to&&selB?.available&&aWorked.length>0&&form.weekId;
  const avail=candidates.filter(c=>c.available).length;

  async function submit(){
    if(!canSubmit)return;
    setSaving(true);
    const newEx={id:uid(),...form,fromName:employees.find(e=>e.id===form.from)?.firstName,toName:employees.find(e=>e.id===form.to)?.firstName,workedSlots:aWorked,status:"pending",createdAt:new Date().toLocaleDateString("fr-FR"),sector:selWeek.sector};
    try{await db.upsertExchange(newEx);}catch(e){console.error(e);}
    setExchanges(prev=>[newEx,...prev]);
    setShowForm(false);setForm({from:"",to:"",day:"Lundi",timeFrom:"9h",timeTo:"14h",weekId:"",note:""});
    setSaving(false);
  }

  async function approve(exId){
    const ex=exchanges.find(e=>e.id===exId);if(!ex)return;
    const updatedEx={...ex,status:"approved"};
    const updatedWeeks=weeks.map(w=>{
      if(w.id!==ex.weekId)return w;
      const next=JSON.parse(JSON.stringify(w));
      const slots=ex.workedSlots||getWorkedInRange(w.data,ex.day,ex.from,ex.timeFrom,ex.timeTo);
      slots.forEach(s=>{const sA=next.data[ex.day][ex.from]?.[s]||"off";const sB=next.data[ex.day][ex.to]?.[s]||"off";next.data[ex.day][ex.from][s]=sB;next.data[ex.day][ex.to][s]=sA;});
      return next;
    });
    try{await db.upsertExchange(updatedEx);await Promise.all(updatedWeeks.filter(w=>w.id===ex.weekId).map(w=>db.upsertWeek(w)));}catch(e){console.error(e);}
    setExchanges(prev=>prev.map(e=>e.id===exId?updatedEx:e));
    setWeeks(updatedWeeks);
  }

  async function reject(exId){
    const updatedEx={...exchanges.find(e=>e.id===exId),status:"rejected"};
    try{await db.upsertExchange(updatedEx);}catch(e){console.error(e);}
    setExchanges(prev=>prev.map(e=>e.id===exId?updatedEx:e));
  }

  const SC={pending:C.warning,approved:C.accent,rejected:C.danger};
  const SL={pending:"En attente",approved:"Approuvé",rejected:"Refusé"};

  return(
    <div style={{display:"flex",flexDirection:"column",gap:18}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div><h3 style={{color:C.text,fontWeight:700,margin:0}}>Échanges de postes</h3><p style={{color:C.textMuted,fontSize:13,margin:"4px 0 0"}}>Disponibles sur semaines verrouillées si validés par le manager.</p></div>
        <Btn onClick={()=>setShowForm(!showForm)}>+ Nouvel échange</Btn>
      </div>
      {showForm&&(
        <Card style={{border:`1px solid ${C.accent}44`}}>
          <h4 style={{color:C.accent,margin:"0 0 16px",fontWeight:700}}>Déclarer un échange</h4>
          <div style={{marginBottom:14}}>
            <div style={{color:C.textDim,fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8}}>1 · Contexte</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10}}>
              <Sel label="Semaine" value={form.weekId} onChange={v=>setForm(f=>({...f,weekId:v,to:""}))}>
                <option value="">Choisir...</option>
                {weeks.map(w=>{const m=new Date(w.monday),s=new Date(m);s.setDate(s.getDate()+6);return <option key={w.id} value={w.id}>{formatDate(m,true)}–{formatDate(s,true)}{w.locked?" 🔒":""}</option>;})}
              </Sel>
              <Sel label="Jour" value={form.day} onChange={v=>setForm(f=>({...f,day:v,to:""}))}>
                {DAYS.filter(d=>d!=="Dimanche").map(d=><option key={d}>{d}</option>)}
              </Sel>
              <Sel label="Salarié A (cède)" value={form.from} onChange={v=>setForm(f=>({...f,from:v,to:""}))}>
                <option value="">Choisir...</option>
                {employees.map(e=><option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}
              </Sel>
            </div>
          </div>
          {form.from&&form.weekId&&(
            <div style={{marginBottom:14}}>
              <div style={{color:C.textDim,fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8}}>2 · Plage horaire</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:8}}>
                <Sel label="De" value={form.timeFrom} onChange={v=>setForm(f=>({...f,timeFrom:v,to:""}))}>
                  {SLOTS.map(s=><option key={s}>{s}</option>)}
                </Sel>
                <Sel label="À" value={form.timeTo} onChange={v=>setForm(f=>({...f,timeTo:v,to:""}))}>
                  {SLOTS.filter(s=>slotToMin(s)>slotToMin(form.timeFrom)).map(s=><option key={s}>{s}</option>)}
                </Sel>
              </div>
              {aWorked.length>0?<div style={{padding:"8px 12px",background:C.accentDim,borderRadius:7,border:`1px solid ${C.accent}33`}}><span style={{color:C.accent,fontSize:12,fontWeight:600}}>✓ {employees.find(e=>e.id===form.from)?.firstName} travaille sur {aWorked.length} créneau(x) : {aWorked[0]} → {aWorked[aWorked.length-1]}</span></div>
              :<div style={{padding:"8px 12px",background:C.dangerDim,borderRadius:7,border:`1px solid ${C.danger}33`}}><span style={{color:C.danger,fontSize:12,fontWeight:600}}>✗ {employees.find(e=>e.id===form.from)?.firstName} n'est pas en poste sur cette plage.</span></div>}
            </div>
          )}
          {form.from&&aWorked.length>0&&(
            <div style={{marginBottom:14}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div style={{color:C.textDim,fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase"}}>3 · Salarié B (remplaçant)</div>
                <span style={{fontSize:12,color:avail>0?C.accent:C.danger,fontWeight:600}}>{avail} dispo / {candidates.length}</span>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:4,maxHeight:240,overflowY:"auto"}}>
                {candidates.map(c=>{const sel=form.to===c.id;return(
                  <div key={c.id} onClick={()=>c.available&&setForm(f=>({...f,to:c.id}))} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",borderRadius:7,cursor:c.available?"pointer":"not-allowed",border:`1px solid ${sel?C.accent:c.available?C.border:C.danger+"33"}`,background:sel?C.accentDim:c.available?C.surfaceHover:`${C.danger}07`,opacity:c.available?1:0.6,transition:"all 0.1s"}}>
                    <div style={{width:28,height:28,borderRadius:"50%",flexShrink:0,background:c.available?(sel?C.accent:C.accentDim):C.dangerDim,border:`2px solid ${c.available?(sel?C.accent:C.border):C.danger}`,display:"flex",alignItems:"center",justifyContent:"center",color:c.available?(sel?"#0F1923":C.accent):C.danger,fontWeight:700,fontSize:12}}>{c.firstName[0]}</div>
                    <div style={{flex:1}}><div style={{fontWeight:600,fontSize:13,color:c.available?C.text:C.textMuted}}>{c.firstName} {c.lastName}</div><div style={{fontSize:11,color:C.textDim}}>{c.role==="pharmacien"?"Pharmacien":"Préparateur"}</div></div>
                    {c.available?<Badge color={C.accent}>Disponible</Badge>:<div style={{textAlign:"right"}}><Badge color={C.danger}>En poste</Badge><div style={{fontSize:10,color:C.danger,marginTop:2}}>{c.conflicts.slice(0,3).join(", ")}{c.conflicts.length>3?` +${c.conflicts.length-3}`:""}</div></div>}
                    {sel&&<span style={{color:C.accent,fontSize:16}}>✓</span>}
                  </div>
                );})}
                {avail===0&&<div style={{padding:12,textAlign:"center",color:C.danger,fontSize:13}}>Aucun salarié disponible.</div>}
              </div>
            </div>
          )}
          {canSubmit&&<div style={{marginBottom:12}}><Inp label="Note (optionnel)" value={form.note} onChange={v=>setForm(f=>({...f,note:v}))} placeholder="Raison..."/></div>}
          <div style={{display:"flex",gap:8}}><Btn onClick={submit} disabled={!canSubmit||saving}>{saving?"Envoi…":"Soumettre"}</Btn><Btn variant="ghost" onClick={()=>setShowForm(false)}>Annuler</Btn></div>
        </Card>
      )}
      {exchanges.length===0?<Card><div style={{textAlign:"center",padding:32,color:C.textMuted}}><div style={{fontSize:32,marginBottom:8}}>🔄</div><div style={{fontWeight:600}}>Aucun échange enregistré</div></div></Card>:(
        <div style={{display:"flex",flexDirection:"column",gap:7}}>
          {exchanges.map(ex=>{const w=weeks.find(ww=>ww.id===ex.weekId);const m=w?new Date(w.monday):null;return(
            <Card key={ex.id} style={{border:`1px solid ${SC[ex.status]}33`}}>
              <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
                <div style={{display:"flex",flex:1,alignItems:"center",gap:12,flexWrap:"wrap"}}>
                  {[{n:ex.fromName,l:"Cède"},{n:ex.toName,l:"Reprend"}].map((p,i)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:7}}>
                      <div style={{width:32,height:32,borderRadius:"50%",background:i===0?C.accentDim:C.pharmaDim,display:"flex",alignItems:"center",justifyContent:"center",color:i===0?C.accent:C.pharma,fontWeight:700,fontSize:13}}>{p.n?.[0]}</div>
                      <div><div style={{color:C.text,fontWeight:600,fontSize:13}}>{p.n}</div><div style={{color:C.textDim,fontSize:11}}>{p.l}</div></div>
                      {i===0&&<span style={{color:C.textDim,fontSize:18,margin:"0 2px"}}>⇄</span>}
                    </div>
                  ))}
                  <div style={{borderLeft:`1px solid ${C.border}`,paddingLeft:12}}>
                    <div style={{color:C.text,fontSize:13,fontWeight:500}}>{ex.day} · {m?formatDate(m,true):"?"}</div>
                    <div style={{color:C.textMuted,fontSize:12}}>{ex.timeFrom} → {ex.timeTo}</div>
                    {ex.note&&<div style={{color:C.textDim,fontSize:11,marginTop:1}}>"{ex.note}"</div>}
                  </div>
                </div>
                <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:7}}>
                  <Badge color={SC[ex.status]}>{SL[ex.status]}</Badge>
                  <div style={{color:C.textDim,fontSize:11}}>{ex.createdAt}</div>
                  {ex.status==="pending"&&<div style={{display:"flex",gap:7}}><Btn size="sm" onClick={()=>approve(ex.id)}>✓ Approuver</Btn><Btn size="sm" variant="danger" onClick={()=>reject(ex.id)}>✕ Refuser</Btn></div>}
                  {ex.status==="approved"&&<span style={{color:C.accent,fontSize:12}}>✓ Planning mis à jour</span>}
                </div>
              </div>
            </Card>
          );})}
        </div>
      )}
    </div>
  );
}

// ─── EMPLOYEE MANAGER ─────────────────────────────────────────────────────────
function EmployeeManager({employees,setEmployees,weeks,setWeeks,sector}){
  const [showForm,setShowForm]=useState(false);
  const [editId,setEditId]=useState(null);
  const [form,setForm]=useState({firstName:"",lastName:"",email:"",role:"preparateur",contract:35});
  const [confirmDel,setConfirmDel]=useState(null);
  const [saving,setSaving]=useState(false);

  async function save(){
    if(!form.firstName.trim()||!form.email.trim())return;
    setSaving(true);
    if(editId){
      const updated={...employees.find(e=>e.id===editId),...form,contract:Number(form.contract)};
      try{await db.upsertEmployee(updated);}catch(e){console.error(e);}
      setEmployees(prev=>prev.map(e=>e.id===editId?updated:e));
    }else{
      const ne={id:uid(),...form,contract:Number(form.contract),sector};
      try{await db.upsertEmployee(ne);}catch(e){console.error(e);}
      setEmployees(prev=>[...prev,ne]);
      const updatedWeeks=weeks.map(w=>{
        const next=JSON.parse(JSON.stringify(w));
        DAYS.forEach(day=>{next.data[day]={...next.data[day],[ne.id]:Object.fromEntries(SLOTS.map(s=>[s,"off"]))}});
        return next;
      });
      try{await Promise.all(updatedWeeks.map(w=>db.upsertWeek(w)));}catch(e){console.error(e);}
      setWeeks(updatedWeeks);
    }
    setSaving(false);setShowForm(false);
  }

  async function remove(id){
    try{await db.deleteEmployee(id);}catch(e){console.error(e);}
    setEmployees(prev=>prev.filter(e=>e.id!==id));
    const updatedWeeks=weeks.map(w=>{const next=JSON.parse(JSON.stringify(w));DAYS.forEach(day=>{if(next.data[day]){const d={...next.data[day]};delete d[id];next.data[day]=d;}});return next;});
    try{await Promise.all(updatedWeeks.map(w=>db.upsertWeek(w)));}catch(e){console.error(e);}
    setWeeks(updatedWeeks);setConfirmDel(null);
  }

  return(
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div><h3 style={{color:C.text,fontWeight:700,margin:0}}>Équipe {sector==="pharmacie"?"Pharmacie":"Parapharmacie"}</h3><p style={{color:C.textMuted,fontSize:13,margin:"4px 0 0"}}>{employees.length} salarié(s)</p></div>
        <Btn onClick={()=>{setEditId(null);setForm({firstName:"",lastName:"",email:"",role:"preparateur",contract:35});setShowForm(true);}}>+ Ajouter</Btn>
      </div>
      {showForm&&(
        <Card style={{border:`1px solid ${C.accent}44`}}>
          <h4 style={{color:C.accent,margin:"0 0 14px",fontWeight:700}}>{editId?"Modifier":"Nouveau salarié"}</h4>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <Inp label="Prénom *" value={form.firstName} onChange={v=>setForm(f=>({...f,firstName:v}))} placeholder="Marie"/>
            <Inp label="Nom" value={form.lastName} onChange={v=>setForm(f=>({...f,lastName:v}))} placeholder="Dupont"/>
            <div style={{gridColumn:"1/-1"}}><Inp label="Email *" value={form.email} onChange={v=>setForm(f=>({...f,email:v}))} placeholder="marie@pharmacie.fr" type="email"/></div>
            {sector==="pharmacie"&&<Sel label="Rôle" value={form.role} onChange={v=>setForm(f=>({...f,role:v}))}><option value="pharmacien">Pharmacien(ne)</option><option value="preparateur">Préparateur / Caissière</option></Sel>}
            <Inp label="H/semaine" value={form.contract} onChange={v=>setForm(f=>({...f,contract:v}))} placeholder="35" type="number"/>
          </div>
          <div style={{display:"flex",gap:8,marginTop:12}}><Btn onClick={save} disabled={!form.firstName.trim()||!form.email.trim()||saving}>{saving?"Enregistrement…":"Enregistrer"}</Btn><Btn variant="ghost" onClick={()=>setShowForm(false)}>Annuler</Btn></div>
        </Card>
      )}
      {confirmDel&&(
        <Card style={{border:`1px solid ${C.danger}44`,background:C.dangerDim}}>
          <p style={{color:C.text,margin:"0 0 10px"}}>Supprimer <strong>{confirmDel.firstName} {confirmDel.lastName}</strong> et tous ses créneaux ?</p>
          <div style={{display:"flex",gap:8}}><Btn variant="danger" onClick={()=>remove(confirmDel.id)}>Confirmer</Btn><Btn variant="ghost" onClick={()=>setConfirmDel(null)}>Annuler</Btn></div>
        </Card>
      )}
      <div style={{display:"flex",flexDirection:"column",gap:7}}>
        {employees.map(emp=>(
          <Card key={emp.id} style={{padding:"11px 14px"}}>
            <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
              <div style={{width:34,height:34,borderRadius:"50%",background:emp.role==="pharmacien"?C.pharmaDim:C.accentDim,border:`2px solid ${emp.role==="pharmacien"?C.pharma:C.accent}`,display:"flex",alignItems:"center",justifyContent:"center",color:emp.role==="pharmacien"?C.pharma:C.accent,fontWeight:700,fontSize:14,flexShrink:0}}>{emp.firstName[0]}</div>
              <div style={{flex:1}}><div style={{color:C.text,fontWeight:600,fontSize:14}}>{emp.firstName} {emp.lastName}</div><div style={{color:C.textMuted,fontSize:12}}>{emp.email}</div></div>
              <Badge color={emp.role==="pharmacien"?C.pharma:C.accent}>{emp.role==="pharmacien"?"Pharmacien":"Préparateur"}</Badge>
              <Badge color={C.textMuted}>{emp.contract}h/sem</Badge>
              <div style={{display:"flex",gap:7}}><Btn size="sm" variant="ghost" onClick={()=>{setEditId(emp.id);setForm({firstName:emp.firstName,lastName:emp.lastName,email:emp.email,role:emp.role,contract:emp.contract});setShowForm(true);}}>Modifier</Btn><Btn size="sm" variant="danger" onClick={()=>setConfirmDel(emp)}>Supprimer</Btn></div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [setup,setSetup]=useState(false); // set true to show setup screen
  const [loading,setLoading]=useState(true);
  const [syncing,setSyncing]=useState(false);
  const [syncError,setSyncError]=useState(false);

  const [pharmaEmps,setPharmaEmps]=useState([]);
  const [paraEmps,setParaEmps]=useState([]);
  const [pharmaWeeks,setPharmaWeeks]=useState([]);
  const [paraWeeks,setParaWeeks]=useState([]);
  const [exchanges,setExchanges]=useState([]);
  const [activeTab,setActiveTab]=useState("calendar");
  const [sector,setSector]=useState("pharmacie");
  const [selectedWeekId,setSelectedWeekId]=useState("");
  const [showUnlockModal,setShowUnlockModal]=useState(false);
  const [unlockInput,setUnlockInput]=useState("");
  const [unlockError,setUnlockError]=useState(false);
  const clickTimes=useRef([]);

  // ── LOAD FROM SUPABASE ──
  useEffect(()=>{
    async function load(){
      setLoading(true);
      try{
        // Load employees
        let [pEmps,paraE]=await Promise.all([db.getEmployees("pharmacie"),db.getEmployees("parapharmacie")]);
        // If empty, seed with initial data
        if(!pEmps||pEmps.length===0){
          await Promise.all(INIT_PHARMA_EMPS.map(e=>db.upsertEmployee(e)));
          pEmps=INIT_PHARMA_EMPS;
        }
        if(!paraE||paraE.length===0){
          await Promise.all(INIT_PARA_EMPS.map(e=>db.upsertEmployee(e)));
          paraE=INIT_PARA_EMPS;
        }
        setPharmaEmps(pEmps);setParaEmps(paraE);

        // Load weeks
        let [pWeeks,prWeeks]=await Promise.all([db.getWeeks("pharmacie"),db.getWeeks("parapharmacie")]);
        if(!pWeeks||pWeeks.length===0){
          const generated=initWeeks(buildBaseTemplate(pEmps,"pharmacie"),"pharmacie");
          await Promise.all(generated.map(w=>db.upsertWeek(w)));
          pWeeks=generated;
        }
        if(!prWeeks||prWeeks.length===0){
          const generated=initWeeks(buildBaseTemplate(paraE,"parapharmacie"),"parapharmacie");
          await Promise.all(generated.map(w=>db.upsertWeek(w)));
          prWeeks=generated;
        }
        setPharmaWeeks(pWeeks);setParaWeeks(prWeeks);
        setSelectedWeekId(pWeeks[0]?.id||"");

        // Load exchanges
        const [pEx,prEx]=await Promise.all([db.getExchanges("pharmacie"),db.getExchanges("parapharmacie")]);
        setExchanges([...(pEx||[]),...(prEx||[])]);

        setSyncError(false);
      }catch(e){
        console.error("Load error:",e);
        setSyncError(true);
        // Fallback to local data
        setPharmaEmps(INIT_PHARMA_EMPS);setParaEmps(INIT_PARA_EMPS);
        setPharmaWeeks(initWeeks(buildBaseTemplate(INIT_PHARMA_EMPS,"pharmacie"),"pharmacie"));
        setParaWeeks(initWeeks(buildBaseTemplate(INIT_PARA_EMPS,"parapharmacie"),"parapharmacie"));
        setSelectedWeekId(getMondayOf(new Date()).toISOString().slice(0,10));
      }
      setLoading(false);
    }
    load();
  },[]);

  // ── AUTO-SAVE WEEKS ──
  async function saveWeek(week){
    setSyncing(true);
    try{await db.upsertWeek(week);setSyncError(false);}catch(e){console.error(e);setSyncError(true);}
    setSyncing(false);
  }

  const weeks     = sector==="pharmacie"?pharmaWeeks:paraWeeks;
  const setWeeks  = sector==="pharmacie"?setPharmaWeeks:setParaWeeks;
  const employees = sector==="pharmacie"?pharmaEmps:paraEmps;
  const setEmp    = sector==="pharmacie"?setPharmaEmps:setParaEmps;
  const selectedWeek=weeks.find(w=>w.id===selectedWeekId)||weeks[0];

  function handleLogoClick(){
    const now=Date.now();
    clickTimes.current=[...clickTimes.current.filter(t=>now-t<UNLOCK_WINDOW),now];
    if(clickTimes.current.length>=UNLOCK_SECRET){
      clickTimes.current=[];
      setUnlockInput("");setUnlockError(false);setShowUnlockModal(true);
    }
  }

  function handleUnlockSubmit(){
    if(unlockInput==="Kzqbtcx"){
      const w=sector==="pharmacie"?pharmaWeeks:paraWeeks;
      const sw=sector==="pharmacie"?setPharmaWeeks:setParaWeeks;
      const target=w.find(wk=>wk.locked&&wk.id===selectedWeekId)||w.find(wk=>wk.locked);
      if(target){
        const updated={...target,locked:false,lockedAt:null};
        sw(prev=>prev.map(wk=>wk.id===target.id?updated:wk));
        saveWeek(updated);
      }
      setShowUnlockModal(false);setUnlockInput("");setUnlockError(false);
    }else{setUnlockError(true);setUnlockInput("");}
  }

  async function toggleSlot(weekId,day,empId,slot){
    const w=weeks.find(wk=>wk.id===weekId);if(!w||w.locked)return;
    const next=JSON.parse(JSON.stringify(w));
    const cur=next.data[day]?.[empId]?.[slot]||"off";
    next.data[day][empId][slot]=cur==="off"?"work":cur==="work"?"pause":"off";
    setWeeks(prev=>prev.map(wk=>wk.id===weekId?next:wk));
    await saveWeek(next);
  }

  async function lockWeek(weekId){
    const w=weeks.find(wk=>wk.id===weekId);if(!w)return;
    const updated={...w,locked:true,lockedAt:new Date().toISOString()};
    setWeeks(prev=>prev.map(wk=>wk.id===weekId?updated:wk));
    await saveWeek(updated);
  }

  async function addMoreWeeks(){
    const last=weeks[weeks.length-1];if(!last)return;
    const lastMonday=new Date(last.monday);
    const newWeeks=Array.from({length:4},(_,i)=>{
      const m=new Date(lastMonday);m.setDate(m.getDate()+(i+1)*7);
      return createWeekSchedule(m,buildBaseTemplate(employees,sector),sector);
    });
    setWeeks(prev=>[...prev,...newWeeks]);
    try{await Promise.all(newWeeks.map(w=>db.upsertWeek(w)));}catch(e){console.error(e);}
  }

  if(setup) return <SetupScreen onDone={()=>setSetup(false)}/>;

  if(loading) return(
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16}}>
      <div style={{width:48,height:48,borderRadius:12,background:`linear-gradient(135deg,${C.accent},${C.pharma})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,color:"#0F1923",fontWeight:900}}>⊕</div>
      <div style={{color:C.textMuted,fontSize:14}}>Chargement des données…</div>
      {syncError&&<div style={{color:C.warning,fontSize:12}}>Connexion Supabase lente — utilisation des données locales</div>}
    </div>
  );

  const pendingCount=exchanges.filter(e=>e.status==="pending").length;
  const totalAlerts=selectedWeek?DAYS.flatMap(d=>sector==="pharmacie"?checkRules(selectedWeek.data,employees,d):[]).filter(a=>a.type==="danger").length:0;
  const tabs=[
    {id:"calendar",  label:"Calendrier",      icon:"📅"},
    {id:"trames",    label:"Grille horaire",   icon:"▦"},
    {id:"individual",label:"Planning",         icon:"◉"},
    {id:"exchanges", label:pendingCount>0?`Échanges (${pendingCount})`:"Échanges",icon:"⇄"},
    {id:"employees", label:"Équipe",           icon:"◎"},
  ];

  return(
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"'Inter',system-ui,sans-serif",color:C.text}}>
      {/* Unlock modal */}
      {showUnlockModal&&(
        <div style={{position:"fixed",inset:0,zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.75)",backdropFilter:"blur(4px)"}} onClick={()=>{setShowUnlockModal(false);setUnlockError(false);setUnlockInput("");}}>
          <div onClick={e=>e.stopPropagation()} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:16,padding:28,width:300,display:"flex",flexDirection:"column",gap:14}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}><span style={{fontSize:22}}>🔐</span><span style={{color:C.text,fontWeight:700,fontSize:16}}>Accès restreint</span></div>
            <input type="password" value={unlockInput} onChange={e=>setUnlockInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleUnlockSubmit()} placeholder="Mot de passe" autoFocus style={{padding:"10px 14px",borderRadius:8,background:C.bg,border:`1px solid ${unlockError?C.danger:C.border}`,color:C.text,fontFamily:"inherit",fontSize:14,outline:"none"}}/>
            {unlockError&&<span style={{color:C.danger,fontSize:12,fontWeight:600}}>Mot de passe incorrect.</span>}
            <div style={{display:"flex",gap:8}}>
              <button onClick={handleUnlockSubmit} style={{flex:1,padding:"9px",borderRadius:8,border:"none",background:C.accent,color:"#0F1923",fontFamily:"inherit",fontWeight:700,fontSize:14,cursor:"pointer"}}>Confirmer</button>
              <button onClick={()=>{setShowUnlockModal(false);setUnlockError(false);setUnlockInput("");}} style={{padding:"9px 14px",borderRadius:8,border:`1px solid ${C.border}`,background:"transparent",color:C.textMuted,fontFamily:"inherit",fontWeight:600,fontSize:13,cursor:"pointer"}}>Annuler</button>
            </div>
          </div>
        </div>
      )}

      {/* Top bar */}
      <div style={{position:"sticky",top:0,zIndex:100,background:`${C.surface}EE`,backdropFilter:"blur(12px)",borderBottom:`1px solid ${C.border}`,padding:"0 18px",display:"flex",alignItems:"center",gap:14,height:54,flexWrap:"wrap"}}>
        <div onClick={handleLogoClick} style={{display:"flex",alignItems:"center",gap:8,cursor:"default",userSelect:"none"}}>
          <div style={{width:28,height:28,borderRadius:7,background:`linear-gradient(135deg,${C.accent},${C.pharma})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,color:"#0F1923",fontWeight:900}}>⊕</div>
          <span style={{fontSize:14,fontWeight:800,color:C.text,letterSpacing:"-0.02em"}}>Pharma<span style={{color:C.accent}}>Planning</span></span>
        </div>
        <div style={{display:"flex",gap:2,background:C.bg,borderRadius:8,padding:3,border:`1px solid ${C.border}`}}>
          {[["pharmacie","💊 Pharmacie"],["parapharmacie","✨ Para"]].map(([s,l])=>(
            <button key={s} onClick={()=>setSector(s)} style={{padding:"4px 10px",borderRadius:6,border:"none",cursor:"pointer",fontFamily:"inherit",fontWeight:600,fontSize:12,background:sector===s?(s==="pharmacie"?C.accent:C.purple):"transparent",color:sector===s?"#0F1923":C.textMuted,transition:"all 0.15s"}}>{l}</button>
          ))}
        </div>
        {selectedWeek&&<div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{color:selectedWeek.locked?C.locked:C.accent,fontSize:12,fontWeight:600}}>{formatDate(new Date(selectedWeek.monday),true)}–{formatDate(new Date(new Date(selectedWeek.monday).setDate(new Date(selectedWeek.monday).getDate()+6)),true)}{selectedWeek.locked?" 🔒":""}</span>
          {totalAlerts>0&&<Badge color={C.danger}>{totalAlerts} alerte{totalAlerts>1?"s":""}</Badge>}
        </div>}
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:10}}>
          <SyncBadge syncing={syncing} error={syncError}/>
          <Badge color={C.accent}>Manager</Badge>
        </div>
      </div>

      {/* Nav */}
      <div style={{background:C.surface,borderBottom:`1px solid ${C.border}`,padding:"0 18px",display:"flex",gap:1,overflowX:"auto"}}>
        {tabs.map(tab=>(
          <button key={tab.id} onClick={()=>setActiveTab(tab.id)} style={{padding:"12px 15px",background:"transparent",border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:600,whiteSpace:"nowrap",color:activeTab===tab.id?C.accent:C.textMuted,borderBottom:`2px solid ${activeTab===tab.id?C.accent:"transparent"}`,transition:"all 0.15s"}}>
            <span style={{marginRight:5}}>{tab.icon}</span>{tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{padding:"18px",maxWidth:1440,margin:"0 auto"}}>
        {activeTab==="calendar"&&(
          <div>
            <div style={{marginBottom:14}}><h2 style={{color:C.text,margin:"0 0 3px",fontSize:18,fontWeight:700}}>Calendrier des plannings</h2><p style={{color:C.textMuted,fontSize:13,margin:0}}>Cliquez sur une semaine pour l'éditer. Validez pour verrouiller.</p></div>
            <CalendarView weeks={weeks} sector={sector} employees={employees} onSelectWeek={id=>{setSelectedWeekId(id);setActiveTab("trames");}} onLockWeek={lockWeek}/>
            <div style={{marginTop:14}}><Btn variant="ghost" onClick={addMoreWeeks}>+ Charger 4 semaines supplémentaires</Btn></div>
          </div>
        )}
        {activeTab==="trames"&&selectedWeek&&(
          <div>
            <div style={{marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
              <div><h2 style={{color:C.text,margin:"0 0 3px",fontSize:18,fontWeight:700}}>Grille — {formatDate(new Date(selectedWeek.monday))} au {formatDate(new Date(new Date(selectedWeek.monday).setDate(new Date(selectedWeek.monday).getDate()+6)))}</h2></div>
              <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                {weeks.map(w=>{const m=new Date(w.monday);return <button key={w.id} onClick={()=>setSelectedWeekId(w.id)} style={{padding:"4px 9px",borderRadius:6,border:`1px solid ${w.id===selectedWeekId?C.accent:C.border}`,cursor:"pointer",fontFamily:"inherit",fontSize:11,fontWeight:600,background:w.id===selectedWeekId?C.accentDim:"transparent",color:w.id===selectedWeekId?C.accent:C.textMuted}}>{formatDate(m,true)}{w.locked?" 🔒":""}</button>;})}
              </div>
            </div>
            <Card>
              <TrameGrid weekData={selectedWeek.data} weekId={selectedWeek.id} monday={selectedWeek.monday} employees={employees} onToggleSlot={toggleSlot} locked={selectedWeek.locked} sector={sector}/>
            </Card>
            {!selectedWeek.locked&&<div style={{marginTop:12,display:"flex",justifyContent:"flex-end"}}><Btn variant="success" onClick={()=>lockWeek(selectedWeek.id)}>✓ Valider et verrouiller</Btn></div>}
          </div>
        )}
        {activeTab==="individual"&&<IndividualPlanning weeks={weeks} employees={employees}/>}
        {activeTab==="exchanges"&&<Exchanges exchanges={exchanges.filter(e=>(weeks.find(w=>w.id===e.weekId)||e.sector===sector))} setExchanges={setExchanges} weeks={weeks} setWeeks={setWeeks} employees={employees}/>}
        {activeTab==="employees"&&<EmployeeManager employees={employees} setEmployees={setEmp} weeks={weeks} setWeeks={setWeeks} sector={sector}/>}
      </div>
    </div>
  );
}
