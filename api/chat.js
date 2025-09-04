// /api/chat.js — JoopJurist backend (Vercel/Node serverless)
// Vereist: OPENAI_API_KEY in je environment (Vercel dashboard of lokaal .env)

// 0) Runtime MOET bovenaan
export const config = { runtime: "nodejs" };

// 1) Imports + OpenAI client
import OpenAI from "openai";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 2) Mini clause-catalogus (klein gehouden)
const CATALOG = [
  {
    id: "eigendom_diefstal",
    title: "Eigendom & geen diefstal",
    why: "Voorkomt problemen als het object gestolen blijkt.",
    clause:
      "Verkoper verklaart eigenaar te zijn en dat het object niet als gestolen geregistreerd staat. Bij onjuistheid mag koper de overeenkomst ontbinden en ontvangt hij de koopprijs terug.",
    when: { category: ["fiets","telefoon","laptop","camera","instrument","overig"], min_price: 200 }
  },
  {
    id: "identificatie_fiets",
    title: "Framenummer & sleutels (fiets)",
    why: "Maakt de fiets identificeerbaar en afspraken over sleutels duidelijk.",
    clause:
      "Identificatie: framenummer {{object.identifiers|*[●nader aan te vullen●]*}}. Verkoper levert bij levering {{keys_count|2}} sleutels over.",
    when: { category: ["fiets"] },
    vars: { keys_count: 2 }
  },
  {
    id: "proefrit_gebreken",
    title: "Proefrit/inspectie & verborgen gebreken",
    why: "Legt de staat vast en beperkt discussies achteraf.",
    clause:
      "Koper heeft het object kunnen inspecteren/proefrijden op {{inspectiedatum|*[●nader aan te vullen●]*}} en accepteert de zichtbare staat. Verborgen gebreken die verkoper kende blijven voor rekening van verkoper.",
    when: { category: ["fiets","laptop","telefoon","camera","instrument","overig"] }
  },
  {
    id: "accountvrij_imei",
    title: "Accountvrij & IMEI (telefoon)",
    why: "Voorkomt lock-problemen en controleert herkomst.",
    clause:
      "Verkoper garandeert dat het toestel niet iCloud/Google-gelockt is en dat de IMEI {{object.identifiers|*[●nader aan te vullen●]*}} niet als gestolen geregistreerd staat.",
    when: { category: ["telefoon"] }
  },
  {
    id: "licentie_privacy",
    title: "Licentie & dataveilig wissen (laptop)",
    why: "Regelt legitieme software en privacybescherming.",
    clause:
      "Meegeleverd: geldige licentie {{software_licentie|*[●nader aan te vullen●]*}}. Verkoper verwijdert alle persoonlijke data en accounts vóór levering (factory reset).",
    when: { category: ["laptop"] }
  },
  {
    id: "transport_risico",
    title: "Transport & risico bij verzending",
    why: "Legt vast wie het risico draagt tijdens verzending.",
    clause:
      "Bij verzending gaat het risico op verlies of beschadiging over bij aflevering op het bezorgadres. Partijen spreken af dat {{verzendkosten_betaler|koper}} de verzendkosten en eventuele verzekering betaalt.",
    when: { shipping: true }
  },
  {
    id: "eigendomsvoorbehoud",
    title: "Eigendom pas na volledige betaling",
    why: "Geeft zekerheid aan de verkoper bij betaling in termijnen.",
    clause:
      "Eigendom gaat pas over na volledige betaling van de koopprijs; tot dat moment mag koper het object niet verkopen of bezwaren.",
    when: { pay_in_parts: true }
  }
];

// 3) Utils
const PH = "*[●nader aan te vullen●]*";
const get = (o,p)=>p.split(".").reduce((x,k)=>x&&x[k],o);
function set(obj, p, val){ const a=p.split("."); let o=obj; for(let i=0;i<a.length-1;i++){ if(!o[a[i]]) o[a[i]]={}; o=o[a[i]]; } o[a[a.length-1]]=val; }
function mergeFacts(oldF={}, newF={}){ const out=JSON.parse(JSON.stringify(oldF)); (function rec(s,pre=""){ for(const k of Object.keys(s||{})){ const v=s[k], path=pre?`${pre}.${k}`:k; if(v&&typeof v==="object"&&!Array.isArray(v)){ if(!get(out,path)) set(out,path,{}); rec(v,path);} else { set(out,path,v);} } })(newF); return out; }

