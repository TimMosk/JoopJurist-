export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).send("Method not allowed");
    }
    
    const { concept, filename = "joopjurist-contract" } = req.body;
    if (!concept) {
      return res.status(400).json({ error: "Concept is required" });
    }

    // RTF content met betere formatting
    const rtfContent = `{\\rtf1\\ansi\\deff0
{\\fonttbl{\\f0\\fswiss\\fcharset0 Arial;}}
{\\colortbl;\\red37\\green99\\blue235;}
\\f0\\fs28\\cf1\\b JoopJurist\\cf0\\b0\\fs22  - Nederlandse Juridische Contracten\\par\\par
${concept.replace(/\*\*(.*?)\*\*/g, '\\b $1\\b0').replace(/\n/g, '\\par ')}\\par\\par
\\i Dit document is gegenereerd door JoopJurist.nl\\i0
}`;

    // Gebruik .doc extensie - dit opent automatisch in Word
    res.setHeader('Content-Type', 'application/msword');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.doc"`);
    res.send(rtfContent);
    
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: "Server error" });
  }
}
