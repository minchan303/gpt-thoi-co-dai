import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import fetch from "node-fetch";
import { JSDOM } from "jsdom";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const upload = multer({ dest: "uploads/" });

// middleware
app.use(cors());
app.use(express.json({ limit: "30mb" }));
app.use(express.urlencoded({ extended: true }));

// static folder
const __dirname = path.resolve();
app.use(express.static(path.join(__dirname, "public")));

// OpenAI
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const openai = new OpenAI({ apiKey: OPENAI_KEY });

/* ========== Helper Functions ========== */

async function extractFromPDF(file) {
  const data = fs.readFileSync(file);
  const parsed = await pdfParse(data);
  return parsed.text || "";
}

async function extractFromDocx(file) {
  const buffer = fs.readFileSync(file);
  const res = await mammoth.extractRawText({ buffer });
  return res.value || "";
}

async function extractFromURL(url) {
  const resp = await fetch(url, { timeout: 15000 });
  const html = await resp.text();
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  // Try common article containers
  const selectors = ["article", "main", "#content", ".article", ".post", ".entry-content"];
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    if (el && el.textContent.length > 200) return el.textContent.trim();
  }

  return doc.body ? doc.body.textContent.trim() : "";
}

/* ========== API Route ========== */

app.post("/api/process", upload.single("file"), async (req, res) => {
  try {
    let text = "";

    // file
    if (req.file) {
      const ext = req.file.originalname.split(".").pop().toLowerCase();
      const filePath = req.file.path;

      if (ext === "pdf") text = await extractFromPDF(filePath);
      else if (ext === "docx") text = await extractFromDocx(filePath);
      else if (ext === "txt") text = fs.readFileSync(filePath, "utf8");

      fs.unlink(filePath, () => {});
    }

    // URL
    if (!text && req.body.url) {
      text = await extractFromURL(req.body.url);
    }

    // Text
    if (!text && req.body.text) {
      text = req.body.text;
    }

    if (!text) return res.status(400).json({ error: "Không tìm thấy nội dung để xử lý." });

    const task = req.body.task || "summary";

    let instruction = "";
    if (task === "summary") instruction = "Summarize the text.";
    if (task === "mindmap") instruction = "Create a hierarchical mindmap in Markdown.";
    if (task === "bullet") instruction = "Convert the text to clean bullet points.";
    if (task === "flashcards") instruction = "Create 12 flashcards in JSON format [{q:'',a:''}].";
    if (task === "qa") instruction = "Generate 8 Q&A pairs for study.";

    const prompt = `You are an expert AI Study Assistant.\nTask: ${task}\nInstructions: ${instruction}\n\nContent:\n${text}`;

    if (!OPENAI_KEY)
      return res.status(500).json({ error: "OPENAI_API_KEY chưa được thiết lập." });

    const response = await openai.responses.create({
      model: OPENAI_MODEL,
      input: prompt
    });

    let output = "";

    if (response.output_text) {
      output = response.output_text;
    } else if (response.output) {
      for (const block of response.output) {
        if (block.type === "message") {
          for (const c of block.content) {
            if (c.type === "output_text") output += c.text;
          }
        }
      }
    }

    res.json({ ok: true, output });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// fallback
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server chạy tại PORT ${PORT}`));
