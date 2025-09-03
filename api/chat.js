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

// Herken dat het model in deze beurt claimt dat er nu een concept komt
// --- Centralised vocabulary for draft detection ---
const DRAFT_TERMS = "(concept|koopovereenkomst|overeenkomst|koopcontract|contract|contracttekst|document)";
const DRAFT_TERMS_RE = new RegExp(`\\b${DRAFT_TERMS}\\b`, "i");
// Herken ook vervoegingen: maak/maakt, opgesteld, genereert, etc.
const DRAFT_VERBS_RE = /\b(opstel\w*|maak\w*|genereer\w*|schrijf\w*)\b/i;
// Meer varianten zodat "Hier heb je / bij deze / alsjeblieft / zie onder" ook werkt
const HERE_IS_RE     = /\b(hier is|hier heb je|bijgaand|hierbij|bij deze|onderstaand|onderstaande|zie hieronder|zie onder|vind je hieronder|alsjeblieft|alstublieft|voilà)\b/i;

// Model claimt dat het concept nu volgt/eronder staat
function llmClaimsDraft(s = "") {
  const t = s || "";
  return HERE_IS_RE.test(t) && DRAFT_TERMS_RE.test(t);
}

// Model belooft het concept te gaan opstellen/maken
function llmWillDraft(s = "") {
  const t = s || "";
  return /\b(ik\s+ga|ik\s+zal|we\s+gaan|we\s+zullen)\b/i.test(t) &&
         DRAFT_TERMS_RE.test(t) &&
         DRAFT_VERBS_RE.test(t);
}

