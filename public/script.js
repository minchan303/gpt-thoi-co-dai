(function () {

const textInput = document.getElementById("textInput");
const urlInput = document.getElementById("urlInput");
const fileInput = document.getElementById("fileInput");
const outputArea = document.getElementById("outputArea");
const loading = document.getElementById("loading");
const taskSelect = document.getElementById("taskSelect");

document.querySelectorAll('input[name="mode"]').forEach(r => {
  r.addEventListener("change", () => {
    let mode = document.querySelector('input[name="mode"]:checked').value;
    document.getElementById("textBox").style.display = mode === "text" ? "block" : "none";
    document.getElementById("fileBox").style.display = mode === "file" ? "block" : "none";
    document.getElementById("urlBox").style.display = mode === "url" ? "block" : "none";
  });
});

document.getElementById("clearBtn").addEventListener("click", () => {
  textInput.value = "";
  urlInput.value = "";
  if (fileInput) fileInput.value = "";
  outputArea.innerText = "";
});

document.getElementById("generateBtn").addEventListener("click", async () => {
  const mode = document.querySelector('input[name="mode"]:checked').value;

  const form = new FormData();
  form.append("task", taskSelect.value);

  if (mode === "text") form.append("text", textInput.value);
  if (mode === "url") form.append("url", urlInput.value);
  if (mode === "file") form.append("file", fileInput.files[0]);

  loading.style.display = "block";
  outputArea.innerText = "";

  try {
    const resp = await fetch("/api/process", { method: "POST", body: form });
    const data = await resp.json();
    outputArea.innerText = data.output || JSON.stringify(data, null, 2);

  } catch (e) {
    outputArea.innerText = "Error: " + e.message;
  }

  loading.style.display = "none";
});

})();
