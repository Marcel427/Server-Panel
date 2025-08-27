// Main client script for dashboard (cleaned, console removed)
document.addEventListener('DOMContentLoaded', () => {
    // Elements
    const loginForm = document.getElementById('loginForm');
    const username = document.getElementById('username');
    const password = document.getElementById('password');
    const loginScreen = document.getElementById('loginScreen');
    const dashboard = document.getElementById('dashboard');
    const cpuVal = document.getElementById('cpuVal');
    const memVal = document.getElementById('memVal');
    const uptimeVal = document.getElementById('uptimeVal');
    const activityList = document.getElementById('activityList');
    const featureForm = document.getElementById('featureForm');
    const toastEl = document.getElementById('toast');
    const tabs = document.querySelectorAll('.sidebar nav li');
    const tabPanels = document.querySelectorAll('.tab');
    const metricsDetails = document.getElementById('metricsDetails');
    const processListEl = document.getElementById('processList');
    const settingsForm = document.getElementById('settingsForm');
    const maxActivityInput = document.getElementById('maxActivity');

    let serverConfig = { features: ['monitoring'], pm2: { enabled: false, manage: false }, maxActivity: 7 };

    function showToast(msg, timeout = 2500){
        if(!toastEl) return;
        toastEl.textContent = msg;
        toastEl.classList.remove && toastEl.classList.remove('hidden');
        clearTimeout(toastEl._t);
        toastEl._t = setTimeout(()=> toastEl.classList && toastEl.classList.add('hidden'), timeout);
    }

    function showTab(name){
        tabPanels.forEach(p => p.classList.add('hidden'));
        const el = document.getElementById('tab-' + name);
        if(el) el.classList.remove('hidden');
        const h3 = document.querySelector('.topbar .left h3'); if(h3) h3.textContent = name.charAt(0).toUpperCase() + name.slice(1);
    }

    function getToken(){ return localStorage.getItem('sp_token'); }

    function authFetch(url, opts){
        opts = opts || {}; opts.headers = opts.headers || {};
        const token = getToken(); if(token) opts.headers['x-auth-token'] = token;
        return fetch(url, opts);
    }

    function updateProfileDisplay(user){
        const p = document.getElementById('profileDisplay'); if(!p) return;
        if(user) p.textContent = user.displayName || user.username; else { const uname = localStorage.getItem('sp_username'); p.textContent = uname ? uname : 'Not signed in'; }
    }

    tabs.forEach(li => li.addEventListener('click', ()=>{
        tabs.forEach(x=>x.classList.remove('active')); li.classList.add('active');
        const tab = li.dataset.tab || 'overview'; showTab(tab);
        if(tab === 'metrics') fetchMetricsDetails();
        if(tab === 'metrics' && !chartsInit){ initCharts(); chartsInit=true; setInterval(fetchAndPush, 3000); }
        if(tab === 'processes') loadProcesses();
        if(tab === 'users') loadUsers();
        if(tab === 'backups') loadBackups();
        if(tab === 'notifications') fetchNotifications();
        if(tab === 'audit') fetchAudit();
    }));

    loginForm && loginForm.addEventListener('submit', (e) => {
        e.preventDefault(); const u = username.value.trim(); const p = password.value.trim();
        if(!u || !p){ showToast('Enter username and password'); return; }
        fetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ username:u, password:p }) })
            .then(r=> r.json())
            .then(j=>{
                if(j.ok){ localStorage.setItem('sp_token', j.token); localStorage.setItem('sp_username', u); showToast('Signed in');
                    loginScreen && loginScreen.classList && loginScreen.classList.add('hidden'); dashboard && dashboard.classList && dashboard.classList.remove('hidden');
                    startMetrics(); loadActivity(); loadConfig(); updateProfileDisplay(j.user);
                } else { showToast('Sign in failed'); }
            }).catch(()=> showToast('Sign in failed (server)'));
    });

    let startTime = Date.now(); let metricsTimer;
    function startMetrics(){ updateOnce(); metricsTimer = setInterval(updateOnce, 1500); }

    async function updateOnce(){
        try{
            const res = await fetch('/api/metrics');
            if(!res.ok) throw new Error('no api');
            const data = await res.json();
            cpuVal.textContent = data.cpu; memVal.textContent = data.memory; uptimeVal.textContent = msToUptime((data.uptime || 0)*1000);
        }catch(err){
            const cpu = (Math.random()*60 + 10).toFixed(0) + '%'; const mem = (Math.random()*50 + 20).toFixed(0) + '%';
            const up = msToUptime(Date.now() - startTime); cpuVal.textContent = cpu; memVal.textContent = mem; uptimeVal.textContent = up;
            if(Math.random() > 0.75) pushActivity(randomActivity());
        }
    }

    async function fetchMetricsDetails(){
        try{
            const res = await fetch('/api/metrics'); if(!res.ok) throw new Error('no api');
            const d = await res.json();
            const uptimeStr = msToUptime((d.uptime || 0) * 1000);
            metricsDetails.textContent = `CPU: ${d.cpu} · Memory: ${d.memory} · Uptime: ${uptimeStr}`;
            if(d.disk){ const dv = document.getElementById('diskVal'); if(dv) dv.textContent = `${d.disk.usedGb || '?'}GB (${d.disk.usedPct || '?'}%)`; const bar = document.getElementById('diskBar'); if(bar && d.disk.usedPct) bar.style.width = String(d.disk.usedPct) + '%'; }
        }catch(e){ if(metricsDetails) metricsDetails.textContent = 'Metrics not available'; }
    }

    function msToUptime(ms){ const s = Math.floor(ms/1000); const h = Math.floor(s/3600); const m = Math.floor((s%3600)/60); const sec = s%60; if(h>0) return `${h}h ${m}m`; if(m>0) return `${m}m ${sec}s`; return `${sec}s`; }

    function loadActivity(){
        fetch('/api/activity').then(r=>r.json()).then(list=>{ activityList.innerHTML = ''; list.forEach(i => pushActivity(i.msg, i.ts)); }).catch(()=>{
            activityList.innerHTML = ''; const items = ['Server started','Backup completed','New user created','Service restarted','Certificate renewed']; items.forEach(i=> pushActivity(i));
        });
    }

    // simple HTML escape helper to avoid markup injection in activity messages
    function escapeHtml(str){ 
        if(!str && str!==0) return ''; 
        return String(str).replace(/[&<>"']/g, 
            function(ch){ 
                return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]); 
            }
        ); 
    }

    function pushActivity(text, ts){
        if(!activityList) return;
        const time = ts ? new Date(ts) : new Date();
        const h = time.getHours();
        const m = String(time.getMinutes()).padStart(2,'0');
        const li = document.createElement('li');
        li.innerHTML = `<span class="time">[${h}:${m}]</span> - <span class="msg">${escapeHtml(text)}</span>`;
        activityList.insertBefore(li, activityList.firstChild);
        const max = serverConfig.maxActivity || 7; while(activityList.children.length > max) activityList.removeChild(activityList.lastChild);
    }

    function randomActivity(){ const arr = ['Auto-scaler triggered','High CPU alert','New SSH key added','Password changed','Disk cleanup finished']; return arr[Math.floor(Math.random()*arr.length)]; }

    featureForm && featureForm.addEventListener('submit', (e)=>{
        e.preventDefault(); const chosen = Array.from(featureForm.elements['features']).filter(i=>i.checked).map(i=>i.value); localStorage.setItem('sp_features', JSON.stringify(chosen));
        fetch('/api/features', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ features: chosen }) })
            .then(r=> r.json().then(j=> showToast('Features saved: ' + (chosen.join(', ') || 'none')) ).catch(()=> showToast('Features saved (local)')) ).catch(()=> showToast('Features saved (local)'));
        const sp = document.getElementById('setupPanel'); if(sp && sp.classList) sp.classList.add('hidden');
    });

    function loadConfig(){ fetch('/api/config').then(r=>r.json()).then(cfg=>{ serverConfig = cfg; if(maxActivityInput) maxActivityInput.value = cfg.maxActivity || 7; }).catch(()=>{}); }

    settingsForm && settingsForm.addEventListener('submit', (e)=>{
        attachSettingsEvents();
        e.preventDefault(); const max = parseInt(maxActivityInput.value, 10) || 7;
        fetch('/api/config', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ maxActivity: max }) })
            .then(r=>r.json()).then(()=>{ serverConfig.maxActivity = max; showToast('Settings saved'); }).catch(()=>{ serverConfig.maxActivity = max; showToast('Settings saved (local)'); });
    });

    async function loadProcesses(){
        if(!processListEl) return; processListEl.textContent = 'Loading...';
        try{
            const res = await authFetch('/api/processes'); if(!res.ok) throw new Error('pm2 not enabled');
            const data = await res.json(); if(!data.ok) throw new Error('pm2 error'); renderProcessList(data.processes || []);
        }catch(e){ processListEl.innerHTML = '<div class="muted">No service available.</div>'; }
    }

    // Notifications (visible to all; content varies by role)
    async function fetchNotifications(){
        const el = document.getElementById('notificationsArea'); if(!el) return; el.textContent = 'Loading...';
        try{
            const res = await authFetch('/api/notifications'); if(!res.ok) throw new Error('no');
            const j = await res.json(); renderNotifications(j);
        } catch(e) { el.textContent = 'Notifications unavailable'; }
    }

    function renderNotifications(data){
        const el = document.getElementById('notificationsArea'); if(!el) return;
        if(!data) { el.textContent = 'No notifications'; return; }
        if(data.role === 'admin'){
            const html = [];
            html.push('<ul>' + (data.activity||[]).map(a=>`<li>[${new Date(a.ts).getHours()}:${String(new Date(a.ts).getMinutes()).padStart(2,'0')}] - ${escapeHtml(a.msg)}</li>`).join('') + '</ul>');
            el.innerHTML = html.join('');
        } else if(data.role === 'user'){
            el.innerHTML = `<div>No notifications for users</div>`;
        } else {
            el.innerHTML = `<div>No notifications available</div>`;
        }
    }

    function logout() {
        // Clear stored auth data
        localStorage.removeItem('sp_token');
        localStorage.removeItem('sp_username');

        // Hide dashboard
        const dashboard = document.getElementById('dashboard');
        if (dashboard && dashboard.classList) dashboard.classList.add('hidden');

        // Show login screen
        const loginScreen = document.getElementById('loginScreen');
        if (loginScreen && loginScreen.classList) loginScreen.classList.remove('hidden');

        // Optionally clear login inputs
        const username = document.getElementById('username');
        const password = document.getElementById('password');
        if (username) username.value = '';
        if (password) password.value = '';

        showToast('Logged out');
    }

    // Wire the logout button
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);
    
    // Convert bytes → human-readable string
    function formatBytes(bytes) {
        if (bytes === 0) return "";
        const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return (bytes / Math.pow(1024, i)).toFixed(2) + " " + sizes[i];
    }

    fetch('/api/config')
        .then(r => r.json())
        .then(cfg => {
            const startPath = cfg.startFolder || '';
            fetchFiles(path = startPath);
        });

    async function fetchFiles(path = '') {
        const el = document.getElementById("filesArea");
        el.textContent = "Loading...";
        try {
            const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
            const data = await res.json();
            renderFiles(data);
        } catch(e) {
            console.error(e);
            el.textContent = "Files unavailable";
        }
    }

    let currentPath = ""; // track current folder path relative to BASE_DIR

        async function renderFiles(data) {
            const el = document.getElementById('filesArea'); 
            if(!el) return;

            if(!data || !data.files || !data.files.length) { 
                el.textContent = 'No files'; 
                updateBackButton();
                return; 
            }

            currentPath = data.path || "";

            const html = ['<ul class="file-list">'];
            data.files.forEach(f => {
                const fullPath = currentPath ? `${currentPath}/${f.name}` : f.name;

                if(f.isDir){
                    html.push(`
                        <li class="folder" data-path="${fullPath}">
                            <span class="name">${f.name}</span>
                            <div class="actions">
                                <button class="menu-btn">⋮</button>
                                <div class="menu hidden">
                                    <div class="menu-item open">Open</div>
                                    <div class="menu-item rename">Rename</div>
                                    <div class="menu-item delete">Delete</div>
                                </div>
                            </div>
                        </li>`);
                } else {
                    html.push(`
                        <li class="file" data-path="${fullPath}">
                            <span class="name">${f.name}</span>
                            <span class="size">${(f.size/1024/1024).toFixed(2)} MB</span>
                            <div class="actions">
                                <button class="menu-btn">⋮</button>
                                <div class="menu hidden">
                                    <div class="menu-item download">Download</div>
                                    <div class="menu-item rename">Rename</div>
                                    <div class="menu-item edit">Edit</div>
                                    <div class="menu-item delete">Delete</div>
                                </div>
                            </div>
                        </li>`);
                }
            });
            html.push('</ul>');
            el.innerHTML = html.join('');
            updateBackButton();

            // --- Folder/File click ---
            el.querySelectorAll('li').forEach(li => {
                li.addEventListener('click', e => {
                    // Ignore clicks on menu or menu button
                    if(e.target.closest('.menu') || e.target.closest('.menu-btn')) return;

                    if(li.classList.contains('folder')){
                        fetchFiles(li.dataset.path);
                    } else {
                        openEditor(li.dataset.path);
                    }
                });
            });

            // --- Menu button toggle ---
            el.querySelectorAll('.menu-btn').forEach(btn => {
                btn.addEventListener('click', e => {
                    e.stopPropagation();
                    const menu = btn.nextElementSibling;
                    document.querySelectorAll('.menu').forEach(m => m.classList.add('hidden'));
                    menu.classList.toggle('hidden');
                });
            });

            // --- Menu actions ---
            el.querySelectorAll('.menu-item').forEach(item => {
                item.addEventListener('click', e => {
                    e.stopPropagation();
                    const li = item.closest('li');
                    const path = li.dataset.path;

                    if(item.classList.contains('download')){
                        window.open(`/api/files/download?path=${encodeURIComponent(path)}`, '_blank');
                    }
                    if(item.classList.contains('edit')){
                        openEditor(path);
                    }
                    if(item.classList.contains('open')){
                        fetchFiles(path);
                    }
                    if(item.classList.contains('delete')){
                        handleDelete(li.dataset.path);
                    }
                    if(item.classList.contains('rename')) handleRename(li.dataset.path);

                    item.closest('.menu').classList.add('hidden');
                });

                    item.closest('.menu').classList.add('hidden');
            });;

            // --- Close menus if click outside ---
            document.addEventListener('click', () => {
                document.querySelectorAll('.menu').forEach(m => m.classList.add('hidden'));
            });

            // Attach delete action for all delete menu items
            attachSearch();
        }

        // --- File Upload ---
        const uploadFileBtn = document.getElementById('uploadFileBtn');
        uploadFileBtn.addEventListener('click', async () => {
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.onchange = async () => {
                if (!fileInput.files.length) return;
                const file = fileInput.files[0];
                const formData = new FormData();
                formData.append('file', file);
                formData.append('path', currentPath); // send the current folder

                try {
                    const res = await fetch('/api/files/upload', {
                        method: 'POST',
                        body: formData
                    });
                    const data = await res.json();
                    if (data.ok) {
                        showToast('File uploaded successfully');
                        fetchFiles(currentPath); // refresh current folder
                    } else {
                        showToast(`Upload failed: ${data.error}`);
                    }
                } catch (e) {
                    showToast(`Error uploading file: ${e}`);
                }
            };
            fileInput.click();
        });


    function attachFileManagement() {
        const newFileBtn = document.getElementById('newFileBtn');
        const newFolderBtn = document.getElementById('newFolderBtn');

        if (!newFileBtn || !newFolderBtn) return;

        newFileBtn.onclick = async () => {
            const name = prompt("Enter new file name:");
            if (!name) return;
            try {
                const res = await fetch('/api/files/create', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: currentPath, name, type: 'file' })
                });
                const data = await res.json();
                if (data.ok) {
                    showToast(`File "${name}" created`);
                    fetchFiles(currentPath); // refresh
                } else {
                    showToast(`Error: ${data.error}`);
                }
            } catch (e) {
                showToast("Error creating file");
            }
        };

        newFolderBtn.onclick = async () => {
            const name = prompt("Enter new folder name:");
            if (!name) return;
            try {
                const res = await fetch('/api/files/create', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: currentPath, name, type: 'folder' })
                });
                const data = await res.json();
                if (data.ok) {
                    showToast(`Folder "${name}" created`);
                    fetchFiles(currentPath); // refresh
                } else {
                    showToast(`Error: ${data.error}`);
                }
            } catch (e) {
                showToast("Error creating folder");
            }
        };
    }

    // Call this once after your file tab is rendered:
    attachFileManagement();



    const backBtn = document.getElementById('backBtn');

    function updateBackButton() {
        if (!currentPath) {
            backBtn.classList.add('hidden'); // hide at root
        } else {
            backBtn.classList.remove('hidden'); // show when inside a folder
        }
    }

    function attachSearch() {
    const input = document.getElementById("fileSearch");
    if (!input) return;

    input.addEventListener("input", () => {
        const query = input.value.toLowerCase().trim();
        const items = document.querySelectorAll("#filesArea li");

        items.forEach(li => {
        const name = li.querySelector(".name").textContent.toLowerCase();

        // Match both normal name searches and extension searches like ".css"
        if (name.includes(query)) {
            li.style.display = "";
        } else {
            li.style.display = "none";
        }
        });
    });
    }

    backBtn.addEventListener('click', async () => {
        if (!currentPath) return;

        // Remove last segment from path
        const parts = currentPath.split('/');
        parts.pop();
        const newPath = parts.join('/');

        // Fetch parent folder
        const res = await fetch(`/api/files?path=${encodeURIComponent(newPath)}`);
        const data = await res.json();
        renderFiles(data);
    });

    // First load
    fetchFiles();
    const refreshBtn = document.getElementById('refreshFiles');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => fetchFiles());
    }


    // Audit (admin only) with client-side filtering
    // Server-backed pagination state
    let _auditCache = []; // last page returned by server (newest-first)
    let _auditLastFetched = 0;
    let _auditOffset = 0; let _auditLimit = 50; let _auditTotal = 0;
    let _auditLive = false; let _auditSocket = null;
    async function fetchAudit(){
        const el = document.getElementById('auditArea'); if(!el) return; el.innerHTML = '<div class="muted">Loading audit... <span class="spinner"></span></div>';
        try{
            const params = new URLSearchParams(); params.set('limit', _auditLimit); params.set('offset', _auditOffset);
            const actor = (document.getElementById('auditFilterActor')||{}).value; const action = (document.getElementById('auditFilterAction')||{}).value;
            const from = (document.getElementById('auditFilterFrom')||{}).value; const to = (document.getElementById('auditFilterTo')||{}).value;
            if(actor) params.set('actor', actor); if(action) params.set('action', action); if(from) params.set('from', from); if(to) params.set('to', to);
            const res = await authFetch('/api/audit?' + params.toString()); if(!res.ok) throw new Error('unauth');
            const j = await res.json(); _auditCache = j.audit || []; _auditLastFetched = Date.now(); _auditTotal = j.total || 0; renderAudit(_auditCache); updatePager();
        }catch(e){ document.getElementById('auditArea').textContent = 'Audit unavailable or admin access required'; }
    }

    function renderAudit(list){
        const el = document.getElementById('auditArea'); if(!el) return; const last = document.getElementById('auditLastUpdated'); if(last) last.textContent = _auditLastFetched ? ('Last: ' + new Date(_auditLastFetched).toLocaleString()) : '';
        if(!list || !list.length) { el.innerHTML = '<div class="muted">No audit records.</div>'; return; }
        // render in a compact table for better scanning with sortable headers
        const rows = list.map(a => `<tr><td>${new Date(a.ts).toLocaleString()}</td><td>${escapeHtml(a.actor)}</td><td>${escapeHtml(a.action)}</td><td>${escapeHtml(a.details||'')}</td></tr>`).join('');
        el.innerHTML = `<div style="overflow:auto"><table style="width:100%;border-collapse:collapse"><thead><tr style="text-align:left"><th data-col="ts" class="sortable" style="padding:6px;border-bottom:1px solid rgba(255,255,255,0.06)">Time</th><th data-col="actor" class="sortable" style="padding:6px;border-bottom:1px solid rgba(255,255,255,0.06)">Actor</th><th data-col="action" class="sortable" style="padding:6px;border-bottom:1px solid rgba(255,255,255,0.06)">Action</th><th style="padding:6px;border-bottom:1px solid rgba(255,255,255,0.06)">Details</th></tr></thead><tbody>${rows}</tbody></table></div>`;
        wireSortHeaders();
    }

    // Sorting state
    let _auditSort = { col: 'ts', dir: 'desc' };
    function wireSortHeaders(){ const headers = document.querySelectorAll('#auditArea table thead th.sortable'); headers.forEach(h => { h.classList.remove('sort-asc','sort-desc'); if(h.dataset.col === _auditSort.col) h.classList.add(_auditSort.dir === 'asc' ? 'sort-asc' : 'sort-desc'); h.onclick = ()=>{ if(h.dataset.col === _auditSort.col) _auditSort.dir = _auditSort.dir === 'asc' ? 'desc' : 'asc'; else { _auditSort.col = h.dataset.col; _auditSort.dir = 'asc'; } applySortAndRender(); }; }); }
    function applySortAndRender(){ if(!_auditCache) return; const copy = _auditCache.slice(); const col = _auditSort.col; const dir = _auditSort.dir === 'asc' ? 1 : -1; copy.sort((a,b)=>{ let va = a[col]; let vb = b[col]; if(col === 'ts'){ va = a.ts || 0; vb = b.ts || 0; } else { va = String(va||'').toLowerCase(); vb = String(vb||'').toLowerCase(); } if(va < vb) return -1 * dir; if(va > vb) return 1 * dir; return 0; }); renderAudit(copy); }

    // Export modal wiring
    function openExportModal(){ const modal = document.getElementById('exportModal'); const body = document.getElementById('exportModalBody'); if(!modal) return; body.textContent = `Export ${_auditTotal} records (showing ${_auditCache.length} on this page). Choose export scope:`; modal.classList.remove('hidden'); }
    function closeExportModal(){ const modal = document.getElementById('exportModal'); if(!modal) return; modal.classList.add('hidden'); }
    function wireExportModal(){ const cancel = document.getElementById('exportCancel'); const pageBtn = document.getElementById('exportPageBtn'); const allBtn = document.getElementById('exportAllBtn'); if(cancel) cancel.addEventListener('click', closeExportModal); if(pageBtn) pageBtn.addEventListener('click', ()=>{ performExport('page'); closeExportModal(); }); if(allBtn) allBtn.addEventListener('click', ()=>{ performExport('all'); closeExportModal(); }); }

    async function performExport(scope){ // scope: 'page' or 'all'
        const token = getToken(); const params = [];
        const actor = (document.getElementById('auditFilterActor')||{}).value; const action = (document.getElementById('auditFilterAction')||{}).value;
        const from = (document.getElementById('auditFilterFrom')||{}).value; const to = (document.getElementById('auditFilterTo')||{}).value;
        if(actor) params.push(`actor=${encodeURIComponent(actor)}`); if(action) params.push(`action=${encodeURIComponent(action)}`); if(from) params.push(`from=${encodeURIComponent(from)}`); if(to) params.push(`to=${encodeURIComponent(to)}`);
        if(scope === 'page'){ params.push(`limit=${_auditLimit}`); params.push(`offset=${_auditOffset}`); }
        const url = '/api/audit/export' + (params.length?('?'+params.join('&')):'');
        try{ const r = await fetch(url, { headers: token ? { 'x-auth-token': token } : {} }); const b = await r.blob(); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = 'audit-export.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=> URL.revokeObjectURL(u), 5000); showToast('Export started'); }catch(e){ showToast('Export failed'); }
    }

    // Client-side audit filters
    function applyAuditFilters(){
        // with server-backed pagination we just reset offset and fetch
        _auditOffset = 0; fetchAudit();
    }

    function clearAuditFilters(){
        const ids = ['auditFilterActor','auditFilterAction','auditFilterFrom','auditFilterTo']; ids.forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; }); _auditOffset = 0; fetchAudit();
    }

    function updatePager(){ const info = document.getElementById('auditPageInfo'); if(!info) return; const start = _auditOffset + 1; const end = Math.min(_auditOffset + _auditLimit, _auditTotal); info.textContent = `${start}-${end} of ${_auditTotal}`; }

    // pagination controls
    function wirePager(){ const prev = document.getElementById('auditPrev'); const next = document.getElementById('auditNext'); const size = document.getElementById('auditPageSize'); if(prev) prev.addEventListener('click', ()=>{ _auditOffset = Math.max(0, _auditOffset - _auditLimit); fetchAudit(); }); if(next) next.addEventListener('click', ()=>{ if(_auditOffset + _auditLimit < _auditTotal){ _auditOffset += _auditLimit; fetchAudit(); } }); if(size) size.addEventListener('change', (e)=>{ _auditLimit = parseInt(e.target.value,10)||50; _auditOffset = 0; fetchAudit(); }); }

    // presets
    function wirePresets(){ const p24 = document.getElementById('preset24h'); const p7 = document.getElementById('preset7d'); const p30 = document.getElementById('preset30d'); if(p24) p24.addEventListener('click', ()=>{ const to = new Date(); const from = new Date(Date.now() - 24*3600*1000); document.getElementById('auditFilterFrom').value = from.toISOString().slice(0,10); document.getElementById('auditFilterTo').value = to.toISOString().slice(0,10); applyAuditFilters(); }); if(p7) p7.addEventListener('click', ()=>{ const to = new Date(); const from = new Date(Date.now() - 7*24*3600*1000); document.getElementById('auditFilterFrom').value = from.toISOString().slice(0,10); document.getElementById('auditFilterTo').value = to.toISOString().slice(0,10); applyAuditFilters(); }); if(p30) p30.addEventListener('click', ()=>{ const to = new Date(); const from = new Date(Date.now() - 30*24*3600*1000); document.getElementById('auditFilterFrom').value = from.toISOString().slice(0,10); document.getElementById('auditFilterTo').value = to.toISOString().slice(0,10); applyAuditFilters(); }); }

    // live-tail toggle
    function wireLiveTail(){ const live = document.getElementById('liveTailToggle'); if(!live) return; live.addEventListener('change', async (e)=>{ _auditLive = e.target.checked; if(_auditLive){ // open socket if not open
            if(!_auditSocket && window.io){ const token = getToken(); _auditSocket = io ? io({ auth: { token } }) : null; if(_auditSocket){ _auditSocket.on('audit', entry => { _auditCache = _auditCache || []; _auditCache.unshift(entry); _auditTotal += 1; if(_auditCache.length > _auditLimit) _auditCache.pop(); if(document.querySelector('.sidebar nav li.active')?.dataset.tab === 'audit'){ fetchAudit(); } }); } }
        } else { if(_auditSocket){ _auditSocket.close(); _auditSocket = null; } }
    }); }

    // Whoami and RBAC UI logic
    async function checkWhoami(){
        try{
            const res = await authFetch('/api/whoami'); if(!res.ok) return; const j = await res.json(); if(j && j.user){ updateProfileDisplay(j.user); // show audit tab for admins
                const auditLi = document.querySelector('.sidebar nav li[data-tab="audit"]'); if(auditLi){ if(j.user.role === 'admin') auditLi.classList.remove('hidden'); else auditLi.classList.add('hidden'); }
            }
        }catch(e){}
    }

    async function renderProcessList(list){
        if(!processListEl) return; if(!list.length) { processListEl.innerHTML = '<div class="muted">No processes found.</div>'; return; }
        const monitored = await loadMonitored().catch(()=>[]);
        const ul = document.createElement('ul');
        list.forEach(p => {
            const li = document.createElement('li'); const checked = monitored.includes(p.pm_id.toString()) ? 'checked' : '';
            li.innerHTML = `<strong>${p.name}</strong> ID: ${p.pm_id} | PID: ${p.pid} | cpu: ${p.monit.cpu}% | mem: ${(p.monit.memory / (1024 *1024)).toFixed(2)}MB`;
            const btns = document.createElement('div'); ['restart','stop','delete'].forEach(act => { const b = document.createElement('button'); b.textContent = act; b.className='btn'; b.addEventListener('click', ()=> manageProc("pm2"+act, p.pm_id)); btns.appendChild(b); });
            li.appendChild(btns); ul.appendChild(li);
        });
        processListEl.innerHTML = ''; processListEl.appendChild(ul);
        ul.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.addEventListener('change', saveMonitoredFromUI));
    }

    async function saveMonitoredFromUI(){
        if(!processListEl) return; const checked = Array.from(processListEl.querySelectorAll('input[type="checkbox"]:checked')).map(i=> i.dataset.pid.toString());
        try{ await authFetch('/api/monitoredProcesses', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ list: checked }) }); showToast('Monitored processes saved'); renderMonitoredOverview(checked); }catch(e){ showToast('Failed to save monitored'); }
    }

    function renderMonitoredOverview(list){
        const area = document.querySelector('#tab-overview .panel.activity'); if(!area) return; let node = area.querySelector('.monitored'); if(!node){ node = document.createElement('div'); node.className='monitored'; area.appendChild(node); }
        node.innerHTML = '<h4>Monitored Processes</h4>' + (list.length?('<ul>'+list.map(id=>`<li>pm_id: ${id}</li>`).join('')+'</ul>'):'<div class="muted">None</div>');
    }

    function manageProc(action, id){ authFetch(`/api/processes/${action}`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id }) }).then(r=>r.json()).then(j=>{ if(j.ok) { showToast(`Process ${id} ${action}ed`); loadProcesses(); } else showToast('Action failed'); }).catch(()=> showToast('Action failed')); }

    async function loadUsers(){
        try{
            const res = await authFetch('/api/users'); if(!res.ok) throw new Error('unauth');
            const data = await res.json();
            const el = document.getElementById('usersArea'); if(!el) return;
            let html = '<button id="newUserBtn" class="btn">New user</button><ul>';
            (data.users||[]).forEach(u=> html += `<li>${u.username} (${u.role}) <button data-user="${u.username}" class="editBtn btn">Edit</button> <button data-user="${u.username}" class="delBtn btn">Delete</button></li>`);
            html += '</ul>';
            el.innerHTML = html;
            const newBtn = document.getElementById('newUserBtn'); if(newBtn) newBtn.addEventListener('click', ()=> openUserModal());
            el.querySelectorAll('.editBtn').forEach(b=> b.addEventListener('click', e=>{ const u = e.currentTarget.dataset.user; openUserModal(u); }));
            el.querySelectorAll('.delBtn').forEach(b=> b.addEventListener('click', async e=>{ const u = e.currentTarget.dataset.user; if(!confirm('Delete '+u+'?')) return; await authFetch('/api/users/'+u, { method:'DELETE' }); loadUsers(); }));
        }catch(e){ console.warn(e); const el = document.getElementById('usersArea'); if(el) el.innerHTML = '<p class="muted">Login to manage users.</p>'; }
    }

    function openUserModal(username){
        const modal = document.getElementById('userModal'); const title = document.getElementById('modalTitle'); const uIn = document.getElementById('modalUsername'); const pIn = document.getElementById('modalPassword'); const rIn = document.getElementById('modalRole');
        if(!modal) return;
        modal.classList.remove('hidden'); if(!username){ title.textContent = 'Create user'; uIn.value = ''; pIn.value = ''; rIn.value = 'user'; uIn.disabled = false; }
        else { title.textContent = 'Edit user'; uIn.value = username; pIn.value = ''; rIn.value = 'user'; uIn.disabled = true; fetch('/api/users', { headers: { 'x-auth-token': getToken() } }).then(r=> r.json().catch(()=>null)).then(db => { if(db && db.users){ const u = db.users.find(x=>x.username===username); if(u) rIn.value = u.role || 'user'; } }).catch(()=>{}); }
    }

    const modalCancel = document.getElementById('modalCancel'); if(modalCancel) modalCancel.addEventListener('click', ()=>{ const um = document.getElementById('userModal'); if(um && um.classList) um.classList.add('hidden'); });

    const userForm = document.getElementById('userForm'); if(userForm) userForm.addEventListener('submit', async (e)=>{ e.preventDefault(); const uname = document.getElementById('modalUsername').value.trim(); const pwd = document.getElementById('modalPassword').value.trim(); const role = document.getElementById('modalRole').value; if(!uname) return showToast('Username required'); const isEdit = document.getElementById('modalUsername').disabled; if(isEdit){ const body = {}; if(pwd) body.password = pwd; if(role) body.role = role; await authFetch('/api/users/'+uname, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }); } else { await authFetch('/api/users', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ username:uname, password:pwd||'pass', role }) }); } const um = document.getElementById('userModal'); if(um && um.classList) um.classList.add('hidden'); loadUsers(); });

    (function wireSettings(){
        const sidebar = document.querySelector('.settings-sidebar'); const panels = document.querySelectorAll('.settings-panel'); if(!sidebar) return; sidebar.querySelectorAll('li').forEach(li=> li.addEventListener('click', ()=>{ sidebar.querySelectorAll('li').forEach(x=>x.classList.remove('active')); li.classList.add('active'); const sec = li.dataset.section; panels.forEach(p=> p.classList.toggle('hidden', p.dataset.section !== sec)); }));
        const pm2Toggle = document.getElementById('pm2Toggle'); if(pm2Toggle) pm2Toggle.addEventListener('click', ()=>{ pm2Toggle.classList.toggle('on'); const enabled = pm2Toggle.classList.contains('on'); fetch('/api/config', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ pm2: { enabled } }) }); });
        const themeToggle = document.getElementById('themeToggle'); if(themeToggle) themeToggle.addEventListener('click', ()=>{ document.body.classList.toggle('light-mode'); });
        const startFolderInput = document.getElementById('startFolder');
        const saveStartFolder = document.getElementById('saveStartFolder');

        if (saveStartFolder && startFolderInput) {
            saveStartFolder.addEventListener('click', () => {
                const folder = startFolderInput.value.trim();
                if (!folder) return;
                fetch('/api/config', { 
                    method:'POST', 
                    headers:{'Content-Type':'application/json'}, 
                    body: JSON.stringify({ startFolder: folder }) 
                });
                showToast('Start folder saved');
            });
        }
    })();

    const existingToken = getToken(); if(existingToken){ authFetch('/api/users').then(r=>{ if(r.ok) updateProfileDisplay(null); }); loadConfig(); updateProfileDisplay(); }

    // Charts
    let cpuChart, memChart; function initCharts(){ const ctx1 = document.createElement('canvas'); ctx1.id='cpuChart'; ctx1.style.width='100%'; document.getElementById('tab-metrics').appendChild(ctx1); const ctx2 = document.createElement('canvas'); ctx2.id='memChart'; ctx2.style.width='100%'; document.getElementById('tab-metrics').appendChild(ctx2); cpuChart = new Chart(ctx1.getContext('2d'), { type:'line', data:{ labels:[], datasets:[{ label:'CPU %', data:[], borderColor:'#f97316', backgroundColor:'rgba(249,115,22,0.15)' }]}, options:{ responsive:true, maintainAspectRatio:false } }); memChart = new Chart(ctx2.getContext('2d'), { type:'line', data:{ labels:[], datasets:[{ label:'Memory %', data:[], borderColor:'#06b6d4', backgroundColor:'rgba(6,182,212,0.12)' }]}, options:{ responsive:true, maintainAspectRatio:false } }); }

    function pushMetricPoint(cpuPct, memPct){ const t = new Date().toLocaleTimeString(); if(!cpuChart) return; cpuChart.data.labels.push(t); cpuChart.data.datasets[0].data.push(parseInt(cpuPct)); memChart.data.labels.push(t); memChart.data.datasets[0].data.push(parseInt(memPct)); if(cpuChart.data.labels.length>30){ cpuChart.data.labels.shift(); cpuChart.data.datasets[0].data.shift(); memChart.data.labels.shift(); memChart.data.datasets[0].data.shift(); } cpuChart.update(); memChart.update(); }

    let chartsInit = false; function fetchAndPush(){ fetch('/api/metrics').then(r=>r.json()).then(d=>{ pushMetricPoint(d.cpu.replace('%',''), d.memory.replace('%','')); }).catch(()=>{}); }

    // socket metrics
    if(window.io){
        const token = getToken(); const socket = io ? io({ auth: { token } }) : null; if(socket){ socket.on('connect', ()=> console.log('[INFO] socket connected', socket.id)); socket.on('metrics', m=> { try{ pushMetricPoint((m.cpu||'0%').replace('%',''), (m.memory||'0%').replace('%','')); }catch(e){} }); socket.on('activity', a=> pushActivity(a.msg, a.ts)); }
    }

    // update disk bar on live metrics
    if(window.io){
        const token = getToken(); const socket2 = io ? io({ auth: { token } }) : null; if(socket2){ socket2.on('metrics', m => { try{ if(m.disk && m.disk.usedPct){ const bar = document.getElementById('diskBar'); const dv = document.getElementById('diskVal'); if(bar) bar.style.width = String(m.disk.usedPct) + '%'; if(dv) dv.textContent = `${m.disk.usedGb || '?'}GB (${m.disk.usedPct || '?'}%)`; } }catch(e){} }); } }

    // socket audit tail: append new audit entries to cache and update UI if visible
    if(window.io){
        const token = getToken(); const socketAudit = io ? io({ auth: { token } }) : null; if(socketAudit){ socketAudit.on('audit', entry => { try{ _auditCache = _auditCache || []; _auditCache.unshift(entry); _auditLastFetched = Date.now(); // keep cap client-side to 2000
                    if(_auditCache.length > 2000) _auditCache = _auditCache.slice(0,2000);
                    // if audit tab is visible, re-apply filters
                    const active = document.querySelector('.sidebar nav li.active'); if(active && active.dataset.tab === 'audit'){ applyAuditFilters(); }
                }catch(e){} }); }
    }

    // monitored processes helpers
    async function loadMonitored(){ try{ const res = await authFetch('/api/monitoredProcesses'); if(!res.ok) throw new Error('no'); const j = await res.json(); return j.list || []; }catch(e){ return []; } }

    // backups
    async function loadBackups(){ const el = document.getElementById('tab-backups'); if(!el) return; el.innerHTML = '<div class="muted">Loading backups...</div>'; try{ const res = await authFetch('/api/backups'); if(!res.ok) throw new Error('no'); const j = await res.json(); el.innerHTML = '<ul>' + (j.list||[]).map(b=> `<li>${b}</li>`).join('') + '</ul>'; }catch(e){ el.innerHTML = '<div class="muted">Backups unavailable</div>'; } }

    // users load on demand
    // wire new user button, edit and delete in loadUsers

    // Wire refresh buttons and initial RBAC check
    try{
        const rn = document.getElementById('refreshNotifications'); if(rn) rn.addEventListener('click', ()=> fetchNotifications());
        const ra = document.getElementById('refreshAudit'); if(ra) ra.addEventListener('click', ()=> fetchAudit());
        const exp = document.getElementById('exportAudit'); if(exp) exp.addEventListener('click', ()=> {
            const token = getToken(); const params = [];
            // attach current filters
            ['auditFilterActor','auditFilterAction','auditFilterFrom','auditFilterTo'].forEach(id=>{ const el=document.getElementById(id); if(el && el.value) params.push(`${encodeURIComponent(id.replace('auditFilter','').toLowerCase())}=${encodeURIComponent(el.value)}`); });
            const url = '/api/audit/export' + (params.length?('?'+params.join('&')):'');
            // open in new tab with token header cannot be set; use fetch and create blob
            fetch(url, { headers: token ? { 'x-auth-token': token } : {} }).then(r=> r.blob()).then(b=>{
                const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = 'audit-export.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=> URL.revokeObjectURL(u), 5000);
            }).catch(()=> showToast('Export failed'));
        });
    }catch(e){}

    // export modal wiring
    try{ const expBtn = document.getElementById('exportAudit'); if(expBtn) expBtn.addEventListener('click', ()=> openExportModal()); wireExportModal(); }catch(e){}

    // run whoami to update UI (show/hide audit tab for admins)
    checkWhoami();
    // wire audit filters
    try{
        const applyBtn = document.getElementById('auditApplyFilters'); if(applyBtn) applyBtn.addEventListener('click', ()=> applyAuditFilters());
        const clearBtn = document.getElementById('auditClearFilters'); if(clearBtn) clearBtn.addEventListener('click', ()=> clearAuditFilters());
        // refresh should re-fetch current page
        const ra2 = document.getElementById('refreshAudit'); if(ra2) ra2.addEventListener('click', ()=> { fetchAudit(); });
        // wire pager, presets and live-tail
        wirePager(); wirePresets(); wireLiveTail();
    }catch(e){}

    function createActionMenu(path, isDir) {
        const menu = document.createElement('div');
        menu.className = 'action-menu hidden';
        menu.innerHTML = `
            <ul>
            ${isDir ? '<li class="open">Open</li>' : ''}
            <li class="download">Download</li>
            ${!isDir ? '<li class="edit">Edit</li>' : ''}
            <li class="delete">Delete</li>
            </ul>
        `;

        menu.querySelectorAll('li').forEach(item => {
            item.addEventListener('click', async () => {
            if (item.classList.contains('download')) {
                window.open(`/api/files/download?path=${path}`, '_blank');
            }
            if (item.classList.contains('edit')) {
                openEditor(path);
            }
            if (item.classList.contains('open') && isDir) {
                fetchFiles(path);
            }
            // TODO: implement delete
            menu.classList.add('hidden');
            });
        });

        return menu;
        }

        // Open editor
        async function openEditor(path) {
        const modal = document.getElementById('editorModal');
        const filenameEl = document.getElementById('editorFilename');
        const textarea = document.getElementById('editorTextarea');
        const saveBtn = document.getElementById('editorSave');
        const closeBtn = document.getElementById('editorClose');

        filenameEl.textContent = decodeURIComponent(path.split('/').pop());
        modal.classList.remove('hidden');
        textarea.value = "Loading...";

        try {
            const res = await fetch(`/api/files/read?path=${encodeURIComponent(path)}`);
            const text = await res.text(); // use text() for plain files
            textarea.value = text;
        } catch (e) {
            textarea.value = `Error loading file: ${e}`;
        }

        saveBtn.onclick = async () => {
            try {
            const res = await fetch(`/api/files/write`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path, content: textarea.value })
            });
            const result = await res.json();
            if (result.ok) showToast("File saved");
            else showToast("Error saving file");
            modal.classList.add('hidden');
            } catch (e) {
            showToast("Error: " + e);
            modal.classList.add('hidden');
            }
        };

        closeBtn.onclick = () => modal.classList.add('hidden');
        }

        // Attach menu to each file/folder
        function addFileMenu(li) {
        const menuBtn = document.createElement('span');
        menuBtn.textContent = '⋮';
        menuBtn.className = 'file-menu-btn';
        menuBtn.style.cursor = 'pointer';
        menuBtn.style.marginLeft = '10px';
        menuBtn.style.fontWeight = 'bold';

        const menu = document.createElement('div');
        menu.className = 'file-menu hidden';
        menu.style.position = 'absolute';
        menu.style.background = '#fff';
        menu.style.border = '1px solid #ccc';
        menu.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)';
        menu.style.padding = '4px 0';
        menu.style.zIndex = 1000;

        const editOption = document.createElement('div');
        editOption.textContent = 'Edit';
        editOption.style.padding = '4px 12px';
        editOption.style.cursor = 'pointer';
        editOption.onclick = (e) => {
            e.stopPropagation();
            openEditor(li.dataset.path); // fixed to correct function
            menu.classList.add('hidden');
        };

        const downloadOption = document.createElement('div');
        downloadOption.textContent = 'Download';
        downloadOption.style.padding = '4px 12px';
        downloadOption.style.cursor = 'pointer';
        downloadOption.onclick = (e) => {
            e.stopPropagation();
            window.open(`/api/files/download?path=${li.dataset.path}`, '_blank');
            menu.classList.add('hidden');
        };

        menu.appendChild(editOption);
        menu.appendChild(downloadOption);

        li.style.position = 'relative';
        li.appendChild(menuBtn);
        li.appendChild(menu);

        menuBtn.onclick = (e) => {
            e.stopPropagation();
            document.querySelectorAll('.file-menu').forEach(m => m.classList.add('hidden')); // close others
            menu.classList.toggle('hidden');
        };

        // Direct click on li opens editor (folders handled separately)
        li.onclick = () => {
            if(li.classList.contains('file')){
            openEditor(li.dataset.path);
            } else if(li.classList.contains('folder')){
            fetchFiles(decodeURIComponent(li.dataset.path));
            }
        };

        // Hide menu if click outside
        document.addEventListener('click', () => menu.classList.add('hidden'));
        }

        async function saveConfig(updates) {
            try {
                const res = await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
                });
                const data = await res.json();
                if (data.ok) {
                console.log("Config updated:", data.config);
                // Optionally show toast
                showToast("Settings saved");
                } else {
                console.error("Error saving config", data);
                showToast("❌ Error saving settings");
                }
            } catch (err) {
                console.error("Config save failed", err);
                showToast("❌ Error saving settings");
            }
            }

            // ---- APPLY CHANGES ----
        function saveConfig(update) {
            fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(update)
            })
            .then(r => r.json())
            .then(res => {
                Object.assign(serverConfig, update);
                showToast('Settings saved');
            })

            .catch(() => {
                Object.assign(serverConfig, update);
                showToast('Settings saved (local)');
            });
        }

            // Max Activity input
        const maxActivityInput1 = document.getElementById('maxActivity');
        if(maxActivityInput1){
            maxActivityInput1.addEventListener('input', e => {
                const val = parseInt(e.target.value, 10) || 7;
                saveConfig({ maxActivity: val });
            });
        }

            // PM2 toggle
        const pm2Toggle = document.getElementById('pm2Toggle');
        if(pm2Toggle){
            pm2Toggle.addEventListener('click', e => {
                const enabled = !pm2Toggle.classList.contains('on');
                pm2Toggle.classList.toggle('on', enabled);
                saveConfig({ pm2: { enabled } });
            });
        }

            // Start folder
            const startFolder = document.getElementById('startFolder');
            if(startFolder){
                startFolder.addEventListener('change', e => {
                    saveConfig({ startFolder: e.target.value });
                });
        }

        if (maxActivityInput1) maxActivityInput1.value = serverConfig.maxActivity || 7;
        if (pm2Toggle) pm2Toggle.classList.toggle('on', serverConfig.pm2?.enabled);
        if (startFolder) startFolder.value = serverConfig.startFolder || '';

        function normalizePath(p) {
            return p.replace(/\//g, '\\');
        }

        // DELETE FUNCTION
        async function handleDelete(path) {
            if (!confirm(`Are you sure you want to delete "${path.split('/').pop()}"?`)) return;

            try {
                const res = await fetch('/api/files/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path })
                });
                const data = await res.json();
                if (data.ok) {
                    showToast('Deleted successfully');
                    fetchFiles(currentPath); // refresh current folder
                } else {
                    showToast(`Delete failed: ${data.error}`);
                }
            } catch (e) {
                showToast(`Error: ${e}`);
            }
        }


        // RENAME FUNCTION
        async function handleRename(oldPath) {
            const newName = prompt("Enter new name:", oldPath.split('/').pop());
            if (!newName || newName === oldPath.split('/').pop()) return;

            const pathParts = oldPath.split('/');
            pathParts[pathParts.length - 1] = newName;
            const newPath = pathParts.join('/');

            try {
                const res = await fetch('/api/files/rename', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ oldPath, newPath }) // keep as relative paths
                });
                const result = await res.json();

                if (result.ok) {
                    showToast(`Renamed to ${newName}`);
                    fetchFiles(currentPath);
                } else {
                    showToast(`Error renaming: ${result.error}`);
                }
            } catch (e) {
                showToast(`Error: ${e}`);
            }
        }
})();