// Declaratieve belofte met voornaamwoord i.p.v. "contract/overeenkomst"
// vb: "Top, ik maak 'm nu", "We stellen het nu op"
function llmWillDraftPronoun(s = "") {
  const t = (s || "").toLowerCase();
  const pron = /\b(het|dit|deze|’m|'m|hem)\b/.test(t);
  const will = /\b(ik\s+ga|ik\s+zal|we\s+gaan|we\s+zullen|ik\s+maak|we\s+maken|ik\s+genereer|we\s+genereren|ik\s+stel|we\s+stellen)\b/.test(t);
  return pron && will && DRAFT_VERBS_RE.test(t);
}

// Model stelt dat het al AF is / zojuist opgesteld
function llmHasDrafted(s = "") {
  const t = s || "";
  // bv. "Ik heb de overeenkomst opgesteld", "De koopovereenkomst is klaar/gereed"
  return DRAFT_TERMS_RE.test(t) &&
         /\b(opgesteld|gemaakt|gegenereerd|geschreven|klaar|gereed|staat hieronder|staat eronder)\b/i.test(t);
}

// Perfectum/af-melding met voornaamwoord
function llmHasDraftedPronoun(s = "") {
  const t = (s || "").toLowerCase();
  return /\b(het|dit|deze|’m|'m|hem)\b/.test(t) &&
         /\b(opgesteld|gemaakt|gegenereerd|geschreven|klaar|gereed|staat hieronder|staat eronder)\b/.test(t);
}

// Laatste assistant-tekst uit de history (werkt ook als content een object is)
function lastAssistantText(history = []) {
  const msg = [...(history || [])].reverse().find(m => m.role === "assistant");
  const c = msg?.content;
  if (!c) return "";
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    // OpenAI tool/parts-stijl: neem alle text-velden samen
    return c.map(p => (typeof p === "string" ? p : (p?.text || ""))).join(" ");
  }
  if (typeof c === "object") {
    // Onze eigen payload van vorige beurt
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

// Strikt: alleen als de gebruiker expliciet om (concept/contract) vraagt
const wantsDraft = (msg = "") => {
  const s = (msg || "").toLowerCase().normalize("NFKD");
  if (!s.trim()) return false;
  const verb = /(toon|laat\s*zien|geef|stuur|maak|cre[eë]er|genereer|schrijf|stel\s*op|opstellen|bouw)/i.test(s);
  const noun = DRAFT_TERMS_RE.test(s);
  const polite = /\b(mag ik|kun je|wil je|zou je)\b/i.test(s) && DRAFT_TERMS_RE.test(s);
  const shortcut = /\bconcept\s*(graag|alvast)?\b/i.test(s); // “concept graag”
  return (verb && noun) || polite || shortcut;
};

// Intent-heuristiek: contract-gerichte trefwoorden
const CONTRACT_KW_RE = /(koopovereenkomst|overeenkomst|contract|clausule|bepaling|opstellen|concept|voorbeeld|draft)/i;
function isContractIntentHeuristic(msg=""){
  // Alleen huidige bericht gebruiken; geen “sticky intent” uit de history
  if (wantsDraft(msg)) return true;
  return CONTRACT_KW_RE.test(msg || "");
}

// Affirmatief antwoord van de gebruiker? (heel graag, tuurlijk, natuurlijk, sure, go ahead, etc.)
function isAffirmative(msg = "") {
  const s = (msg || "").toLowerCase().normalize("NFKD").trim();
  if (!s) return false;
  // duidelijke ontkenningen eerst
  if (/\b(nee|niet|liever niet|geen|nog niet|stop|wacht|nope|nah)\b/.test(s)) return false;
  // emoji & korte bevestigers (ook "top")
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

// Heeft de assistent in de vorige beurt een concept/contract aangeboden?
function assistantOfferedDraft(history = []) {
  return DRAFT_TERMS_RE.test(lastAssistantText(history));
}

// Vroeg de assistent zojuist expliciet om toestemming om te gaan opstellen?
function assistantAskedPermission(history = []) {
  const t = (lastAssistantText(history) || "").toLowerCase();
  if (!t.includes("?")) return false; // moet een vraag zijn
  // Voorbeelden: "Zal ik het/dit/de overeenkomst opstellen/maken/genereren?"
  const refersToDraft = DRAFT_TERMS_RE.test(t) || /\b(het|’m|hem|dit|deze)\b/.test(t);
  const asksPermission = /\b(zal|zullen|kan|kun|mag|wil)\b/.test(t);
  return refersToDraft && asksPermission && DRAFT_VERBS_RE.test(t);
}

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

// 4) Fallback-extractor: haal namen uit platte tekst (bv. “Koper: Jan Jansen”)
function extractFactsFromMessage(msg = "") {
  const f = {};
  // Koper
  let m = msg.match(/\bkoper\b[^A-Za-z0-9]+(?:is|=|:)?\s*([A-ZÀ-ÖØ-Ý][\wÀ-ÖØ-öø-ÿ' -]{1,60})/i);
  if (m) {
    const name = m[1].trim().replace(/[.,;:]+$/, "");
    if (!f.koper) f.koper = {};
    f.koper.naam = name;
  }
  // Verkoper
  m = msg.match(/\bverkoper\b[^A-Za-z0-9]+(?:is|=|:)?\s*([A-ZÀ-ÖØ-Ý][\wÀ-ÖØ-öø-ÿ' -]{1,60})/i);
  if (m) {
    const name = m[1].trim().replace(/[.,;:]+$/, "");
    if (!f.verkoper) f.verkoper = {};
    f.verkoper.naam = name;
  }
  return f;
}

// 4b) Datum- en plaatsherkenning (NL) → feiten
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
  // 👇 NIEUW: 'volgende week dinsdag' en 'deze week vrijdag'
  mDow = s.match(/\b(volgende|deze)\s+week\s+(zondag|maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag)\b/);
  if (mDow) {
    const part = mDow[1]; const dowWord = mDow[2];
    let monday = startOfISOWeek(now);
    if (part === "volgende") monday.setDate(monday.getDate()+7);
    const d = dayFromISOWeek(monday, NL_DOW[dowWord]);
    // 'deze week' maar dag is al voorbij → schuif naar volgende week
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (part === "deze" && d < today) d.setDate(d.getDate()+7);
    return toISODate(d);
  }
  
  let m = s.match(/\b(20\d{2}|19\d{2})[./-](\d{1,2})[./-](\d{1,2})\b/);
  if (m) { const d = new Date(Number(m[1]), Number(m[2])-1, Number(m[3])); if(!isNaN(d)) return toISODate(d); }
  m = s.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b/);
  if (m) { let y=Number(m[3]); if (y<100) y+=2000; const d=new Date(y, Number(m[2])-1, Number(m[1])); if(!isNaN(d)) return toISODate(d); }
  m = s.match(/\b(\d{1,2})\s+([a-z.]+)\s*(\d{2,4})?\b/);
  if (m && NL_MONTHS[m[2].replace(".","")]) { let y=m[3]?Number(m[3]):now.getFullYear(); if (y<100) y+=2000; const d=new Date(y, NL_MONTHS[m[2].replace(".","")]-1, Number(m[1])); if(!m[3] && d<now) d.setFullYear(d.getFullYear()+1); if(!isNaN(d)) return toISODate(d); }
  m = s.match(/\b(\d{1,2})[./-](\d{1,2})\b/);
  if (m) { const y0=now.getFullYear(); let d=new Date(y0, Number(m[2])-1, Number(m[1])); const today=new Date(now.getFullYear(), now.getMonth(), now.getDate()); if (d<today) d.setFullYear(y0+1); if(!isNaN(d)) return toISODate(d); }
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
  
// 5) Prompt + LLM-call (JSON afdwingen)
const SYSTEM_PROMPT = `
Je bent "JoopJurist", een Nederlandse jurist met veel ervaring. Doel: help bij koopovereenkomst voor spullen (roerende zaak) in natuurlijk Nederlands.

OUTPUT-STIJL:
Je bent "JoopJurist", een Nederlandse jurist. Doel: help bij juridisch advies over en het maken van een koopovereenkomst voor spullen (roerende zaak) in natuurlijk, menselijk Nederlands.

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
    // 🔒 dwing zuiver JSON af
    response_format: { type: "json_object" }
  });

  const raw = resp.choices?.[0]?.message?.content || "{}";
  try { return JSON.parse(raw); }
  catch {
    return { say:"Sorry, ik kon dit niet goed verwerken.", facts, ask:"Wil je het anders formuleren?", suggestions:[], concept:null, done:false };
  }
}

// 6) Normaliseer say/ask (vraag alleen in ask)
function normalizeSayAsk(llm) {
  if (!llm) return;

  // verplaats de hele laatste vraagzin uit 'say' naar 'ask'
  if (llm.say && /\?/.test(llm.say)) {
    // match: laatste segment dat eindigt op '?'
    const m = llm.say.match(/([^?.!]*\?)\s*$/);
    if (m) {
      const qFull = m[1].trim();                                     // volledige vraagzin
      const before = llm.say.slice(0, llm.say.length - m[0].length);  // 'say' zonder de vraag
      llm.say = before.replace(/[–—-]\s*$/, "").trim();
      if (!llm.ask || !llm.ask.trim()) llm.ask = qFull;
    }
  }

  // dubbele/lege ask → null
  if (llm.ask) {
    const norm = s => (s || "").replace(/\W+/g, "").toLowerCase();
    if (!llm.ask.trim() || norm(llm.ask) === norm(llm.say)) {
      llm.ask = null;
    }
  }
  // Inline de vraag in 'say' (om cursief/nieuwe regel in de UI te vermijden),
  // maar alleen als 'say' die vraag nog NIET al bevat.
  if (llm.ask && llm.ask.trim()) {
    const q = llm.ask.trim().replace(/\s*\?+$/, "?");
    const alreadyHas = (llm.say || "").includes(q);
    if (!alreadyHas) {
      const sep = llm.say && !/[?.!…]$/.test(llm.say) ? ". " : " ";
      llm.say = (llm.say || "").trim() + sep + q;
    }
    llm.ask = null; // UI toont geen aparte (schuine) ask
  }
}

// 7) API handler
export default async function handler(req, res) {
  try{
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

    // Maak server-side een Date die dezelfde "wandklok" heeft als bij de gebruiker.
    // clientNow (ISO) is UTC; clientOffset is minuten (UTC - local).
    let NOW = new Date();
    if (clientNow) {
      const base = new Date(clientNow); // UTC moment
      if (!isNaN(base)) {
        const offsetMin = Number.isFinite(clientOffset) ? Number(clientOffset) : 0;
        // verschuif zodat getFullYear()/getMonth()/getDate() gelden voor de lokale dag van de gebruiker
        NOW = new Date(base.getTime() - offsetMin * 60 * 1000);
      }
    }
    // 7a) Fallback-extractie vóór de LLM-call
    const extracted = extractFactsFromMessage(message);
    const extractedDP = extractDatesPlaces(message, NOW);
    const mappedDP = {};
    if (extractedDP["levering.datum"])  set(mappedDP,"levering.datum",extractedDP["levering.datum"]);
    if (extractedDP["levering.plaats"]) set(mappedDP,"levering.plaats",extractedDP["levering.plaats"]);
    if (extractedDP["forum.woonplaats_gebruiker"]) set(mappedDP,"forum.woonplaats_gebruiker",extractedDP["forum.woonplaats_gebruiker"]);
    const preFacts = mergeFacts(mergeFacts(clientFacts, extracted), mappedDP);
        
    // 7b) LLM-analyse (met preFacts) + normaliseren
    const llm = await callLLM({ facts: preFacts, history, message });
    normalizeSayAsk(llm);
        
    // 7c) Facts samenvoegen + vaste rechtsbasis + forum
    let facts = mergeFacts(preFacts, llm.facts || {});
    set(facts, "recht.toepasselijk", "Nederlands recht");

    // extra fallback: vul koper/verkoper alsnog als ze nog leeg zijn
    if (!get(facts, "koper.naam")) {
      const f2 = extractFactsFromMessage(message);
      if (f2?.koper?.naam) set(facts, "koper.naam", f2.koper.naam);
    }
    if (!get(facts, "verkoper.naam")) {
      const f2 = extractFactsFromMessage(message);
      if (f2?.verkoper?.naam) set(facts, "verkoper.naam", f2.verkoper.naam);
    }

    if (get(facts,"forum.woonplaats_gebruiker") && !get(facts,"forum.rechtbank")) {
      set(facts,"forum.rechtbank", nearestCourt(get(facts,"forum.woonplaats_gebruiker")));
    }

    // 7d) Missing bepalen
    const missing = missingKeys(facts);
    let suggestions = [];
    
    // 7f) Intent + concept beslissen (alleen op expliciet verzoek)
    // Concept alléén tonen/aanmaken wanneer de gebruiker dat in dit bericht vraagt.
    // of wanneer hij net "ja/graag/ok" heeft gezegd op een aanbod/toestemmingsvraag.

    const modelClaims = llmClaimsDraft(llm.say);
    const modelWillDraft = llmWillDraft(llm.say);
    const modelWillDraftPron = llmWillDraftPronoun(llm.say);
    const modelHasDrafted = llmHasDrafted(llm.say);
    const modelHasDraftedPron = llmHasDraftedPronoun(llm.say);
    const modelShould = !!llm.should_draft;
    // Bepaal intent + init variabelen (declareer deze SLECHTS ÉÉN keer)
    const intent = isContractIntentHeuristic(message) ? "contract" : "general";
    let concept = null;
    let done = false;
    
    // 🔒 Toestemming net gegeven?
    const permissionJustGranted = isAffirmative(message) && assistantAskedPermission(history);

    // ✅ Eén samenhangende poort: als één van deze signalen waar is → render NU
    const mustRenderNow =
      modelClaims || modelHasDrafted || modelHasDraftedPron ||
      modelWillDraft || modelWillDraftPron || modelShould ||
      wantsDraft(message) ||
      permissionJustGranted ||
      (isAffirmative(message) && assistantOfferedDraft(history));
        
    // Vergelijk enkel kernfeiten (excl. afgeleide velden zoals recht.* en forum.rechtbank)
    
    // Render-regels:
    // 1) Alleen bij expliciet verzoek renderen (userWants).
    // 2) Als alle verplichte feiten compleet zijn maar er niet expliciet is gevraagd:
    //    één keer toestemming vragen om het concept te maken (geen auto-render).
    if (!concept && userRenderNow && missing.length === 0) {
      concept = renderConcept(facts, false); // volledig
      done = true;
      llm.ask = null;
    } else if (!concept && userRenderNow && missing.length > 0) {
      concept = renderConcept(facts, true);  // placeholders
      done = true;
      llm.ask = `Zullen we dit eerst invullen: ${prettyLabel(missing[0])}?`;
    } else if (!concept && missing.length === 0) {
      // Alle kernfeiten zijn binnen, maar geen expliciet verzoek.
      // Vraag 1× toestemming; herhaal niet als we dit net aanboden.
      if (!assistantOfferedDraft(history)) {
        llm.ask = "We hebben alle benodigde gegevens. Zal ik het concept van de koopovereenkomst voor je maken?";
      } else {
        llm.ask = null;
      }
    } else if (!concept && intent === "contract" && missing.length > 0) {
      // Nog niet compleet: vraag gericht om de eerstvolgende ontbrekende feit.
      llm.ask = `Zullen we dit eerst invullen: ${prettyLabel(missing[0])}?`;
    } else {
      llm.ask = null; // algemene chat: geen concept en geen vraag
    }
    
    if (concept && done && !/hier\s+is\b/i.test(llm.say || "")) {
      llm.say = missing.length > 0
        ? "Hier is het concept van de koopovereenkomst met invulplekken waar nog gegevens ontbreken."
        : "Hier is het concept van de koopovereenkomst.";
    }

    // ✅ Failsafe: extra vangnet op claims/belofte
    if (!concept && (modelClaims || modelWillDraft || modelHasDrafted || modelHasDraftedPron)) {
      const usePH = missing.length > 0;
      concept = renderConcept(facts, usePH);
      done = true;
      llm.say = usePH
        ? "Hier is het concept van de koopovereenkomst met invulplekken waar nog gegevens ontbreken."
        : "Hier is het concept van de koopovereenkomst.";
      llm.ask = usePH ? `Zullen we dit eerst invullen: ${prettyLabel(missing[0])}?` : null;
    }
    
    // 7g) Suggesties (alleen in contractmodus en met basisdata)
    const canSuggest = !!get(facts,"object.omschrijving") && get(facts,"prijs.bedrag") != null;
    suggestions = (intent === "contract" && canSuggest) ? pickCatalogSuggestions(facts, message) : [];

    // 7h) “neem 1 en 3”
    const picked = parseSuggestionSelection(message, suggestions);
    if (picked.length && concept){
      const extra = picked.map(s => `\n**Aanvullende bepaling – ${s.title}**\n${s.clause}\n`).join("");
      concept += `\n${extra}`;
    }

    // 🔒 Final consistency guard: als de tekst claimt dat er NU een concept is,
    // of zojuist toestemming is gegeven, maar 'concept' is nog leeg → render alsnog.
    const saysHereIsNow =
      HERE_IS_RE.test(llm.say || "") && DRAFT_TERMS_RE.test(llm.say || "");
    
    if (!concept && (saysHereIsNow || permissionJustGranted)) {
      const usePH = missing.length > 0;
      concept = renderConcept(facts, usePH);
      done = true;
    // Zorg dat de copy klopt met de werkelijkheid
    llm.say = usePH
      ? "Hier is het concept van de koopovereenkomst met invulplekken waar nog gegevens ontbreken."
      : "Hier is het concept van de koopovereenkomst.";
    llm.ask = usePH ? `Zullen we dit eerst invullen: ${prettyLabel(missing[0])}?` : null;
    }
    
    // Vraag (als die net is gezet) nog inline in 'say' duwen
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

// 8) Concept renderer
function renderConcept(f, usePH){
  const v = p => get(f,p) || (usePH ? PH : "");
  const bedrag = get(f,"prijs.bedrag");
  const prijsStr = (bedrag != null && String(bedrag).trim() !== "")
    ? `€ ${Number(bedrag).toLocaleString("nl-NL",{minimumFractionDigits:2, maximumFractionDigits:2})}`
    : (usePH ? PH : "€ …");
  const forum = get(f,"forum.rechtbank") || (usePH ? PH : "dichtstbijzijnde rechtbank bij woonplaats koper");

  return [
`**KOOPOVEREENKOMST – SPULLEN (roerende zaak)**

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

Datum: __________________
`
  ].join("\n");
}
