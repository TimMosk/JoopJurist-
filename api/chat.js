export default async function handler(req, res) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Alleen POST-requests zijn toegestaan.' });
  }

  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Geen bericht ontvangen in de request body" });
    }

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'Je bent een juridische chatbot die gebruikers helpt bij het opstellen van juridische documenten door gestructureerde informatie te verzamelen.'
          },
          {
            role: 'user',
            content: message
          }
        ]
      })
    });

    const data = await openaiRes.json();

    // Als OpenAI een fout terugstuurt, log die dan
    if (!data.choices || !data.choices[0]) {
      console.error("❌ OpenAI antwoord ongeldig:", data);
      return res.status(500).json({ error: "OpenAI gaf geen geldig antwoord terug", data });
    }

    res.status(200).json(data);
  } catch (error) {
    console.error("❌ Server fout:", error);
    res.status(500).json({ error: "Interne serverfout", details: error.message });
  }
}
