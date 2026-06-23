window.addEventListener('contextmenu', (e) => e.preventDefault());

let openTabs = [];
let activeTabId = null;

let currentActiveDocId = null;
let currentExtension = "";
let currentFileName = "";
let rawDecryptedContent = null;
let checkedOutPath = null;

// OS-LEVEL SECURITY SHIELD (Locks on Alt-Tab window shifting)
const blurShield = document.createElement('div');
blurShield.style.position = 'fixed'; blurShield.style.top = '0'; blurShield.style.left = '0';
blurShield.style.width = '100vw'; blurShield.style.height = '100vh';
blurShield.style.backgroundColor = 'black'; blurShield.style.color = 'red';
blurShield.style.display = 'none'; blurShield.style.flexDirection = 'column';
blurShield.style.alignItems = 'center'; blurShield.style.justifyContent = 'center';
blurShield.style.zIndex = '999999'; blurShield.style.fontFamily = 'sans-serif';
blurShield.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="red" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg><h1 style="margin-top: 20px;">SECURITY LOCK</h1>`;
document.body.appendChild(blurShield);
window.addEventListener('blur', () => { blurShield.style.display = 'flex'; });
window.addEventListener('focus', () => { blurShield.style.display = 'none'; });

window.addEventListener('beforeunload', () => {
    openTabs.forEach(tab => { if (tab.logId) window.api.closeLog(tab.logId); });
});

async function initApp() {
    if (!window.api) return console.error("Bridge missing");

    window.api.onSyncSuccess(async (msg) => {
        const btn = document.getElementById('checkout-office-btn');
        if (btn) { btn.innerText = "✅ Saved & Office Killed!"; btn.style.background = "#28a745"; }
        setTimeout(async () => {
            const savedAuth = await window.api.getAuth();
            loadSecureDocument(savedAuth.userId, currentActiveDocId, true);
        }, 1500);
    });

    await checkAutoLogin();
}
initApp();

async function checkAutoLogin() {
    const savedAuth = await window.api.getAuth();
    const startupCheck = await window.api.getStartupFile();

    if (savedAuth && savedAuth.email && savedAuth.password) {
        document.getElementById('login-screen').classList.add('hidden');
        if (startupCheck && startupCheck.success && startupCheck.docId) {
            loadSecureDocument(savedAuth.userId, startupCheck.docId);
        } else {
            showSystemReady(savedAuth.email);
        }
    } else {
        document.getElementById('login-screen').classList.remove('hidden');
    }
}

document.getElementById('login-btn').addEventListener('click', async () => {
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value.trim();
    if (!email || !password) return;
    document.getElementById('login-error').innerText = "Authenticating...";
    const res = await window.api.login({ email, password });
    if (res.success) {
        await window.api.saveAuth({ email, password, userId: res.userId });
        document.getElementById('login-screen').classList.add('hidden');

        const startupCheck = await window.api.getStartupFile();
        if (startupCheck && startupCheck.success && startupCheck.docId) {
            loadSecureDocument(res.userId, startupCheck.docId);
        } else {
            showSystemReady(email);
        }
    } else { document.getElementById('login-error').innerText = res.message; }
});

function showSystemReady(email) {
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('main-app').classList.add('hidden');
    document.getElementById('user-email-display').innerText = email;
}

document.getElementById('logout-btn').addEventListener('click', async () => {
    openTabs.forEach(tab => { if (tab.logId) window.api.closeLog(tab.logId); });
    await window.api.clearAuth(); window.location.reload();
});

async function triggerFileBrowse() {
    const res = await window.api.openFileDialog();
    if (res.success && res.docId) {
        const savedAuth = await window.api.getAuth();
        await loadSecureDocument(savedAuth.userId, res.docId);
    }
}
document.getElementById('open-file-btn').addEventListener('click', triggerFileBrowse);

document.getElementById('close-file-btn').addEventListener('click', () => {
    if (activeTabId) closeTab(activeTabId);
});

// 🔥 MULTI-TAB ENGINE
function renderTabs() {
    const tabBar = document.getElementById('tab-bar');
    tabBar.innerHTML = '';

    openTabs.forEach(tab => {
        const t = document.createElement('div');
        t.className = `vdr-tab ${tab.id === activeTabId ? 'active' : ''}`;
        t.innerHTML = `<span style="overflow:hidden; text-overflow:ellipsis; max-width:140px; white-space:nowrap;">${tab.name}</span>
                       <button class="vdr-tab-close">✖</button>`;
        t.onclick = () => switchTab(tab.id);
        t.querySelector('.vdr-tab-close').onclick = (e) => closeTab(tab.id, e);
        tabBar.appendChild(t);
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'vdr-tab-add';
    addBtn.innerText = '+';
    addBtn.onclick = triggerFileBrowse;
    tabBar.appendChild(addBtn);
}

function switchTab(docId) {
    activeTabId = docId;
    openTabs.forEach(tab => {
        if (tab.id === docId) {
            tab.container.style.display = 'flex';
            document.getElementById('doc-title').innerText = tab.name;

            currentActiveDocId = tab.id;
            currentFileName = tab.name;
            currentExtension = tab.ext;
            rawDecryptedContent = tab.content;

            document.getElementById('edit-txt-btn').classList.add('hidden');
            document.getElementById('edit-txt-tools').classList.add('hidden');
            document.getElementById('checkout-office-btn').classList.add('hidden');
            if (tab.canEdit) {
                if (tab.ext === 'txt' || tab.ext === 'html') document.getElementById('edit-txt-btn').classList.remove('hidden');
                else if (['docx', 'doc', 'xlsx', 'xls'].includes(tab.ext)) {
                    const checkBtn = document.getElementById('checkout-office-btn');
                    checkBtn.classList.remove('hidden'); checkBtn.innerText = "📝 Edit in MS Office"; checkBtn.style.background = "#007acc";
                }
            }
        } else {
            tab.container.style.display = 'none';
        }
    });
    renderTabs();
}

async function closeTab(docId, event) {
    if (event) event.stopPropagation();
    const tabIndex = openTabs.findIndex(t => t.id === docId);
    if (tabIndex === -1) return;

    const tab = openTabs[tabIndex];
    if (tab.logId) window.api.closeLog(tab.logId);
    tab.container.remove();
    openTabs.splice(tabIndex, 1);

    if (openTabs.length === 0) {
        document.getElementById('main-app').classList.add('hidden');
        document.getElementById('auth-screen').classList.remove('hidden');
        activeTabId = null;
    } else {
        const nextTab = openTabs[tabIndex] || openTabs[tabIndex - 1];
        switchTab(nextTab.id);
    }
}

// 🔥 CORE LOAD ENGINE 
async function loadSecureDocument(userId, docId, isRefresh = false) {
    const existingTabIndex = openTabs.findIndex(t => t.id === docId);
    if (existingTabIndex !== -1 && !isRefresh) {
        switchTab(docId);
        return;
    }

    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('main-app').classList.remove('hidden');
    document.getElementById('doc-title').innerText = "Decrypting Secure Data...";

    const response = await window.api.verifyAccess({ userId, docId });

    if (response.success) {
        let ext = response.fileName.includes('.') ? response.fileName.split('.').pop().toLowerCase() : '';
        const binaryString = atob(response.content);

        const docContainer = document.createElement('div');
        docContainer.className = 'document-tab-container';

        const wmTargetId = `watermark-target-${docId}`;

        if (ext === 'pdf') {
            const pdfDataUri = `data:application/pdf;base64,${response.content}#toolbar=0&navpanes=0`;
            docContainer.innerHTML = `
                <div style="position: relative; width: 100%; height: 100%; overflow: hidden;">
                    <div id="${wmTargetId}" style="position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; overflow:hidden; z-index:9999;"></div>
                    <iframe src="${pdfDataUri}" width="100%" height="100%" style="border: none; background: white; position:relative; z-index:1;" allowfullscreen></iframe>
                </div>`;
        }
        else if (ext === 'docx' || ext === 'doc') {
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
            try {
                const res = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer });
                docContainer.innerHTML = `
                <div style="width: 100%; padding: 40px; background-color: #1e1e1e; display: flex; justify-content: center; overflow:auto;">
                    <div style="background: white; color: black; padding: 60px; width: 210mm; min-height: 297mm; height: max-content; box-shadow: 0 4px 15px rgba(0,0,0,0.5); font-family: 'Arial', sans-serif; line-height: 1.6; text-align: left; overflow-wrap: break-word; position:relative; overflow:hidden;">
                        <div id="${wmTargetId}" style="position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; overflow:hidden; z-index:9999;"></div>
                        <div style="position:relative; z-index:20;">${res.value}</div>
                    </div>
                </div>`;
            } catch (e) { docContainer.innerHTML = `<div style="color:red; padding: 20px;">Failed to render Word Doc.</div>`; }
        }
        else if (ext === 'xlsx' || ext === 'csv' || ext === 'xls') {
            try {
                const workbook = XLSX.read(response.content, { type: 'base64' });
                const htmlStr = XLSX.utils.sheet_to_html(workbook.Sheets[workbook.SheetNames[0]]);
                docContainer.innerHTML = `
                <div style="background: white; padding: 20px; width: 100%; height: 100%; overflow: auto; position:relative;">
                    <div id="${wmTargetId}" style="position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; overflow:hidden; z-index:9999;"></div>
                    <div style="position:relative; z-index:20;">
                        <style>#excel-tbl table { border-collapse: collapse; min-width: 100%; font-family: 'Segoe UI', sans-serif; font-size: 14px; color: black; } #excel-tbl th, #excel-tbl td { border: 1px solid #d2d2d2; padding: 8px 12px; text-align: left; white-space: nowrap; } #excel-tbl th { background-color: #f3f2f1; font-weight: 600; border-bottom: 2px solid #ccc; position: sticky; top: 0; }</style>
                        <div id="excel-tbl">${htmlStr}</div>
                    </div>
                </div>`;
            } catch (e) { docContainer.innerHTML = `<div style="color:red; padding: 20px;">Failed to render Excel.</div>`; }
        }
        else if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'gif') {
            const mime = ext === 'jpg' ? 'jpeg' : ext;
            const dataUri = `data:image/${mime};base64,${response.content}`;
            docContainer.innerHTML = `
            <div style="width: 100%; height: 100%; display: flex; justify-content: center; align-items: center; background-color: #1e1e1e; overflow: auto; padding: 40px;">
                <div style="position: relative; max-width: 100%; max-height: 100%; display: flex; justify-content: center; align-items: center; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.5); overflow: hidden;">
                    <div id="${wmTargetId}" style="position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; overflow:hidden; z-index:9999;"></div>
                    <div style="position:relative; z-index:20; display:flex;">
                        <img src="${dataUri}" style="max-width: 100%; max-height: 80vh; object-fit: contain; pointer-events: none;" />
                    </div>
                </div>
            </div>`;
        }
        else {
            docContainer.innerHTML = `
            <div style="width: 100%; height: 100%; display: flex; justify-content: center; padding-top: 20px; background-color: #1e1e1e;">
                <div style="position: relative; width: 90%; max-width: 900px; height: 90vh; background: #2d2d2d; overflow: hidden; border-radius: 4px;">
                    <div id="${wmTargetId}" style="position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; overflow:hidden; z-index:9999;"></div>
                    <textarea style="width: 100%; height: 100%; background: transparent; color: white; padding: 30px; font-family: monospace; resize:none; outline: none; border:none; position:relative; z-index:20;" readonly>${binaryString}</textarea>
                </div>
            </div>`;
        }

        document.getElementById('viewer-container').appendChild(docContainer);

        if (response.watermark) {
            const savedAuth = await window.api.getAuth();
            applyWatermark(response.watermark, savedAuth.email, wmTargetId);
        }

        if (isRefresh && existingTabIndex !== -1) {
            openTabs[existingTabIndex].container.remove();
            openTabs[existingTabIndex] = { id: docId, name: response.fileName, logId: response.logId, ext: ext, canEdit: response.canEdit, container: docContainer, content: response.content };
        } else {
            openTabs.push({ id: docId, name: response.fileName, logId: response.logId, ext: ext, canEdit: response.canEdit, container: docContainer, content: response.content });
        }

        switchTab(docId);

    } else {
        alert("Security Violation: " + response.error);
        if (openTabs.length === 0) {
            document.getElementById('main-app').classList.add('hidden');
            document.getElementById('auth-screen').classList.remove('hidden');
        }
    }
}

