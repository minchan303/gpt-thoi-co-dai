import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import path from "path";
import fs from "fs";
import { OpenAI } from "openai";

dotenv.config();
const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.post("/api/process", async (req, res) => {
  try {
    const { type, content, mode } = req.body;

    const prompt = `
      You are an AI Study Assistant. Mode = ${mode}.
      Process the following input and return clean, structured text:

      INPUT:
      ${content}
    `;

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: prompt,
    });

    const result = response.output[0].content[0].text;
    res.json({ output: result });
  } catch (error) {
    console.error("ERROR:", error);
    res.status(500).json({ error: "Server error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
