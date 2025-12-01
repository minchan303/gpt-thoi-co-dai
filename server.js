import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import OpenAI from "openai";

dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.post("/api/process", async (req, res) => {
    const { text, task } = req.body;

    let prompt = "";

    if (task === "summary") {
        prompt = `Tóm tắt đoạn sau ở mức cô đọng, dễ hiểu:\n\n${text}`;
    }
    if (task === "flashcards") {
        prompt = `Tạo flashcard từ nội dung:\n\n${text}`;
    }
    if (task === "qa") {
        prompt = `Tạo danh sách câu hỏi & trả lời dựa trên:\n\n${text}`;
    }
    if (task === "mindmap") {
        prompt = `
        Tạo mindmap dưới dạng JSON có cấu trúc:
        { "name": "Chủ đề", "children": [ { "name": "...", "children": [...] } ] }
        Không giải thích thêm.
        Nội dung:
        ${text}`;
    }

    const completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
    });

    const output = completion.choices[0].message.content;

    try {
        res.json(JSON.parse(output));
    } catch {
        res.json(output);
    }
});

app.listen(3000, () => console.log("Server running on 3000"));
