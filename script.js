// script.js — JoopJurist "spullen" (koop roerende zaken)
// v1.3.0

const language = "nl";

// Tekstlabels
const textLabels = {
  nl: {
    send: "Verstuur",
    sending: "Bezig...",
    placeholder: "Typ hier je vraag...",
    error: "⚠️ Er ging iets mis",
    network: "⚠️ Netwerkfout",
    typing: "⚖️ Joop zit in de bieb",
  },
  en: {
    send: "Send",
    sending: "Sending...",
    placeholder: "Type your question here...",
    error: "⚠️ Something went wrong",
    network: "⚠️ Network error",
    typing: "⚖️ Joop is thinking",
  },
};

// ====== UI helpers ======
function scrollToBottom() {
  const chatLog = document.getElementById("chat-log");
  chatLog.scrollTop = chatLog.scrollHeight;
}
function addUserMessage(text) {
  const chatLog = document.getElementById("chat-log");
  chatLog.innerHTML += `
    <div class="message user"><div class="bubble">💬 ${escapeHtml(text)}</div></div>
  `;
  scrollToBottom();
}
function addAiMessageMarkdown(md) {
  const chatLog = document.getElementById("chat-log");
  const html = marked.parse(md);
  chatLog.innerHTML += `
    <div class="message ai"><div class="bubble formatted-output">⚖️ ${html}</div></div>
  `;
  scrollToBottom();
}
function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

// ====== 1) Gespreks-state & router ======
const PHASE = {
  IDLE: "idle",
  INTENT: "intent",
  PROPOSAL: "proposal",      // voorstel-flow in meerdere microstappen
  COLLECT: "collect",        // details verzamelen
  VALIDATE: "validate",
  CONCEPT: "concept",
  DONE: "done",
};

const MODE = { CHAT: "chat", FORM: "form", MCQ: "mcq" };

const state = {
  phase: PHASE.IDLE,
  mode: null,                // chat | form | mcq
  intent: null,              // koop_spullen
  objectDetected: null,      // fiets, laptop, ...
  didAssumptiveIntro: false,
  proposalStep: 0,           // 0=alleen assumptie, 1=keuzevraag, 2=omschrijving-voorstel
  fields: {},                // ingevulde velden
  sources: {},               // bron per veld (user | ai-proposed)
  lastAsked: null            // laatst gevraagde veldpad
};

// ====== 2) Basis-schema "spullen" ======
const schema = {
  doc_type: "koop_spullen",
  version: "1.0.0",
  required: [
    "koper.naam",
    "verkoper.naam",
    "object.omschrijving",
    "prijs.bedrag",
    "levering.datum",
    "levering.plaats",
    "forum.woonplaats_gebruiker"
  ],
  optional: [
    "koper.adres",
    "verkoper.adres",
    "object.identifiers",
    "object.conditie",
    "betaling.wijze",
    "betaling.moment",
    "garantie.type"
  ],
  fixed: {
    "recht.toepasselijk": "Nederlands recht"
  }
};

// ====== 3) Intent-detectie + assumptieve Stap 1 ======
const KNOWN_OBJECTS = [
  { keys: ["fiets","e-bike","racefiets","mtb","bakfiets","mountainbike"], object: "fiets" },
  { keys: ["laptop","notebook","macbook","pc","computer"], object: "laptop" },
  { keys: ["telefoon","smartphone","iphone","samsung"], object: "telefoon" },
  { keys: ["gitaar","piano","keyboard","viool","drumstel"], object: "instrument" },
  { keys: ["camera","canon","nikon","sony","fujifilm"], object: "camera" },
  { keys: ["bank","stoel","tafel","kast","meubel"], object: "meubel" }
];

function detectObject(msg) {
  const m = (msg || "").toLowerCase();
  for (const g of KNOWN_OBJECTS) {
    if (g.keys.some(k => m.includes(k))) return g.object;
  }
  return null;
}
function classifyIntent(msg) {
  const obj = detectObject(msg);
  if (obj) return { intent: "koop_spullen", certainty: "high", object: obj };
  if (/(koop|kopen|aanschaf|aankoop)/i.test(msg || "")) {
    return { intent: "koop_spullen", certainty: "medium", object: null };
  }
  return { intent: "unknown", certainty: "low", object: null };
}

