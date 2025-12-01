// public/script.js
(() => {
  const modeRadios = document.querySelectorAll('input[name="mode"]');
  const textBox = document.getElementById("textBox");
  const fileBox = document.getElementById("fileBox");
  const urlBox = document.getElementById("urlBox");
  const textInput = document.getElementById("textInput");
  const fileInput = document.getElementById("fileInput");
  const urlInput = document.getElementById("urlInput");
  const taskSelect = document.getElementById("taskSelect");
  const generateBtn = document.getElementById("generateBtn");
  const clearBtn = document.getElementById("clearBtn");
  const loadingEl = document.getElementById("loading");
  const outputArea = document.getElementById("outputArea");
  const mindmapWrap = document.getElementById("mindmapWrap");
  const mindmapContainer = document.getElementById("mindmapContainer");
  const copyBtn = document.getElementById("copyBtn");
  const downloadBtn = document.getElementById("downloadBtn");
  const exportMindmapBtn = document.getElementById("exportMindmapBtn");

  modeRadios.forEach(r => r.addEventListener("change", () => {
    const m = document.querySelector('input[name="mode"]:checked').value;
    textBox.style.display = m === "text" ? "block" : "none";
    fileBox.style.display = m === "file" ? "block" : "none";
    urlBox.style.display = m === "url" ? "block" : "none";
  }));

  clearBtn.addEventListener("click", () => {
    textInput.value = "";
    urlInput.value = "";
    if (fileInput) fileInput.value = null;
    outputArea.innerText = "";
    mindmapContainer.innerHTML = "";
    mindmapWrap.style.display = "none";
  });

  copyBtn.addEventListener("click", async () => {
    const t = outputArea.innerText;
    if (!t) return alert("No output to copy");
    await navigator.clipboard.writeText(t);
    alert("Copied to clipboard");
  });

  downloadBtn.addEventListener("click", () => {
    const t = outputArea.innerText;
    if (!t) return alert("No output to download");
    const blob = new Blob([t], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "ai_output.txt";
    a.click();
    a.remove();
  });

  generateBtn.addEventListener("click", async () => {
    const mode = document.querySelector('input[name="mode"]:checked').value;
    const task = taskSelect.value;
    loadingEl.style.display = "block";
    outputArea.innerText = "";
    mindmapContainer.innerHTML = "";
    mindmapWrap.style.display = "none";

    const form = new FormData();
    form.append("task", task);

    if (mode === "text") {
      const t = textInput.value.trim();
      if (!t) { alert("Please enter text"); loadingEl.style.display="none"; return; }
      form.append("text", t);
    } else if (mode === "url") {
      const u = urlInput.value.trim();
      if (!u) { alert("Please enter URL"); loadingEl.style.display="none"; return; }
      form.append("url", u);
    } else {
      const f = fileInput.files[0];
      if (!f) { alert("Please choose a file"); loadingEl.style.display="none"; return; }
      form.append("file", f);
    }

    try {
      const resp = await fetch("/api/process", { method: "POST", body: form });
      if (!resp.ok) {
        const err = await resp.json().catch(()=>null);
        throw new Error(err?.error || resp.statusText || "Server error");
      }
      const j = await resp.json();

      if (task === "mindmap") {
        // server returns { mindmap, raw }
        const tree = j.mindmap || { name: "Root", children: [] };
        outputArea.innerText = j.raw || JSON.stringify(tree, null, 2);
        renderMindmap(tree);
        mindmapWrap.style.display = "block";
      } else if (task === "flashcards" || task === "qa") {
        // server returns parsed JSON -> show pretty JSON and text
        outputArea.innerText = JSON.stringify(j.data || j.raw || [], null, 2);
      } else {
        outputArea.innerText = j.output || j.raw || "No output returned";
      }

    } catch (e) {
      alert("Error: " + e.message);
      outputArea.innerText = "Error: " + (e.message || JSON.stringify(e));
    } finally {
      loadingEl.style.display = "none";
    }
  });

  // D3 rendering for mindmap (tree layout left->right)
  function renderMindmap(treeData) {
    mindmapContainer.innerHTML = ""; // clear
    const width = Math.max(800, mindmapContainer.clientWidth || 900);
    const height = 560;

    const svg = d3.create("svg")
      .attr("width", width)
      .attr("height", height);

    const g = svg.append("g").attr("transform", "translate(20,20)");
    const root = d3.hierarchy(treeData);
    const treeLayout = d3.tree().size([height - 40, width - 200]);
    treeLayout(root);

    // links
    g.selectAll(".link")
      .data(root.links())
      .join("path")
      .attr("class", "link")
      .attr("d", d => {
        return `M${d.source.y},${d.source.x}C${(d.source.y + d.target.y)/2},${d.source.x} ${(d.source.y + d.target.y)/2},${d.target.x} ${d.target.y},${d.target.x}`;
      })
      .attr("fill", "none")
      .attr("stroke", "#cbd5e1")
      .attr("stroke-width", 2);

    // nodes
    const node = g.selectAll(".node")
      .data(root.descendants())
      .join("g")
      .attr("class", "node")
      .attr("transform", d => `translate(${d.y},${d.x})`);

    node.append("circle")
      .attr("r", 22)
      .attr("fill", "#fff")
      .attr("stroke", "#2563eb")
      .attr("stroke-width", 2);

    node.append("text")
      .attr("dy", "0.35em")
      .attr("text-anchor", "middle")
      .text(d => d.data.name)
      .style("font-size", "12px")
      .style("pointer-events", "none");

    mindmapContainer.appendChild(svg.node());

    // simple pan & zoom
    const zoom = d3.zoom().scaleExtent([0.5, 2]).on("zoom", (event) => {
      svg.select("g").attr("transform", event.transform);
    });
    d3.select(svg.node()).call(zoom);
  }

  // export mindmap as PNG
  exportMindmapBtn.addEventListener("click", () => {
    const svg = mindmapContainer.querySelector("svg");
    if (!svg) return alert("No mindmap to export.");
    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svg);
    const canvas = document.createElement("canvas");
    canvas.width = svg.clientWidth;
    canvas.height = svg.clientHeight;
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.onload = () => {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(img, 0, 0);
      const a = document.createElement("a");
      a.download = "mindmap.png";
      a.href = canvas.toDataURL("image/png");
      a.click();
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);
  });

})();
