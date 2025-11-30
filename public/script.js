// public/assets/script.js
(function(){
  const textInput = document.getElementById("textInput");
  const fileInput = document.getElementById("fileInput");
  const urlInput = document.getElementById("urlInput");
  const outputArea = document.getElementById("outputArea");
  const loadingEl = document.getElementById("loading");
  const taskSelect = document.getElementById("taskSelect");

  // mode radio
  document.querySelectorAll('input[name="mode"]').forEach(r=>{
    r.addEventListener('change', ()=>{
      const v = document.querySelector('input[name="mode"]:checked').value;
      document.getElementById("textBox").style.display = v === "text" ? "block" : "none";
      document.getElementById("fileBox").style.display = v === "file" ? "block" : "none";
      document.getElementById("urlBox").style.display = v === "url" ? "block" : "none";
    });
  });

  document.getElementById("clearBtn").addEventListener("click", ()=>{
    textInput.value = "";
    urlInput.value = "";
    if (fileInput) fileInput.value = null;
    outputArea.innerText = "";
  });

  async function submit() {
    outputArea.innerText = "";
    loadingEl.style.display = "inline";
    const mode = document.querySelector('input[name="mode"]:checked').value;
    const task = taskSelect.value;

    const form = new FormData();
    form.append("task", task);

    if (mode === "text") {
      const t = textInput.value.trim();
      if (!t) { alert("Please enter text"); loadingEl.style.display = "none"; return; }
      form.append("text", t);
    } else if (mode === "file") {
      const f = fileInput.files[0];
      if (!f) { alert("Please choose file"); loadingEl.style.display = "none"; return; }
      form.append("file", f);
    } else {
      const u = urlInput.value.trim();
      if (!u) { alert("Please enter URL"); loadingEl.style.display = "none"; return; }
      form.append("url", u);
    }

    try {
      const resp = await fetch("/api/process", { method: "POST", body: form });
      if (!resp.ok) {
        const err = await resp.json().catch(()=>null);
        throw new Error(err?.error || resp.statusText || "Server error");
      }
      const j = await resp.json();
      outputArea.innerText = j.output || JSON.stringify(j, null, 2);
    } catch (e) {
      alert("Error: " + (e.message || e));
      outputArea.innerText = "Error: " + (e.message || JSON.stringify(e));
    } finally {
      loadingEl.style.display = "none";
    }
  }

  document.getElementById("generateBtn").addEventListener("click", submit);

})();