// 🔥 ADVANCED WATERMARK & DB CONFIG ENGINE
// function applyWatermark(wm, email, targetElementId) {
//     const target = document.getElementById(targetElementId);
//     if (!target) return;

//     const wmLayer = document.createElement('div');
//     wmLayer.className = 'secure-watermark-layer';
//     wmLayer.style.position = 'absolute';
//     wmLayer.style.top = '0'; wmLayer.style.left = '0';
//     wmLayer.style.width = '100%'; wmLayer.style.height = '100%';
//     wmLayer.style.pointerEvents = 'none';
//     wmLayer.style.zIndex = '9999';
//     wmLayer.style.overflow = 'hidden';

//     // 1. 🔥 THE FIX: Safely parse Supabase JSON/JSONB columns
//     let textConfig = typeof wm.attributes === 'string' ? JSON.parse(wm.attributes || "{}") : (wm.attributes || {});
//     let positions = typeof wm.positions === 'string' ? JSON.parse(wm.positions || "{}") : (wm.positions || {});

//     const customText = wm.custom_text || "";
//     const showEmail = textConfig.email || false;
//     const showDate = textConfig.dateTime || false;

//     // 2. Base Logo URL Construction
//     const BASE_LOGO_URL = "https://xxlawcufvetxygaqwoxi.supabase.co/storage/v1/object/public/vdr-logos/";
//     let logoUrl = wm.final_logo_link || null;

