// server.js
import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import fetch from "node-fetch";
import { JSDOM } from "jsdom";
import OpenAI from "openai";

dotenv.config();

const app = express();
const upload = multer({ dest: "uploads/" });

app.use(cors());
app.use(express.json({ limit: "30mb" }));
app.use(express.urlencoded({ extended: true }));
const __dirname = path.resolve();
app.use(express.static(path.join(__dirname, "public")));

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const openai = new OpenAI({ apiKey: OPENAI_KEY });

// helpers
async function extractFileText(filePath, originalName = "") {
  const ext = (originalName.split(".").pop() || "").toLowerCase();
  try {
    if (ext === "pdf") {
      const data = fs.readFileSync(filePath);
      const parsed = await pdfParse(data);
      return parsed.text || "";
    }
    if (ext === "docx") {
      const buffer = fs.readFileSync(filePath);
      const res = await mammoth.extractRawText({ buffer });
      return res.value || "";
    }
    if (ext === "txt") {
      return fs.readFileSync(filePath, "utf8");
    }
    // images: no OCR included (could add Tesseract later)
    return "";
  } catch (e) {
    return "";
  }
}

async function fetchUrlText(url) {
  try {
    const resp = await fetch(url, { timeout: 15000 });
    const html = await resp.text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    const selectors = ["article", "main", "[role=main]", "#content", ".article", ".entry-content", ".post"];
    for (const s of selectors) {
      const el = doc.querySelector(s);
      if (el && el.textContent && el.textContent.trim().length > 200) return el.textContent.trim();
    }
    return doc.body ? doc.body.textContent.trim() : "";
  } catch (e) {
    return "";
  }
}

function buildPromptForTask(task, content) {
  if (task === "mindmap") {
    return `
Convert the following content into a hierarchical JSON mindmap.

REQUIREMENTS:
- Output valid JSON only (no explanation).
- Use this structure:
{
  "name": "Root",
  "children": [
    { "name": "Main idea", "children": [...] }
  ]
}
- Use short labels (max 6-8 words per node).
- Ensure the JSON parses (no trailing commas).
CONTENT:
${content}
`;
  }

  if (task === "flashcards") {
    return `
Create up to 12 flashcards from the content. Output JSON array ONLY, format:
[
  { "q": "Question text", "a": "Answer text" },
  ...
]
Content:
${content}
`;
  }

  if (task === "qa") {
    return `
Create 8 short Q&A pairs for study. Output JSON array ONLY:
[
  { "q":"...", "a":"..."}
]
Content:
${content}
`;
  }

  if (task === "bullet") {
    return `
Convert the content into clear bullet points (short lines). Return plain text (bulleted lines).
Content:
${content}
`;
  }

  // default summary
  return `
Summarize the content into concise study notes with headings and bullet points. Return plain text only.
Content:
${content}
`;
}

// main API
app.post("/api/process", upload.single("file"), async (req, res) => {
  try {
    let text = "";

    // 1) file uploaded
    if (req.file) {
      text = await extractFileText(req.file.path, req.file.originalname);
      // cleanup
      fs.unlink(req.file.path, () => {});
    }

    // 2) url
    if (!text && req.body.url) {
      text = await fetchUrlText(req.body.url);
    }

    // 3) direct text
    if (!text && req.body.text) text = req.body.text;

    if (!text) return res.status(400).json({ error: "No input found. Upload file, provide URL or paste text." });
    if (!OPENAI_KEY) return res.status(500).json({ error: "OPENAI_API_KEY not set on server." });

    const task = req.body.task || "summary";
    const prompt = buildPromptForTask(task, text);

    // call OpenAI Responses API
    const response = await openai.responses.create({
      model: OPENAI_MODEL,
      input: prompt,
    });

    // get textual output
    let outputText = "";
    if (response.output_text) outputText = response.output_text;
    else if (response.output && Array.isArray(response.output)) {
      for (const o of response.output) {
        if (o.type === "message" && o.content) {
          for (const c of o.content) {
            if (c.type === "output_text" && c.text) outputText += c.text;
          }
        }
      }
    } else {
      outputText = JSON.stringify(response, null, 2);
    }

    // If task produces JSON outputs (mindmap/flashcards/qa), try to parse it.
    if (["mindmap", "flashcards", "qa"].includes(task)) {
      // remove triple backticks if any
      let cleaned = outputText.replace(/```json/g, "").replace(/```/g, "").trim();
      // Try parse, if fail, attempt to extract first JSON substring
      let parsed = null;
      try {
        parsed = JSON.parse(cleaned);
      } catch (e) {
        // try to find first { ... } or [ ... ]
        const firstObj = cleaned.match(/(\{[\s\S]*\})/m);
        const firstArr = cleaned.match(/(\[[\s\S]*\])/m);
        const candidate = firstObj ? firstObj[0] : (firstArr ? firstArr[0] : null);
        if (candidate) {
          try { parsed = JSON.parse(candidate); } catch (e2) { parsed = null; }
        }
      }
      // If parse failed for mindmap, wrap plain text as single child (fallback)
      if (task === "mindmap") {
        if (!parsed) {
          parsed = { name: "Root", children: [{ name: outputText.substring(0, 300) }] };
        }
        return res.json({ ok: true, raw: outputText, mindmap: parsed });
      } else {
        // flashcards or qa
        if (!parsed) {
          return res.json({ ok: true, raw: outputText, data: null, note: "Could not parse JSON from model." });
        }
        return res.json({ ok: true, raw: outputText, data: parsed });
      }
    }

    // default: summary or bullet -> return text
    return res.json({ ok: true, output: outputText });

  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: err.message || "Processing failed" });
  }
});

// fallback serve index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
