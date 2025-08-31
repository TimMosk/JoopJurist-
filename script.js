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
const scrollToBottom = () => { const log=$("#chat-log"); log.scrollTop = log.scrollHeight; };

function addUser(text){
  $("#chat-log").innerHTML += `<div class="message user"><div class="bubble">💬 ${escapeHtml(text)}</div></div>`;
  scrollToBottom();
}
function addAiMarkdown(md){
  const html = window.marked.parse(md);
  $("#chat-log").innerHTML += `<div class="message ai"><div class="bubble formatted-output">⚖️ ${html}</div></div>`;
  scrollToBottom();
}
function addTyping(){
  const el = document.createElement("div");
  el.className = "message ai"; el.id = "typing-indicator";
  el.innerHTML = `<div class="bubble typing">${t.typing}<span class="dots"></span></div>`;
  $("#chat-log").appendChild(el); scrollToBottom(); return el;
}

let facts = {};         // optioneel lokaal; server mag ook masteren
let history = [];       // laatste turns

async function sendMessage(){
  const input = $("#user-input");
  const btn = $("#send-btn") || $("button");
  const msg = input.value.trim(); if(!msg) return;

  addUser(msg);
  history.push({ role:"user", content: msg });
  input.value=""; input.disabled=true; if(btn){ btn.disabled=true; btn.textContent=t.sending; }

  const typing = addTyping();

  try{
    const res = await fetch("/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message: msg, facts, history: history.slice(-10) })
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

  if (data.say) {
    addAiMarkdown(data.say);
    history.push({ role: "assistant", content: data.say });
  }

  if (data.ask) {
    addAiMarkdown(data.ask);
    history.push({ role: "assistant", content: data.ask });
  }

  if (Array.isArray(data.suggestions) && data.suggestions.length) {
    const bullets = data.suggestions.map((s, i) => `**${i+1}. ${s.title}**\n— ${s.why}`).join("\n\n");
    addAiMarkdown(`**Mogelijke aanvullingen:**\n${bullets}\n*Zeg bijvoorbeeld: “neem 1 en 3”.*`);
    history.push({ role: "assistant", content: bullets });
  }

  if (data.concept) {
    addAiMarkdown(data.concept);
    history.push({ role: "assistant", content: data.concept });
  }
}

    if (Array.isArray(data.suggestions) && data.suggestions.length){
      const bullets = data.suggestions.map((s,i)=>`**${i+1}. ${s.title}** — ${s.why}`).join("\n");
      addAiMarkdown(`**Mogelijke aanvullingen:**\n${bullets}\n\n_Zeg bijvoorbeeld: “neem 1 en 3” of “alleen eigendom”.__`);
      history.push({ role:"assistant", content: "[suggestions]" });
    }

    if (data.ask){
      addAiMarkdown(data.ask);
      history.push({ role:"assistant", content: data.ask });
    }

    if (data.concept){
      addAiMarkdown(data.concept);
      history.push({ role:"assistant", content: "[concept]" });
    }

  } catch (e) {
  // only real network/JS errors land here (we no longer throw on non-OK)
  if (typeof typing !== "undefined" && typing) typing.remove?.();
  const reason = e?.message || String(e) || "onbekende fout";
  addAiMarkdown(`⚠️ Netwerkfout – ${reason}`);
  console.error("Fetch/JS error", e);
} finally {
  // always restore the UI
  const btn = document.getElementById("send-btn");
  if (typeof input !== "undefined" && input) {
    input.disabled = false;
    input.focus();
  }
  if (btn) {
    btn.disabled = false;
    btn.textContent = t?.send || "Verstuur";
  }
}
}

window.addEventListener("DOMContentLoaded", ()=>{
  const input = $("#user-input");
  const btn = $("#send-btn") || $("button");
  input.placeholder = t.placeholder;
  if(btn){ btn.textContent=t.send; btn.onclick=null; btn.addEventListener("click", sendMessage); }
  input.addEventListener("keydown", e=>{ if(e.key==="Enter"){ e.preventDefault(); sendMessage(); }});
  addAiMarkdown("Ik ben **JoopJurist**. Vertel in je eigen woorden wat je wil regelen; ik denk mee, vul aan en stel de juiste vragen.");
});