//     if (!logoUrl && wm.logo_path) {
//         const cleanPath = wm.logo_path.trim();
//         logoUrl = cleanPath.startsWith('http') ? cleanPath : BASE_LOGO_URL + cleanPath;
//     }

//     // 3. Extract Styles exactly from DB
//     const textColor = wm.text_color || '#64748B';
//     const textOpacity = (wm.text_opacity !== undefined ? wm.text_opacity : 25) / 100;
//     const logoOpacity = wm.logo_opacity !== undefined ? wm.logo_opacity : 0.2;
//     const rotation = wm.rotation !== undefined ? wm.rotation : -30;
//     const fontSize = wm.font_size || 14;

//     // 4. Center-Anchored Grid Mapping
//     const posMap = {
//         "top-left": { top: '20%', left: '25%' },
//         "top-center": { top: '20%', left: '50%' },
//         "top-right": { top: '20%', left: '75%' },
//         "middle-left": { top: '50%', left: '25%' },
//         "middle-center": { top: '50%', left: '50%' },
//         "middle-right": { top: '50%', left: '75%' },
//         "bottom-left": { top: '80%', left: '25%' },
//         "bottom-center": { top: '80%', left: '50%' },
//         "bottom-right": { top: '80%', left: '75%' }
//     };

//     // 5. Loop and Render Blocks
//     Object.keys(positions).forEach(posKey => {
//         if (positions[posKey] && posMap[posKey]) {
//             const block = document.createElement('div');
//             block.style.position = 'absolute';
//             block.style.top = posMap[posKey].top;
//             block.style.left = posMap[posKey].left;
//             block.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;

//             block.style.display = 'flex';
//             block.style.flexDirection = 'column';
//             block.style.alignItems = 'center';
//             block.style.justifyContent = 'center';
//             block.style.textAlign = 'center';
//             block.style.color = textColor;
//             block.style.fontSize = `${fontSize}px`;
//             block.style.fontWeight = 'bold';
//             block.style.whiteSpace = 'nowrap';
//             block.style.zIndex = '9999';

//             if (customText) {
//                 const txtSpan = document.createElement('div');
//                 txtSpan.innerText = customText;
//                 txtSpan.style.opacity = textOpacity;
//                 block.appendChild(txtSpan);
//             }

//             if (logoUrl) {
//                 const img = document.createElement('img');
//                 img.src = logoUrl;
//                 img.style.width = '60px';
//                 img.style.maxHeight = '60px';
//                 img.style.objectFit = 'contain';
//                 img.style.margin = '6px 0';
//                 img.style.opacity = logoOpacity;
//                 img.onerror = () => { img.style.display = 'none'; };
//                 block.appendChild(img);
//             }

//             if (showEmail && email) {
//                 const emSpan = document.createElement('div');
//                 emSpan.innerText = email;
//                 emSpan.style.opacity = textOpacity;
//                 block.appendChild(emSpan);
//             }

//             if (showDate) {
//                 const dtSpan = document.createElement('div');
//                 dtSpan.innerText = new Date().toLocaleString();
//                 dtSpan.style.opacity = textOpacity;
//                 block.appendChild(dtSpan);
//             }

//             wmLayer.appendChild(block);
//         }
//     });

//     target.appendChild(wmLayer);
// }

// 🔥 ADVANCED WATERMARK & DB CONFIG ENGINE
function applyWatermark(wm, email, targetElementId) {
    const target = document.getElementById(targetElementId);
    if (!target) return;

    const wmLayer = document.createElement('div');
    wmLayer.className = 'secure-watermark-layer';
    wmLayer.style.position = 'absolute';
    wmLayer.style.top = '0'; wmLayer.style.left = '0';
    wmLayer.style.width = '100%'; wmLayer.style.height = '100%';
    wmLayer.style.pointerEvents = 'none'; // Critical: allows clicking through to doc
    wmLayer.style.zIndex = '9999';
    wmLayer.style.overflow = 'hidden';

    // 1. Safely parse Supabase JSON/JSONB columns
    let textConfig = typeof wm.attributes === 'string' ? JSON.parse(wm.attributes || "{}") : (wm.attributes || {});
    let positions = typeof wm.positions === 'string' ? JSON.parse(wm.positions || "{}") : (wm.positions || {});

    const customText = wm.custom_text || "";
    const showEmail = textConfig.email || false;
    const showDate = textConfig.dateTime || false;

    // 2. Base Logo URL Construction (Gets official bucket URL from main.js or builds it)
    const BASE_LOGO_URL = "https://xxlawcufvetxygaqwoxi.supabase.co/storage/v1/object/public/vdr-logos/";
    let logoUrl = wm.final_logo_link || null;
    if (!logoUrl && wm.logo_path) {
        const cleanPath = wm.logo_path.trim();
        logoUrl = cleanPath.startsWith('http') ? cleanPath : BASE_LOGO_URL + cleanPath;
    }

    // 3. Extract Styles EXACTLY from DB
    const textColor = wm.text_color || '#64748B';
    const textOpacity = (wm.text_opacity !== undefined ? wm.text_opacity : 25) / 100;
    const logoOpacity = wm.logo_opacity !== undefined ? wm.logo_opacity : 0.2;
    const rotation = wm.rotation !== undefined ? wm.rotation : -30;
    const fontSize = wm.font_size || 14;

    // 4. Center-Anchored Grid Mapping
    const posMap = {
        "top-left": { top: '20%', left: '25%' },
        "top-center": { top: '20%', left: '50%' },
        "top-right": { top: '20%', left: '75%' },
        "middle-left": { top: '50%', left: '25%' },
        "middle-center": { top: '50%', left: '50%' },
        "middle-right": { top: '50%', left: '75%' },
        "bottom-left": { top: '80%', left: '25%' },
        "bottom-center": { top: '80%', left: '50%' },
        "bottom-right": { top: '80%', left: '75%' }
    };

    // 5. Loop and Render Blocks
    Object.keys(positions).forEach(posKey => {
        if (positions[posKey] && posMap[posKey]) {
            const block = document.createElement('div');
            block.style.position = 'absolute';
            block.style.top = posMap[posKey].top;
            block.style.left = posMap[posKey].left;
            block.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;

            block.style.display = 'flex';
            block.style.flexDirection = 'column';
            block.style.alignItems = 'center';
            block.style.justifyContent = 'center';
            block.style.textAlign = 'center';

            // STRICTLY APPLIES DB FONT SIZE AND COLOR TO ENTIRE BLOCK
            block.style.color = textColor;
            block.style.fontSize = `${fontSize}px`;
            block.style.fontWeight = 'bold';
            block.style.whiteSpace = 'nowrap';
            block.style.zIndex = '9999';

            // --- REORDERED: LOGO -> TEXT -> EMAIL -> DATE ---

            // ITEM 1: Logo (Now at the very top!)
            if (logoUrl) {
                const img = document.createElement('img');
                img.src = logoUrl;
                img.style.width = '60px';
                img.style.maxHeight = '60px';
                img.style.objectFit = 'contain';
                img.style.margin = '0 0 6px 0'; // Adds a small gap *below* the logo
                img.style.opacity = logoOpacity; // Strictly uses DB Logo Opacity
                img.onerror = () => { img.style.display = 'none'; };
                block.appendChild(img);
            }

            // ITEM 2: Custom Text / Name (Below Logo)
            if (customText) {
                const txtSpan = document.createElement('div');
                txtSpan.innerText = customText;
                txtSpan.style.opacity = textOpacity; // Strictly uses DB Text Opacity
                block.appendChild(txtSpan);
            }

            // ITEM 3: Email Address (Below Text)
            if (showEmail && email) {
                const emSpan = document.createElement('div');
                emSpan.innerText = email;
                emSpan.style.opacity = textOpacity; // Strictly uses DB Text Opacity
                block.appendChild(emSpan);
            }

            // ITEM 4: Date (Below Email)
            if (showDate) {
                const dtSpan = document.createElement('div');
                dtSpan.innerText = new Date().toLocaleString();
                dtSpan.style.opacity = textOpacity; // Strictly uses DB Text Opacity
                block.appendChild(dtSpan);
            }

            wmLayer.appendChild(block);
        }
    });

    target.appendChild(wmLayer);
}

