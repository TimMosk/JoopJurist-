import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).send("Method not allowed");
    }
    
    const { concept, filename = "joopjurist-contract" } = req.body;
    if (!concept) {
      return res.status(400).json({ error: "Concept is required" });
    }

    // Maak nieuw Word document met JoopJurist huisstijl
    const doc = new Document({
      creator: "JoopJurist.nl",
      title: "Juridisch Contract",
      description: "Gegenereerd door JoopJurist AI",
      
      sections: [{
        properties: {},
        children: [
          // Header met JoopJurist branding
          new Paragraph({
            children: [
              new TextRun({
                text: "JoopJurist",
                bold: true,
                size: 32,
                color: "2563EB", // JoopJurist blauw
              }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 }
          }),
          
          new Paragraph({
            children: [
              new TextRun({
                text: "Nederlandse Juridische Contracten",
                size: 20,
                color: "6B7280",
                italics: true
              }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 }
          }),
          
          // Contract content
          ...processConceptForDocx(concept),
          
          // Footer
          new Paragraph({
            children: [
              new TextRun({
                text: "Dit document is gegenereerd door JoopJurist.nl",
                size: 16,
                color: "9CA3AF",
                italics: true
              }),
            ],
            alignment: AlignmentType.RIGHT,
            spacing: { before: 400 }
          }),
        ],
      }],
    });

    // Converteer naar buffer
    const buffer = await Packer.toBuffer(doc);
    
    // Stuur als download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFilename(filename)}.docx"`);
    res.setHeader('Content-Length', buffer.length);
    
    res.send(buffer);
    
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: "Server error bij het genereren van het Word document" });
  }
}

// Hulpfunctie om concept om te zetten naar Word paragraphs
function processConceptForDocx(concept) {
  const paragraphs = [];
  const lines = concept.split('\n');
  
  for (const line of lines) {
    if (line.trim() === '') {
      // Lege regel
      paragraphs.push(new Paragraph({ children: [new TextRun("")] }));
      continue;
    }
    
    // Check voor headers (## of #)
    if (line.startsWith('## ')) {
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: line.substring(3), bold: true, size: 24 })],
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 240, after: 120 }
      }));
    } else if (line.startsWith('# ')) {
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: line.substring(2), bold: true, size: 28 })],
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 240, after: 120 }
      }));
    } else {
      // Normale tekst met markdown parsing
      const textRuns = parseMarkdownToTextRuns(line);
      paragraphs.push(new Paragraph({
        children: textRuns,
        spacing: { after: 120 }
      }));
    }
  }
  
  return paragraphs;
}

// Parse markdown formattering naar TextRuns
function parseMarkdownToTextRuns(text) {
  const runs = [];
  let currentPos = 0;
  
  // Regex voor **bold** en *italic*
  const markdownRegex = /(\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
  let match;
  
  while ((match = markdownRegex.exec(text)) !== null) {
    // Voeg tekst voor de match toe
    if (match.index > currentPos) {
      runs.push(new TextRun({
        text: text.substring(currentPos, match.index)
      }));
    }
    
    // Voeg geformatteerde tekst toe
    if (match[0].startsWith('**')) {
      // Bold text
      runs.push(new TextRun({
        text: match[2],
        bold: true
      }));
    } else {
      // Italic text  
      runs.push(new TextRun({
        text: match[3],
        italics: true
      }));
    }
    
    currentPos = match.index + match[0].length;
  }
  
  // Voeg resterende tekst toe
  if (currentPos < text.length) {
    runs.push(new TextRun({
      text: text.substring(currentPos)
    }));
  }
  
  return runs.length > 0 ? runs : [new TextRun({ text })];
}

// Hulpfunctie om bestandsnamen veilig te maken
function sanitizeFilename(filename) {
  return filename
    .replace(/[^a-zA-Z0-9-_\s]/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase();
}
