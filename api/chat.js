const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

export default async function handler(req, res) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Alleen POST-requests zijn toegestaan.' });
  }

  try {
    const { message } = req.body;

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
            content: 'Je bent een juridische chatbot die gebruikers helpt bij het opstellen van juridische documenten door gestructureerde informatie te verzamelen.'
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
      // Geeft de fout van OpenAI netjes terug
      return res.status(response.status).json({
        error: "OpenAI gaf geen geldig antwoord terug",
        details: data
      });
    }

    res.status(200).json(data);

  } catch (error) {
    res.status(500).json({ error: 'Interne serverfout', details: error.message });
  }
}
