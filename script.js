const language = "nl";

// 🏷️ Labels per taal
const textLabels = {
  nl: {
    send: "Verstuur",
    sending: "Bezig...",
    placeholder: "Typ hier je vraag...",
    error: "⚠️ Er ging iets mis",
    network: "⚠️ Netwerkfout",
    typing: "⚖️ Joop zit in de bieb"
  },
  en: {
    send: "Send",
    sending: "Sending...",
    placeholder: "Type your question here...",
    error: "⚠️ Something went wrong",
    network: "⚠️ Network error",
    typing: "⚖️ Joop is thinking"
  }
};

// ✅ Correcte scrollfunctie
function scrollToBottom() {
  const chatLog = document.getElementById("chat-log");
  chatLog.scrollTop = chatLog.scrollHeight;
}

async function sendMessage() {
  const inputField = document.getElementById("user-input");
  const sendButton = document.querySelector("button");
  const chatLog = document.getElementById("chat-log");
  const originalText = textLabels[language].send;
  const userMessage = inputField.value.trim();
  if (!userMessage) return;

  // Voeg gebruikersbericht toe
  chatLog.innerHTML += `
    <div class="message user">
      <div class="bubble">💬 ${userMessage}</div>
    </div>
  `;
  scrollToBottom();
  inputField.value = "";
  inputField.disabled = true;
  sendButton.disabled = true;
  sendButton.innerHTML = `<span class="spinner"></span> ${textLabels[language].sending}`;

  // Typ-indicator
  const typingIndicator = document.createElement("div");
  typingIndicator.classList.add("message", "ai");
  typingIndicator.id = "typing-indicator";
  typingIndicator.innerHTML = `
    <div class="bubble typing">
      ${textLabels[language].typing}<span class="dots"></span>
    </div>`;
  chatLog.appendChild(typingIndicator);
  scrollToBottom();

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ message: userMessage })
    });

    // ✅ Check op netwerk- of serverfouten vóór .json()
    if (!response.ok) {
      typingIndicator.remove();
      throw new Error(`Server returned ${response.status}`);
    }

    const data = await response.json();
    typingIndicator.remove();

    if (!data.choices || !data.choices[0]) {
      chatLog.innerHTML += `
        <div class="message ai">
          <div class="bubble error">${textLabels[language].error}</div>
        </div>
      `;
      scrollToBottom();
      return;
    }

    const aiMessage = data.choices[0].message.content;
    chatLog.innerHTML += `
      <div class="message ai">
        <div class="bubble">⚖️ ${aiMessage}</div>
      </div>
    `;
    scrollToBottom();
  } catch (error) {
    typingIndicator.remove();
    chatLog.innerHTML += `
      <div class="message ai">
        <div class="bubble error">${textLabels[language].network}</div>
      </div>
    `;
    console.error("Fout:", error);
    scrollToBottom();
  } finally {
    inputField.disabled = false;
    inputField.focus();
    sendButton.disabled = false;
    sendButton.textContent = originalText;
  }
}

// ✅ Bij laden: placeholder, button label, enter-verzending, focus
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
});