// EDITING BINDINGS
document.getElementById('edit-txt-btn').addEventListener('click', () => {
    document.getElementById('edit-txt-btn').classList.add('hidden');
    document.getElementById('edit-txt-tools').classList.remove('hidden');

    const activeTab = openTabs.find(t => t.id === currentActiveDocId);
    if (activeTab) {
        const editor = activeTab.container.querySelector('textarea');
        if (editor) { editor.removeAttribute('readonly'); editor.focus(); }
    }
});

document.getElementById('save-txt-btn').addEventListener('click', async () => {
    const activeTab = openTabs.find(t => t.id === currentActiveDocId);
    const editor = activeTab.container.querySelector('textarea');
    if (!editor) return;

    const saveBtn = document.getElementById('save-txt-btn');
    saveBtn.innerText = "Saving...";
    const newB64Content = btoa(unescape(encodeURIComponent(editor.value)));

    try {
        const savedAuth = await window.api.getAuth();
        const res = await window.api.saveTextEdits({ userId: savedAuth.userId, docId: currentActiveDocId, newB64Content: newB64Content });
        if (res.success) {
            saveBtn.innerText = "✅ Saved!";
            saveBtn.style.background = "#28a745";
            setTimeout(() => {
                document.getElementById('edit-txt-tools').classList.add('hidden');
                loadSecureDocument(savedAuth.userId, currentActiveDocId, true);
            }, 1000);
        } else { throw new Error(res.error); }
    } catch (error) {
        saveBtn.innerText = "⚠️ Failed";
        saveBtn.style.background = "#dc3545";
    }
});

document.getElementById('checkout-office-btn').addEventListener('click', async () => {
    const savedAuth = await window.api.getAuth();
    const btn = document.getElementById('checkout-office-btn');

    if (btn.innerText.includes("Close Office")) {
        btn.innerText = "Cleaning Drive...";
        await window.api.checkinOfficeDoc(checkedOutPath);
        loadSecureDocument(savedAuth.userId, currentActiveDocId, true);
        return;
    }

    btn.innerText = "Opening MS Office...";
    const res = await window.api.checkoutOfficeDoc({ userId: savedAuth.userId, docId: currentActiveDocId, base64Content: rawDecryptedContent, fileName: currentFileName });

    if (res.success) {
        checkedOutPath = res.tempPath;
        btn.innerText = "🔒 Cancel / Close Office";
        btn.style.background = "#dc3545";
    } else {
        btn.innerText = "📝 Edit in MS Office";
    }
});











//best one
// // renderer.js
// window.addEventListener('contextmenu', (e) => e.preventDefault());

// let currentActiveDocId = null;
// let currentExtension = "";
// let currentLogId = null;
// let rawDecryptedContent = null;
// let currentFileName = "";
// let checkedOutPath = null;

// // 🔥 OS-LEVEL SECURITY SHIELD (Locks on Alt-Tab window shifting)
// const blurShield = document.createElement('div');
// blurShield.style.position = 'fixed'; blurShield.style.top = '0'; blurShield.style.left = '0';
// blurShield.style.width = '100vw'; blurShield.style.height = '100vh';
// blurShield.style.backgroundColor = 'black'; blurShield.style.color = 'red';
// blurShield.style.display = 'none'; blurShield.style.flexDirection = 'column';
// blurShield.style.alignItems = 'center'; blurShield.style.justifyContent = 'center';
// blurShield.style.zIndex = '999999'; blurShield.style.fontFamily = 'sans-serif';
// blurShield.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="red" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg><h1 style="margin-top: 20px;">SECURITY LOCK</h1>`;
// document.body.appendChild(blurShield);
// window.addEventListener('blur', () => { blurShield.style.display = 'flex'; });
// window.addEventListener('focus', () => { blurShield.style.display = 'none'; });

// window.addEventListener('beforeunload', () => {
//     if (currentLogId) window.api.closeLog(currentLogId);
// });

// async function initApp() {
//     if (!window.api) return console.error("Bridge missing");

//     window.api.onSyncSuccess(async (msg) => {
//         const btn = document.getElementById('checkout-office-btn');
//         if (btn) { btn.innerText = "✅ Saved & Office Killed!"; btn.style.background = "#28a745"; }

//         setTimeout(async () => {
//             const savedAuth = await window.api.getAuth();
//             loadSecureDocument(savedAuth.userId, currentActiveDocId);
//         }, 1500);
//     });

//     await checkAutoLogin();
// }

// async function checkAutoLogin() {
//     const savedAuth = await window.api.getAuth();
//     if (savedAuth && savedAuth.email && savedAuth.password) {
//         document.getElementById('login-screen').classList.add('hidden');
//         showSystemReady(savedAuth.email);
//     } else { document.getElementById('login-screen').classList.remove('hidden'); }
// }

// document.getElementById('login-btn').addEventListener('click', async () => {
//     const email = document.getElementById('email').value.trim();
//     const password = document.getElementById('password').value.trim();
//     if (!email || !password) return;
//     document.getElementById('login-error').innerText = "Authenticating...";
//     const res = await window.api.login({ email, password });
//     if (res.success) {
//         await window.api.saveAuth({ email, password, userId: res.userId });
//         document.getElementById('login-screen').classList.add('hidden');
//         showSystemReady(email);
//     } else { document.getElementById('login-error').innerText = res.message; }
// });

// function showSystemReady(email) {
//     document.getElementById('auth-screen').classList.remove('hidden');
//     document.getElementById('main-app').classList.add('hidden');
//     document.getElementById('user-email-display').innerText = email;
// }

