import express from "express";
import cors from "cors";
import multer from "multer";
import pdfParse from "pdf-parse";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer();

// === Helper: call OpenAI safely ===
async function callOpenAI(prompt) {
    try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [{ role: "user", content: prompt }],
                max_tokens: 4000
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error("OpenAI API error:", errText);
            throw new Error("OpenAI failed: " + errText);
        }

        const data = await response.json();
        return data.choices[0].message.content;
    } catch (err) {
        console.error("OpenAI error:", err);
        throw err;
    }
}

// === Helper: fetch URL text ===
async function extractTextFromURL(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Failed to fetch URL");
        const html = await response.text();

        const cleaned = html.replace(/<[^>]+>/g, " ");
        return cleaned.substring(0, 18000);
    } catch (err) {
        console.error("URL fetch error:", err);
        throw new Error("Cannot read URL");
    }
}

// === Main Endpoint ===
app.post("/api/process", upload.single("file"), async (req, res) => {
    try {
        let inputText = "";

        // 1. Paste text
        if (req.body.type === "text") {
            inputText = req.body.text;
        }

        // 2. URL mode
        if (req.body.type === "url") {
            inputText = await extractTextFromURL(req.body.url);
        }

        // 3. PDF upload
        if (req.body.type === "file") {
            if (!req.file) throw new Error("File missing");
            const pdfData = await pdfParse(req.file.buffer);
            inputText = pdfData.text;
        }

        if (!inputText || inputText.trim().length === 0) {
            throw new Error("Input text empty");
        }

        let prompt = "";
        const mode = req.body.mode;

        if (mode === "summary") {
            prompt = `Tóm tắt đoạn văn sau một cách ngắn gọn, rõ ràng:\n\n${inputText}`;
        }

        if (mode === "flashcards") {
            prompt = `Tạo flashcards dạng Q&A từ nội dung sau:\n\n${inputText}`;
        }

        if (mode === "qa") {
            prompt = `Tạo bộ câu hỏi và trả lời (Q&A) dựa trên nội dung sau:\n\n${inputText}`;
        }

        if (mode === "mindmap") {
            prompt = `
Tạo JSON mindmap dạng cây. Format:
{
 "name": "Root",
 "children": [ { "name": "...", "children": [...] } ]
}
Nội dung: ${inputText}
`;
        }

        const output = await callOpenAI(prompt);
        res.json({ result: output });

    } catch (err) {
        console.error("SERVER ERROR:", err);
        res.json({ error: err.message });
    }
});

// === Start local OR Render ===
app.get("/", (req, res) => res.send("AI Study Assistant API Running."));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port", PORT));