// Contract terms regex
const DRAFT_TERMS_RE = /\b(concept|koopovereenkomst|overeenkomst|koopcontract|contract|contracttekst|document)\b/i;
const DRAFT_VERBS_RE = /\b(opstel\w*|maak\w*|genereer\w*|schrijf\w*)\b/i;

// Helper functions
function lastAssistantText(history = []) {
  const msg = [...(history || [])].reverse().find(m => m.role === "assistant");
  const c = msg?.content;
  if (!c) return "";
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c.map(p => (typeof p === "string" ? p : (p?.text || ""))).join(" ");
  }
  if (typeof c === "object") {
    return c.say || c.text || c.message || "";
  }
  return String(c || "");
}

function nearestCourt(place=""){
  const s = (place||"").toLowerCase();
  const map = [
    [/den haag|wassenaar|leiden|delft|zoetermeer|scheveningen|voorburg/, "Rechtbank Den Haag"],
    [/amsterdam|amstelveen|diemen|zaandam|hoofddorp|haarlem/, "Rechtbank Amsterdam / Noord-Holland"],
    [/rotterdam|schiedam|capelle|spijkenisse|dordrecht/, "Rechtbank Rotterdam"],
    [/utrecht|hilversum|amersfoort|leusden|nieuwegein|zeist/, "Rechtbank Midden-Nederland (Utrecht)"],
    [/eindhoven|s-?hertogenbosch|den bosch|helmond/, "Rechtbank Oost-Brabant"],
    [/breda|tilburg|roosendaal/, "Rechtbank Zeeland-West-Brabant"],
    [/groningen|assen|leeuwarden/, "Rechtbank Noord-Nederland"],
    [/zwolle|enschede|deventer|almelo/, "Rechtbank Overijssel"],
    [/arnhem|nijmegen|apeldoorn|zutphen|ede|wageningen/, "Rechtbank Gelderland"],
    [/maastricht|heerlen|sittard|venlo|roermond/, "Rechtbank Limburg"]
  ];
  for (const [rx,c] of map) if (rx.test(s)) return c;
  return "Rechtbank Den Haag";
}

const REQUIRED = [
  "koper.naam","verkoper.naam",
  "object.omschrijving","prijs.bedrag",
  "levering.datum","levering.plaats"
];

const missingKeys = f => REQUIRED.filter(k => !get(f,k));

const prettyLabel = k => ({
  "koper.naam":"naam van de koper",
  "verkoper.naam":"naam van de verkoper",
  "object.omschrijving":"omschrijving van het object",
  "prijs.bedrag":"koopprijs",
  "levering.datum":"leveringsdatum",
  "levering.plaats":"leveringsplaats"
}[k] || k);

// User intent detection
const wantsDraft = (msg = "") => {
  const s = (msg || "").toLowerCase().normalize("NFKD");
  if (!s.trim()) return false;
  const verb = /(toon|laat\s*zien|geef|stuur|maak|cre[eë]er|genereer|schrijf|stel\s*op|opstellen|bouw)/i.test(s);
  const noun = DRAFT_TERMS_RE.test(s);
  const polite = /\b(mag ik|kun je|wil je|zou je)\b/i.test(s) && DRAFT_TERMS_RE.test(s);
  const shortcut = /\bconcept\s*(graag|alvast)?\b/i.test(s);
  return (verb && noun) || polite || shortcut;
};

const CONTRACT_KW_RE = /(koopovereenkomst|overeenkomst|contract|clausule|bepaling|opstellen|concept|voorbeeld|draft)/i;
function isContractIntentHeuristic(msg=""){
  if (wantsDraft(msg)) return true;
  return CONTRACT_KW_RE.test(msg || "");
}

function isAffirmative(msg = "") {
  const s = (msg || "").toLowerCase().normalize("NFKD").trim();
  if (!s) return false;
  if (/\b(nee|niet|liever niet|geen|nog niet|stop|wacht|nope|nah)\b/.test(s)) return false;
  if (/(^|\s)(👍|👌|✅|✔️|☑️|✌️|🙌|👏)(\s|$)/.test(msg)) return true;
  const yesPhrases = [
    "ja","jazeker","zeker","tuurlijk","natuurlijk","prima","akkoord",
    "ok","oke","oké","okay","okey","yes","yup","sure","please","pls",
    "doe maar","ga maar","ga door","ga je gang","go ahead","is goed",
    "graag","heel graag","graag hoor","top","helemaal goed","klinkt goed"
  ];
  return yesPhrases.some(p =>
    new RegExp(`\\b${p.replace(/\s+/g,"\\s+")}\\b`, "i").test(s)
  );
}

