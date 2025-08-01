async function sendMessage() {
  const inputField = document.getElementById("user-input");
  const chatLog = document.getElementById("chat-log");
  const userMessage = inputField.value;
  if (!userMessage) return;

  chatLog.innerHTML += `<p><strong>Jij:</strong> ${userMessage}</p>`;
  inputField.value = "";

  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ message: userMessage })
  });

  const data = await response.json();
  const aiMessage = data.message;
  chatLog.innerHTML += `<p><strong>Joop Jurist:</strong> ${aiMessage}</p>`;
  chatLog.scrollTop = chatLog.scrollHeight;
}
