module.exports = async function handler(req, res) {
  try {
    console.log('API called with method:', req.method);
    
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Use POST method" });
    }
    
    const { concept, filename = "joopjurist-contract" } = req.body;
    console.log('Received concept length:', concept?.length);
    
    if (!concept) {
      return res.status(400).json({ error: "Concept is required" });
    }
    
    // Maak simpele tekst bestand (tijdelijk, om te testen)
    const textContent = `JoopJurist - Nederlandse Juridische Contracten
    
${concept}

Dit document is gegenereerd door JoopJurist.nl`;
    
    console.log('Sending text file...');
    
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.txt"`);
    res.send(textContent);
    
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ 
      error: "Server error", 
      details: error.message 
    });
  }
};