function assistantOfferedDraft(history = []) {
  const lastText = lastAssistantText(history);
  return /\b(concept|overeenkomst|contract)\b/i.test(lastText) && 
         /\b(maken|opstellen|genereren|zal ik)\b/i.test(lastText);
}

// Category detection and suggestions
function detectCategory(facts){
  const s = (facts?.object?.omschrijving || "").toLowerCase();
  if (/fiets|e-bike|racefiets|mtb|bakfiets|mountainbike/.test(s)) return "fiets";
  if (/laptop|notebook|macbook|computer|pc/.test(s)) return "laptop";
  if (/telefoon|smartphone|iphone|samsung/.test(s)) return "telefoon";
  if (/camera|canon|nikon|sony|fujifilm/.test(s)) return "camera";
  if (/gitaar|piano|keyboard|viool|drum/.test(s)) return "instrument";
  return "overig";
}

function deriveFlags(facts, lastUserMsg=""){
  const price = Number(facts?.prijs?.bedrag || 0);
  const shipping = /verzend|bezorg|opsturen|pakket|postnl|dhl/i.test(lastUserMsg)
                 || /bezorg|aflever/i.test(facts?.levering?.plaats || "");
  const payInParts = /termijn|in delen|gespreid|betaling in delen/i.test(lastUserMsg);
  return { price, shipping, payInParts };
}

function fillTemplate(tpl, facts, vars={}) {
  return tpl.replace(/\{\{([^}|]+)(?:\|([^}]*))?\}\}/g, (_, path, fb) => {
    const v = get(facts, path.trim());
    if (v != null && String(v).trim() !== "") return String(v);
    if (vars && vars[path.trim()] != null) return String(vars[path.trim()]);
    return fb != null ? fb : PH;
  });
}

function pickCatalogSuggestions(facts, lastUserMsg=""){
  const cat = detectCategory(facts);
  const { price, shipping, payInParts } = deriveFlags(facts, lastUserMsg);
  const matches = CATALOG.filter(it => {
    const w = it.when || {};
    if (w.category && !w.category.includes(cat)) return false;
    if (w.min_price && price < w.min_price) return false;
    if (w.shipping === true && !shipping) return false;
    if (w.pay_in_parts === true && !payInParts) return false;
    return true;
  });
  return matches.slice(0,3).map(it => ({
    id: it.id, title: it.title, why: it.why,
    clause: fillTemplate(it.clause, facts, it.vars || {})
  }));
}

function parseSuggestionSelection(userMsg="", suggestions=[]){
  const picks = new Set();
  const m = userMsg.match(/\bneem\b([^.]*)/i);
  if (m) {
    const nums = (m[1].match(/\d+/g) || []).map(n => Number(n)-1);
    nums.forEach(ix => suggestions[ix] && picks.add(suggestions[ix].id));
  }
  suggestions.forEach(s => {
    const kw = (s.id || s.title).split(/\W+/)[0];
    if (new RegExp(kw,"i").test(userMsg)) picks.add(s.id);
  });
  return suggestions.filter(s => picks.has(s.id));
}