// document.getElementById('logout-btn').addEventListener('click', async () => {
//     if (currentLogId) window.api.closeLog(currentLogId);
//     await window.api.clearAuth(); window.location.reload();
// });

// document.getElementById('open-file-btn').addEventListener('click', async () => {
//     const btn = document.getElementById('open-file-btn');
//     btn.innerText = "Opening File Explorer...";
//     const res = await window.api.openFileDialog();
//     if (res.success && res.docId) {
//         btn.innerText = "Decrypting File...";
//         const savedAuth = await window.api.getAuth();
//         await loadSecureDocument(savedAuth.userId, res.docId);
//         btn.innerText = "📂 Browse & Open .vdr File";
//     } else { btn.innerText = "📂 Browse & Open .vdr File"; }
// });

// document.getElementById('close-file-btn').addEventListener('click', () => {
//     if (currentLogId) window.api.closeLog(currentLogId);
//     document.getElementById('main-app').classList.add('hidden');
//     document.getElementById('auth-screen').classList.remove('hidden');

//     // Wipe overlay when file exits
//     const existing = document.getElementById('secure-watermark-layer');
//     if (existing) existing.remove();
// });

// async function loadSecureDocument(userId, docId) {
//     document.getElementById('auth-screen').classList.add('hidden');
//     document.getElementById('main-app').classList.remove('hidden');

//     // Ensure the main-app acts as a structural anchor for our fixed watermark glass
//     document.getElementById('main-app').style.position = 'relative';

//     document.getElementById('edit-txt-btn').classList.add('hidden');
//     document.getElementById('edit-txt-tools').classList.add('hidden');
//     document.getElementById('checkout-office-btn').classList.add('hidden');
//     document.getElementById('doc-title').innerText = "Loading...";

//     const response = await window.api.verifyAccess({ userId, docId });

//     if (response.success) {
//         currentLogId = response.logId;
//         currentActiveDocId = docId;
//         rawDecryptedContent = response.content;
//         currentFileName = response.fileName;

//         document.getElementById('doc-title').innerText = currentFileName;
//         const container = document.getElementById('viewer-container');
//         container.classList.add('read-only-mode');

//         const binaryString = atob(response.content);
//         let ext = response.fileName.includes('.') ? response.fileName.split('.').pop().toLowerCase() : '';
//         currentExtension = ext;

//         if (ext === 'pdf') {
//             const pdfDataUri = `data:application/pdf;base64,${response.content}#toolbar=0&navpanes=0`;
//             container.innerHTML = `<iframe src="${pdfDataUri}" width="100%" height="100%" style="border: none; background: white;" allowfullscreen></iframe>`;
//         }
//         else if (ext === 'docx' || ext === 'doc') {
//             const bytes = new Uint8Array(binaryString.length);
//             for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
//             try {
//                 const res = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer });
//                 container.innerHTML = `<div style="width: 100%; padding: 40px; background-color: #1e1e1e; display: flex; justify-content: center;"><div style="background: white !important; color: black !important; padding: 60px; width: 210mm; min-height: 297mm; height: max-content; box-shadow: 0 4px 15px rgba(0,0,0,0.5); font-family: 'Arial', sans-serif; line-height: 1.6; text-align: left; overflow-wrap: break-word;">${res.value}</div></div>`;
//             } catch (e) { container.innerHTML = `<div style="color:red; padding: 20px;">Failed to render Word Doc.</div>`; }
//         }
//         else if (ext === 'xlsx' || ext === 'csv' || ext === 'xls') {
//             try {
//                 const workbook = XLSX.read(response.content, { type: 'base64' });
//                 const htmlStr = XLSX.utils.sheet_to_html(workbook.Sheets[workbook.SheetNames[0]]);
//                 container.innerHTML = `
//                 <div style="background: white; padding: 20px; width: 100%; height: 100%; overflow: auto;">
//                     <style>
//                         #excel-table table { border-collapse: collapse; min-width: 100%; font-family: 'Segoe UI', sans-serif; font-size: 14px; color: black; }
//                         #excel-table th, #excel-table td { border: 1px solid #d2d2d2; padding: 8px 12px; text-align: left; white-space: nowrap; }
//                         #excel-table th { background-color: #f3f2f1; font-weight: 600; border-bottom: 2px solid #ccc; position: sticky; top: 0; }
//                     </style>
//                     <div id="excel-table">${htmlStr}</div>
//                 </div>`;
//             } catch (e) { container.innerHTML = `<div style="color:red; padding: 20px;">Failed to render Excel.</div>`; }
//         }
//         else {
//             container.innerHTML = `<textarea style="width: 90%; max-width: 900px; height: 90vh; background: #2d2d2d; color: white; padding: 30px; font-family: monospace; resize:none; outline: none; border:none; margin-top: 20px;" readonly>${binaryString}</textarea>`;
//         }

//         // 🔥 INJECT WATERMARK AND PASS THE FILE EXTENSION (ext)
//         if (response.watermark) {
//             const savedAuth = await window.api.getAuth();
//             applyWatermark(response.watermark, savedAuth.email, ext);
//         }

//         if (response.canEdit) {
//             if (ext === 'txt' || ext === 'html') {
//                 document.getElementById('edit-txt-btn').classList.remove('hidden');
//             } else if (ext === 'docx' || ext === 'doc' || ext === 'xlsx' || ext === 'xls') {
//                 const checkBtn = document.getElementById('checkout-office-btn');
//                 checkBtn.classList.remove('hidden');
//                 checkBtn.innerText = "📝 Edit in MS Office";
//                 checkBtn.style.background = "#007acc";
//             }
//         }

//     } else {
//         document.getElementById('main-app').classList.add('hidden');
//         document.getElementById('auth-screen').classList.remove('hidden');
//         document.getElementById('auth-screen').innerHTML += `
//             <div style="margin-top: 20px; padding: 15px; background: rgba(220, 53, 69, 0.2); border: 1px solid #dc3545; border-radius: 5px;">
//                 <h3 style="color: #dc3545; margin:0 0 10px 0;">Security Violation</h3>
//                 <p style="margin:0; font-size: 14px;">${response.error}</p>
//             </div>`;
//     }
// }

// document.getElementById('edit-txt-btn').addEventListener('click', () => {
//     document.getElementById('edit-txt-btn').classList.add('hidden');
//     document.getElementById('edit-txt-tools').classList.remove('hidden');
//     const editor = document.querySelector('textarea');
//     if (editor) { editor.removeAttribute('readonly'); editor.focus(); }
// });

// document.getElementById('save-txt-btn').addEventListener('click', async () => {
//     const editor = document.querySelector('textarea');
//     if (!editor) return;
//     const saveBtn = document.getElementById('save-txt-btn');
//     saveBtn.innerText = "Saving...";
//     const newB64Content = btoa(unescape(encodeURIComponent(editor.value)));