// ====== 4) Slimme voorinvulling ======
function suggestionFor(object) {
  if (object === "fiets") return "stadsfiets, 7 versnellingen, zwart, bouwjaar 2022, goed onderhouden";
  if (object === "laptop") return "14-inch laptop, 16GB RAM, 512GB SSD, gekocht in 2023, nette staat";
  if (object === "telefoon") return "smartphone, 128GB opslag, zwart, gekocht in 2022, werkt naar behoren";
  if (object === "instrument") return "akoestische gitaar, massief sparren top, goede staat, ca. 2019";
  if (object === "camera") return "systeemcamera met kitlens, ca. 2021, lichte gebruikerssporen";
  if (object === "meubel") return "eettafel, massief hout, 180x90 cm, natuurlijke kleur, goede staat";
  return "object in goede staat (specificaties nog aan te vullen)";
}

// ====== 5) Extractie (entity/slot filling) ======
function extractFields(text) {
  const t = (text || "").toLowerCase();
  const out = {};

  // prijs: €350 / 350 euro
  const priceMatch = t.match(/(?:€\s*|eur(?:o)?\s*)?(\d{2,6}(?:[.,]\d{2})?)(?:\s*(?:eur|euro))?/i);
  if (priceMatch) out["prijs.bedrag"] = normalizeMoney(priceMatch[1]);

  // jaar: 2000-2099 (grof)
  const yearMatch = t.match(/\b(20\d{2})\b/);
  if (yearMatch) out["object.jaar"] = yearMatch[1];

  // kleur
  const kleurMatch = t.match(/\b(zwart|wit|blauw|rood|grijs|groen|geel|bruin|zilver)\b/);
  if (kleurMatch) out["object.kleur"] = kleurMatch[1];

  // merk
  const merkMatch = t.match(/\b(batavus|cortina|gazelle|cube|trek|giant|apple|dell|hp|samsung|sony|canon|nikon|fujifilm)\b/);
  if (merkMatch) out["object.merk"] = capitalize(merkMatch[1]);

  // leveringsdatum: natuurlijke NL datum óf klassieke notatie
  const humanDate = parseHumanDateNL(text);
  if (humanDate) {
    out["levering.datum"] = humanDate;
  } else {
    const dateMatch = t.match(/\b(\d{1,2}[-/]\d{1,2}[-/]\d{4})\b|\b(20\d{2}-\d{2}-\d{2})\b/);
    if (dateMatch) {
      const raw = dateMatch[1] || dateMatch[2];
      const parsed = parseDutchDate(raw);
      if (parsed) out["levering.datum"] = parsed;
    }
  }

  // plaats (heuristiek): na "in" of "te" + kapitaalwoord
  const placeMatch = text.match(/\b(?:in|te)\s+([A-ZÁÉÍÓÚÄËÏÖÜ][\w\- ]{2,})/);
  if (placeMatch) out["levering.plaats"] = placeMatch[1].trim();

  // woonplaats gebruiker (voor forum)
  const woonMatch = text.match(/\b(?:woon(?:plaats)?|ik woon in|mijn (?:woon)?plaats is)\s+([A-Z][\w\- ]{2,})/i);
  if (woonMatch) out["forum.woonplaats_gebruiker"] = woonMatch[1].trim();

  // conditie
  const condMatch = t.match(/\b(nieuwstaat|zo goed als nieuw|goede staat|gebruikt)\b/);
  if (condMatch) out["object.conditie"] = condMatch[1];

  return out;
}
function normalizeMoney(s) {
  return s.replace(/\./g, "").replace(",", "."); // 1.250,00 -> 1250.00
}
function parseDutchDate(s) {
  if (!s) return null;
  // dd-mm-yyyy of dd/mm/yyyy
  const m1 = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m1) {
    const d = Number(m1[1]), mo = Number(m1[2]), y = Number(m1[3]);
    const iso = `${y.toString().padStart(4,"0")}-${mo.toString().padStart(2,"0")}-${d.toString().padStart(2,"0")}`;
    if (!isNaN(Date.parse(iso))) return iso;
  }
  // yyyy-mm-dd
  if (!isNaN(Date.parse(s))) return s;
  return null;
}

