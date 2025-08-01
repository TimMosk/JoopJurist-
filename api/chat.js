export default async function handler(req, res) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Alleen POST-requests zijn toegestaan.' });
  }

  try {
    const { message } = req.body;

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
    console.log("✅ OpenAI response:", data);

    if (!data.choices || !data.choices[0]) {
      return res.status(500).json({ error: 'Geen geldige reactie van OpenAI', details: data });
    }

    res.status(200).json(data);
  } catch (error) {
    console.error("❌ Fout in backend:", error);
    res.status(500).json({ error: 'Interne fout', details: error.message });
  }
}
