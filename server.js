import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import axios from "axios";
import { JSDOM } from "jsdom";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: "30mb" }));
app.use(express.urlencoded({ extended: true }));

// serve static frontend in /public
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({ storage: multer.memoryStorage() });

const OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_KEY) {
  console.warn("Warning: OPENAI_API_KEY is not set in environment.");
}

const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// --- Helpers ---
function chunkTextByChars(text, chunkSize = 1800) {
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
}

async function callOpenAIMessage(message, max_tokens = 1000, temp = 0.2) {
  if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY not configured on server.");
  try {
    const res = await axios.post(
      OPENAI_ENDPOINT,
      {
        model: MODEL,
        messages: [{ role: "user", content: message }],
        temperature: temp,
        max_tokens
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 120000
      }
    );

    if (res.data?.choices?.[0]?.message?.content) {
      return res.data.choices[0].message.content;
    } else {
      throw new Error("OpenAI returned unexpected response structure.");
    }
  } catch (err) {
    // try to provide helpful error message
    let msg = (err.response && err.response.data) ? JSON.stringify(err.response.data) : err.message;
    throw new Error("OpenAI API error: " + msg);
  }
}

// extract text from URL (simple)
async function extractTextFromURL(url) {
  try {
    const res = await axios.get(url, { timeout: 20000 });
    const dom = new JSDOM(res.data);
    const text = dom.window.document.body.textContent || "";
    return text.replace(/\s+/g, " ").trim().slice(0, 20000);
  } catch (err) {
    throw new Error("Cannot fetch URL: " + (err.message || err));
  }
}

// extract text from uploaded file buffer (pdf/docx/txt)
async function extractTextFromBuffer(file) {
  try {
    const mimetype = file.mimetype || "";
    if (mimetype === "application/pdf") {
      const data = await pdfParse(file.buffer);
      return (data.text || "").replace(/\s+/g, " ").trim();
    }
    if (mimetype.includes("word") || mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      return (result.value || "").replace(/\s+/g, " ").trim();
    }
    // fallback: treat as utf8 text
    return file.buffer.toString("utf8").replace(/\s+/g, " ").trim();
  } catch (err) {
    throw new Error("Failed to extract text from file: " + err.message);
  }
}

// convert merged summary -> simple mindmap JSON (shallow)
function textToMindmapJSON(title, mergedText) {
  // split into sentences (safe)
  const parts = mergedText.split(/[\.\n]+/).map(s => s.trim()).filter(Boolean).slice(0, 16);
  return {
    name: title || "Root",
    children: parts.map(p => ({ name: p.length > 60 ? p.slice(0, 57) + "..." : p }))
  };
}

// --- Main processing function using chunking to reduce tokens ---
async function processLargeText(text, task) {
  // 1) chunk -> summarize each chunk
  const chunks = chunkTextByChars(text, 1800);
  const summaries = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const p = `Bạn là một trợ lý tóm tắt. Hãy tóm tắt ngắn gọn đoạn văn sau (1-3 câu):\n\n${chunk}\n\nChỉ trả về phần tóm tắt, không thêm chú thích.`;
    const out = await callOpenAIMessage(p, 400);
    summaries.push(out.trim());
    // slight delay could be added if necessary
  }

  // 2) merge summaries and produce final output depending on task
  const merged = summaries.join("\n\n");

  if (task === "summary") {
    const finalPrompt = `Bạn là trợ lý tóm tắt. Từ các đoạn tóm tắt nhỏ dưới đây, tạo một tóm tắt đầy đủ, súc tích, bằng tiếng Việt (3-6 đoạn ngắn):\n\n${merged}`;
    const final = await callOpenAIMessage(finalPrompt, 1200);
    return { type: "text", text: final.trim() };
  }

  if (task === "flashcards") {
    const finalPrompt = `Từ nội dung dưới đây, tạo một danh sách flashcards (Q&A). Mỗi flashcard gồm câu hỏi ngắn và câu trả lời ngắn. Trả về dạng văn bản dễ đọc:\n\n${merged}`;
    const final = await callOpenAIMessage(finalPrompt, 1200);
    return { type: "text", text: final.trim() };
  }

  if (task === "qa") {
    const finalPrompt = `Từ nội dung dưới đây, tạo 10 câu hỏi quan trọng và câu trả lời tương ứng. Trả về định dạng rõ ràng:\n\n${merged}`;
    const final = await callOpenAIMessage(finalPrompt, 1200);
    return { type: "text", text: final.trim() };
  }

  if (task === "mindmap") {
    // create mindmap json from merged summary
    const tree = textToMindmapJSON("Mindmap", merged);
    return { type: "mindmap", mindmap: tree };
  }

  // fallback
  return { type: "text", text: merged };
}

// --- Routes ---

// simple alive check
app.get("/", (req, res) => {
  res.send("AI Study Assistant API Running.");
});

// POST /api/process  - handles paste text or URL (JSON body)
// body: { inputType: 'text'|'url', text: '...', url: '...', task: 'summary'|'mindmap'|'flashcards'|'qa' }
app.post("/api/process", async (req, res) => {
  try {
    const { inputType, text, url, task } = req.body;
    let rawText = "";

    if (inputType === "url") {
      if (!url) return res.status(400).json({ error: "Missing url" });
      rawText = await extractTextFromURL(url);
    } else {
      // default: text
      rawText = (text || "").toString();
    }

    if (!rawText || rawText.trim().length < 10) {
      return res.status(400).json({ error: "Input text too short or empty." });
    }

    const output = await processLargeText(rawText, task || "summary");
    return res.json(output);

  } catch (err) {
    console.error("PROCESS ERROR:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
});

// POST /api/upload - handles file upload (multipart) and type in body
// form-data: file, task
app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const task = req.body.task || "summary";
    const text = await extractTextFromBuffer(req.file);
    if (!text || text.trim().length < 5) {
      return res.status(400).json({ error: "Cannot extract text from file." });
    }
    const output = await processLargeText(text, task);
    return res.json(output);
  } catch (err) {
    console.error("UPLOAD ERROR:", err);
    return res.status(500).json({ error: err.message || "Server upload error" });
  }
});

// fallback for unknown routes (helps Render "Cannot GET /" cases if needed)
// but we already serve index.html from public; keep simple
app.use((req, res) => {
  res.status(404).send("Not Found");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AI Study Assistant server running on port ${PORT}`);
});
