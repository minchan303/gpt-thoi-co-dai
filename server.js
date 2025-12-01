import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import axios from "axios";
import { JSDOM } from "jsdom";
import OpenAI from "openai";

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

// ==============================
// 🔧 Multer: File Upload
// ==============================
const upload = multer({ dest: "uploads/" });

// ==============================
// 🔧 OpenAI Client
// ==============================
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// ==============================
// 🔥 Hàm gọi OpenAI
// ==============================
async function callOpenAI(prompt) {
    const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }]
    });

    return completion.choices[0].message.content;
}

// ==============================
// 📌 LẤY TEXT TỪ URL
// ==============================
async function fetchTextFromURL(url) {
    try {
        const res = await axios.get(url);
        const dom = new JSDOM(res.data);
        return dom.window.document.body.textContent.trim();
    } catch (err) {
        return "Không thể tải URL.";
    }
}

// ==============================
// 📌 TẠO MINDMAP JSON
// ==============================
function convertTextToMindmapJSON(text) {
    const sentences = text.split(".").slice(0, 8);

    return {
        name: "Root",
        children: sentences.map(s => ({
            name: s.trim().substring(0, 35),
            children: []
        }))
    };
}

// ==============================
// 📌 FILE → TEXT
// ==============================
async function extractTextFromFile(path, mimetype) {
    if (mimetype === "application/pdf") {
        const dataBuffer = fs.readFileSync(path);
        const data = await pdfParse(dataBuffer);
        return data.text;
    }

    if (mimetype.includes("word")) {
        const data = await mammoth.extractRawText({ path });
        return data.value;
    }

    return fs.readFileSync(path, "utf8");
}

// ==============================
// 📌 API PROCESS – TEXT / URL
// ==============================
app.post("/api/process", async (req, res) => {
    try {
        let rawText = "";
        const { text, url, type } = req.body;

        if (url) rawText = await fetchTextFromURL(url);
        else rawText = text;

        if (!rawText || rawText.length < 5)
            return res.json({ error: "Không có nội dung hợp lệ." });

        let output = "";

        if (type === "summary") {
            output = await callOpenAI(
                `Tóm tắt nội dung sau thành các đoạn rõ ràng:\n\n${rawText}`
            );
            return res.json({ result: output });
        }

        if (type === "flashcards") {
            output = await callOpenAI(
                `Tạo flashcards dạng Q/A từ nội dung sau:\n\n${rawText}`
            );
            return res.json({ result: output });
        }

        if (type === "qa") {
            output = await callOpenAI(
                `Tạo danh sách câu hỏi và câu trả lời từ văn bản sau:\n\n${rawText}`
            );
            return res.json({ result: output });
        }

        // Mindmap JSON → Front-end render D3.js
        if (type === "mindmap") {
            const tree = convertTextToMindmapJSON(rawText);
            return res.json({ mindmap: tree });
        }

        res.json({ error: "Loại đầu ra không hợp lệ." });

    } catch (err) {
        console.error(err);
        res.json({ error: "Lỗi xử lý." });
    }
});

// ==============================
// 📌 API UPLOAD FILE
// ==============================
app.post("/api/upload", upload.single("file"), async (req, res) => {
    try {
        const file = req.file;
        const outputType = req.body.type;

        const rawText = await extractTextFromFile(file.path, file.mimetype);
        fs.unlinkSync(file.path); // Xóa sau khi đọc

        let output = "";

        if (outputType === "summary") {
            output = await callOpenAI(`Tóm tắt nội dung:\n\n${rawText}`);
            return res.json({ result: output });
        }

        if (outputType === "flashcards") {
            output = await callOpenAI(`Tạo flashcards từ:\n\n${rawText}`);
            return res.json({ result: output });
        }

        if (outputType === "qa") {
            output = await callOpenAI(`Tạo Q&A từ:\n\n${rawText}`);
            return res.json({ result: output });
        }

        if (outputType === "mindmap") {
            const tree = convertTextToMindmapJSON(rawText);
            return res.json({ mindmap: tree });
        }

        res.json({ error: "Loại output không hợp lệ." });

    } catch (err) {
        console.error(err);
        res.json({ error: "Lỗi upload file." });
    }
});

// ==============================
// 📌 SERVER LISTEN
// ==============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server chạy tại cổng ${PORT}`));
