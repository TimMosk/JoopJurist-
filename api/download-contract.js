const { Document, Packer, Paragraph, TextRun, AlignmentType } = require("docx");

const createSimpleStyles = () => ({
  default: {
    document: {
      run: { font: "Calibri", size: 22 }, // 11pt
    },
  },
  paragraphStyles: [
    {
      id: "title",
      name: "Title",
      run: { font: "Calibri", size: 32, bold: true, color: "2563eb" },
      paragraph: { spacing: { after: 400 }, alignment: AlignmentType.CENTER },
    },
    {
      id: "heading",
      name: "Heading",
      run: { font: "Calibri", size: 28, bold: true, color: "1f2937" },
      paragraph: { spacing: { before: 300, after: 200 } },
    },
  ],
});

function parseMarkdownToDocx(text) {
  const lines = text.split('\n');
  const children = [];
  
  for (const line of lines) {
    if (line.startsWith('**') && line.endsWith('**') && line.length > 4) {
      // Bold headers
      const textContent = line.slice(2, -2);
      if (textContent.includes('KOOPOVEREENKOMST')) {
        children.push(new Paragraph({
          text: textContent,
          style: "title",
        }));
      } else {
        children.push(new Paragraph({
          text: textContent,
          style: "heading",
        }));
      }
    } else if (line.trim() === '') {
      children.push(new Paragraph({ text: "" }));
    } else if (line.includes('**') && line.includes('**')) {
      // Inline bold
      const parts = line.split('**');
      const runs = [];
      for (let i = 0; i < parts.length; i++) {
        if (i % 2 === 0) {
          if (parts[i]) runs.push(new TextRun({ text: parts[i] }));
        } else {
          if (parts[i]) runs.push(new TextRun({ text: parts[i], bold: true }));
        }
      }
      children.push(new Paragraph({ children: runs }));
    } else {
      children.push(new Paragraph({ text: line }));
    }
  }
  
  return children;
}

function generateWordDocument(concept) {
  const children = parseMarkdownToDocx(concept);
  
  const doc = new Document({
    styles: createSimpleStyles(),
    sections: [{
      children: [
        new Paragraph({
          children: [
            new TextRun({ text: "JoopJurist", bold: true, color: "2563eb", size: 24 }),
            new TextRun({ text: " | Nederlandse Juridische Contracten", color: "6b7280", size: 20 }),
          ],
          spacing: { after: 600 },
          alignment: AlignmentType.CENTER,
        }),
        ...children,
        new Paragraph({ text: "", spacing: { before: 600 } }),
        new Paragraph({
          text: "Dit document is gegenereerd door JoopJurist.nl",
          alignment: AlignmentType.CENTER,
          run: { color: "6b7280", size: 18 },
        }),
      ]
    }]
  });
  
  return doc;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Use POST" });
    }
    
    const { concept, filename = "joopjurist-contract" } = req.body;
    
    if (!concept) {
      return res.status(400).json({ error: "Concept is required" });
    }
    
    console.log('Generating Word document...');
    const doc = generateWordDocument(concept);
    const buffer = await Packer.toBuffer(doc);
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.docx"`);
    res.send(buffer);
    
  } catch (error) {
    console.error('Word generation error:', error);
    res.status(500).json({ error: "Failed to generate document", details: error.message });
  }
};