//     try {
//         const savedAuth = await window.api.getAuth();
//         const res = await window.api.saveTextEdits({ userId: savedAuth.userId, docId: currentActiveDocId, newB64Content: newB64Content });
//         if (res.success) {
//             saveBtn.innerText = "✅ Saved!";
//             saveBtn.style.background = "#28a745";
//             setTimeout(() => {
//                 document.getElementById('edit-txt-tools').classList.add('hidden');
//                 loadSecureDocument(savedAuth.userId, currentActiveDocId);
//             }, 1000);
//         } else { throw new Error(res.error); }
//     } catch (error) {
//         saveBtn.innerText = "⚠️ Failed";
//         saveBtn.style.background = "#dc3545";
//     }
// });

// document.getElementById('checkout-office-btn').addEventListener('click', async () => {
//     const savedAuth = await window.api.getAuth();
//     const btn = document.getElementById('checkout-office-btn');

//     if (btn.innerText.includes("Close Office")) {
//         btn.innerText = "Cleaning Drive...";
//         await window.api.checkinOfficeDoc(checkedOutPath);
//         loadSecureDocument(savedAuth.userId, currentActiveDocId);
//         return;
//     }

//     btn.innerText = "Opening MS Office...";
//     const res = await window.api.checkoutOfficeDoc({ userId: savedAuth.userId, docId: currentActiveDocId, base64Content: rawDecryptedContent, fileName: currentFileName });

//     if (res.success) {
//         checkedOutPath = res.tempPath;
//         btn.innerText = "🔒 Cancel / Close Office";
//         btn.style.background = "#dc3545";
//     } else {
//         btn.innerText = "📝 Edit in MS Office";
//     }
// });

// 🔥 STATIONARY GLASS PANE WATERMARK ENGINE

// function applyWatermark(wmData, userEmail, ext) {
//     const existing = document.getElementById('secure-watermark-layer');
//     if (existing) existing.remove();

//     const layer = document.createElement('div');
//     layer.id = 'secure-watermark-layer';

//     // Position it absolutely relative to the window, disconnected from the scroll!
//     layer.style.position = 'absolute';
//     layer.style.top = '60px'; // Sit perfectly below the toolbar
//     layer.style.left = '50%';
//     layer.style.transform = 'translateX(-50%)'; // Center it perfectly on the monitor
//     layer.style.height = 'calc(100vh - 60px)';
//     layer.style.pointerEvents = 'none'; // Critical: allows mouse clicks to pass through
//     layer.style.zIndex = '9998';
//     layer.style.overflow = 'hidden';

//     // 🔥 BOUNDARY LOCK: Confine the grid strictly to the width of the document
//     if (ext === 'docx' || ext === 'doc') {
//         layer.style.width = '210mm'; // Exactly A4 paper width
//     } else if (ext === 'txt' || ext === 'html') {
//         layer.style.width = '90%';
//         layer.style.maxWidth = '900px'; // Matches the textarea box width
//     } else {
//         layer.style.width = '100%'; // PDFs and Excel span the full viewer width
//     }

//     let attrs = typeof wmData.attributes === 'string' ? JSON.parse(wmData.attributes) : wmData.attributes;
//     let textParts = [];

//     if (wmData.custom_text) textParts.push(wmData.custom_text);
//     if (attrs && attrs.cmpname) textParts.push("INTERNAL ONLY");
//     if (attrs && attrs.email) textParts.push(userEmail);
//     if (attrs && attrs.userName) textParts.push("CLASSIFIED ACCESS");
//     if (attrs && attrs.ipAddress) textParts.push("SYSTEM AUDITED");
//     if (attrs && attrs.dateTime) textParts.push(new Date().toLocaleDateString());

//     const finalWatermarkString = textParts.join(' | ');
//     let positions = typeof wmData.positions === 'string' ? JSON.parse(wmData.positions) : wmData.positions;

//     const gridMap = {
//         'top-left': { top: '15%', left: '15%' },
//         'top-center': { top: '15%', left: '50%' },
//         'top-right': { top: '15%', left: '85%' },
//         'middle-left': { top: '50%', left: '15%' },
//         'middle-center': { top: '50%', left: '50%' },
//         'middle-right': { top: '50%', left: '85%' },
//         'bottom-left': { top: '85%', left: '15%' },
//         'bottom-center': { top: '85%', left: '50%' },
//         'bottom-right': { top: '85%', left: '85%' }
//     };

//     if (positions) {
//         for (const [key, isEnabled] of Object.entries(positions)) {
//             if (isEnabled && gridMap[key]) {
//                 const mark = document.createElement('div');
//                 mark.innerText = finalWatermarkString;

//                 mark.style.position = 'absolute';
//                 mark.style.top = gridMap[key].top;
//                 mark.style.left = gridMap[key].left;

//                 // Rotates perfectly anchored to the explicit coordinate
//                 mark.style.transform = `translate(-50%, -50%) rotate(${wmData.rotation}deg)`;

//                 mark.style.fontSize = `${wmData.font_size}px`;
//                 mark.style.color = wmData.text_color;
//                 mark.style.opacity = wmData.text_opacity / 100;

//                 mark.style.whiteSpace = 'nowrap';
//                 mark.style.fontFamily = "'Segoe UI', Arial, sans-serif";
//                 mark.style.fontWeight = 'bold';
//                 mark.style.userSelect = 'none';

//                 layer.appendChild(mark);
//             }
//         }
//     }

//     document.getElementById('main-app').appendChild(layer);
// }

// 🔥 STATIONARY GLASS PANE WATERMARK ENGINE (Stacked Vertically)
// function applyWatermark(wmData, userEmail, ext) {
//     const existing = document.getElementById('secure-watermark-layer');
//     if (existing) existing.remove();

//     const layer = document.createElement('div');
//     layer.id = 'secure-watermark-layer';

//     // Position it absolutely relative to the window, disconnected from the scroll!
//     layer.style.position = 'absolute';
//     layer.style.top = '60px'; // Sit perfectly below the toolbar
//     layer.style.left = '50%';
//     layer.style.transform = 'translateX(-50%)'; // Center it perfectly on the monitor
//     layer.style.height = 'calc(100vh - 60px)';
//     layer.style.pointerEvents = 'none'; // Critical: allows mouse clicks to pass through
//     layer.style.zIndex = '9998';
//     layer.style.overflow = 'hidden';

//     // 🔥 BOUNDARY LOCK: Confine the grid strictly to the width of the document
//     if (ext === 'docx' || ext === 'doc') {
//         layer.style.width = '210mm'; // Exactly A4 paper width
//     } else if (ext === 'txt' || ext === 'html') {
//         layer.style.width = '90%';
//         layer.style.maxWidth = '900px';
//     } else {
//         layer.style.width = '100%'; // PDFs and Excel span the full viewer width
//     }

//     let attrs = typeof wmData.attributes === 'string' ? JSON.parse(wmData.attributes) : wmData.attributes;
//     let textParts = [];

