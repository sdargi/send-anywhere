const $=s=>document.querySelector(s);
const drop=$('#drop'); const fileInput=$('#file');
const uploadBtn=$('#uploadBtn'); const result=$('#result');
const progressWrap=$('#progressWrap'); const progressBar=$('#progressBar'); const progressText=$('#progressText');
const expires=$('#expires'); const maxDl=$('#maxDl');
const codeInput=$('#codeInput'); const checkBtn=$('#checkBtn'); const meta=$('#meta'); const downloadBtn=$('#downloadBtn');

// Drag & drop
drop.addEventListener('click',()=>fileInput.click());
drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('drag')});
drop.addEventListener('dragleave',()=>drop.classList.remove('drag'));
drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('drag');
   if(e.dataTransfer.files.length) fileInput.files=e.dataTransfer.files});

uploadBtn.addEventListener('click', ()=>{
  if(!fileInput.files[0]) return alert('Choose a file first');
  uploadFile(fileInput.files[0]);
});

checkBtn.addEventListener('click', async ()=>{
  const code = codeInput.value.trim();
  if(code.length!==6) return alert('Enter a 6-digit code');
  meta.textContent = 'Checking…';
  downloadBtn.classList.add('hidden');
  const r = await fetch('/api/file/'+encodeURIComponent(code));
  const data = await r.json();
  if(!r.ok){ meta.textContent = data.error || 'Not found'; return; }
  meta.innerHTML = `
    <div><strong>${data.original_name}</strong></div>
    <div>Size: ${formatBytes(data.size)} | Type: ${data.mime || 'unknown'}</div>
    <div>${expiryText(data)}</div>
  `;
  downloadBtn.onclick = ()=>{ window.location.href = '/download/'+code; };
  downloadBtn.classList.remove('hidden');
});

function uploadFile(file){
  const fd = new FormData();
  fd.append('file', file);
  fd.append('expiresMinutes', expires.value || '1440');
  fd.append('maxDownloads', maxDl.value || '0');

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/upload');
  xhr.upload.onprogress = (e)=>{
    if(!e.lengthComputable) return;
    progressWrap.classList.remove('hidden');
    const pct = Math.round((e.loaded/e.total)*100);
    progressBar.style.width = pct+'%';
    progressText.textContent = pct+'%';
  };
  xhr.onload = ()=>{
    if(xhr.status>=200 && xhr.status<300){
      const data = JSON.parse(xhr.responseText);
      const code = data.code;
      result.innerHTML = `
        <div>Share this code:</div>
        <div class="code">${code}</div>
        <button class="copy" onclick="navigator.clipboard.writeText('${code}')">Copy</button>
        <div>Expires: ${data.expiresAt ? new Date(data.expiresAt).toLocaleString() : 'Never'} | Max downloads: 
        ${data.maxDownloads || 'Unlimited'}</div>
      `;
    }else{
      try{ const err = JSON.parse(xhr.responseText); alert(err.error || 'Upload failed'); }catch{ alert('Upload failed'); }
    }
    setTimeout(()=>{progressWrap.classList.add('hidden'); progressBar.style.width='0%'; progressText.textContent='0%';}, 800);
  };
  xhr.onerror = ()=>{ alert('Network error'); };
  xhr.send(fd);
}

function formatBytes(bytes){
  if(bytes===0) return '0 B';
  const sizes=['B','KB','MB','GB','TB'];
  const i=Math.floor(Math.log(bytes)/Math.log(1024));
  return (bytes/Math.pow(1024,i)).toFixed(2)+' '+sizes[i];
}
function expiryText(data){
  if(!data.expires_at) return 'No expiry';
  const d = new Date(data.expires_at);
  return 'Expires at: '+d.toLocaleString();
}