// ==== Natuurlijke NL datums (“morgen”, “over twee weken”, “12 oktober”, “a.s. vrijdag”, “12/10”) ====
function parseHumanDateNL(text, now = new Date()) {
  if (!text) return null;
  const t = text.toLowerCase();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const addDays = (base, d) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + d);

  const NUM_WORDS = {
    "een":1,"één":1,"twee":2,"drie":3,"vier":4,"vijf":5,"zes":6,"zeven":7,"acht":8,"negen":9,"tien":10,"elf":11,"twaalf":12
  };
  const months = {
    "januari":0,"jan":0,"februari":1,"feb":1,"maart":2,"mrt":2,"april":3,"apr":3,"mei":4,"juni":5,"jun":5,
    "juli":6,"jul":6,"augustus":7,"aug":7,"september":8,"sep":8,"sept":8,"oktober":9,"okt":9,"november":10,"nov":10,"december":11,"dec":11
  };
  const weekdays = ["zondag","maandag","dinsdag","woensdag","donderdag","vrijdag","zaterdag"];

  // vandaag / morgen
  if (/\bvandaag\b/.test(t)) return today.toISOString().slice(0,10);
  if (/\bmorgen\b/.test(t)) return addDays(today, 1).toISOString().slice(0,10);

  // over N dagen / weken / maanden (N als cijfer of woord)
  let m;
  if (m = t.match(/\bover\s+(\d+|een|één|twee|drie|vier|vijf|zes|zeven|acht|negen|tien|elf|twaalf)\s*dag(?:en)?\b/)) {
    const n = isNaN(m[1]) ? NUM_WORDS[m[1]] : parseInt(m[1],10);
    return addDays(today, n).toISOString().slice(0,10);
  }
  if (m = t.match(/\bover\s+(\d+|een|één|twee|drie|vier|vijf|zes|zeven|acht|negen|tien|elf|twaalf)\s*week(?:en)?\b/)) {
    const n = isNaN(m[1]) ? NUM_WORDS[m[1]] : parseInt(m[1],10);
    return addDays(today, n*7).toISOString().slice(0,10);
  }
  if (m = t.match(/\bover\s+(\d+|een|één|twee|drie|vier|vijf|zes|zeven|acht|negen|tien|elf|twaalf)\s*maand(?:en)?\b/)) {
    const n = isNaN(m[1]) ? NUM_WORDS[m[1]] : parseInt(m[1],10);
    const d = new Date(today); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0,10);
  }

  // (a.s.|aanstaande|komende) vrijdag
  if (m = t.match(/\b(?:a\.s\.|aanstaande|as\.?|komende)\s+(maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag)\b/)) {
    const target = weekdays.indexOf(m[1]);
    const diff = (target - today.getDay() + 7) % 7 || 7; // altijd volgende
    return addDays(today, diff).toISOString().slice(0,10);
  }

  // volgende week dinsdag
  if (m = t.match(/\bvolgende\s+week\s+(maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag)\b/)) {
    const target = weekdays.indexOf(m[1]);
    const nextMon = addDays(today, ((8 - today.getDay()) % 7) || 7); // maandag volgende week
    const diff = (target + 6) % 7; // 0=ma → zo=6
    const d2 = addDays(nextMon, diff);
    return d2.toISOString().slice(0,10);
  }

  // 12 oktober 2025 / 12 okt 2025
  if (m = t.match(/\b(\d{1,2})\s+(januari|jan|februari|feb|maart|mrt|april|apr|mei|juni|jun|juli|jul|augustus|aug|september|sep|sept|oktober|okt|november|nov|december|dec)\s+(\d{4})\b/)) {
    const d = parseInt(m[1],10), mo = months[m[2]], y = parseInt(m[3],10);
    return new Date(y, mo, d).toISOString().slice(0,10);
  }

  // 12 oktober (zonder jaar → dit jaar, anders volgend jaar)
  if (m = t.match(/\b(\d{1,2})\s+(januari|jan|februari|feb|maart|mrt|april|apr|mei|juni|jun|juli|jul|augustus|aug|september|sep|sept|oktober|okt|november|nov|december|dec)\b/)) {
    const d = parseInt(m[1],10), mo = months[m[2]];
    let cand = new Date(today.getFullYear(), mo, d);
    if (cand < today) cand = new Date(today.getFullYear()+1, mo, d);
    return cand.toISOString().slice(0,10);
  }

  // 12-10 / 12/10 (zonder jaar → dit jaar, of volgend jaar als voorbij)
  if (m = t.match(/\b(\d{1,2})[-/](\d{1,2})(?:[-/](\d{4}))?\b/)) {
    const d = parseInt(m[1],10), mo = parseInt(m[2],10)-1, y = m[3] ? parseInt(m[3],10) : today.getFullYear();
    let cand = new Date(y, mo, d);
    if (!m[3] && cand < today) cand = new Date(y+1, mo, d);
    return cand.toISOString().slice(0,10);
  }

  return null;
}

