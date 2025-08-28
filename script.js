// script.js — JoopJurist "spullen" (koop roerende zaken)
// v1.1.0

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
  PROPOSAL: "proposal",      // voorstel + slimme voorinvulling
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
  fields: {},                // ingevulde velden
  sources: {},               // bron per veld (user | ai-proposed)
};

// ====== 2) Basis-schema "spullen" (Stap 5) ======
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
    "forum.woonplaats_gebruiker" // nodig om dichtstbijzijnde rechtbank te bepalen
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
    "recht.toepasselijk": "Nederlands recht" // altijd NL recht
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

// ====== 4) Slimme voorinvulling (Stap 2 samengevoegd) ======
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

  // jaar: 2020..2026
  const yearMatch = t.match(/\b(20[0-4]\d|2025|2026)\b/); // simpele range
  if (yearMatch) out["object.jaar"] = yearMatch[1];

  // kleur (een paar veelvoorkomende NL kleuren)
  const kleurMatch = t.match(/\b(zwart|wit|blauw|rood|grijs|groen|geel|bruin|zilver)\b/);
  if (kleurMatch) out["object.kleur"] = kleurMatch[1];

  // merk (heel grof, voor fiets/elek)
  const merkMatch = t.match(/\b(batavus|cortina|gazelle|cube|trek|giant|apple|dell|hp|samsung|sony|canon|nikon|fujifilm)\b/);
  if (merkMatch) out["object.merk"] = capitalize(merkMatch[1]);

  // leveringsdatum: dd-mm-jjjj of jjjj-mm-dd
  const dateMatch = t.match(/\b(\d{1,2}[-/]\d{1,2}[-/]\d{4})\b|\b(20\d{2}-\d{2}-\d{2})\b/);
  if (dateMatch) {
    const raw = dateMatch[1] || dateMatch[2];
    const parsed = parseDutchDate(raw);
    if (parsed) out["levering.datum"] = parsed;
  }

  // plaats (heuristiek): na woorden "in" of "te" + kapitaalwoord
  const placeMatch = text.match(/\b(?:in|te)\s+([A-ZÁÉÍÓÚÄËÏÖÜ][\w\- ]{2,})/);
  if (placeMatch) out["levering.plaats"] = placeMatch[1].trim();

  // woonplaats gebruiker (voor forum)
  const woonMatch = text.match(/\b(?:woon(?:plaats)?|ik woon in|mijn (?:woon)?plaats is)\s+([A-Z][\w\- ]{2,})/i);
  if (woonMatch) out["forum.woonplaats_gebruiker"] = woonMatch[1].trim();

  // conditie (een paar woorden)
  if (/\b(nieuwstaat|zo goed als nieuw|goede staat|gebruikt)\b/.test(t)) {
    out["object.conditie"] = (t.match(/\b(nieuwstaat|zo goed als nieuw|goede staat|gebruikt)\b/) || [])[1];
  }

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
    const [_, d, mo, y] = m1.map(Number);
    const iso = `${y.toString().padStart(4,"0")}-${mo.toString().padStart(2,"0")}-${d.toString().padStart(2,"0")}`;
    if (!isNaN(Date.parse(iso))) return iso;
  }
  // yyyy-mm-dd
  if (!isNaN(Date.parse(s))) return s;
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

  // simpele mapping (kan later uitgebreid of met geocoding)
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

// ====== 8) Validatie (Stap 7) ======
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
  if (dat && isNaN(Date.parse(dat))) errs.push("Leveringsdatum is ongeldig (gebruik bijv. 12-10-2025).");

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