//     if (wmData.custom_text) textParts.push(wmData.custom_text);
//     if (attrs && attrs.cmpname) textParts.push("INTERNAL ONLY");
//     if (attrs && attrs.email) textParts.push(userEmail);
//     if (attrs && attrs.dateTime) textParts.push(new Date().toLocaleDateString());

//     // 🔥 THE FIX: Join with HTML line breaks instead of straight lines
//     const finalWatermarkString = textParts.join('<br>');

//     let positions = typeof wmData.positions === 'string' ? JSON.parse(wmData.positions) : wmData.positions;

//     const gridMap = {
//         'top-left': { top: '15%', left: '15%' },
//         'top-center': { top: '15%', left: '50%' },
//         'top-right': { top: '15%', left: '85%' },
//         'middle-left': { top: '50%', left: '15%' },
//         'middle-center': { top: '50%', left: '50%' },
//         'middle-right': { top: '50%', left: '85%' },
//         'bottom-left': { top: '85%', left: '15%' },
//         'bottom-center': { top: '85%', left: '50%' },
//         'bottom-right': { top: '85%', left: '85%' }
//     };

//     if (positions) {
//         for (const [key, isEnabled] of Object.entries(positions)) {
//             if (isEnabled && gridMap[key]) {
//                 const mark = document.createElement('div');

//                 // 🔥 THE FIX: Use innerHTML so the <br> tags render properly
//                 mark.innerHTML = finalWatermarkString;

//                 mark.style.position = 'absolute';
//                 mark.style.top = gridMap[key].top;
//                 mark.style.left = gridMap[key].left;

//                 // Rotates flawlessly around explicit coordinates
//                 mark.style.transform = `translate(-50%, -50%) rotate(${wmData.rotation}deg)`;

//                 mark.style.fontSize = `${wmData.font_size}px`;
//                 mark.style.color = wmData.text_color;
//                 mark.style.opacity = wmData.text_opacity / 100;

//                 // 🔥 THE FIX: Center the stacked text nicely with good line height
//                 mark.style.textAlign = 'center';
//                 mark.style.lineHeight = '1.4';
//                 mark.style.whiteSpace = 'nowrap';
//                 mark.style.fontFamily = "'Segoe UI', Arial, sans-serif";
//                 mark.style.fontWeight = 'bold';
//                 mark.style.userSelect = 'none';

//                 layer.appendChild(mark);
//             }
//         }
//     }

//     document.getElementById('main-app').appendChild(layer);
// }

// document.addEventListener('DOMContentLoaded', initApp);
















//perfect one without watermark overlay
// // renderer.js
// window.addEventListener('contextmenu', (e) => e.preventDefault());

// let currentActiveDocId = null;
// let currentExtension = "";
// let currentLogId = null;
// let rawDecryptedContent = null;
// let currentFileName = "";
// let checkedOutPath = null;

// // 🔥 OS-LEVEL SECURITY SHIELD (Locks on Alt-Tab)
// const blurShield = document.createElement('div');
// blurShield.style.position = 'fixed'; blurShield.style.top = '0'; blurShield.style.left = '0';
// blurShield.style.width = '100vw'; blurShield.style.height = '100vh';
// blurShield.style.backgroundColor = 'black'; blurShield.style.color = 'red';
// blurShield.style.display = 'none'; blurShield.style.flexDirection = 'column';
// blurShield.style.alignItems = 'center'; blurShield.style.justifyContent = 'center';
// blurShield.style.zIndex = '999999'; blurShield.style.fontFamily = 'sans-serif';
// blurShield.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="red" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg><h1 style="margin-top: 20px;">SECURITY LOCK</h1>`;
// document.body.appendChild(blurShield);
// window.addEventListener('blur', () => { blurShield.style.display = 'flex'; });
// window.addEventListener('focus', () => { blurShield.style.display = 'none'; });

// window.addEventListener('beforeunload', () => {
//     if (currentLogId) window.api.closeLog(currentLogId);
// });

// async function initApp() {
//     if (!window.api) return console.error("Bridge missing");

//     window.api.onSyncSuccess(async (msg) => {
//         const btn = document.getElementById('checkout-office-btn');
//         if (btn) { btn.innerText = "✅ Saved & Office Killed!"; btn.style.background = "#28a745"; }

//         setTimeout(async () => {
//             const savedAuth = await window.api.getAuth();
//             loadSecureDocument(savedAuth.userId, currentActiveDocId);
//         }, 1500);
//     });

//     await checkAutoLogin();
// }

// async function checkAutoLogin() {
//     const savedAuth = await window.api.getAuth();
//     if (savedAuth && savedAuth.email && savedAuth.password) {
//         document.getElementById('login-screen').classList.add('hidden');
//         showSystemReady(savedAuth.email);
//     } else { document.getElementById('login-screen').classList.remove('hidden'); }
// }

// document.getElementById('login-btn').addEventListener('click', async () => {
//     const email = document.getElementById('email').value.trim();
//     const password = document.getElementById('password').value.trim();
//     if (!email || !password) return;
//     document.getElementById('login-error').innerText = "Authenticating...";
//     const res = await window.api.login({ email, password });
//     if (res.success) {
//         await window.api.saveAuth({ email, password, userId: res.userId });
//         document.getElementById('login-screen').classList.add('hidden');
//         showSystemReady(email);
//     } else { document.getElementById('login-error').innerText = res.message; }
// });

// function showSystemReady(email) {
//     document.getElementById('auth-screen').classList.remove('hidden');
//     document.getElementById('main-app').classList.add('hidden');
//     document.getElementById('user-email-display').innerText = email;
// }

// document.getElementById('logout-btn').addEventListener('click', async () => {
//     if (currentLogId) window.api.closeLog(currentLogId);
//     await window.api.clearAuth(); window.location.reload();
// });

// document.getElementById('open-file-btn').addEventListener('click', async () => {
//     const btn = document.getElementById('open-file-btn');
//     btn.innerText = "Opening File Explorer...";
//     const res = await window.api.openFileDialog();
//     if (res.success && res.docId) {
//         btn.innerText = "Decrypting File...";
//         const savedAuth = await window.api.getAuth();
//         await loadSecureDocument(savedAuth.userId, res.docId);
//         btn.innerText = "📂 Browse & Open .vdr File";
//     } else { btn.innerText = "📂 Browse & Open .vdr File"; }
// });

// document.getElementById('close-file-btn').addEventListener('click', () => {
//     if (currentLogId) window.api.closeLog(currentLogId);
//     document.getElementById('main-app').classList.add('hidden');
//     document.getElementById('auth-screen').classList.remove('hidden');
// });

// async function loadSecureDocument(userId, docId) {
//     document.getElementById('auth-screen').classList.add('hidden');
//     document.getElementById('main-app').classList.remove('hidden');

