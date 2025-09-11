// /api/chat.js — JoopJurist backend (Vercel/Node serverless)
// Vereist: OPENAI_API_KEY in je environment (Vercel dashboard of lokaal .env)

// 0) Runtime MOET bovenaan
export const config = { runtime: "nodejs" };

// 1) Imports + OpenAI client
import OpenAI from "openai";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Fetch clauses from GitHub
async function loadCatalog(agreementType = "purchase") {
  const url = `https://raw.githubusercontent.com/your-username/joopjurist/main/clauses/${agreementType}.yaml`;
  const response = await fetch(url);
  const yamlText = await response.text();
  // Simple YAML parser (for basic key/value pairs)
  const lines = yamlText.split('\n');
  const catalog = [];
  let currentClause = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('- id:')) {
      if (currentClause) catalog.push(currentClause);
      currentClause = { id: line.split(':')[1].trim() };
    } else if (line.startsWith('title:')) {
      currentClause.title = line.split(':')[1].trim();
    } else if (line.startsWith('why:')) {
      currentClause.why = line.split(':')[1].trim();
    } else if (line.startsWith('clause:')) {
      let clauseLines = [];
      i++;
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        clauseLines.push(lines[i].trim().replace(/^\|/, '').trim());
        i++;
      }
      i--; // Adjust for loop increment
      currentClause.clause = clauseLines.join('\n');
    } else if (line.startsWith('when:')) {
      currentClause.when = {};
      // Parse categories
      const categoryLine = lines.find(l => l.includes('category:'));
      if (categoryLine) {
        const categories = categoryLine.match(/\[(.*?)\]/)[1].split(',').map(c => c.trim().replace(/"/g, ''));
        currentClause.when.category = categories;
      }
      // Parse min_price
      const priceLine = lines.find(l => l.includes('min_price:'));
      if (priceLine) {
        currentClause.when.min_price = parseInt(priceLine.split(':')[1].trim());
      }
      // Parse shipping/pay_in_parts
      const shippingLine = lines.find(l => l.includes('shipping:'));
      if (shippingLine) {
        currentClause.when.shipping = shippingLine.includes('true');
      }
      const payInPartsLine = lines.find(l => l.includes('pay_in_parts:'));
      if (payInPartsLine) {
        currentClause.when.pay_in_parts = payInPartsLine.includes('true');
      }
    } else if (line.startsWith('vars:')) {
      currentClause.vars = {};
      const varsLine = lines.find(l => l.includes('keys_count:') || l.includes('specificaties:'));
      if (varsLine) {
        const key = varsLine.split(':')[0].trim();
        const value = varsLine.split(':')[1].trim();
        currentClause.vars[key] = isNaN(value) ? value : parseInt(value);
      }
    }
  }
  if (currentClause) catalog.push(currentClause);
  return catalog;
}

// Load the catalog when the module initializes
const CATALOG = await loadCatalog();

// 3) Utils
const PH = "*[●nader aan te vullen●]*";
const get = (o,p)=>p.split(".").reduce((x,k)=>x&&x[k],o);
function set(obj, p, val){ const a=p.split("."); let o=obj; for(let i=0;i<a.length-1;i++){ if(!o[a[i]]) o[a[i]]={}; o=o[a[i]]; } o[a[a.length-1]]=val; }
function mergeFacts(oldF={}, newF={}){ const out=JSON.parse(JSON.stringify(oldF)); (function rec(s,pre=""){ for(const k of Object.keys(s||{})){ const v=s[k], path=pre?`${pre}.${k}`:k; if(v&&typeof v==="object"&&!Array.isArray(v)){ if(!get(out,path)) set(out,path,{}); rec(v,path);} else { set(out,path,v);} } })(newF); return out; }

// Helper functions - simplified to let LLM handle intent detection
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

// Data extraction from messages - keep basic regex extraction as fallback
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

// Date and place extraction - simplified
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

// Category detection and suggestions - keep for clause suggestions
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

