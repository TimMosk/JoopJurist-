// /api/chat.js — JoopJurist backend (Vercel/Node serverless)
// Vereist: OPENAI_API_KEY in je environment (Vercel dashboard of lokaal .env)

// 0) Runtime MOET bovenaan
export const config = { runtime: "nodejs" };

// 1) Imports + OpenAI client
import OpenAI from "openai";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 2) Mini clause-catalogus
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

const wantsDraft = msg => /toon (alvast )?(het )?concept|laat .*concept|geef .*concept|concept graag|opzet|voorbeeld|draft/i.test(msg||"");

detectCategory(facts){
  const s = (facts?.object?.omschrijving || "").toLowerCase();
  if (/fiets|e-bike|racefiets|mtb|bakfiets|mountainbike/.test(s)) return "fiets";
  if (/laptop|notebook|macbook|computer|pc/.test(s)) return "laptop";
  if (/telefoon|smartphone|iphone|samsung/.test(s)) return "telefoon";
  if (/camera|canon|nikon|sony|fujifilm/.test(s)) return "camera";
  if (/gitaar|piano|keyboard|viool|drum/.test(s)) return "instrument";
  return "overig";
}
deriveFlags(facts, lastUserMsg=""){
  const price = Number(facts?.prijs?.bedrag || 0);
  const shipping = /verzend|bezorg|opsturen|pakket|postnl|dhl/i.test(lastUserMsg)
                 || /bezorg|aflever/i.test(facts?.levering?.plaats || "");
  const payInParts = /termijn|in delen|gespreid|betaling in delen/i.test(lastUserMsg);
  return { price, shipping, payInParts };
}
fillTemplate(tpl, facts, vars={}) {
  return tpl.replace(/\{\{([^}|]+)(?:\|([^}]*))?\}\}/g, (_, path, fb) => {
    const v = get(facts, path.trim());
    if (v != null && String(v).trim() !== "") return String(v);
    if (vars && vars[path.trim()] != null) return String(vars[path.trim()]);
    return fb != null ? fb : PH;
  });
}
pickCatalogSuggestions(facts, lastUserMsg=""){
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
parseSuggestionSelection(userMsg="", suggestions=[]){
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

function extractFactsFromMessage(msg = "") {
  const f = {};
  // Koper: “Koper: Jan Jansen” / “Koper is Jan Jansen”
  let m = msg.match(/\bkoper\b[^A-Za-z0-9]+(?:is|=|:)?\s*([A-ZÀ-ÖØ-Ý][\wÀ-ÖØ-öø-ÿ' -]{1,60})/i);
  if (m) {
    const name = m[1].trim().replace(/[.,;:]+$/, "");
    if (!f.koper) f.koper = {};
    f.koper.naam = name;
  }
  // Verkoper: “Verkoper: Piet Pieters”
  m = msg.match(/\bverkoper\b[^A-Za-z0-9]+(?:is|=|:)?\s*([A-ZÀ-ÖØ-Ý][\wÀ-ÖØ-öø-ÿ' -]{1,60})/i);
  if (m) {
    const name = m[1].trim().replace(/[.,;:]+$/, "");
    if (!f.verkoper) f.verkoper = {};
    f.verkoper.naam = name;
  }
  return f;
}

// 4) Normaliseer say/ask (vraag alleen in ask)
function normalizeSayAsk(llm) {
  if (!llm) return;

  // Als er een vraag in 'say' zit, verplaats die naar 'ask'
  if (llm.say && llm.say.includes("?")) {
    const idx = llm.say.lastIndexOf("?");
    const before = llm.say.slice(0, idx).trim();
    const q = llm.say.slice(idx).trim();
    llm.say = before.replace(/[–—-]\s*$/, "").trim();
    if (!llm.ask) {
      const cleaned = q.replace(/^[?.!\s-]+/, "").trim();
      if (cleaned) llm.ask = cleaned.endsWith("?") ? cleaned : cleaned + "?";
    }
  }

  // Als ask leeg of duplicaat is, maak 'm null
  if (llm.ask) {
    const norm = s => (s || "").replace(/\W+/g, "").toLowerCase();
    if (!llm.ask.trim() || norm(llm.ask) === norm(llm.say)) {
      llm.ask = null;
    }
  }
}

// 5) Prompt + LLM-call (JSON afdwingen)
const SYSTEM_PROMPT = `
Je bent "JoopJurist", een Nederlandse jurist met veel ervaring met consumentenkoop. Doel: help bij koopovereenkomst voor spullen (roerende zaak) in natuurlijk Nederlands.

OUTPUT-STIJL:
- "say" = 1–2 korte, vriendelijke zinnen zonder vraag.
- Heb je een vraag? Zet exact één korte vraag in "ask". Herhaal die niet in "say".
- Geen suggesties in de allereerste beurt; pas wanneer de gebruiker daarom vraagt of er al wat feiten zijn.

FACTS-SCHEMA (gebruik exact deze padnamen, niets anders):
facts = {
  "koper":   { "naam": string|null, "adres": string|null },
  "verkoper":{ "naam": string|null, "adres": string|null },
  "object":  { "omschrijving": string|null, "conditie": string|null, "identifiers": string|null },
  "prijs":   { "bedrag": number|null },
  "levering":{ "datum": string|null, "plaats": string|null },
  "forum":   { "woonplaats_gebruiker": string|null, "rechtbank": string|null },
  "recht":   { "toepasselijk": "Nederlands recht" }
}

REGELS:
- Vul alleen in wat je redelijk zeker weet uit de laatste gebruikerstekst en de meegegeven facts; overschrijf niet met lege waarden.
- Datums liefst ISO (YYYY-MM-DD) of dag/maand/jaar uitgeschreven.
- Forum = dichtstbijzijnde rechtbank bij woonplaats van gebruiker (leid af of vraag 1×).
- Antwoord ALTIJD als strikt JSON, zonder extra tekst of codefences:
{"say": string, "facts": object, "ask": string|null, "suggestions": [{"id": string, "title": string, "why": string, "clause": string}]|[], "concept": null, "done": boolean}
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
    // 🔒 Dwing zuiver JSON af
    response_format: { type: "json_object" }
  });

  const raw = resp.choices?.[0]?.message?.content || "{}";
  try { return JSON.parse(raw); }
  catch {
    // Fallback (zou zelden nodig zijn)
    return { say:"Sorry, ik kon dit niet goed verwerken.", facts, ask:"Wil je het anders formuleren?", suggestions:[], concept:null, done:false };
  }
}

// 6) API handler
export default async function handler(req, res) {
  try{
    if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

   const { message="", facts: clientFacts={}, history=[] } = req.body || {};

// haal simpele feiten uit de userzin (fallback)
    const extracted = extractFactsFromMessage(message);
// geef die alvast mee aan het model
    const preFacts = mergeFacts(clientFacts, extracted);

    const llm = await callLLM({ facts: preFacts, history, message });
    normalizeSayAsk(llm);

    // Merge + vaste rechtsbasis + rechtbank
    let facts = mergeFacts(preFacts, llm.facts || {});
    set(facts, "recht.toepasselijk", "Nederlands recht");

    // extra fallback: vul koper/verkoper alsnog uit message indien nog leeg
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

    // Bepaal missende velden (nu al nodig voor gating)
    const missing = missingKeys(facts);

    // Gate voor suggesties: niet in beurt 1, tenzij gevraagd; of als er al wat context is en er niet te veel mist
    const userAskedForSugg = /\b(suggest|advies|aanvull|clausul|extra|neem\s+\d)/i.test(message);
    let suggestions = [];
    const allowSuggestions = userAskedForSugg || ((history && history.length > 0) && missing.length <= 3);
    if (allowSuggestions) {
      suggestions = pickCatalogSuggestions(facts, message);
      if (Array.isArray(llm.suggestions) && llm.suggestions.length){
        const combined = [...suggestions];
        for (const s of llm.suggestions) {
          if (!combined.find(x => x.id === s.id) && combined.length < 3) combined.push(s);
        }
        suggestions = combined;
      }
    }

    // Concept beslissen
    const userWants = wantsDraft(message);
    let concept = null;
    let done = false;

    if (missing.length === 0) {
      concept = renderConcept(facts, false);
      done = true;
    } else if (userWants) {
      concept = renderConcept(facts, true);
      done = true;
      if (!llm.ask) llm.ask = `Wil je eerst **${prettyLabel(missing[0])}** geven? Dan werk ik het concept direct bij.`;
    } else {
      if (!llm.ask) llm.ask = `Zullen we dit eerst invullen: **${prettyLabel(missing[0])}**? Je kunt ook zeggen: “Toon alvast het concept.”`;
      concept = null; done = false;
    }

    // “neem 1 en 3”
    const picked = parseSuggestionSelection(message, suggestions);
    if (picked.length && concept){
      const extra = picked.map(s => `\n**Aanvullende bepaling – ${s.title}**\n${s.clause}\n`).join("");
      concept += `\n${extra}`;
    }

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

// 7) Concept renderer
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
${get(f,"koper.naam")||"Koper"} – datum handtekening: _____________________
${get(f,"verkoper.naam")||"Verkoper"} – datum handtekening: _____________________
`
  ].join("\n");
}