// Data extraction from messages
function extractFactsFromMessage(msg = "") {
  const f = {};
  let m = msg.match(/\bkoper\b[^A-Za-z0-9]+(?:is|=|:)?\s*([A-ZÀ-ÖØ-Ý][\wÀ-ÖØ-öø-ÿ' -]{1,60})/i);
  if (m) {
    const name = m[1].trim().replace(/[.,;:]+$/, "");
    if (!f.koper) f.koper = {};
    f.koper.naam = name;
  }
  m = msg.match(/\bverkoper\b[^A-Za-z0-9]+(?:is|=|:)?\s*([A-ZÀ-ÖØ-Ý][\wÀ-ÖØ-öø-ÿ' -]{1,60})/i);
  if (m) {
    const name = m[1].trim().replace(/[.,;:]+$/, "");
    if (!f.verkoper) f.verkoper = {};
    f.verkoper.naam = name;
  }
  return f;
}

// Date and place extraction
const NL_MONTHS = { jan:1,januari:1, feb:2,februari:2, mrt:3,maart:3, apr:4,april:4, mei:5, jun:6,juni:6, jul:7,juli:7, aug:8,augustus:8, sep:9,sept:9,september:9, okt:10,oktober:10, nov:11,november:11, dec:12,december:12 };
const NL_DOW = { zondag:0, maandag:1, dinsdag:2, woensdag:3, donderdag:4, vrijdag:5, zaterdag:6 };

function startOfISOWeek(dt){ const d=new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()); const dow=d.getDay()||7; if(dow!==1) d.setDate(d.getDate()-(dow-1)); d.setHours(0,0,0,0); return d; }
function dayFromISOWeek(monday, dow){ const i=(dow===0?7:dow)-1; const d=new Date(monday); d.setDate(monday.getDate()+i); return d; }
const PLACE_RE = /\b(levering|afhalen|bezorging|overdracht|overhandiging)\b[^.]*?\b(in|te|op)\s+([A-ZÀ-ÖØ-Ý][\w'À-ÖØ-öø-ÿ -]{2,})(?=[,.)]|$)/i;
const HOME_RE  = /\b(ik\s+woon|woonplaats\s*(is)?|mijn\s*woonplaats\s*(is)?)\b[^.]*?\b(in|te)\s+([A-ZÀ-ÖØ-Ý][\w'À-ÖØ-öø-ÿ -]{2,})(?=[,.)]|$)/i;
const IN_RE    = /\b(in|te)\s+([A-ZÀ-ÖØ-Ý][\w'À-ÖØ-öø-ÿ -]{2,})(?=[,.)]|$)/g;

function toISODate(d){ const z=n=>String(n).padStart(2,"0"); return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`; }
function nextDow(from, dow){ const d=new Date(from); const delta=(dow-d.getDay()+7)%7||7; d.setDate(d.getDate()+delta); return d; }

function parseDateNL(msg, now=new Date()){
  const s = msg.toLowerCase().normalize("NFKD");
  if (/\bvandaag\b/.test(s)) return toISODate(now);
  if (/\bmorgen\b/.test(s)) { const d=new Date(now); d.setDate(d.getDate()+1); return toISODate(d); }
  if (/\bovermorgen\b/.test(s)) { const d=new Date(now); d.setDate(d.getDate()+2); return toISODate(d); }
  
  let mDow = s.match(/\b(aanstaande|komende|volgende)\s+(zondag|maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag)\b/);
  if (mDow) { const d = nextDow(now, NL_DOW[mDow[2]]); return toISODate(d); }
  
  mDow = s.match(/\b(volgende|deze)\s+week\s+(zondag|maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag)\b/);
  if (mDow) {
    const part = mDow[1]; const dowWord = mDow[2];
    let monday = startOfISOWeek(now);
    if (part === "volgende") monday.setDate(monday.getDate()+7);
    const d = dayFromISOWeek(monday, NL_DOW[dowWord]);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (part === "deze" && d < today) d.setDate(d.getDate()+7);
    return toISODate(d);
  }
  
  let m = s.match(/\b(20\d{2}|19\d{2})[./-](\d{1,2})[./-](\d{1,2})\b/);
  if (m) { const d = new Date(Number(m[1]), Number(m[2])-1, Number(m[3])); if(!isNaN(d)) return toISODate(d); }
  
  m = s.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b/);
  if (m) { let y=Number(m[3]); if (y<100) y+=2000; const d=new Date(y, Number(m[2])-1, Number(m[1])); if(!isNaN(d)) return toISODate(d); }
  
  m = s.match(/\b(\d{1,2})\s+([a-z.]+)\s*(\d{2,4})?\b/);
  if (m && NL_MONTHS[m[2].replace(".","")]) { 
    let y=m[3]?Number(m[3]):now.getFullYear(); 
    if (y<100) y+=2000; 
    const d=new Date(y, NL_MONTHS[m[2].replace(".","")]-1, Number(m[1])); 
    if(!m[3] && d<now) d.setFullYear(d.getFullYear()+1); 
    if(!isNaN(d)) return toISODate(d); 
  }
  
  m = s.match(/\b(\d{1,2})[./-](\d{1,2})\b/);
  if (m) { 
    const y0=now.getFullYear(); 
    let d=new Date(y0, Number(m[2])-1, Number(m[1])); 
    const today=new Date(now.getFullYear(), now.getMonth(), now.getDate()); 
    if (d<today) d.setFullYear(y0+1); 
    if(!isNaN(d)) return toISODate(d); 
  }
  return null;
}

function extractDatesPlaces(msg, now=new Date()){
  const out = {};
  const iso = parseDateNL(msg, now); if (iso) out["levering.datum"] = iso;
  let m = msg.match(PLACE_RE); if (m) out["levering.plaats"] = m[3].trim();
  m = msg.match(HOME_RE); if (m) out["forum.woonplaats_gebruiker"] = m[5].trim();
  if (!out["levering.plaats"]) { let last=null, r; while ((r=IN_RE.exec(msg))!==null) last=r[2]; if (last) out["levering.plaats"]=last.trim(); }
  return out;
}

// LLM System prompt and call
const SYSTEM_PROMPT = `
Je bent "JoopJurist", een Nederlandse jurist met veel ervaring. Doel: help bij koopovereenkomst voor spullen (roerende zaak) in natuurlijk Nederlands.

STIJL:
- Eén antwoord per beurt. "say" = korte, vriendelijke boodschap; als er een vraag is, voeg die er direct achteraan toe als "ask" (max 1). Geen dubbele of herhaalde vragen.
- Geen aparte lijst met "Mogelijke aanvullingen". Adviezen verwerk je natuurlijk in "say" of — als het om contracttekst gaat — rechtstreeks in het "concept".
- Altijd NL; datums liefst ISO (YYYY-MM-DD).

JURIDISCH:
- Toepasselijk recht = Nederlands recht.
- Forumkeuze = dichtstbijzijnde rechtbank bij woonplaats van gebruiker (leid af of vraag 1×).

INTENT:
- Bepaal "intent" ∈ {"contract","general","other"}.
- "contract" = gebruiker wil (verder) een koopovereenkomst of clausule opstellen/aanpassen/afronden.
- "general" = algemene vraag/advies (los van het document).
- "other" = niet te plaatsen/overig.
- Zet "should_draft" true **alleen** als de gebruiker expliciet om een concept vraagt of duidelijk verder wil met het document; anders false.

FACTS-SCHEMA (exact deze paden):
facts = {
  "koper":   { "naam": string|null, "adres": string|null },
  "verkoper":{ "naam": string|null, "adres": string|null },
  "object":  { "omschrijving": string|null, "conditie": string|null, "identifiers": string|null },
  "prijs":   { "bedrag": number|null },
  "levering":{ "datum": string|null, "plaats": string|null },
  "forum":   { "woonplaats_gebruiker": string|null, "rechtbank": string|null },
  "recht":   { "toepasselijk": "Nederlands recht" }
}

OUTPUT (STRICT JSON, zonder extra tekst):
{"say": string, "facts": object, "ask": string|null, "suggestions": [], "concept": null, "done": boolean, "intent":"contract"|"general"|"other", "should_draft": boolean}
`;

async function callLLM({facts, history, message}) {
  const messages = [
    { role:"system", content: SYSTEM_PROMPT },
    ...(history || []).slice(-8),
    { role:"user", content: JSON.stringify({ message, facts }) }
  ];

  const resp = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o",
    temperature: 0.3,
    messages,
    response_format: { type: "json_object" }
  });

  const raw = resp.choices?.[0]?.message?.content || "{}";
  try { return JSON.parse(raw); }
  catch {
    return { say:"Sorry, ik kon dit niet goed verwerken.", facts, ask:"Wil je het anders formuleren?", suggestions:[], concept:null, done:false };
  }
}

// Normalize say/ask to avoid duplicate questions
function normalizeSayAsk(llm) {
  if (!llm) return;

  if (llm.say && /\?/.test(llm.say)) {
    const m = llm.say.match(/([^?.!]*\?)\s*$/);
    if (m) {
      const qFull = m[1].trim();
      const before = llm.say.slice(0, llm.say.length - m[0].length);
      llm.say = before.replace(/[–—-]\s*$/, "").trim();
      if (!llm.ask || !llm.ask.trim()) llm.ask = qFull;
    }
  }

  if (llm.ask) {
    const norm = s => (s || "").replace(/\W+/g, "").toLowerCase();
    if (!llm.ask.trim() || norm(llm.ask) === norm(llm.say)) {
      llm.ask = null;
    }
  }
  
  if (llm.ask && llm.ask.trim()) {
    const q = llm.ask.trim().replace(/\s*\?+$/, "?");
    const alreadyHas = (llm.say || "").includes(q);
    if (!alreadyHas) {
      const sep = llm.say && !/[?.!…]$/.test(llm.say) ? ". " : " ";
      llm.say = (llm.say || "").trim() + sep + q;
    }
    llm.ask = null;
  }
}

// SIMPLIFIED CONTRACT GENERATION LOGIC
function shouldGenerateContract(message, facts, history) {
  // Rule 1: User explicitly asks for contract
  if (wantsDraft(message)) return { generate: true, reason: 'explicit_request' };
  
  // Rule 2: User says yes to our offer
  if (isAffirmative(message) && assistantOfferedDraft(history)) {
    return { generate: true, reason: 'accepted_offer' };
  }
  
  // Rule 3: All required data is complete and user shows contract intent
  const missing = missingKeys(facts);
  if (missing.length === 0 && isContractIntentHeuristic(message)) {
    return { generate: true, reason: 'complete_data' };
  }
  
  return { generate: false, reason: 'not_ready' };
}

// Contract renderer
function renderConcept(f, usePH){
  const v = p => get(f,p) || (usePH ? PH : "");
  const bedrag = get(f,"prijs.bedrag");
  const prijsStr = (bedrag != null && String(bedrag).trim() !== "")
    ? `€ ${Number(bedrag).toLocaleString("nl-NL",{minimumFractionDigits:2, maximumFractionDigits:2})}`
    : (usePH ? PH : "€ …");
  const forum = get(f,"forum.rechtbank") || (usePH ? PH : "dichtstbijzijnde rechtbank bij woonplaats koper");

  return `**KOOPOVEREENKOMST – SPULLEN (roerende zaak)**

**Partijen**
1. **Koper**: ${v("koper.naam")}${get(f,"koper.adres")?`, ${get(f,"koper.adres")}`:""}.
2. **Verkoper**: ${v("verkoper.naam")}${get(f,"verkoper.adres")?`, ${get(f,"verkoper.adres")}`:""}.

**1. Omschrijving van het object**
Het verkochte betreft: **${v("object.omschrijving")}**${get(f,"object.conditie")?`, conditie: ${get(f,"object.conditie")}`:""}${get(f,"object.identifiers")?` (identificatie: ${get(f,"object.identifiers")})`:""}.

**2. Prijs en betaling**
De koopprijs bedraagt **${prijsStr}**. Betaling via ${get(f,"betaling.wijze")||"overboeking"} op ${get(f,"betaling.moment")||"moment van levering"}.

**3. Levering en risico**
Levering vindt plaats op **${v("levering.datum")}** te **${v("levering.plaats")}**. Het risico gaat over bij levering.

**4. Eigendom en garanties**
Verkoper verklaart eigenaar te zijn en dat het object vrij is van beslagen en beperkte rechten. Verborgen gebreken die verkoper kende blijven voor rekening van verkoper.

**5. Toepasselijk recht en forumkeuze**
Op deze overeenkomst is **Nederlands recht** van toepassing.
Geschillen worden exclusief voorgelegd aan de **${forum}**.


**Ondertekening**

**Koper**: ${get(f,"koper.naam")||"Koper"}

Handtekening: _________________________________

Datum: __________________

**Verkoper**: ${get(f,"verkoper.naam")||"Verkoper"}

Handtekening: _________________________________

Datum: __________________`;
}

// Main API handler
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

    const {
      message = "",
      facts: clientFacts = {},
      history = [],
      clientNow,
      clientOffset
    } = req.body || {};

    // Handle client timezone
    let NOW = new Date();
    if (clientNow) {
      const base = new Date(clientNow);
      if (!isNaN(base)) {
        const offsetMin = Number.isFinite(clientOffset) ? Number(clientOffset) : 0;
        NOW = new Date(base.getTime() - offsetMin * 60 * 1000);
      }
    }

    // Extract facts from message using regex patterns
    const extracted = extractFactsFromMessage(message);
    const extractedDP = extractDatesPlaces(message, NOW);
    const mappedDP = {};
    if (extractedDP["levering.datum"]) set(mappedDP, "levering.datum", extractedDP["levering.datum"]);
    if (extractedDP["levering.plaats"]) set(mappedDP, "levering.plaats", extractedDP["levering.plaats"]);
    if (extractedDP["forum.woonplaats_gebruiker"]) set(mappedDP, "forum.woonplaats_gebruiker", extractedDP["forum.woonplaats_gebruiker"]);
    const preFacts = mergeFacts(mergeFacts(clientFacts, extracted), mappedDP);

    // Get LLM response
    const llm = await callLLM({ facts: preFacts, history, message });
    normalizeSayAsk(llm);

    // Merge all facts
    let facts = mergeFacts(preFacts, llm.facts || {});
    set(facts, "recht.toepasselijk", "Nederlands recht");

    // Extra fallback for missing names
    if (!get(facts, "koper.naam")) {
      const f2 = extractFactsFromMessage(message);
      if (f2?.koper?.naam) set(facts, "koper.naam", f2.koper.naam);
    }
    if (!get(facts, "verkoper.naam")) {
      const f2 = extractFactsFromMessage(message);
      if (f2?.verkoper?.naam) set(facts, "verkoper.naam", f2.verkoper.naam);
    }

    // Set court based on user location
    if (get(facts, "forum.woonplaats_gebruiker") && !get(facts, "forum.rechtbank")) {
      set(facts, "forum.rechtbank", nearestCourt(get(facts, "forum.woonplaats_gebruiker")));
    }

    // SIMPLIFIED CONTRACT GENERATION LOGIC
    const contractDecision = shouldGenerateContract(message, facts, history);
    const missing = missingKeys(facts);
    const intent = isContractIntentHeuristic(message) ? "contract" : "general";
    
    let concept = null;
    let done = false;
    let suggestions = [];

    if (contractDecision.generate) {
      // Generate contract (with or without placeholders)
      const usePlaceholders = missing.length > 0;
      concept = renderConcept(facts, usePlaceholders);
      done = !usePlaceholders; // only "done" if no missing data
      
      // Set appropriate response message
      if (contractDecision.reason === 'complete_data') {
        llm.say = "Perfect! Ik heb alle benodigde gegevens. Hier is het concept van de koopovereenkomst.";
      } else if (usePlaceholders) {
        llm.say = "Hier is het concept van de koopovereenkomst met invulplekken waar nog gegevens ontbreken.";
      } else {
        llm.say = "Hier is het concept van de koopovereenkomst.";
      }
      
      // Clear any ask if we're generating
      llm.ask = null;
      
    } else {
      // Don't generate contract
      if (missing.length === 0 && intent === "contract" && !assistantOfferedDraft(history)) {
        // We have all data but user hasn't asked - offer to generate
        llm.say = "Geweldig! Ik heb alle benodigde gegevens voor de koopovereenkomst.";
        llm.ask = "Zal ik het concept nu voor je maken?";
      } else if (missing.length > 0 && intent === "contract") {
        // Missing data - ask for next piece
        llm.ask = `Om verder te gaan heb ik nog nodig: ${prettyLabel(missing[0])}. Kun je die verstrekken?`;
      }
      // For general chat, just use the LLM's response as-is
    }

    // Handle suggestions
    const canSuggest = !!get(facts, "object.omschrijving") && get(facts, "prijs.bedrag") != null;
    suggestions = (intent === "contract" && canSuggest) ? pickCatalogSuggestions(facts, message) : [];

    // Handle suggestion selections
    const picked = parseSuggestionSelection(message, suggestions);
    if (picked.length && concept) {
      const extra = picked.map(s => `\n**Aanvullende bepaling – ${s.title}**\n${s.clause}\n`).join("");
      concept += `\n${extra}`;
    }

    // Final response normalization
    normalizeSayAsk(llm);

    return res.status(200).json({
      say: llm.say || "Helder.",
      facts,
      ask: llm.ask || null,
      suggestions,
      concept,
      done
    });

  } catch (err) {
    console.error("api/chat error:", err);
    return res.status(500).json({
      error: "Server error",
      details: err?.message || String(err)
    });
  }
}
