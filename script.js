
async function sendMessage() {
    const inputField = document.getElementById("user-input");
    const chatLog = document.getElementById("chat-log");
    const userMessage = inputField.value;
    if (!userMessage) return;

    chatLog.innerHTML += `<p><strong>Jij:</strong> ${userMessage}</p>`;
    inputField.value = "";

    try {
        const response = await fetch("/api/chat", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ message: userMessage })
        });

        if (!response.ok) {
            throw new Error(`Serverfout: ${response.status}`);
        }

        const data = await response.json();

        if (!data.reply) {
            throw new Error("Geen antwoord ontvangen van de chatbot.");
        }

        chatLog.innerHTML += `<p><strong>Joop Jurist:</strong> ${data.reply}</p>`;
        chatLog.scrollTop = chatLog.scrollHeight;
    } catch (error) {
        console.error("Fout bij verzenden van bericht:", error);
        chatLog.innerHTML += `<p><strong>Joop Jurist:</strong> Er is iets misgegaan. Probeer het opnieuw.</p>`;
    }
}
