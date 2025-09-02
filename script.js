// script.js — Natural-first chat client for JoopJurist
// versie: natural-4

const t = {
  send: "Verstuur",
  sending: "Bezig...",
  placeholder: "Typ hier je vraag...",
  typing: "⚖️ Joop denkt na",
  network: "⚠️ Netwerkfout"
};

const $ = s => document.querySelector(s);
const escapeHtml = s => (s||"").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

// Sticky autoscroll: blijf onder als gebruiker niet omhoog is gescrolld
let _stickToBottom = true;
const _log = () => document.querySelector("#chat-log");
const _isNearBottom = (el) => (el.scrollHeight - el.clientHeight - el.scrollTop) < 4;
const scrollToBottom = (force=false) => {
  const el = _log(); if (!el) return;
  if (!force && !_stickToBottom && !_isNearBottom(el)) return;
  // wacht tot DOM & layout klaar zijn
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.scrollTop = el.scrollHeight;
  }));
};

function addUser(text){
   const html = `<div class="message user"><div class="bubble">💬 ${escapeHtml(text)}</div></div>`;
   $("#chat-log").insertAdjacentHTML("beforeend", html);
   scrollToBottom();
}
function addAiMarkdown(md){
  const html = window.marked.parse(md);
  $("#chat-log").insertAdjacentHTML("beforeend",
    `<div class="message ai"><div class="bubble formatted-output">⚖️ ${html}</div></div>`
  );
  scrollToBottom();
}
function addTyping(){
  const el = document.createElement("div");
  el.className = "message ai"; el.id = "typing-indicator";
  el.innerHTML = `<div class="bubble typing">${t.typing}<span class="dots"></span></div>`;
  $("#chat-log").appendChild(el);
  scrollToBottom();
  return el;
}

let facts = {};         // optioneel lokaal; server mag ook masteren
let history = [];       // laatste turns

async function sendMessage(){
  const input = $("#user-input");
  const btn = document.querySelector("#composer #send-btn");
  const msg = input.value.trim(); if(!msg) return;

  addUser(msg);
  history.push({ role:"user", content: msg });
  input.value=""; input.disabled=true; if(btn){ btn.disabled=true; btn.textContent=t.sending; }

  const typing = addTyping();

  try{
    const res = await fetch("/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    message: msg,
    facts,
    history: history.slice(-10),
    // 👇 lokaal “nu” uit de browser
    clientNow: new Date().toISOString(),
    clientOffset: new Date().getTimezoneOffset(), // in minuten; bv. CET = -60
    clientTz: Intl.DateTimeFormat().resolvedOptions().timeZone // optioneel
  })
});

// lees ALTIJD eerst de body als tekst (kan ook geen-JSON fout zijn)
const payloadText = await res.text();
let data = null;
try { data = JSON.parse(payloadText); } catch {}

// HTTP-fout? Toon status + details van de server en stop netjes
if (!res.ok) {
  typing?.remove();
  const reason = (data && (data.details || data.error)) || payloadText || "Onbekende fout";
  addAiMarkdown(`⚠️ Serverfout **${res.status}** – ${reason}`);
  console.error("API error", res.status, reason);
  // UI herstellen (pas namen aan jouw variabelen aan)
  input?.removeAttribute("disabled");
  btn?.removeAttribute("disabled");
  if (btn) btn.textContent = "Verstuur";
  input?.focus();
  return;
}

// happy path
typing?.remove();
if (!data || typeof data !== "object") {
  addAiMarkdown("⚠️ Ongeldige serverrespons.");
  console.error("Invalid body:", payloadText);
} else {
  if (data.facts) facts = data.facts;

const parts = [];
if (data.say) parts.push(data.say);
// Vraag NIET cursief en liefst in dezelfde bubbel.
if (data.ask) {
  if (parts.length) {
    parts[0] = parts[0].replace(/\s*$/, '') + (/[?.!…]$/.test(parts[0]) ? ' ' : ' ') + data.ask;
  } else {
    parts.push(data.ask);
  }
}
  
if (parts.length) {
  const oneBubble = parts.join("\n\n");
  addAiMarkdown(oneBubble);
  history.push({ role: "assistant", content: oneBubble });
}

// Concept (als het er is) tonen in een eigen, enkele bubbel
if (data.concept) {
  addAiMarkdown(data.concept);
  history.push({ role: "assistant", content: "[concept]" });
  }
}
    
  } catch (e) {
  // alleen echte netwerk/JS-fouten komen hier; HTTP-fouten zijn al afgehandeld
  typing?.remove?.();
  const reason = e?.message || String(e) || "onbekende fout";
  addAiMarkdown(`⚠️ Netwerkfout – ${reason}`);
  console.error("Fetch/JS error", e);
} finally {
  // UI altijd herstellen
  const btnEl = document.querySelector("#composer #send-btn");
  const inputEl = document.getElementById("user-input");
  if (inputEl) {
    inputEl.disabled = false;
    inputEl.focus();
  }
  if (btnEl) {
    btnEl.disabled = false;
    btnEl.textContent = t?.send || "Verstuur";
  }
}
}

window.addEventListener("DOMContentLoaded", ()=>{
  const input = $("#user-input");
  const btn = document.querySelector("#composer #send-btn");
  const form = document.getElementById("composer");
  input.placeholder = t.placeholder;
  if (btn) { btn.textContent = t.send; }
  // Verzend via formulier-submit (Enter werkt automatisch). Niet ook nog op click/keydown binden.
  if (form && !form.dataset.bound) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      sendMessage();
    });
    form.dataset.bound = "1";
  }
  addAiMarkdown("Ik ben **JoopJurist**. Vertel in je eigen woorden wat je wil regelen; ik denk mee, vul aan en stel de juiste vragen.");

  // Sticky autoscroll: als user omhoog scrolt, niet meer auto-naar-onderen
  const log = document.querySelector("#chat-log");
  if (log) {
    log.addEventListener("scroll", () => {
      _stickToBottom = _isNearBottom(log);
    });
  }
});