// IMPROVED LLM System prompt - let it handle all decision making
const SYSTEM_PROMPT = `
Je bent "JoopJurist", een Nederlandse jurist met veel ervaring. Doel: help bij koopovereenkomst voor spullen (roerende zaak) in natuurlijk Nederlands.

STIJL:
- Eén antwoord per beurt. "say" = je boodschap; "ask" = eventuele vraag (max 1). Geen dubbele vragen.
- Altijd NL; datums liefst ISO (YYYY-MM-DD).

JURIDISCH:
- Toepasselijk recht = Nederlands recht.
- Forumkeuze = dichtstbijzijnde rechtbank bij woonplaats van gebruiker.

BESLISSINGEN:
- Bepaal "intent" ∈ {"contract","general","other"}.
- "contract" = gebruiker wil een koopovereenkomst opstellen/aanpassen/afronden.
- "general" = algemene vraag/advies.
- "other" = niet te plaatsen/overig.

WANNEER CONTRACTCONCEPT MAKEN:
Zet "should_draft" op TRUE als:
- Gebruiker vraagt expliciet om contract/concept/overeenkomst ("maak een contract", "opstellen graag", "concept maken")
- Gebruiker zegt ja/akkoord op jouw aanbod om contract te maken
- Gebruiker geeft laatste ontbrekende info en context suggereert dat ze het contract willen
- Het logisch is om nu het concept te genereren

Zet "should_draft" op FALSE bij:
- Algemene vragen over contracten
- Alleen informatieverzameling
- Onduidelijke intentie
- Gebruiker wil nog niet het concept

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

OUTPUT (STRICT JSON):
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
    return { say:"Sorry, ik kon dit niet goed verwerken.", facts, ask:"Wil je het anders formuleren?", suggestions:[], concept:null, done:false, should_draft: false };
  }
}

// Simplified response normalization
function normalizeSayAsk(llm) {
  if (!llm) return;

  // If ask is set, append to say (but avoid duplication)
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

// Contract renderer - unchanged
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

// MAIN API HANDLER - Simplified to trust LLM decisions
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

    // Extract basic facts as fallback (LLM should handle most of this)
    const extracted = extractFactsFromMessage(message);
    const extractedDP = extractDatesPlaces(message, NOW);
    const mappedDP = {};
    if (extractedDP["levering.datum"]) set(mappedDP, "levering.datum", extractedDP["levering.datum"]);
    if (extractedDP["levering.plaats"]) set(mappedDP, "levering.plaats", extractedDP["levering.plaats"]);
    if (extractedDP["forum.woonplaats_gebruiker"]) set(mappedDP, "forum.woonplaats_gebruiker", extractedDP["forum.woonplaats_gebruiker"]);
    const preFacts = mergeFacts(mergeFacts(clientFacts, extracted), mappedDP);

    // Get LLM response - this is where all the intelligence happens
    const llm = await callLLM({ facts: preFacts, history, message });
    normalizeSayAsk(llm);

    // Merge all facts
    let facts = mergeFacts(preFacts, llm.facts || {});
    set(facts, "recht.toepasselijk", "Nederlands recht");

    // Set court based on user location if we have it
    if (get(facts, "forum.woonplaats_gebruiker") && !get(facts, "forum.rechtbank")) {
      set(facts, "forum.rechtbank", nearestCourt(get(facts, "forum.woonplaats_gebruiker")));
    }

    // SIMPLIFIED: Trust the LLM's should_draft decision completely
    const missing = missingKeys(facts);
    let concept = null;
    let done = false;
    let suggestions = [];

    // Generate contract if LLM says so
    if (llm.should_draft) {
      const usePlaceholders = missing.length > 0;
      concept = renderConcept(facts, usePlaceholders);
      done = !usePlaceholders; // only "done" if no missing data
      
      // Handle suggestions for additional clauses
      const canSuggest = !!get(facts, "object.omschrijving") && get(facts, "prijs.bedrag") != null;
      if (canSuggest) {
        suggestions = pickCatalogSuggestions(facts, message);
        
        // Handle suggestion selections
        const picked = parseSuggestionSelection(message, suggestions);
        if (picked.length && concept) {
          const extra = picked.map(s => `\n**Aanvullende bepaling – ${s.title}**\n${s.clause}\n`).join("");
          concept += `\n${extra}`;
        }
      }
    } else {
      // Not generating contract - might still show suggestions for future use
      const canSuggest = !!get(facts, "object.omschrijving") && get(facts, "prijs.bedrag") != null;
      if (canSuggest && llm.intent === "contract") {
        suggestions = pickCatalogSuggestions(facts, message);
      }
    }

    // Debug logging (remove in production)
    if (process.env.NODE_ENV !== 'production') {
      console.log('Decision factors:', {
        message: message.slice(0, 50) + '...',
        llm_should_draft: llm.should_draft,
        missing_count: missing.length,
        intent: llm.intent,
        generating_concept: !!concept
      });
    }

    return res.status(200).json({
      say: llm.say || "Helder.",
      facts,
      ask: llm.ask || null,
      suggestions,
      concept,
      done,
      downloadUrl: concept ? '/api/download-contract' : null  
    });

  } catch (err) {
    console.error("api/chat error:", err);
    return res.status(500).json({
      error: "Server error",
      details: err?.message || String(err)
    });
  }
}
