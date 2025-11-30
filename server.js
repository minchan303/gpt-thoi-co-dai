require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const fetch = require('node-fetch');
const { JSDOM } = require('jsdom');
const os = require('os');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ extended: true, limit: '30mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const PORT = process.env.PORT || 3000;

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

async function extractFromPDF(filepath) {
  const data = fs.readFileSync(filepath);
  const parsed = await pdfParse(data);
  return parsed.text || '';
}
async function extractFromDocx(filepath) {
  const buffer = fs.readFileSync(filepath);
  const res = await mammoth.extractRawText({ buffer });
  return res.value || '';
}
async function extractFromUrl(url) {
  const resp = await fetch(url, { timeout: 15000 });
  if (!resp.ok) throw new Error('Failed to fetch URL: ' + resp.status);
  const html = await resp.text();
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const selectors = ['article','main','[role=main]','#content','.article','.entry-content','.post'];
  for (const s of selectors) {
    const el = doc.querySelector(s);
    if (el && el.textContent && el.textContent.trim().length > 200) return el.textContent.trim();
  }
  return doc.body ? doc.body.textContent.trim() : '';
}

async function extractFileSmart(file) {
  const ext = (file.originalname.split('.').pop() || '').toLowerCase();
  const filepath = file.path;
  try {
    if (ext === 'pdf') return await extractFromPDF(filepath);
    if (ext === 'docx') return await extractFromDocx(filepath);
    if (ext === 'txt') return fs.readFileSync(filepath,'utf8');
    if (['jpg','jpeg','png','webp','bmp','tiff'].includes(ext)) return '';
    try { return fs.readFileSync(filepath, 'utf8'); } catch (e) { return ''; }
  } finally {}
}

async function callOpenAI(messages, fileBase64=null, filename=null) {
  if (!OPENAI_KEY) throw new Error('OpenAI API key not configured on server.');
  const url = 'https://api.openai.com/v1/responses';
  const body = { model: OPENAI_MODEL, input: messages.join("\n\n") };
  if (fileBase64 && filename) {
    body.input += "\n\n[ATTACHED_FILE_NAME] " + filename + "\n[ATTACHED_FILE_BASE64]\n" + fileBase64 + "\n[END_ATTACHED_FILE]";
  }
  const res = await fetch(url, { method: 'POST', headers: { 'Authorization': 'Bearer ' + OPENAI_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) { const txt = await res.text(); throw new Error('OpenAI API error: ' + res.status + ' ' + txt); }
  const json = await res.json();
  if (json.output_text) return json.output_text;
  if (json.output && Array.isArray(json.output)) {
    let acc = '';
    for (const o of json.output) {
      if (o.type === 'message' && o.content) {
        for (const c of o.content) {
          if (c.type === 'output_text' && c.text) acc += c.text;
        }
      }
    }
    if (acc) return acc;
  }
  return JSON.stringify(json);
}

app.post('/api/process', upload.single('file'), async (req, res) => {
  try {
    let inputText = '';
    let fileBase64 = null;
    let filename = null;
    if (req.file) {
      filename = req.file.originalname;
      const ext = filename.split('.').pop().toLowerCase();
      if (['jpg','jpeg','png','webp','bmp','tiff'].includes(ext)) {
        const data = fs.readFileSync(req.file.path);
        fileBase64 = data.toString('base64');
      } else {
        inputText = await extractFileSmart(req.file);
      }
      fs.unlink(req.file.path, ()=>{});
    }
    if (!inputText && req.body.url) {
      try { inputText = await extractFromUrl(req.body.url); } catch(e){ inputText = ''; }
    }
    if (!inputText && req.body.text) inputText = req.body.text;
    if (!inputText && !fileBase64) return res.status(400).json({ error: 'No input found. Upload file or provide text/URL.' });
    const task = (req.body.task || 'summary').toLowerCase();
    let instruction = '';
    if (task === 'mindmap') instruction = 'Generate a hierarchical mindmap in Markdown nested lists.';
    else if (task === 'bullet') instruction = 'Generate clear bullet points.';
    else if (task === 'flashcards') instruction = 'Create up to 12 flashcards in JSON [{q:"",a:""}].';
    else if (task === 'qa') instruction = 'Create 8 short Q&A pairs for study.';
    else instruction = 'Summarize the content into concise study notes.';
    const messages = ['You are an expert study assistant.', instruction, inputText ? ('Content:\n' + inputText) : 'Content is attached in the uploaded file.'];
    const output = await callOpenAI(messages, fileBase64, filename);
    res.json({ ok: true, output });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, '0.0.0.0', () => {
  console.log('Server running on', PORT);
});