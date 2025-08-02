async function sendMessage() {
  const inputField = document.getElementById("user-input");
  const chatLog = document.getElementById("chat-log");
  const userMessage = inputField.value;
  if (!userMessage) return;

  chatLog.innerHTML += `
    <div class="message user">
      <div class="bubble">💬 ${userMessage}</div>
    </div>
  `;
  inputField.value = "";

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ message: userMessage })
    });

    const data = await response.json();

    if (!response.ok || !data.choices || !data.choices[0]) {
      chatLog.innerHTML += `
        <div class="message ai">
          <div class="bubble error">⚠️ Er ging iets mis: ${data.error || "Geen geldig antwoord"}</div>
        </div>
      `;
      return;
    }

    const aiMessage = data.choices[0].message.content;
    chatLog.innerHTML += `
      <div class="message ai">
        <div class="bubble">⚖️ ${aiMessage}</div>
      </div>
    `;
    chatLog.scrollTop = chatLog.scrollHeight;
  } catch (error) {
    chatLog.innerHTML += `
      <div class="message ai">
        <div class="bubble error">⚠️ Netwerkfout</div>
      </div>
    `;
    console.error("Fout:", error);
  }
}
