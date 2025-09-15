// /api/chat.js — JoopJurist backend (Vercel/Node serverless)

// 0) Runtime MOET bovenaan
export const config = { runtime: "nodejs" };

// 1) Imports + OpenAI client
import OpenAI from "openai";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Fetch clauses from GitHub (robust)
async function loadCatalog(agreementType = "purchase") {
  const url = `https://raw.githubusercontent.com/TimMosk/JoopJurist-/main/clauses/${agreementType}.yaml`;
  try {
    const response = await fetch(url);
    if (!response.ok) return []; // fail soft
    const yamlText = await response.text();

    // Simple YAML parser (very shallow)
    const lines = yamlText.split("\n");
    const catalog = [];
    let currentClause = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith("- id:")) {
        if (currentClause) catalog.push(currentClause);
        currentClause = { id: line.split(":")[1].trim() };
      } else if (line.startsWith("title:")) {
        currentClause.title = line.split(":")[1].trim();
      } else if (line.startsWith("why:")) {
        currentClause.why = line.split(":")[1].trim();
      } else if (line.startsWith("clause:")) {
        let clauseLines = [];
        i++;
        while (i < lines.length && lines[i].trim().startsWith("|")) {
          clauseLines.push(lines[i].trim().replace(/^\|/, "").trim());
          i++;
        }
        i--; // Adjust for loop increment
        currentClause.clause = clauseLines.join("\n");
      } else if (line.startsWith("when:")) {
        currentClause.when = {};
        const categoryLine = lines.find((l) => l.includes("category:"));
        if (categoryLine) {
          const m = categoryLine.match(/\[(.*?)\]/);
          if (m) {
            const categories = m[1]
              .split(",")
              .map((c) => c.trim().replace(/"/g, ""));
            currentClause.when.category = categories;
          }
        }
        const priceLine = lines.find((l) => l.includes("min_price:"));
        if (priceLine) {
          const n = parseInt(priceLine.split(":")[1].trim(), 10);
          if (!Number.isNaN(n)) currentClause.when.min_price = n;
        }
        const shippingLine = lines.find((l) => l.includes("shipping:"));
        if (shippingLine) currentClause.when.shipping = /true/i.test(shippingLine);
        const payInPartsLine = lines.find((l) => l.includes("pay_in_parts:"));
        if (payInPartsLine)
          currentClause.when.pay_in_parts = /true/i.test(payInPartsLine);
      } else if (line.startsWith("vars:")) {
        currentClause.vars = {};
        const varsLine = lines.find(
          (l) => l.includes("keys_count:") || l.includes("specificaties:")
        );
        if (varsLine) {
          const key = varsLine.split(":")[0].trim();
          const value = varsLine.split(":")[1].trim();
          currentClause.vars[key] = isNaN(value) ? value : parseInt(value, 10);
        }
      }
    }
    if (currentClause) catalog.push(currentClause);
    return catalog;
  } catch {
    return []; // fail soft
  }
}

