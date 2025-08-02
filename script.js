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
      chatLog.innerHTML += `<p><strong>Joop Jurist:</strong> Er ging iets mis: ${data.error || "Geen geldig antwoord"}</p>`;
      return;
    }

    const aiMessage = data.choices[0].message.content;
    chatLog.innerHTML += `<p><strong>Joop Jurist:</strong> ${aiMessage}</p>`;
    chatLog.scrollTop = chatLog.scrollHeight;
  } catch (error) {
   chatLog.innerHTML += `
  <div class="message ai">
    <div class="bubble">⚖️ ${aiMessage}</div>
  </div>
`;
    console.error("Fout:", error);
  }
}