function capitalize(s){ return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

// ====== 6) Keuze modes (chat/form/mcq) ======
function parseMode(text) {
  const t = (text||"").toLowerCase();
  if (/(chat|stap\-?voor\-?stap)/.test(t)) return MODE.CHAT;
  if (/(formulier|alles in één|in een bericht|in één bericht)/.test(t)) return MODE.FORM;
  if (/(meerkeuze|mcq)/.test(t)) return MODE.MCQ;
  return null;
}

// ====== 7) Rechtbankkeuze (forum) op basis van woonplaats ======
function nearestCourt(woonplaats) {
  const t = (woonplaats||"").toLowerCase().trim();
  const map = [
    { rx: /den haag|wassenaar|leiden|delft|zoetermeer|scheveningen|voorburg/, court: "Rechtbank Den Haag" },
    { rx: /amsterdam|amstelveen|diemen|zaandam|hoofddorp|haarlem/, court: "Rechtbank Amsterdam / Noord-Holland" },
    { rx: /rotterdam|schiedam|capelle|spijkenisse|dordrecht/, court: "Rechtbank Rotterdam" },
    { rx: /utrecht|hilversum|amersfoort|leusden|nieuwegein|zeist/, court: "Rechtbank Midden-Nederland (Utrecht)" },
    { rx: /eindhoven|'s\-?hertogenbosch|den bosch|helmond/, court: "Rechtbank Oost-Brabant" },
    { rx: /breda|tilburg|roosendaal/, court: "Rechtbank Zeeland-West-Brabant" },
    { rx: /groningen|assen|leeuwarden/, court: "Rechtbank Noord-Nederland" },
    { rx: /zwolle|enschede|deventer|almelo/, court: "Rechtbank Overijssel" },
    { rx: /arnhem|nijmegen|apeldoorn|zutphen|ede|wageningen/, court: "Rechtbank Gelderland" },
    { rx: /maastricht|heerlen|sittard|venlo|roermond/, court: "Rechtbank Limburg" }
  ];
  for (const m of map) if (m.rx.test(t)) return m.court;
  return "Rechtbank Den Haag"; // fallback
}

// ====== 8) Validatie ======
function validateFields(fields) {
  const errs = [];

  // vereiste velden
  for (const path of schema.required) {
    if (!get(fields, path)) errs.push(`Ontbrekend: ${path}`);
  }

  // prijs
  const bedrag = parseFloat(get(fields, "prijs.bedrag"));
  if (isNaN(bedrag) || bedrag <= 0) errs.push("Prijs moet een positief bedrag zijn.");

  // datum
  const dat = get(fields, "levering.datum");
  if (dat && isNaN(Date.parse(dat))) errs.push("Leveringsdatum is ongeldig (bijv. “morgen” of 12-10-2025).");

  // forum: woonplaats → rechtbank
  const woon = get(fields, "forum.woonplaats_gebruiker");
  if (woon && !get(fields, "forum.rechtbank")) {
    set(fields, "forum.rechtbank", nearestCourt(woon));
  }

  // vast recht
  set(fields, "recht.toepasselijk", schema.fixed["recht.toepasselijk"]);

  return errs;
}
function get(obj, path) {
  return path.split(".").reduce((o,k)=>o && o[k], obj);
}
function set(obj, path, val) {
  const parts = path.split(".");
  let o = obj;
  for (let i=0;i<parts.length-1;i++){
    if (!o[parts[i]]) o[parts[i]] = {};
    o = o[parts[i]];
  }
  o[parts[parts.length-1]] = val;
}

// ====== 9) Clause engine / concept (incl. Ondertekening zonder plaats) ======
function buildConcept(fields) {
  const f = (p, d="") => get(fields,p) || d;
  const bedrag = f("prijs.bedrag");
  const prijsStr = bedrag ? `€ ${Number(bedrag).toLocaleString("nl-NL",{minimumFractionDigits:2, maximumFractionDigits:2})}` : "€ …";

  return [
`**KOOPOVEREENKOMST – SPULLEN (roerende zaak)**

**Partijen**
1. **Koper**: ${f("koper.naam","…")}${f("koper.adres") ? `, ${f("koper.adres")}` : ""}.
2. **Verkoper**: ${f("verkoper.naam","…")}${f("verkoper.adres") ? `, ${f("verkoper.adres")}` : ""}.

**1. Omschrijving van het object**
Het verkochte betreft: **${f("object.omschrijving","…")}**${f("object.conditie") ? `, conditie: ${f("object.conditie")}` : ""}${f("object.identifiers") ? ` (identificatie: ${f("object.identifiers")})` : ""}.

**2. Prijs en betaling**
De koopprijs bedraagt **${prijsStr}**. Betaling via ${f("betaling.wijze","overboeking")} op ${f("betaling.moment","moment van levering")}.

**3. Levering en risico**
Levering vindt plaats op **${f("levering.datum","…")}** te **${f("levering.plaats","…")}**. Het risico gaat over bij levering.

**4. Eigendom en garanties**
Verkoper verklaart eigenaar te zijn en dat het object vrij is van beslagen en beperkte rechten.${f("garantie.type")==="geen"?" Er wordt geen garantie verstrekt.": f("garantie.type")?` Garantie: ${f("garantie.type")}.`:""}

**5. Toepasselijk recht en forumkeuze**
Op deze overeenkomst is **${f("recht.toepasselijk","Nederlands recht")}** van toepassing.
Geschillen worden exclusief voorgelegd aan de **${f("forum.rechtbank","dichtstbijzijnde rechtbank bij woonplaats koper")}**.

**Ondertekening**
${f("koper.naam","Koper")} – datum handtekening: _____________________
${f("verkoper.naam","Verkoper")} – datum handtekening: _____________________
`
  ].join("\n");
}

// ====== 10) Gesprekslogica (router) ======
function handleLocal(userMsg) {
  // 1) intent (assumptief)
  if (state.phase === PHASE.IDLE || state.phase === PHASE.INTENT) {
    const cls = classifyIntent(userMsg);
    if (cls.intent === "koop_spullen") {
      state.intent = "koop_spullen";
      state.objectDetected = cls.object;
      state.phase = PHASE.PROPOSAL;
      state.didAssumptiveIntro = true;
      state.proposalStep = 0;

      // (0) Eerste beurt: alleen assumptie
      addAiMessageMarkdown(
        `Ik ga uit van een **koopovereenkomst voor spullen (roerende zaak)**, omdat ${cls.object ? `het om een ${cls.object} gaat` : "het om de aankoop van spullen lijkt te gaan"}.`
      );
      return true;
    }
    return false;
  }

  // 2) PROPOSAL microstappen
  if (state.phase === PHASE.PROPOSAL) {
    // step 0 → 1: vraag pas nu naar mode
    if (state.proposalStep === 0) {
      state.proposalStep = 1;
      addAiMessageMarkdown(
        `Hoe wil je de informatie aanleveren? **Chat** (stap voor stap), alles in **één bericht** (‘formulier’), of **meerkeuze**? Je mag ook **'checklist'** zeggen.`
      );
      return true;
    }

    // step 1: verwerk keuze (of default) en ga naar omschrijving
    if (state.proposalStep === 1) {
      const mode = parseMode(userMsg);
      state.mode = mode || MODE.CHAT;

      // Nu pas het omschrijvingsvoorstel
      const suggestion = suggestionFor(state.objectDetected);
      addAiMessageMarkdown(
        `Zal ik alvast een **omschrijving** voorstellen?\n**Voorstel:** “${suggestion}”.\n**Past dit ongeveer?** Zo niet, noem merk/kleur/jaar/conditie.`
      );
      state.lastAsked = "object.omschrijving";
      state.phase = PHASE.COLLECT;
      return true;
    }
  }

  // 3) COLLECT: vraag-voor-vraag velden verzamelen
  if (state.phase === PHASE.COLLECT) {
    // Als we net om omschrijving vroegen en user zegt "ja/klopt", neem voorstel over
    if (state.lastAsked === "object.omschrijving" && /^(ja|klopt|prima|ok|oke|okay)\b/i.test(userMsg)) {
      if (!get(state.fields,"object.omschrijving")) {
        set(state.fields,"object.omschrijving", suggestionFor(state.objectDetected));
        state.sources["object.omschrijving"] = "ai-proposed";
      }
    }

    // verwerk user input → velden (prijs, datum, plaats, woonplaats, etc.)
    const extracted = extractFields(userMsg);
    for (const k of Object.keys(extracted)) {
      set(state.fields, k, extracted[k]);
      state.sources[k] = "user";
    }

    // Namen expliciet herkennen (flexibeler)
    const koperMatch = userMsg.match(/(?:^|\b)koper(?:\s+is)?[:\-]?\s+(.+)$/i);
    if (koperMatch) {
      set(state.fields, "koper.naam", koperMatch[1].trim());
      state.sources["koper.naam"] = "user";
    }
    const verkoperMatch = userMsg.match(/(?:^|\b)verkoper(?:\s+is)?[:\-]?\s+(.+)$/i);
    if (verkoperMatch) {
      set(state.fields, "verkoper.naam", verkoperMatch[1].trim());
      state.sources["verkoper.naam"] = "user";
    }

    // Vrije tekst als omschrijving (alleen als dat net gevraagd is)
    if (state.lastAsked === "object.omschrijving") {
      const val = userMsg.trim();
      if (val && !/^(ja|nee)$/i.test(val) && !get(state.fields,"object.omschrijving")) {
        set(state.fields,"object.omschrijving", val);
        state.sources["object.omschrijving"] = "user";
      }
    }

    // Fallback: als we zojuist om een specifiek veld vroegen en de input lijkt een waarde,
    // zet het direct (vooral voor namen)
    if (state.lastAsked && !get(state.fields, state.lastAsked)) {
      const val = userMsg.trim();
      if (val && val.length > 1 && !/^ja$|^nee$/i.test(val)) {
        set(state.fields, state.lastAsked, val.replace(/^(koper|verkoper)[:\-]\s*/i,"").trim());
        state.sources[state.lastAsked] = "user";
      }
    }

    // Vraag volgende of ga valideren
    const missing = requiredMissing();
    if (missing.length === 0) {
      state.phase = PHASE.VALIDATE;
      const errs = validateFields(state.fields);
      if (errs.length) {
        addAiMessageMarkdown("Even checken:\n" + errs.map(e=>`- ${e}`).join("\n") + "\n\nNoem alsjeblieft de ontbrekende/onjuiste gegevens.");
        state.phase = PHASE.COLLECT;
        return true;
      } else {
        state.phase = PHASE.CONCEPT;
        const concept = buildConcept(state.fields);
        addAiMessageMarkdown(concept + "\n\n*Als je iets wilt aanpassen (prijs, datum, namen, woonplaats, etc.), typ het gewoon.*");
        state.phase = PHASE.DONE;
        return true;
      }
    } else {
      // stel de volgende, korte vraag
      addAiMessageMarkdown(nextQuestion());
      return true;
    }
  }

  // 4) DONE: bewerkingen/aanpassingen
  if (state.phase === PHASE.DONE) {
    // aanpassingen oppakken
    const extracted = extractFields(userMsg);
    for (const k of Object.keys(extracted)) {
      set(state.fields, k, extracted[k]);
      state.sources[k] = "user";
    }

    // simpele naam-wijzigers
    if (/^koper[:\-]\s*/i.test(userMsg)) {
      set(state.fields,"koper.naam", userMsg.replace(/^koper[:\-]\s*/i,"").trim());
      state.sources["koper.naam"] = "user";
    }
    if (/^verkoper[:\-]\s*/i.test(userMsg)) {
      set(state.fields,"verkoper.naam", userMsg.replace(/^verkoper[:\-]\s*/i,"").trim());
      state.sources["verkoper.naam"] = "user";
    }
    if (/^woonplaats[:\-]\s*/i.test(userMsg)) {
      const w = userMsg.replace(/^woonplaats[:\-]\s*/i,"").trim();
      set(state.fields,"forum.woonplaats_gebruiker", w);
      set(state.fields,"forum.rechtbank", nearestCourt(w));
      state.sources["forum.woonplaats_gebruiker"] = "user";
    }

    // herbouw concept
    const errors = validateFields(state.fields);
    if (errors.length) {
      addAiMessageMarkdown("Kleine controle:\n" + errors.map(e=>`- ${e}`).join("\n") + "\n\nPas dit aan en ik werk het concept direct bij.");
      return true;
    } else {
      const concept = buildConcept(state.fields);
      addAiMessageMarkdown(concept + "\n\n*Nog iets wijzigen? Typ het maar.*");
      return true;
    }
  }

  return false; // niet lokaal afgehandeld
}

function requiredMissing() {
  const missing = [];
  for (const k of schema.required) if (!get(state.fields,k)) missing.push(k);
  return missing;
}

function nextQuestion() {
  // in logische volgorde vragen wat nog ontbreekt
  const missing = requiredMissing();

  if (!get(state.fields,"object.omschrijving")) {
    const base = suggestionFor(state.objectDetected);
    state.lastAsked = "object.omschrijving";
    return `Kun je de **omschrijving van het object** bevestigen of aanpassen?\nBijv.: “${base}”.`;
  }
  if (!get(state.fields,"prijs.bedrag")) {
    state.lastAsked = "prijs.bedrag";
    return `Wat is de **koopprijs**? (bijv. €350)`;
  }
  if (!get(state.fields,"levering.datum")) {
    state.lastAsked = "levering.datum";
    return `Welke **leveringsdatum** wil je gebruiken? (bijv. “morgen” of “12-10-2025”)`;
  }
  if (!get(state.fields,"levering.plaats")) {
    state.lastAsked = "levering.plaats";
    return `Op welke **plaats** vindt de levering plaats? (bijv. “in Leiden” of “te Utrecht”)`;
  }
  if (!get(state.fields,"koper.naam")) {
    state.lastAsked = "koper.naam";
    return `Wat is de **naam van de koper**? (bijv. “Jan Jansen”)`;
  }
  if (!get(state.fields,"verkoper.naam")) {
    state.lastAsked = "verkoper.naam";
    return `Wat is de **naam van de verkoper**? (bijv. “Piet Pieters”)`;
  }
  if (!get(state.fields,"forum.woonplaats_gebruiker")) {
    state.lastAsked = "forum.woonplaats_gebruiker";
    return `Wat is je **woonplaats** (of postcode) voor de forumkeuze (dichtstbijzijnde rechtbank)?`;
  }

  state.lastAsked = null;
  return `Dank! Ik controleer even alles en toon dan het **concept**.`;
}

// ====== Verzenden / event binding ======
async function sendMessage() {
  const inputField = document.getElementById("user-input");
  const sendButton = document.querySelector("button");
  const chatLog = document.getElementById("chat-log");
  const originalText = textLabels[language].send;
  const userMessage = inputField.value.trim();
  if (!userMessage) return;

  addUserMessage(userMessage);
  inputField.value = "";

  // Probeer lokaal af te handelen (onze 10-stappenflow)
  const handled = handleLocal(userMessage);
  if (handled) return;

  // Zo niet: val terug op backend (optioneel / toekomstig)
  inputField.disabled = true;
  sendButton.disabled = true;
  sendButton.innerHTML = `<span class="spinner"></span> ${textLabels[language].sending}`;

  // Typ-indicator
  const typingIndicator = document.createElement("div");
  typingIndicator.classList.add("message", "ai");
  typingIndicator.id = "typing-indicator";
  typingIndicator.innerHTML = `<div class="bubble typing">
    ${textLabels[language].typing}<span class="dots"></span>
  </div>`;
  chatLog.appendChild(typingIndicator);
  scrollToBottom();

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: userMessage })
    });
    if (!response.ok) {
      typingIndicator.remove();
      throw new Error(`Server returned ${response.status}`);
    }
    const data = await response.json();
    typingIndicator.remove();

    if (!data.choices || !data.choices[0]) {
      addAiMessageMarkdown("⚠️ Geen geldig antwoord ontvangen.");
      return;
    }

    const aiMessage = marked.parse(data.choices[0].message.content);
    const html = `<div class="message ai"><div class="bubble formatted-output">⚖️ ${aiMessage}</div></div>`;
    chatLog.innerHTML += html;
    scrollToBottom();
  } catch (e) {
    typingIndicator.remove();
    addAiMessageMarkdown(textLabels[language].network);
    console.error(e);
  } finally {
    inputField.disabled = false;
    inputField.focus();
    sendButton.disabled = false;
    sendButton.textContent = originalText;
  }
}

// Init
window.addEventListener("DOMContentLoaded", function () {
  const input = document.getElementById("user-input");
  const sendButton = document.querySelector("button");
  input.placeholder = textLabels[language].placeholder;
  sendButton.textContent = textLabels[language].send;

  input.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      event.preventDefault();
      sendMessage();
    }
  });
  input.focus();
  // Geen onboarding — we wachten op de eerste user input
});