// 3) Utils
const PH = "*[●nader aan te vullen●]*";
const get = (o, p) => p.split(".").reduce((x, k) => (x && x[k] !== undefined ? x[k] : undefined), o);
function set(obj, p, val) {
  const a = p.split(".");
  let o = obj;
  for (let i = 0; i < a.length - 1; i++) {
    if (!o[a[i]]) o[a[i]] = {};
    o = o[a[i]];
  }
  o[a[a.length - 1]] = val;
}
function mergeFacts(oldF = {}, newF = {}) {
  const out = JSON.parse(JSON.stringify(oldF));
  (function rec(s, pre = "") {
    for (const k of Object.keys(s || {})) {
      const v = s[k],
        path = pre ? `${pre}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        if (!get(out, path)) set(out, path, {});
        rec(v, path);
      } else {
        set(out, path, v);
      }
    }
  })(newF);
  return out;
}

// Helper functions - simplified to let LLM handle intent detection
function nearestCourt(place = "") {
  const s = (place || "").toLowerCase();
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
    [/maastricht|heerlen|sittard|venlo|roermond/, "Rechtbank Limburg"],
  ];
  for (const [rx, c] of map) if (rx.test(s)) return c;
  return "Rechtbank Den Haag";
}

const REQUIRED = [
  "koper.naam",
  "verkoper.naam",
  "object.omschrijving",
  "prijs.bedrag",
  "levering.datum",
  "levering.plaats",
];

const missingKeys = (f) => REQUIRED.filter((k) => !get(f, k));

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
const NL_MONTHS = {
  jan: 1, januari: 1,
  feb: 2, februari: 2,
  mrt: 3, maart: 3,
  apr: 4, april: 4,
  mei: 5,
  jun: 6, juni: 6,
  jul: 7, juli: 7,
  aug: 8, augustus: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};
const NL_DOW = { zondag: 0, maandag: 1, dinsdag: 2, woensdag: 3, donderdag: 4, vrijdag: 5, zaterdag: 6 };

function startOfISOWeek(dt) {
  const d = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  const dow = d.getDay() || 7;
  if (dow !== 1) d.setDate(d.getDate() - (dow - 1));
  d.setHours(0, 0, 0, 0);
  return d;
}
function dayFromISOWeek(monday, dow) {
  const i = (dow === 0 ? 7 : dow) - 1;
  const d = new Date(monday);
  d.setDate(monday.getDate() + i);
  return d;
}
const PLACE_RE = /\b(levering|afhalen|bezorging|overdracht|overhandiging)\b[^.]*?\b(in|te|op)\s+([A-ZÀ-ÖØ-Ý][\w'À-ÖØ-öø-ÿ -]{2,})(?=[,.)]|$)/i;
const HOME_RE = /\b(ik\s+woon|woonplaats\s*(is)?|mijn\s*woonplaats\s*(is)?)\b[^.]*?\b(in|te)\s+([A-ZÀ-ÖØ-Ý][\w'À-ÖØ-öø-ÿ -]{2,})(?=[,.)]|$)/i;
const IN_RE = /\b(in|te)\s+([A-ZÀ-ÖØ-Ý][\w'À-ÖØ-öø-ÿ -]{2,})(?=[,.)]|$)/g;

function toISODate(d) {
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
function nextDow(from, dow) {
  const d = new Date(from);
  const delta = ((dow - d.getDay() + 7) % 7) || 7;
  d.setDate(d.getDate() + delta);
  return d;
}

function parseDateNL(msg, now = new Date()) {
  const s = msg.toLowerCase().normalize("NFKD");
  if (/\bvandaag\b/.test(s)) return toISODate(now);
  if (/\bmorgen\b/.test(s)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return toISODate(d);
  }
  if (/\bovermorgen\b/.test(s)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 2);
    return toISODate(d);
  }

  let mDow = s.match(/\b(aanstaande|komende|volgende)\s+(zondag|maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag)\b/);
  if (mDow) {
    const d = nextDow(now, NL_DOW[mDow[2]]);
    return toISODate(d);
  }

  mDow = s.match(/\b(volgende|deze)\s+week\s+(zondag|maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag)\b/);
  if (mDow) {
    const part = mDow[1];
    const dowWord = mDow[2];
    let monday = startOfISOWeek(now);
    if (part === "volgende") monday.setDate(monday.getDate() + 7);
    const d = dayFromISOWeek(monday, NL_DOW[dowWord]);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (part === "deze" && d < today) d.setDate(d.getDate() + 7);
    return toISODate(d);
  }

  let m = s.match(/\b(20\d{2}|19\d{2})[./-](\d{1,2})[./-](\d{1,2})\b/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (!isNaN(d)) return toISODate(d);
  }

  m = s.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b/);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    const d = new Date(y, Number(m[2]) - 1, Number(m[1]));
    if (!isNaN(d)) return toISODate(d);
  }

  m = s.match(/\b(\d{1,2})\s+([a-z.]+)\s*(\d{2,4})?\b/);
  if (m && NL_MONTHS[m[2].replace(".", "")]) {
    let y = m[3] ? Number(m[3]) : now.getFullYear();
    if (y < 100) y += 2000;
    const d = new Date(y, NL_MONTHS[m[2].replace(".", "")] - 1, Number(m[1]));
    if (!m[3] && d < now) d.setFullYear(d.getFullYear() + 1);
    if (!isNaN(d)) return toISODate(d);
  }

  m = s.match(/\b(\d{1,2})[./-](\d{1,2})\b/);
  if (m) {
    const y0 = now.getFullYear();
    let d = new Date(y0, Number(m[2]) - 1, Number(m[1]));
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (d < today) d.setFullYear(y0 + 1);
    if (!isNaN(d)) return toISODate(d);
  }
  return null;
}

function extractDatesPlaces(msg, now = new Date()) {
  const out = {};
  const iso = parseDateNL(msg, now);
  if (iso) out["levering.datum"] = iso;
  let m = msg.match(PLACE_RE);
  if (m) out["levering.plaats"] = m[3].trim();
  m = msg.match(HOME_RE);
  if (m) out["forum.woonplaats_gebruiker"] = m[5].trim();
  if (!out["levering.plaats"]) {
    let last = null,
      r;
    while ((r = IN_RE.exec(msg)) !== null) last = r[2];
    if (last) out["levering.plaats"] = last.trim();
  }
  return out;
}

// Category detection and suggestions - keep for clause suggestions
function detectCategory(facts) {
  const s = (facts?.object?.omschrijving || "").toLowerCase();
  if (/fiets|e-bike|racefiets|mtb|bakfiets|mountainbike/.test(s)) return "fiets";
  if (/laptop|notebook|macbook|computer|pc/.test(s)) return "laptop";
  if (/telefoon|smartphone|iphone|samsung/.test(s)) return "telefoon";
  if (/camera|canon|nikon|sony|fujifilm/.test(s)) return "camera";
  if (/gitaar|piano|keyboard|viool|drum/.test(s)) return "instrument";
  return "overig";
}

function deriveFlags(facts, lastUserMsg = "") {
  const price = Number(facts?.prijs?.bedrag || 0);
  const shipping =
    /verzend|bezorg|opsturen|pakket|postnl|dhl/i.test(lastUserMsg) ||
    /bezorg|aflever/i.test(facts?.levering?.plaats || "");
  const payInParts = /termijn|in delen|gespreid|betaling in delen/i.test(lastUserMsg);
  return { price, shipping, payInParts };
}

function fillTemplate(tpl, facts, vars = {}) {
  return tpl.replace(/\{\{([^}|]+)(?:\|([^}]*))?\}\}/g, (_, path, fb) => {
    const v = get(facts, path.trim());
    if (v != null && String(v).trim() !== "") return String(v);
    if (vars && vars[path.trim()] != null) return String(vars[path.trim()]);
    return fb != null ? fb : PH;
  });
}

// Updated to fetch clauses dynamically
async function pickCatalogSuggestions(facts, lastUserMsg = "") {
  const agreementType = facts.agreement_type || "purchase";
  const catalog = await loadCatalog(agreementType);
  const cat = detectCategory(facts);
  const { price, shipping, payInParts } = deriveFlags(facts, lastUserMsg);
  const matches = catalog.filter((it) => {
    const w = it.when || {};
    if (w.category && !w.category.includes(cat)) return false;
    if (w.min_price && price < w.min_price) return false;
    if (w.shipping === true && !shipping) return false;
    if (w.pay_in_parts === true && !payInParts) return false;
    return true;
  });
  return matches.slice(0, 3).map((it) => ({
    id: it.id,
    title: it.title,
    why: it.why,
    clause: fillTemplate(it.clause || "", facts, it.vars || {}),
  }));
}

function parseSuggestionSelection(userMsg = "", suggestions = []) {
  const picks = new Set();
  const m = userMsg.match(/\bneem\b([^.]*)/i);
  if (m) {
    const nums = (m[1].match(/\d+/g) || []).map((n) => Number(n) - 1);
    nums.forEach((ix) => suggestions[ix] && picks.add(suggestions[ix].id));
  }
  suggestions.forEach((s) => {
    const kw = (s.id || s.title || "").split(/\W+/)[0];
    if (kw && new RegExp(kw, "i").test(userMsg)) picks.add(s.id);
  });
  return suggestions.filter((s) => picks.has(s.id));
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

async function callLLM({ facts, history, message }) {
  console.log("callLLM starting with:", { 
    message: message.slice(0, 50) + "...", 
    factsKeys: Object.keys(facts),
    historyLength: history?.length || 0
  });

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...(history || []).slice(-8),
    { role: "user", content: JSON.stringify({ message, facts }) },
  ];

  try {
    console.log("Making OpenAI API call...");
    const resp = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o",
      temperature: 0.3,
      messages,
      response_format: { type: "json_object" },
    });

    console.log("OpenAI API call successful");
    const raw = resp.choices?.[0]?.message?.content || "{}";
    console.log("OpenAI response length:", raw.length);
    
    try {
      const parsed = JSON.parse(raw);
      console.log("JSON parsing successful");
      return parsed;
    } catch (parseError) {
      console.error("JSON parsing failed:", parseError);
      console.error("Raw response:", raw.slice(0, 200) + "...");
      return {
        say: "Sorry, ik kon dit niet goed verwerken.",
        facts,
        ask: "Wil je het anders formuleren?",
        suggestions: [],
        concept: null,
        done: false,
        should_draft: false,
      };
    }
  } catch (apiError) {
    console.error("OpenAI API call failed:", apiError);
    throw apiError; // Re-throw to be caught by main handler
  }
}

// Simplified response normalization
function normalizeSayAsk(llm) {
  if (!llm) return;
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

// Fetch template from GitHub (robust)
async function fetchTemplate(agreementType) {
  const url = `https://raw.githubusercontent.com/TimMosk/JoopJurist-/main/templates/${agreementType}.md`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      // Minimal fallback template to avoid crashes during 404s
      return `# Koopovereenkomst

**Koper:** {{koper.naam|${PH}}}  
**Verkoper:** {{verkoper.naam|${PH}}}  

**Object:** {{object.omschrijving|${PH}}}  
**Prijs:** € {{prijs.bedrag|${PH}}}  

**Levering:** {{levering.datum|${PH}}} te {{levering.plaats|${PH}}}

_Toepasselijk recht: Nederlands recht. Forum: {{forum.rechtbank|${PH}}}._`;
    }
    return await response.text();
  } catch {
    // Network fail → same fallback
    return `# Koopovereenkomst

**Koper:** {{koper.naam|${PH}}}  
**Verkoper:** {{verkoper.naam|${PH}}}  

**Object:** {{object.omschrijving|${PH}}}  
**Prijs:** € {{prijs.bedrag|${PH}}}  

**Levering:** {{levering.datum|${PH}}} te {{levering.plaats|${PH}}}

_Toepasselijk recht: Nederlands recht. Forum: {{forum.rechtbank|${PH}}}._`;
  }
}

// Updated renderConcept to use fetched templates
async function renderConcept(f, usePH) {
  const agreementType = f.agreement_type || "purchase";
  const template = await fetchTemplate(agreementType);
  return fillTemplate(template, f, { PH: "*[●nader aan te vullen●]*" });
} 

// MAIN API HANDLER - Simplified to trust LLM decisions
export default async function handler(req, res) {
  console.log("Handler starting. Method:", req.method);
  console.log("OpenAI API Key present:", !!process.env.OPENAI_API_KEY);
  console.log("OpenAI Model:", process.env.OPENAI_MODEL || "gpt-4o (default)");
  
  try {
    if (req.method !== "POST") {
      console.log("Method not POST, returning 405");
      return res.status(405).json({ error: "Use POST" });
    }
    
    if (!process.env.OPENAI_API_KEY) {
      console.log("Missing OpenAI API key");
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

    console.log("Request body keys:", Object.keys(req.body || {}));

    const { message = "", facts: clientFacts = {}, history = [], clientNow, clientOffset } = req.body || {};

    // Handle client timezone
    let NOW = new Date();
    if (clientNow) {
      const base = new Date(clientNow);
      if (!isNaN(base)) {
        const offsetMin = Number.isFinite(clientOffset) ? Number(clientOffset) : 0;
        NOW = new Date(base.getTime() - offsetMin * 60 * 1000);
      }
    }

    // Extract basic facts as fallback
    const extracted = extractFactsFromMessage(message);
    const extractedDP = extractDatesPlaces(message, NOW);
    const mappedDP = {};
    if (extractedDP["levering.datum"]) set(mappedDP, "levering.datum", extractedDP["levering.datum"]);
    if (extractedDP["levering.plaats"]) set(mappedDP, "levering.plaats", extractedDP["levering.plaats"]);
    if (extractedDP["forum.woonplaats_gebruiker"])
      set(mappedDP, "forum.woonplaats_gebruiker", extractedDP["forum.woonplaats_gebruiker"]);
    const preFacts = mergeFacts(mergeFacts(clientFacts, extracted), mappedDP);

    // Get LLM response
    const llm = await callLLM({ facts: preFacts, history, message });
    normalizeSayAsk(llm);

    // ---- IMPORTANT: Merge LLM facts BEFORE any use ----
    let facts = mergeFacts(preFacts, llm.facts || {});
    set(facts, "recht.toepasselijk", "Nederlands recht");

    if (get(facts, "forum.woonplaats_gebruiker") && !get(facts, "forum.rechtbank")) {
      set(facts, "forum.rechtbank", nearestCourt(get(facts, "forum.woonplaats_gebruiker")));
    }

    // Suggestions (declare once)
    let suggestions = [];
    let concept = null;
    let done = false;

    let canSuggest =
      !!get(facts, "object.omschrijving") && get(facts, "prijs.bedrag") != null;

    if (canSuggest && llm.intent === "contract") {
      suggestions = await pickCatalogSuggestions(facts, message);
    }

    // Generate contract if LLM says so
    const missing = missingKeys(facts);
    if (llm.should_draft) {
      const usePlaceholders = missing.length > 0;
      concept = await renderConcept(facts, usePlaceholders);
      done = !usePlaceholders;

      if (canSuggest && suggestions.length) {
        const picked = parseSuggestionSelection(message, suggestions);
        if (picked.length && concept) {
          const extra = picked
            .map((s) => `\n**Aanvullende bepaling – ${s.title}**\n${s.clause}\n`)
            .join("");
          concept += `\n${extra}`;
        }
      }
    }

    // Debug logging (remove in production)
    if (process.env.NODE_ENV !== "production") {
      console.log("Decision factors:", {
        message: message.slice(0, 50) + "...",
        llm_should_draft: llm.should_draft,
        missing_count: missing.length,
        intent: llm.intent,
        generating_concept: !!concept,
      });
    }

    return res.status(200).json({
      say: llm.say || "Helder.",
      facts,
      ask: null,
      suggestions,
      concept,
      done,
      downloadUrl: concept ? "/api/download-contract" : null,
    });
  } catch (err) {
    console.error("api/chat error:", err);
    return res.status(500).json({
      error: "Server error",
      details: err?.message || String(err),
    });
  }
}