// ====== 9) Clause engine / concept (Stap 9 + NL recht & forum) ======
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
Plaats: _____________________   Datum: _____________________
Koper: ______________________   Verkoper: ___________________
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

      const suggestion = suggestionFor(cls.object);
      const intro = [
        `Ik ga uit van een **koopovereenkomst voor spullen (roerende zaak)**, omdat ${cls.object ? `het om een ${cls.object} gaat` : "het om de aankoop van spullen lijkt te gaan"}.`,
        `Je kunt informatie aanleveren via **chat** (stap voor stap), alles in één **bericht** (‘formulier’), of **meerkeuze**.`,
        `**Voorstel objectomschrijving:** “${suggestion}”.`,
        `**Past dit ongeveer?** Zo niet, noem merk/kleur/jaar/conditie. Je mag ook je **woonplaats** geven (voor de forumkeuze).`,
        `*NB: Het toepasselijk recht is **altijd Nederlands recht**; geschillen gaan naar de **dichtstbijzijnde rechtbank bij jouw woonplaats***.`
      ].join("\n");
      addAiMessageMarkdown(intro);
      return true; // lokaal afgehandeld
    }
    // geen koop ⇒ laat backend doen (of vraag verduidelijking)
    return false;
  }

  // 2) voorstel + mode + eerste slots
  if (state.phase === PHASE.PROPOSAL) {
    // mode keus?
    const mode = parseMode(userMsg);
    if (mode) state.mode = mode;
    else if (!state.mode) state.mode = MODE.CHAT;

    // neem AI-voorstel over als user "ja" of soortgelijk zegt
    if (/^(ja|klopt|prima|ok|oke|okay)\b/i.test(userMsg)) {
      // zet de object-omschrijving als nog niet gezet
      if (!get(state.fields,"object.omschrijving")) {
        set(state.fields,"object.omschrijving", suggestionFor(state.objectDetected));
        state.sources["object.omschrijving"] = "ai-proposed";
      }
    }

    // pak eventuele direct ingevulde velden uit userMsg
    const extracted = extractFields(userMsg);
    for (const k of Object.keys(extracted)) {
      set(state.fields, k, extracted[k]);
      state.sources[k] = "user";
    }

    // Als we nog geen woonplaats hebben en user noemt een plaats met "ik woon in …", pakten we die hierboven al.
    // Vraag nu gericht door afhankelijk van mode
    state.phase = PHASE.COLLECT;
    addAiMessageMarkdown(nextQuestion());
    return true;
  }

  // 3) COLLECT: vraag-voor-vraag velden verzamelen
  if (state.phase === PHASE.COLLECT) {
    // verwerk user input → velden
    const extracted = extractFields(userMsg);
    for (const k of Object.keys(extracted)) {
      set(state.fields, k, extracted[k]);
      state.sources[k] = "user";
    }

    // ook vrije tekst overnemen als object-omschrijving als user duidelijk corrigeert
    if (!/prijs|€|\b(\d{1,2}[-/]\d{1,2}[-/]\d{4})\b|levering|woonplaats|betaal|betaling/i.test(userMsg)) {
      // heuristiek: als user iets als "Batavus, blauw, 2021" zegt
      if (!get(state.fields,"object.omschrijving") && /[a-z]/i.test(userMsg)) {
        set(state.fields,"object.omschrijving", userMsg.trim());
        state.sources["object.omschrijving"] = "user";
      }
    }

    // vraag volgende of ga valideren
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
      // vraag volgende
      addAiMessageMarkdown(nextQuestion());
      return true;
    }
  }

  // 4) DONE: bewerkingen/aanpassingen
  if (state.phase === PHASE.DONE) {
    // laat aanpassingen toe: parse opnieuw en toon geüpdatet concept
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

  // 1) object.omschrijving
  if (!get(state.fields,"object.omschrijving")) {
    const base = suggestionFor(state.objectDetected);
    return `Kun je de **omschrijving van het object** bevestigen of aanpassen?\nBijv.: “${base}”.`;
  }
  // 2) prijs.bedrag
  if (!get(state.fields,"prijs.bedrag")) {
    return `Wat is de **koopprijs**? (bijv. €350)`;
  }
  // 3) levering.datum
  if (!get(state.fields,"levering.datum")) {
    return `Welke **leveringsdatum** wil je gebruiken? (bijv. 12-10-2025)`;
  }
  // 4) levering.plaats
  if (!get(state.fields,"levering.plaats")) {
    return `Op welke **plaats** vindt de levering plaats? (bijv. “in Leiden” of “te Utrecht”)`;
  }
  // 5) koper.naam
  if (!get(state.fields,"koper.naam")) {
    return `Wat is de **naam van de koper**? (bijv. “Koper: Jan Jansen”)`;
  }
  // 6) verkoper.naam
  if (!get(state.fields,"verkoper.naam")) {
    return `Wat is de **naam van de verkoper**? (bijv. “Verkoper: Piet Pieters”)`;
  }
  // 7) forum.woonplaats_gebruiker
  if (!get(state.fields,"forum.woonplaats_gebruiker")) {
    return `Wat is je **woonplaats** (of postcode) voor de **forumkeuze** (dichtstbijzijnde rechtbank)?`;
  }

  // Als alles er is:
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
