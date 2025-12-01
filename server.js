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
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const openai = new OpenAI({ apiKey: OPENAI_KEY });

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
    // images: no OCR included
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

function buildPrompt(task, content) {
  if (task === "mindmap") {
    return `
Convert the following content into a hierarchical JSON mindmap.

REQUIREMENTS:
- Output valid JSON only (no surrounding text, no explanations).
- Format:
{
 "name": "Root",
 "children": [
   { "name": "Main idea", "children": [...] }
 ]
}
- Use short labels (6-10 words max).
- Provide meaningful hierarchy (2-4 levels).
- Ensure JSON is parseable (no trailing commas).

CONTENT:
${content}
`;
  }
  if (task === "flashcards") {
    return `
Create up to 12 flashcards from the content. Output JSON array ONLY:
[
 { "q": "Question", "a": "Answer" },
 ...
]
CONTENT:
${content}
`;
  }
  if (task === "qa") {
    return `
Create 8 short Q&A pairs for studying. Output JSON array ONLY:
[
 { "q": "...", "a":"..." }
]
CONTENT:
${content}
`;
  }
  if (task === "bullet") {
    return `
Convert the content into concise bullet points. Return plain text with bullets (dash '-').
CONTENT:
${content}
`;
  }
  // default summary
  return `
Summarize the content into concise study notes with headings and bullets. Return plain text only.
CONTENT:
${content}
`;
}

app.post("/api/process", upload.single("file"), async (req, res) => {
  try {
    let content = "";

    if (req.file) {
      content = await extractFileText(req.file.path, req.file.originalname);
      fs.unlink(req.file.path, () => {});
    }

    if (!content && req.body.url) {
      content = await fetchUrlText(req.body.url);
    }

    if (!content && req.body.text) content = req.body.text;

    if (!content) return res.status(400).json({ error: "No input found. Provide file, URL, or text." });
    if (!OPENAI_KEY) return res.status(500).json({ error: "OPENAI_API_KEY not set on server." });

    const task = req.body.task || "summary";
    const prompt = buildPrompt(task, content);

    const response = await openai.responses.create({
      model: OPENAI_MODEL,
      input: prompt
    });

    // gather output text
    let outText = "";
    if (response.output_text) outText = response.output_text;
    else if (response.output && Array.isArray(response.output)) {
      for (const o of response.output) {
        if (o.type === "message" && o.content) {
          for (const c of o.content) {
            if (c.type === "output_text" && c.text) outText += c.text;
          }
        }
      }
    } else {
      outText = JSON.stringify(response);
    }

    // if JSON expected, attempt to extract and parse JSON
    if (["mindmap", "flashcards", "qa"].includes(task)) {
      let cleaned = outText.replace(/```json/g, "").replace(/```/g, "").trim();
      let parsed = null;
      try {
        parsed = JSON.parse(cleaned);
      } catch (e) {
        // try find first JSON substring
        const objMatch = cleaned.match(/(\{[\s\S]*\})/m);
        const arrMatch = cleaned.match(/(\[[\s\S]*\])/m);
        const candidate = objMatch ? objMatch[0] : (arrMatch ? arrMatch[0] : null);
        if (candidate) {
          try { parsed = JSON.parse(candidate); } catch (e2) { parsed = null; }
        }
      }
      if (task === "mindmap") {
        if (!parsed) {
          // fallback: create trivial tree
          parsed = { name: "Root", children: [{ name: outText.slice(0, 200) }] };
        }
        return res.json({ ok: true, raw: outText, mindmap: parsed });
      } else {
        if (!parsed) {
          return res.json({ ok: true, raw: outText, data: null, note: "Could not parse JSON" });
        }
        return res.json({ ok: true, raw: outText, data: parsed });
      }
    }

    // default text responses
    return res.json({ ok: true, output: outText });

  } catch (err) {
    console.error("Process error:", err);
    res.status(500).json({ error: err.message || "Processing failed" });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