//     document.getElementById('edit-txt-btn').classList.add('hidden');
//     document.getElementById('edit-txt-tools').classList.add('hidden');
//     document.getElementById('checkout-office-btn').classList.add('hidden');
//     document.getElementById('doc-title').innerText = "Loading...";

//     const response = await window.api.verifyAccess({ userId, docId });

//     if (response.success) {
//         currentLogId = response.logId;
//         currentActiveDocId = docId;
//         rawDecryptedContent = response.content;
//         currentFileName = response.fileName;

//         document.getElementById('doc-title').innerText = currentFileName;
//         const container = document.getElementById('viewer-container');
//         container.classList.add('read-only-mode');

//         const binaryString = atob(response.content);
//         let ext = response.fileName.includes('.') ? response.fileName.split('.').pop().toLowerCase() : '';
//         currentExtension = ext;

//         if (ext === 'pdf') {
//             const pdfDataUri = `data:application/pdf;base64,${response.content}#toolbar=0&navpanes=0`;
//             container.innerHTML = `<iframe src="${pdfDataUri}" width="100%" height="100%" style="border: none; background: white;" allowfullscreen></iframe>`;
//         }
//         else if (ext === 'docx' || ext === 'doc') {
//             const bytes = new Uint8Array(binaryString.length);
//             for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
//             try {
//                 const res = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer });
//                 // 🔥 THE FIX: Removed height limits so it expands downwards naturally!
//                 container.innerHTML = `<div style="width: 100%; padding: 40px; background-color: #1e1e1e; display: flex; justify-content: center;"><div style="background: white !important; color: black !important; padding: 60px; width: 210mm; min-height: 297mm; height: max-content; box-shadow: 0 4px 15px rgba(0,0,0,0.5); font-family: 'Arial', sans-serif; line-height: 1.6; text-align: left; overflow-wrap: break-word;">${res.value}</div></div>`;
//             } catch (e) { container.innerHTML = `<div style="color:red; padding: 20px;">Failed to render Word Doc.</div>`; }
//         }
//         else if (ext === 'xlsx' || ext === 'csv' || ext === 'xls') {
//             try {
//                 const workbook = XLSX.read(response.content, { type: 'base64' });
//                 const htmlStr = XLSX.utils.sheet_to_html(workbook.Sheets[workbook.SheetNames[0]]);
//                 // 🔥 THE FIX: Sticky Headers and Nowrap for perfect Excel structure
//                 container.innerHTML = `
//                 <div style="background: white; padding: 20px; width: 100%; height: 100%; overflow: auto;">
//                     <style>
//                         #excel-table table { border-collapse: collapse; min-width: 100%; font-family: 'Segoe UI', sans-serif; font-size: 14px; color: black; }
//                         #excel-table th, #excel-table td { border: 1px solid #d2d2d2; padding: 8px 12px; text-align: left; white-space: nowrap; }
//                         #excel-table th { background-color: #f3f2f1; font-weight: 600; border-bottom: 2px solid #ccc; position: sticky; top: 0; }
//                     </style>
//                     <div id="excel-table">${htmlStr}</div>
//                 </div>`;
//             } catch (e) { container.innerHTML = `<div style="color:red; padding: 20px;">Failed to render Excel.</div>`; }
//         }
//         else {
//             container.innerHTML = `<textarea style="width: 90%; max-width: 900px; height: 90vh; background: #2d2d2d; color: white; padding: 30px; font-family: monospace; resize:none; outline: none; border:none; margin-top: 20px;" readonly>${binaryString}</textarea>`;
//         }

//         if (response.canEdit) {
//             if (ext === 'txt' || ext === 'html') {
//                 document.getElementById('edit-txt-btn').classList.remove('hidden');
//             } else if (ext === 'docx' || ext === 'doc' || ext === 'xlsx' || ext === 'xls') {
//                 const checkBtn = document.getElementById('checkout-office-btn');
//                 checkBtn.classList.remove('hidden');
//                 checkBtn.innerText = "📝 Edit in MS Office";
//                 checkBtn.style.background = "#007acc";
//             }
//         }

//     } else {
//         document.getElementById('main-app').classList.add('hidden');
//         document.getElementById('auth-screen').classList.remove('hidden');
//         document.getElementById('auth-screen').innerHTML += `
//             <div style="margin-top: 20px; padding: 15px; background: rgba(220, 53, 69, 0.2); border: 1px solid #dc3545; border-radius: 5px;">
//                 <h3 style="color: #dc3545; margin:0 0 10px 0;">Security Violation</h3>
//                 <p style="margin:0; font-size: 14px;">${response.error}</p>
//             </div>`;
//     }
// }

// document.getElementById('edit-txt-btn').addEventListener('click', () => {
//     document.getElementById('edit-txt-btn').classList.add('hidden');
//     document.getElementById('edit-txt-tools').classList.remove('hidden');
//     const editor = document.querySelector('textarea');
//     if (editor) { editor.removeAttribute('readonly'); editor.focus(); }
// });

// document.getElementById('save-txt-btn').addEventListener('click', async () => {
//     const editor = document.querySelector('textarea');
//     if (!editor) return;
//     const saveBtn = document.getElementById('save-txt-btn');
//     saveBtn.innerText = "Saving...";
//     const newB64Content = btoa(unescape(encodeURIComponent(editor.value)));

//     try {
//         const savedAuth = await window.api.getAuth();
//         const res = await window.api.saveTextEdits({ userId: savedAuth.userId, docId: currentActiveDocId, newB64Content: newB64Content });
//         if (res.success) {
//             saveBtn.innerText = "✅ Saved!";
//             saveBtn.style.background = "#28a745";
//             setTimeout(() => {
//                 document.getElementById('edit-txt-tools').classList.add('hidden');
//                 loadSecureDocument(savedAuth.userId, currentActiveDocId);
//             }, 1000);
//         } else { throw new Error(res.error); }
//     } catch (error) {
//         saveBtn.innerText = "⚠️ Failed";
//         saveBtn.style.background = "#dc3545";
//     }
// });

// document.getElementById('checkout-office-btn').addEventListener('click', async () => {
//     const savedAuth = await window.api.getAuth();
//     const btn = document.getElementById('checkout-office-btn');

//     if (btn.innerText.includes("Close Office")) {
//         btn.innerText = "Cleaning Drive...";
//         await window.api.checkinOfficeDoc(checkedOutPath);
//         loadSecureDocument(savedAuth.userId, currentActiveDocId);
//         return;
//     }

//     btn.innerText = "Opening MS Office...";
//     const res = await window.api.checkoutOfficeDoc({ userId: savedAuth.userId, docId: currentActiveDocId, base64Content: rawDecryptedContent, fileName: currentFileName });

//     if (res.success) {
//         checkedOutPath = res.tempPath;
//         btn.innerText = "🔒 Cancel / Close Office";
//         btn.style.background = "#dc3545";
//     } else {
//         btn.innerText = "📝 Edit in MS Office";
//     }
// });

// document.addEventListener('DOMContentLoaded', initApp);













