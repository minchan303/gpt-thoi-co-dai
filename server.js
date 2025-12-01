// server.js
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

app.use(cors());
app.use(express.json({ limit: "30mb" }));
app.use(express.urlencoded({ extended: true }));
const __dirname = path.resolve();
app.use(express.static(path.join(__dirname, "public")));

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const openai = new OpenAI({ apiKey: OPENAI_KEY });

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
  const selectors = ["article", "main", "#content", ".article", ".post", ".entry-content"];
  for (const s of selectors) {
    const el = doc.querySelector(s);
    if (el && el.textContent && el.textContent.trim().length > 200) return el.textContent.trim();
  }
  return doc.body ? doc.body.textContent.trim() : "";
}

app.post("/api/process", upload.single("file"), async (req, res) => {
  try {
    let text = "";
    if (req.file) {
      const ext = (req.file.originalname.split(".").pop() || "").toLowerCase();
      const fp = req.file.path;
      if (ext === "pdf") text = await extractFromPDF(fp);
      else if (ext === "docx") text = await extractFromDocx(fp);
      else if (ext === "txt") text = fs.readFileSync(fp, "utf8");
      // images: leave empty (client can use image for OCR later)
      fs.unlink(fp, () => {});
    }
    if (!text && req.body.url) {
      try { text = await extractFromURL(req.body.url); } catch(e){ text = ""; }
    }
    if (!text && req.body.text) text = req.body.text;

    if (!text) return res.status(400).json({ error: "No input found. Upload file or provide text/URL." });
    if (!OPENAI_KEY) return res.status(500).json({ error: "OPENAI_API_KEY not set on server." });

    const task = (req.body.task || "summary").toLowerCase();
    let instruction = "";
    if (task === "mindmap") instruction = "Generate a hierarchical mindmap in Markdown nested lists (use dashes and indentation).";
    else if (task === "bullet") instruction = "Produce short, prioritized bullet points.";
    else if (task === "flashcards") instruction = "Create up to 12 flashcards in JSON array: [{q:'',a:''}].";
    else if (task === "qa") instruction = "Create 8 short Q&A pairs for revision.";
    else instruction = "Summarize into concise study notes with headings and bullet points.";

    const prompt = `You are an expert study assistant.\n${instruction}\n\nContent:\n${text}`;

    const resp = await openai.responses.create({
      model: OPENAI_MODEL,
      input: prompt
    });

    let output = "";
    if (resp.output_text) output = resp.output_text;
    else if (resp.output && Array.isArray(resp.output)) {
      for (const o of resp.output) {
        if (o.type === "message" && o.content) {
          for (const c of o.content) {
            if (c.type === "output_text" && c.text) output += c.text;
          }
        }
      }
    } else {
      output = JSON.stringify(resp);
    }

    res.json({ ok: true, output });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Server error" });
  }
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`Server running on ${PORT}`));
