export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).send("Method not allowed");
    }
    
    const { concept, filename = "joopjurist-contract" } = req.body;
    
    if (!concept) {
      return res.status(400).json({ error: "Concept is required" });
    }
    
    // Maak tekst bestand
    const textContent = `JoopJurist - Nederlandse Juridische Contracten

${concept}

Dit document is gegenereerd door JoopJurist.nl`;
    
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.txt"`);
    res.send(textContent);
    
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: "Server error" });
  }
}
