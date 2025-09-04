import { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel } from "docx";

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
      const text = line.slice(2, -2);
      if (text.includes('KOOPOVEREENKOMST')) {
        children.push(new Paragraph({
          text: text,
          style: "title",
        }));
      } else {
        children.push(new Paragraph({
          text: text,
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

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Use POST" });
    }

    const { concept, filename = "koopovereenkomst" } = req.body;
    
    if (!concept) {
      return res.status(400).json({ error: "Concept is required" });
    }

    const doc = generateWordDocument(concept);
    const buffer = await Packer.toBuffer(doc);
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.docx"`);
    res.send(buffer);
    
  } catch (error) {
    console.error('Word generation error:', error);
    res.status(500).json({ error: "Failed to generate document" });
  }
}

// 3. Update je hoofdchat API (/api/chat.js) - voeg toe aan einde van handler:
// Voeg deze regel toe na het genereren van concept:
if (concept) {
  const downloadUrl = `/api/download-contract`;
  // Voeg toe aan response
  return res.status(200).json({
    say: llm.say || "Helder.",
    facts,
    ask: llm.ask || null,
    suggestions,
    concept,
    done,
    downloadUrl // Nieuwe field
  });
}

// 4. Frontend update - voeg toe aan je chat component waar je concept toont:
{concept && (
  <div className="concept-container">
    <div className="concept-text">
      {concept}
    </div>
    <div className="download-link" style={{ marginTop: '20px', textAlign: 'center' }}>
      <button 
        onClick={async () => {
          const response = await fetch('/api/download-contract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ concept, filename: 'koopovereenkomst' })
          });
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'koopovereenkomst.docx';
          a.click();
        }}
        style={{
          background: '#2563eb',
          color: 'white',
          padding: '8px 16px',
          border: 'none',
          borderRadius: '6px',
          cursor: 'pointer',
          fontSize: '14px'
        }}
      >
        📄 Download Word document
      </button>
    </div>
  </div>
)}
