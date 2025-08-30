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
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ message: msg, facts, history: history.slice(-10) })
    });
    if(!res.ok) throw new Error("HTTP "+res.status);
    const data = await res.json();
    typing.remove();

    if (data.facts) facts = data.facts;

    if (data.say){
      addAiMarkdown(data.say);
      history.push({ role:"assistant", content: data.say });
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

  }catch(e){
    typing.remove();
    addAiMarkdown(t.network);
    console.error(e);
  }finally{
    const b = $("#send-btn");
    input.disabled=false; input.focus();
    if(b){ b.disabled=false; b.textContent=t.send; }
  }
}

window.addEventListener("DOMContentLoaded", ()=>{
  const input = $("#user-input");
  const btn = $("#send-btn") || $("button");
  input.placeholder = t.placeholder;
  if(btn){ btn.textContent=t.send; btn.onclick=null; btn.addEventListener("click", sendMessage); }
  input.addEventListener("keydown", e=>{ if(e.key==="Enter"){ e.preventDefault(); sendMessage(); }});
  addAiMarkdown("Ik ben **JoopJurist**. Vertel in je eigen woorden wat je wil regelen; ik denk mee, vul aan en stel alleen vragen die nodig zijn. Je kunt altijd zeggen: _“Toon alvast het concept.”_");
});
