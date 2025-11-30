async function submitProcess() {
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const task = document.getElementById('taskSelect').value;
  const out = document.getElementById('outputArea');
  const loading = document.getElementById('loading');
  out.innerText = ''; loading.style.display = 'block';
  const form = new FormData();
  form.append('task', task);
  if (mode === 'text') {
    const t = document.getElementById('textInput').value.trim();
    if (!t) { alert('Please enter text'); loading.style.display='none'; return; }
    form.append('text', t);
  } else if (mode === 'file') {
    const f = document.getElementById('fileInput').files[0];
    if (!f) { alert('Please choose a file'); loading.style.display='none'; return; }
    form.append('file', f);
  } else {
    const u = document.getElementById('urlInput').value.trim();
    if (!u) { alert('Please enter URL'); loading.style.display='none'; return; }
    form.append('url', u);
  }
  try {
    const resp = await fetch('/api/process', { method: 'POST', body: form });
    if (!resp.ok) { const e = await resp.json().catch(()=>null); throw new Error(e?.error || 'Server error'); }
    const j = await resp.json();
    out.innerText = j.output || JSON.stringify(j, null, 2);
  } catch (err) {
    alert('Error: ' + (err.message || err));
  } finally {
    loading.style.display = 'none';
  }
}
document.getElementById('generateBtn').addEventListener('click', submitProcess);
document.getElementById('clearBtn').addEventListener('click', ()=>{ document.getElementById('textInput').value=''; document.getElementById('urlInput').value=''; document.getElementById('fileInput').value=null; document.getElementById('outputArea').innerText=''; });
function copyOutput(){ const t=document.getElementById('outputArea').innerText; if(!t) return alert('No output'); navigator.clipboard.writeText(t).then(()=>alert('Copied')); }
function downloadOutput(){ const t=document.getElementById('outputArea').innerText; if(!t) return alert('No output'); const blob=new Blob([t],{type:'text/plain'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='ai_output.txt'; document.body.appendChild(a); a.click(); a.remove(); }
