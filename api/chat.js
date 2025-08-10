const MODEL = process.env.OPENAI_MODEL || 'gpt-5';

export default async function handler(req, res) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Alleen POST-requests zijn toegestaan.' });
  }

  try {
    const { message } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Bericht ontbreekt of is ongeldig.' });
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: 'system',
            content: 'Je bent JoopJurist, een juridische chatbot die gebruikers helpt bij het opstellen van juridische documenten door gestructureerde informatie te verzamelen en advies te geven in duidelijke taal.'
          },
          {
            role: 'user',
            content: message
          }
        ]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: "OpenAI gaf geen geldig antwoord terug.",
        details: data
      });
    }

    // Antwoord terugsturen naar de frontend
    return res.status(200).json(data);

  } catch (error) {
    console.error("Fout in API-route:", error);
    return res.status(500).json({ error: 'Interne serverfout bij het aanroepen van OpenAI.' });
  }
}
