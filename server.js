import express from "express";
import multer from "multer";
import fetch from "node-fetch";
import fs from "fs";
import pdfParse from "pdf-parse";
import path from "path";
import { OpenAI } from "openai";

const app = express();
const upload = multer({ dest: "uploads/" });
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// -------------------- Extract text from file --------------------
async function extractText(filePath, mimetype) {
  if (mimetype === "application/pdf") {
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    return data.text;
  }

  return fs.readFileSync(filePath, "utf8");
}

// -------------------- AI GENERATION --------------------
async function generateOutput(task, input) {
  const promptMap = {
    summary: `Tóm tắt đoạn văn sau:\n${input}`,
    flashcards: `Tạo flashcards (Q/A) dựa trên nội dung sau:\n${input}`,
    bullet: `Tóm tắt nội dung dưới dạng bullet point:\n${input}`,
    qa: `Tạo bộ câu hỏi & trả lời dựa vào nội dung sau:\n${input}`,
    mindmap: `Chuyển nội dung này thành mindmap dưới dạng JSON tree. Format:
{
  "name": "Root",
  "children": [...]
}
Nội dung:\n${input}`
  };

  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    messages: [{ role: "user", content: promptMap[task] }],
  });

  return completion.choices[0].message.content;
}

// -------------------- Main API --------------------
app.post("/api/process", upload.single("file"), async (req, res) => {
  try {
    let text = "";

    if (req.file) {
      text = await extractText(req.file.path, req.file.mimetype);
      fs.unlinkSync(req.file.path);
    } else if (req.body.url) {
      const response = await fetch(req.body.url);
      text = await response.text();
    } else {
      text = req.body.text || "";
    }

    const task = req.body.task || "summary";
    const output = await generateOutput(task, text);

    res.json({ output });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(process.env.PORT || 3000, () =>
  console.log("SERVER RUNNING")
);
