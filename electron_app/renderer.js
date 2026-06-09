// renderer.js
window.addEventListener('contextmenu', (e) => e.preventDefault());

let currentActiveDocId = null;
let currentExtension = "";

// 🔥 OS-LEVEL SECURITY: The Blur Shield
const blurShield = document.createElement('div');
blurShield.style.position = 'fixed';
blurShield.style.top = '0'; blurShield.style.left = '0';
blurShield.style.width = '100vw'; blurShield.style.height = '100vh';
blurShield.style.backgroundColor = 'black';
blurShield.style.color = 'red';
blurShield.style.display = 'flex';
blurShield.style.flexDirection = 'column';
blurShield.style.alignItems = 'center';
blurShield.style.justifyContent = 'center';
blurShield.style.zIndex = '999999';
blurShield.style.fontFamily = 'sans-serif';
blurShield.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="red" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
    <h1 style="margin-top: 20px;">SECURITY LOCK</h1>
    <p>Application lost focus. Click here to resume secure viewing.</p>
`;
blurShield.style.display = 'none';
document.body.appendChild(blurShield);

window.addEventListener('blur', () => { blurShield.style.display = 'flex'; });
window.addEventListener('focus', () => { blurShield.style.display = 'none'; });

// 1. SAFE BOOT SEQUENCE
async function initApp() {
    if (!window.api) {
        document.body.innerHTML = `
            <div style="display:flex; justify-content:center; align-items:center; height:100vh; flex-direction:column; background:#1e1e1e; color:white;">
                <h1 style="color: #ff4d4d;">CRITICAL SYSTEM ERROR</h1>
                <p>Security Bridge failed to connect.</p>
            </div>`;
        return;
    }

    window.api.onOpenFile((docId) => {
        currentActiveDocId = docId;
        checkAutoLogin();
    });

    const startupDocId = await window.api.getStartupFile();
    if (startupDocId) currentActiveDocId = startupDocId;

    await checkAutoLogin();
}

// 2. SECURE AUTO LOGIN
async function checkAutoLogin() {
    const savedAuth = await window.api.getAuth();

    if (savedAuth && savedAuth.email && savedAuth.password) {
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('auth-screen').classList.remove('hidden');
        document.getElementById('auth-screen').innerHTML = `<h2>Verifying security credentials...</h2>`;

        const loginResult = await window.api.login({ email: savedAuth.email, password: savedAuth.password });

        if (loginResult.success) {
            if (currentActiveDocId) {
                await loadSecureDocument(loginResult.userId, currentActiveDocId);
            } else {
                showSystemReady(savedAuth.email);
            }
        } else {
            await window.api.clearAuth();
            document.getElementById('auth-screen').classList.add('hidden');
            document.getElementById('login-screen').classList.remove('hidden');
        }
    } else {
        document.getElementById('auth-screen').classList.add('hidden');
        document.getElementById('login-screen').classList.remove('hidden');
    }
}

// 3. MANUAL LOGIN
document.getElementById('login-btn').addEventListener('click', async () => {
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value.trim();
    const errorDiv = document.getElementById('login-error');

    if (!email || !password) return errorDiv.innerText = "Provide email and password.";
    errorDiv.innerText = "Authenticating...";

    const loginResult = await window.api.login({ email, password });

    if (loginResult.success) {
        await window.api.saveAuth({ email, password, userId: loginResult.userId });
        document.getElementById('login-screen').classList.add('hidden');

        if (currentActiveDocId) await loadSecureDocument(loginResult.userId, currentActiveDocId);
        else showSystemReady(email);
    } else {
        errorDiv.innerText = loginResult.message || loginResult.error || "Login Failed";
    }
});

// 4. DOCUMENT ROUTER
async function loadSecureDocument(userId, docId) {
    const authScreen = document.getElementById('auth-screen');
    authScreen.classList.remove('hidden');
    authScreen.innerHTML = `<h2>Decrypting file from Vault...</h2>`;

    const response = await window.api.verifyAccess({ userId, docId });

    if (response.success) {
        authScreen.classList.add('hidden');
        document.getElementById('main-app').classList.remove('hidden');

        const container = document.getElementById('viewer-container');
        container.classList.add('read-only-mode');

        const binaryString = atob(response.content);
        let ext = response.fileName.includes('.') ? response.fileName.split('.').pop().toLowerCase() : '';

        if (binaryString.startsWith("%PDF")) ext = 'pdf';
        else if (binaryString.startsWith("PK")) {
            if (binaryString.includes("word/document.xml")) ext = 'docx';
            else if (binaryString.includes("xl/worksheets")) ext = 'xlsx';
        } else if (binaryString.trim().startsWith("<html") || binaryString.trim().startsWith("<!DOCTYPE html>")) {
            ext = 'html';
        }
        currentExtension = ext;

        if (ext === 'pdf') {
            const pdfDataUri = `data:application/pdf;base64,${response.content}#toolbar=0&navpanes=0`;
            container.innerHTML = `<iframe src="${pdfDataUri}" width="100%" height="100%" style="border: none;" allowfullscreen></iframe>`;
        }
        else if (ext === 'docx' || ext === 'doc') {
            if (binaryString.startsWith("<")) {
                container.innerHTML = `<div id="data-editor" style="background: white; color: black; padding: 50px; width: 800px; min-height: 100vh; margin: 0 auto;">${binaryString}</div>`;
            } else {
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
                try {
                    const res = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer });
                    container.innerHTML = `<div id="data-editor" style="background: white; color: black; padding: 50px; width: 800px; min-height: 100vh; margin: 0 auto; box-shadow: 0 0 10px rgba(0,0,0,0.5);">${res.value}</div>`;
                } catch (e) {
                    container.innerHTML = `<div style="color:red; padding:20px;">Failed to render Word Document.</div>`;
                }
            }
        }
        else if (ext === 'xlsx' || ext === 'csv' || ext === 'xls') {
            try {
                const workbook = XLSX.read(response.content, { type: 'base64' });
                const htmlStr = XLSX.utils.sheet_to_html(workbook.Sheets[workbook.SheetNames[0]]);
                container.innerHTML = `<div id="data-editor" style="background: white; color: black; padding: 20px; width: 95%; height: 95%; overflow: auto; margin: 0 auto;">${htmlStr}</div>`;
            } catch (e) {
                container.innerHTML = `<div style="color:red; padding:20px;">Failed to render Excel Document.</div>`;
            }
        }
        else if (ext === 'html' || ext === 'htm') {
            container.innerHTML = `<div id="data-editor" style="background: white; color: black; width: 100%; height: 100%; overflow: auto;">${binaryString}</div>`;
        }
        else {
            container.innerHTML = `<textarea id="data-editor" style="width: 95%; height: 95%; margin: 20px; background: #2d2d2d; color: white; border: none; padding: 20px; resize:none;" readonly>${binaryString}</textarea>`;
        }

        document.getElementById('edit-btn').style.display = response.canEdit ? 'block' : 'none';

    } else {
        const savedAuth = await window.api.getAuth();
        authScreen.innerHTML = `
            <h2 style="color: #dc3545;">Access Denied</h2>
            <p>${response.error || "Unknown Error"}</p>
            <p>Logged in as: <b>${savedAuth ? savedAuth.email : 'Unknown'}</b></p>
            <button id="logout-btn" class="btn" style="background: #dc3545; margin-top:20px;">Switch User</button>
        `;
        attachLogout();
    }
}

// 5. UNLOCK EDIT MODE
document.getElementById('edit-btn').addEventListener('click', () => {
    if (currentExtension === 'pdf') return alert("🔒 PDFs are secure. Edit the original .docx file instead.");

    document.getElementById('edit-btn').style.display = 'none';
    document.getElementById('edit-tools').classList.remove('hidden');
    document.getElementById('viewer-container').classList.remove('read-only-mode');

    const editor = document.getElementById('data-editor');
    if (editor) {
        if (editor.tagName === 'TEXTAREA') editor.removeAttribute('readonly');
        else { editor.setAttribute('contenteditable', 'true'); editor.style.outline = "2px dashed #ffc107"; }
        editor.focus();
    }
});

// 6. SAVE BACK
document.getElementById('save-btn').addEventListener('click', async () => {
    const editor = document.getElementById('data-editor');
    if (editor) {
        document.getElementById('save-btn').innerText = "Saving to Server...";
        let newB64Content = "";

        if (currentExtension === 'xlsx' || currentExtension === 'csv' || currentExtension === 'xls') {
            const table = document.querySelector('#data-editor table');
            newB64Content = XLSX.write(XLSX.utils.table_to_book(table), { type: 'base64', bookType: 'xlsx' });
        } else if (currentExtension === 'docx' || currentExtension === 'doc' || currentExtension === 'html') {
            newB64Content = btoa(editor.innerHTML);
        } else if (editor.tagName === 'TEXTAREA') {
            newB64Content = btoa(editor.value);
        }

        const savedAuth = await window.api.getAuth();
        const res = await window.api.saveDocumentEdits({ userId: savedAuth.userId, docId: currentActiveDocId, newB64Content });

        if (res.success) {
            document.getElementById('save-btn').innerText = "✅ Saved!";
            document.getElementById('save-btn').style.background = "#28a745";
            setTimeout(() => { document.getElementById('save-btn').innerText = "💾 Save"; }, 3000);
        } else {
            alert("❌ FAILED TO SAVE:\n" + res.error);
            document.getElementById('save-btn').innerText = "⚠️ Retry";
            document.getElementById('save-btn').style.background = "#dc3545";
        }
    }
});

function showSystemReady(email) {
    const authScreen = document.getElementById('auth-screen');
    authScreen.classList.remove('hidden');
    authScreen.innerHTML = `<h2 style="color: #007acc;">System Ready</h2><p>Logged in as: <b>${email}</b></p><button id="logout-btn" class="btn" style="background: #dc3545; margin-top: 20px;">Log Out</button>`;
    attachLogout();
}
function attachLogout() {
    document.getElementById('logout-btn').addEventListener('click', async () => { await window.api.clearAuth(); window.location.reload(); });
}
document.addEventListener('DOMContentLoaded', initApp);


// // renderer.js
// window.addEventListener('contextmenu', (e) => e.preventDefault());

// let currentActiveDocId = null;
// let currentExtension = '';

// // ── 1. Listen for double-clicked .vdr file (from second instance) ─────────────
// window.api.onOpenFile((docId) => {
//     currentActiveDocId = docId;
//     checkAutoLogin();
// });

// // ── 2. On startup ─────────────────────────────────────────────────────────────
// window.api.getStartupFile().then(docId => {
//     if (docId) currentActiveDocId = docId;
//     checkAutoLogin();
// });

// // ── 3. Auto-login with saved credentials ──────────────────────────────────────
// async function checkAutoLogin() {
//     const savedAuth = await window.api.getAuth();

//     if (savedAuth?.email && savedAuth?.password) {
//         showScreen('auth-screen');
//         document.getElementById('auth-screen').innerHTML = `<h2>Verifying credentials…</h2>`;

//         const result = await window.api.login({ email: savedAuth.email, password: savedAuth.password });

//         if (result.success) {
//             // ✅ FIX: result.user.id — not result.userId
//             const userId = result.user.id;
//             if (currentActiveDocId) {
//                 await loadSecureDocument(userId, currentActiveDocId);
//             } else {
//                 showSystemReady(savedAuth.email, userId);
//             }
//         } else {
//             await window.api.clearAuth();
//             showScreen('login-screen');
//         }
//     } else {
//         // No saved auth — show login
//         showScreen('login-screen');
//     }
// }

// // ── 4. Manual login ───────────────────────────────────────────────────────────
// document.getElementById('login-btn').addEventListener('click', async () => {
//     const email = document.getElementById('email').value.trim();
//     const password = document.getElementById('password').value.trim();
//     const errorDiv = document.getElementById('login-error');

//     if (!email || !password) { errorDiv.innerText = 'Provide email and password.'; return; }
//     errorDiv.innerText = 'Authenticating…';

//     const result = await window.api.login({ email, password });

//     if (result.success) {
//         // ✅ FIX: result.user.id
//         const userId = result.user.id;
//         await window.api.saveAuth({ email, password, userId });
//         if (currentActiveDocId) {
//             await loadSecureDocument(userId, currentActiveDocId);
//         } else {
//             showSystemReady(email, userId);
//         }
//     } else {
//         errorDiv.innerText = result.message || 'Login failed.';
//     }
// });

// // ── 5. Load and decrypt document ──────────────────────────────────────────────
// async function loadSecureDocument(userId, docId) {
//     showScreen('auth-screen');
//     document.getElementById('auth-screen').innerHTML = `<h2>Decrypting file from Vault…</h2>`;

//     const response = await window.api.verifyAccess({ userId, docId });

//     if (response.success) {
//         showScreen('main-app');

//         const container = document.getElementById('viewer-container');
//         container.classList.add('read-only-mode');

//         const binaryString = atob(response.content);

//         // File type sniffer
//         let ext = response.fileName?.includes('.') ? response.fileName.split('.').pop().toLowerCase() : '';
//         if (binaryString.startsWith('%PDF')) ext = 'pdf';
//         else if (binaryString.startsWith('PK')) {
//             if (binaryString.includes('word/document.xml')) ext = 'docx';
//             else if (binaryString.includes('xl/worksheets')) ext = 'xlsx';
//         } else if (binaryString.trim().startsWith('<html') ||
//             binaryString.trim().startsWith('<!DOCTYPE html>')) ext = 'html';

//         currentExtension = ext;

//         if (ext === 'pdf') {
//             const pdfDataUri = `data:application/pdf;base64,${response.content}#toolbar=0&navpanes=0`;
//             container.innerHTML = `<iframe src="${pdfDataUri}" width="100%" height="100%" style="border:none;" allowfullscreen></iframe>`;
//         }
//         else if (ext === 'docx' || ext === 'doc') {
//             if (binaryString.startsWith('<')) {
//                 container.innerHTML = `<div id="data-editor" style="background:white;color:black;padding:50px;width:800px;min-height:100vh;margin:0 auto;">${binaryString}</div>`;
//             } else {
//                 const bytes = new Uint8Array(binaryString.length);
//                 for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
//                 try {
//                     const res = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer });
//                     container.innerHTML = `<div id="data-editor" style="background:white;color:black;padding:50px;width:800px;min-height:100vh;margin:0 auto;box-shadow:0 0 10px rgba(0,0,0,0.5);">${res.value}</div>`;
//                 } catch (e) {
//                     container.innerHTML = `<div style="color:red;padding:20px;">Failed to render Word document: ${e.message}</div>`;
//                 }
//             }
//         }
//         else if (ext === 'xlsx' || ext === 'csv' || ext === 'xls') {
//             try {
//                 const workbook = XLSX.read(response.content, { type: 'base64' });
//                 const htmlStr = XLSX.utils.sheet_to_html(workbook.Sheets[workbook.SheetNames[0]]);
//                 container.innerHTML = `<div id="data-editor" style="background:white;color:black;padding:20px;width:95%;height:95%;overflow:auto;margin:0 auto;">${htmlStr}</div>`;
//             } catch (e) {
//                 container.innerHTML = `<div style="color:red;padding:20px;">Failed to render spreadsheet: ${e.message}</div>`;
//             }
//         }
//         else if (ext === 'html' || ext === 'htm') {
//             container.innerHTML = `<div id="data-editor" style="background:white;color:black;width:100%;height:100%;overflow:auto;">${binaryString}</div>`;
//         }
//         else {
//             container.innerHTML = `<textarea id="data-editor" style="width:95%;height:95%;margin:20px;background:#2d2d2d;color:white;border:none;padding:20px;resize:none;" readonly>${binaryString}</textarea>`;
//         }

//         // Edit button visibility
//         document.getElementById('edit-btn').style.display = response.canEdit ? 'block' : 'none';

//     } else {
//         const savedAuth = await window.api.getAuth();
//         showScreen('auth-screen');
//         document.getElementById('auth-screen').innerHTML = `
//             <h2 style="color:#dc3545;">Access Denied</h2>
//             <p>${response.error}</p>
//             <p>Logged in as: <b>${savedAuth?.email ?? 'Unknown'}</b></p>
//             <button class="btn" style="background:#dc3545;margin-top:20px;" onclick="handleLogout()">Switch User / Log Out</button>
//         `;
//     }
// }

// // ── 6. Edit mode ──────────────────────────────────────────────────────────────
// document.getElementById('edit-btn').addEventListener('click', () => {
//     if (currentExtension === 'pdf') {
//         alert('PDFs are flattened secure documents.\n\nAsk the Admin to upload the original .docx to enable editing.');
//         return;
//     }
//     document.getElementById('edit-btn').style.display = 'none';
//     document.getElementById('edit-tools').classList.remove('hidden');
//     document.getElementById('viewer-container').classList.remove('read-only-mode');

//     const editor = document.getElementById('data-editor');
//     if (editor) {
//         if (editor.tagName === 'TEXTAREA') {
//             editor.removeAttribute('readonly');
//         } else {
//             editor.setAttribute('contenteditable', 'true');
//             editor.style.outline = '2px dashed #ffc107';
//         }
//         editor.focus();
//     }
// });

// // ── 7. Save edits ─────────────────────────────────────────────────────────────
// document.getElementById('save-btn').addEventListener('click', async () => {
//     const editor = document.getElementById('data-editor');
//     if (!editor) return;

//     document.getElementById('save-btn').innerText = 'Saving to Server…';
//     let newB64Content = '';

//     if (['xlsx', 'csv', 'xls'].includes(currentExtension)) {
//         const table = document.querySelector('#data-editor table');
//         const workbook = XLSX.utils.table_to_book(table);
//         newB64Content = XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' });
//     } else if (['docx', 'doc', 'html', 'htm'].includes(currentExtension)) {
//         newB64Content = btoa(unescape(encodeURIComponent(editor.innerHTML)));
//     } else if (editor.tagName === 'TEXTAREA') {
//         newB64Content = btoa(unescape(encodeURIComponent(editor.value)));
//     } else {
//         alert('Cannot save this format.');
//         document.getElementById('save-btn').innerText = '💾 Save Changes to Server';
//         return;
//     }

//     const savedAuth = await window.api.getAuth();
//     const res = await window.api.saveDocumentEdits({
//         userId: savedAuth.userId,
//         docId: currentActiveDocId,
//         newB64Content,
//     });

//     if (res.success) {
//         document.getElementById('save-btn').innerText = '✅ Saved!';
//         document.getElementById('save-btn').style.background = '#28a745';
//         setTimeout(() => {
//             document.getElementById('save-btn').innerText = '💾 Save Changes to Server';
//             document.getElementById('save-btn').style.background = '';
//         }, 3000);
//     } else {
//         alert('❌ SAVE FAILED:\n\n' + res.error + '\n\nCheck the terminal for logs.');
//         document.getElementById('save-btn').innerText = '⚠️ Retry Save';
//         document.getElementById('save-btn').style.background = '#dc3545';
//     }
// });

// // ── Utilities ─────────────────────────────────────────────────────────────────
// function showScreen(id) {
//     ['login-screen', 'auth-screen', 'main-app'].forEach(s => {
//         document.getElementById(s).classList.add('hidden');
//     });
//     document.getElementById(id).classList.remove('hidden');
// }

// function showSystemReady(email, userId) {
//     showScreen('auth-screen');
//     document.getElementById('auth-screen').innerHTML = `
//         <h2 style="color:#007acc;">System Ready</h2>
//         <p>Logged in as: <b>${email}</b></p>
//         <button class="btn" style="background:#dc3545;margin-top:20px;" onclick="handleLogout()">Log Out</button>
//     `;
// }

// async function handleLogout() {
//     await window.api.clearAuth();
//     window.location.reload();
// }




// // 🔥 GLOBAL SECURITY FIX: Completely disable Right-Clicking everywhere!
// // This stops downloads, and allows us to remove the PDF overlay so you can scroll/zoom!
// window.addEventListener('contextmenu', (e) => e.preventDefault());

// let currentActiveDocId = null;
// let currentExtension = "";

// // 1. Listen for double-clicked file
// window.api.onOpenFile((docId) => {
//     currentActiveDocId = docId;
//     checkAutoLogin();
// });

// // 2. On Startup
// window.api.getStartupFile().then(docId => {
//     if (docId) currentActiveDocId = docId;
//     checkAutoLogin();
// });

// // 3. SECURE OS-LEVEL AUTO LOGIN
// async function checkAutoLogin() {
//     const savedAuth = await window.api.getAuth();

//     if (savedAuth && savedAuth.email && savedAuth.password) {
//         document.getElementById('login-screen').classList.add('hidden');
//         document.getElementById('auth-screen').classList.remove('hidden');
//         document.getElementById('auth-screen').innerHTML = `<h2>Verifying security credentials...</h2>`;

//         const loginResult = await window.api.login({ email: savedAuth.email, password: savedAuth.password });

//         if (loginResult.success) {
//             if (currentActiveDocId) {
//                 await loadSecureDocument(loginResult.userId, currentActiveDocId);
//             } else {
//                 showSystemReady(savedAuth.email);
//             }
//         } else {
//             await window.api.clearAuth();
//             document.getElementById('auth-screen').classList.add('hidden');
//             document.getElementById('login-screen').classList.remove('hidden');
//         }
//     } else {
//         document.getElementById('auth-screen').classList.add('hidden');
//         document.getElementById('login-screen').classList.remove('hidden');
//     }
// }

// // 4. Manual Login
// document.getElementById('login-btn').addEventListener('click', async () => {
//     const email = document.getElementById('email').value.trim();
//     const password = document.getElementById('password').value.trim();
//     const errorDiv = document.getElementById('login-error');

//     if (!email || !password) return errorDiv.innerText = "Provide email and password.";
//     errorDiv.innerText = "Authenticating...";

//     const loginResult = await window.api.login({ email, password });

//     if (loginResult.success) {
//         await window.api.saveAuth({ email, password, userId: loginResult.userId });
//         document.getElementById('login-screen').classList.add('hidden');

//         if (currentActiveDocId) await loadSecureDocument(loginResult.userId, currentActiveDocId);
//         else showSystemReady(email);
//     } else {
//         errorDiv.innerText = loginResult.error;
//     }
// });

// // 5. THE UNIVERSAL DOCUMENT ROUTER
// async function loadSecureDocument(userId, docId) {
//     const authScreen = document.getElementById('auth-screen');
//     authScreen.classList.remove('hidden');
//     authScreen.innerHTML = `<h2>Decrypting file from Vault...</h2>`;

//     const response = await window.api.verifyAccess({ userId, docId });

//     if (response.success) {
//         authScreen.classList.add('hidden');
//         document.getElementById('main-app').classList.remove('hidden');

//         const container = document.getElementById('viewer-container');
//         container.classList.add('read-only-mode'); // Block copy/paste initially

//         const binaryString = atob(response.content);

//         // Advanced File Sniffer
//         let ext = response.fileName.includes('.') ? response.fileName.split('.').pop().toLowerCase() : '';
//         if (binaryString.startsWith("%PDF")) ext = 'pdf';
//         else if (binaryString.startsWith("PK")) {
//             if (binaryString.includes("word/document.xml")) ext = 'docx';
//             else if (binaryString.includes("xl/worksheets")) ext = 'xlsx';
//         } else if (binaryString.trim().startsWith("<html") || binaryString.trim().startsWith("<!DOCTYPE html>")) {
//             ext = 'html'; // Detect pure HTML files
//         }

//         currentExtension = ext;

//         // 🟢 ROUTER LOGIC
//         if (ext === 'pdf') {
//             // 🔥 SCROLL FIX: Removed the overlay! PDF native scroll and zoom works now!
//             const pdfDataUri = `data:application/pdf;base64,${response.content}#toolbar=0&navpanes=0`;
//             container.innerHTML = `<iframe src="${pdfDataUri}" width="100%" height="100%" style="border: none;" allowfullscreen></iframe>`;
//         }
//         else if (ext === 'docx' || ext === 'doc') {
//             if (binaryString.startsWith("<")) {
//                 container.innerHTML = `<div id="data-editor" style="background: white; color: black; padding: 50px; width: 800px; min-height: 100vh; margin: 0 auto;">${binaryString}</div>`;
//             } else {
//                 const bytes = new Uint8Array(binaryString.length);
//                 for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
//                 try {
//                     const res = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer });
//                     container.innerHTML = `<div id="data-editor" style="background: white; color: black; padding: 50px; width: 800px; min-height: 100vh; margin: 0 auto; box-shadow: 0 0 10px rgba(0,0,0,0.5);">${res.value}</div>`;
//                 } catch (e) {
//                     container.innerHTML = `<div style="color:red; padding:20px;">Failed to render Word Document.</div>`;
//                 }
//             }
//         }
//         else if (ext === 'xlsx' || ext === 'csv' || ext === 'xls') {
//             try {
//                 const workbook = XLSX.read(response.content, { type: 'base64' });
//                 const htmlStr = XLSX.utils.sheet_to_html(workbook.Sheets[workbook.SheetNames[0]]);
//                 container.innerHTML = `<div id="data-editor" style="background: white; color: black; padding: 20px; width: 95%; height: 95%; overflow: auto; margin: 0 auto;">${htmlStr}</div>`;
//             } catch (e) {
//                 container.innerHTML = `<div style="color:red; padding:20px;">Failed to render Excel Document.</div>`;
//             }
//         }
//         else if (ext === 'html' || ext === 'htm') {
//             // 🔥 HTML FIX: Render HTML files beautifully!
//             container.innerHTML = `<div id="data-editor" style="background: white; color: black; width: 100%; height: 100%; overflow: auto;">${binaryString}</div>`;
//         }
//         else {
//             // 🔥 TXT FIX: Only pure text goes into the Notepad text area
//             container.innerHTML = `<textarea id="data-editor" style="width: 95%; height: 95%; margin: 20px; background: #2d2d2d; color: white; border: none; padding: 20px; resize:none;" readonly>${binaryString}</textarea>`;
//         }

//         // Show Edit Button if they have permissions
//         if (response.canEdit) {
//             document.getElementById('edit-btn').style.display = 'block';
//         } else {
//             document.getElementById('edit-btn').style.display = 'none';
//         }

//     } else {
//         const savedAuth = await window.api.getAuth();
//         authScreen.innerHTML = `
//             <h2 style="color: #dc3545;">Access Denied</h2>
//             <p>${response.error}</p>
//             <p>Logged in as: <b>${savedAuth ? savedAuth.email : 'Unknown'}</b></p>
//             <button id="logout-btn" class="btn" style="background: #dc3545; margin-top:20px;">Switch User / Log Out</button>
//         `;
//         attachLogout();
//     }
// }

// // 6. UNLOCK EDIT MODE
// document.getElementById('edit-btn').addEventListener('click', () => {

//     // 🔥 PDF "Word Mode" Warning
//     if (currentExtension === 'pdf') {
//         alert("🔒 PDFs are 'Flattened' secure documents.\n\nTo edit this file like a Word Document, please ask the Admin to upload the original .docx file instead.\n\n(We blocked PDF edits to prevent layout corruption).");
//         return;
//     }

//     document.getElementById('edit-btn').style.display = 'none';
//     document.getElementById('edit-tools').classList.remove('hidden');
//     document.getElementById('viewer-container').classList.remove('read-only-mode'); // Unlock copy/paste

//     const editor = document.getElementById('data-editor');
//     if (editor) {
//         if (editor.tagName === 'TEXTAREA') {
//             editor.removeAttribute('readonly');
//         } else {
//             editor.setAttribute('contenteditable', 'true');
//             editor.style.outline = "2px dashed #ffc107";
//         }
//         editor.focus();
//     }
// });

// // 7. SAVE BACK TO DATABASE (WITH LOUD ERRORS)
// document.getElementById('save-btn').addEventListener('click', async () => {
//     const editor = document.getElementById('data-editor');
//     if (editor) {
//         document.getElementById('save-btn').innerText = "Saving to Server...";

//         let newB64Content = "";

//         if (currentExtension === 'xlsx' || currentExtension === 'csv' || currentExtension === 'xls') {
//             const table = document.querySelector('#data-editor table');
//             const workbook = XLSX.utils.table_to_book(table);
//             newB64Content = XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' });
//         } else if (currentExtension === 'docx' || currentExtension === 'doc' || currentExtension === 'html') {
//             newB64Content = btoa(editor.innerHTML);
//         } else if (editor.tagName === 'TEXTAREA') {
//             newB64Content = btoa(editor.value);
//         } else {
//             alert("Cannot save this format.");
//             document.getElementById('save-btn').innerText = "💾 Save Changes to Server";
//             return;
//         }

//         const savedAuth = await window.api.getAuth();
//         const res = await window.api.saveDocumentEdits({ userId: savedAuth.userId, docId: currentActiveDocId, newB64Content });

//         if (res.success) {
//             document.getElementById('save-btn').innerText = "✅ Saved to DB!";
//             document.getElementById('save-btn').style.background = "#28a745";
//             setTimeout(() => { document.getElementById('save-btn').innerText = "💾 Save Changes to Server"; }, 3000);
//         } else {
//             // 🔥 THE LOUD ERROR FIX: Pop up the exact reason Python/Supabase failed!
//             alert("❌ FAILED TO SAVE TO DATABASE:\n\n" + res.error + "\n\nPlease check the Python Terminal for exact logs.");
//             document.getElementById('save-btn').innerText = "⚠️ Retry Save";
//             document.getElementById('save-btn').style.background = "#dc3545";
//         }
//     }
// });

// // Utilities
// function showSystemReady(email) {
//     const authScreen = document.getElementById('auth-screen');
//     authScreen.classList.remove('hidden');
//     authScreen.innerHTML = `
//         <h2 style="color: #007acc;">System Ready</h2>
//         <p>Logged in as: <b>${email}</b></p>
//         <button id="logout-btn" class="btn" style="background: #dc3545; margin-top: 20px;">Log Out</button>
//     `;
//     attachLogout();
// }

// function attachLogout() {
//     document.getElementById('logout-btn').addEventListener('click', async () => {
//         await window.api.clearAuth();
//         window.location.reload();
//     });
// }






//this is without error display code , runs blindly
// let currentActiveDocId = null;

// // 1. Listen for double-clicked file
// window.api.onOpenFile((docId) => {
//     currentActiveDocId = docId;
//     checkAutoLogin();
// });

// // 2. On Startup
// window.api.getStartupFile().then(docId => {
//     if (docId) currentActiveDocId = docId;
//     checkAutoLogin();
// });

// // 3. SECURE OS-LEVEL AUTO LOGIN
// async function checkAutoLogin() {
//     const savedAuth = await window.api.getAuth(); // 🔥 Reads from OS securely

//     if (savedAuth && savedAuth.email && savedAuth.password) {
//         document.getElementById('login-screen').classList.add('hidden');
//         document.getElementById('auth-screen').classList.remove('hidden');
//         document.getElementById('auth-screen').innerHTML = `<h2>Verifying security credentials...</h2>`;

//         const loginResult = await window.api.login({ email: savedAuth.email, password: savedAuth.password });

//         if (loginResult.success) {
//             if (currentActiveDocId) {
//                 await loadSecureDocument(loginResult.userId, currentActiveDocId);
//             } else {
//                 showSystemReady(savedAuth.email);
//             }
//         } else {
//             // Password changed. Wipe OS memory.
//             await window.api.clearAuth();
//             document.getElementById('auth-screen').classList.add('hidden');
//             document.getElementById('login-screen').classList.remove('hidden');
//         }
//     } else {
//         document.getElementById('auth-screen').classList.add('hidden');
//         document.getElementById('login-screen').classList.remove('hidden');
//     }
// }

// // 4. Manual Login
// document.getElementById('login-btn').addEventListener('click', async () => {
//     const email = document.getElementById('email').value.trim();
//     const password = document.getElementById('password').value.trim();
//     const errorDiv = document.getElementById('login-error');

//     if (!email || !password) return errorDiv.innerText = "Provide email and password.";
//     errorDiv.innerText = "Authenticating...";

//     const loginResult = await window.api.login({ email, password });

//     if (loginResult.success) {
//         // 🔥 Save to OS permanently
//         await window.api.saveAuth({ email, password, userId: loginResult.userId });

//         document.getElementById('login-screen').classList.add('hidden');
//         if (currentActiveDocId) {
//             await loadSecureDocument(loginResult.userId, currentActiveDocId);
//         } else {
//             showSystemReady(email);
//         }
//     } else {
//         errorDiv.innerText = loginResult.error;
//     }
// });



// // 5. THE UNIVERSAL DOCUMENT ROUTER
// // async function loadSecureDocument(userId, docId) {
// //     const authScreen = document.getElementById('auth-screen');
// //     authScreen.classList.remove('hidden');
// //     authScreen.innerHTML = `<h2>Decrypting file from Vault...</h2>`;

// //     const response = await window.api.verifyAccess({ userId, docId });

// //     if (response.success) {
// //         authScreen.classList.add('hidden');
// //         document.getElementById('main-app').classList.remove('hidden');

// //         const container = document.getElementById('viewer-container');

// //         // Lock view mode securely by default (Blocks Copy/Paste)
// //         container.classList.add('read-only-mode');

// //         // Decode Base64 to Binary String
// //         const binaryString = atob(response.content);

// //         // 🔥 THE MAGIC SNIFFER: Detect file type even if extension is missing!
// //         let ext = response.fileName.includes('.') ? response.fileName.split('.').pop().toLowerCase() : '';

// //         if (binaryString.startsWith("%PDF")) {
// //             ext = 'pdf';
// //         } else if (binaryString.startsWith("PK")) {
// //             // 'PK' is the secret ZIP header for Word and Excel files!
// //             if (binaryString.includes("word/document.xml")) ext = 'docx';
// //             else if (binaryString.includes("xl/worksheets")) ext = 'xlsx';
// //         }

// //         // 🟢 ROUTER LOGIC
// //         if (ext === 'pdf') {
// //             const pdfDataUri = `data:application/pdf;base64,${response.content}`;
// //             container.innerHTML = `
// //                 <div id="pdf-overlay" style="position:absolute; width:100%; height:100%; z-index:10;"></div>
// //                 <iframe src="${pdfDataUri}" width="100%" height="100%" style="border: none;" allowfullscreen></iframe>
// //             `;
// //         }
// //         else if (ext === 'docx' || ext === 'doc') {
// //             const bytes = new Uint8Array(binaryString.length);
// //             for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);

// //             try {
// //                 const res = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer });
// //                 container.innerHTML = `<div id="data-editor" style="background: white; color: black; padding: 50px; width: 800px; min-height: 100vh; margin: 0 auto; box-shadow: 0 0 10px rgba(0,0,0,0.5);">${res.value}</div>`;
// //             } catch (e) {
// //                 container.innerHTML = `<div style="color:red; padding: 20px;">Failed to render Word Document. Error: ${e.message}</div>`;
// //             }
// //         }
// //         else if (ext === 'xlsx' || ext === 'csv' || ext === 'xls') {
// //             try {
// //                 const workbook = XLSX.read(response.content, { type: 'base64' });
// //                 const htmlStr = XLSX.utils.sheet_to_html(workbook.Sheets[workbook.SheetNames[0]]);
// //                 container.innerHTML = `<div id="data-editor" style="background: white; color: black; padding: 20px; width: 95%; height: 95%; overflow: auto; margin: 0 auto;">${htmlStr}</div>`;
// //             } catch (e) {
// //                 container.innerHTML = `<div style="color:red; padding: 20px;">Failed to render Excel Document.</div>`;
// //             }
// //         }
// //         else { // TEXT FILES (.txt, etc)
// //             container.innerHTML = `<textarea id="data-editor" style="width: 95%; height: 95%; margin: 20px; background: #2d2d2d; color: white; border: none; padding: 20px; resize:none;" readonly>${binaryString}</textarea>`;
// //         }

// //         // 🟢 EDIT BUTTON LOGIC (Only appears if user has edit rights!)
// //         if (response.canEdit) {
// //             document.getElementById('edit-btn').style.display = 'block';
// //         } else {
// //             document.getElementById('edit-btn').style.display = 'none';
// //         }

// //     } else {
// //         const savedAuth = await window.api.getAuth();
// //         authScreen.innerHTML = `
// //             <h2 style="color: #dc3545;">Access Denied</h2>
// //             <p>${response.error}</p>
// //             <p>Logged in as: <b>${savedAuth ? savedAuth.email : 'Unknown'}</b></p>
// //             <button id="logout-btn" class="btn" style="background: #dc3545;">Switch User / Log Out</button>
// //         `;
// //         attachLogout();
// //     }
// // }

// // 6. UNLOCK EDIT MODE
// // document.getElementById('edit-btn').addEventListener('click', () => {
// //     document.getElementById('edit-btn').style.display = 'none';
// //     document.getElementById('edit-tools').classList.remove('hidden');

// //     // 1. Remove the strict copy/paste block!
// //     document.getElementById('viewer-container').classList.remove('read-only-mode');

// //     // 2. Make the data actually typable/editable!
// //     const editor = document.getElementById('data-editor');
// //     if (editor) {
// //         if (editor.tagName === 'TEXTAREA') {
// //             editor.removeAttribute('readonly');
// //         } else {
// //             editor.setAttribute('contenteditable', 'true'); // Allows typing over Word/Excel HTML
// //             editor.style.outline = "2px solid #007acc";
// //         }
// //         editor.focus();
// //     } else {
// //         // If it's a PDF, remove the invisible overlay to allow copying
// //         const overlay = document.getElementById('pdf-overlay');
// //         if (overlay) overlay.style.display = 'none';
// //     }
// // });

// // 7. SAVE BACK TO DATABASE
// // document.getElementById('save-btn').addEventListener('click', async () => {
// //     const editor = document.getElementById('data-editor');
// //     if (editor) {
// //         document.getElementById('save-btn').innerText = "Saving...";

// //         let newRawText = "";
// //         if (editor.tagName === 'TEXTAREA') newRawText = editor.value;
// //         else newRawText = editor.innerHTML; // Saves the modified HTML for Word/Excel

// //         // Convert to base64
// //         const newB64Content = btoa(newRawText);

// //         const savedAuth = await window.api.getAuth();
// //         const res = await window.api.saveDocumentEdits({ userId: savedAuth.userId, docId: currentActiveDocId, newB64Content });

// //         if (res.success) {
// //             document.getElementById('save-btn').innerText = "✅ Saved to DB!";
// //             setTimeout(() => { document.getElementById('save-btn').innerText = "💾 Save Changes to Server"; }, 2000);
// //         } else {
// //             alert("Save Failed: " + res.error);
// //             document.getElementById('save-btn').innerText = "💾 Save Changes to Server";
// //         }
// //     } else {
// //         alert("Native PDF editing is restricted. Save works for Data/Text files.");
// //     }
// // });



// let currentExtension = ""; // Tracks if we are editing Excel, Word, or PDF

// // 5. THE UNIVERSAL DOCUMENT ROUTER
// async function loadSecureDocument(userId, docId) {
//     const authScreen = document.getElementById('auth-screen');
//     authScreen.classList.remove('hidden');
//     authScreen.innerHTML = `<h2>Decrypting file from Vault...</h2>`;

//     const response = await window.api.verifyAccess({ userId, docId });

//     if (response.success) {
//         authScreen.classList.add('hidden');
//         document.getElementById('main-app').classList.remove('hidden');

//         const container = document.getElementById('viewer-container');
//         container.classList.add('read-only-mode'); // Lock down copy/paste by default

//         const binaryString = atob(response.content);

//         // Get extension
//         let ext = response.fileName.includes('.') ? response.fileName.split('.').pop().toLowerCase() : '';
//         if (binaryString.startsWith("%PDF")) ext = 'pdf';
//         else if (binaryString.startsWith("PK")) {
//             if (binaryString.includes("word/document.xml")) ext = 'docx';
//             else if (binaryString.includes("xl/worksheets")) ext = 'xlsx';
//         }

//         currentExtension = ext; // Save globally so the Save button knows what to do

//         // 🟢 ROUTER LOGIC
//         if (ext === 'pdf') {
//             // 🔥 THE LEAK FIX: Add #toolbar=0 to destroy the Download/Print buttons!
//             const pdfDataUri = `data:application/pdf;base64,${response.content}#toolbar=0&navpanes=0&scrollbar=0`;
//             container.innerHTML = `
//                 <div id="pdf-overlay" style="position:absolute; width:100%; height:100%; z-index:10;"></div>
//                 <iframe src="${pdfDataUri}" width="100%" height="100%" style="border: none;" allowfullscreen></iframe>
//             `;
//         }
//         else if (ext === 'docx' || ext === 'doc') {
//             // Word Logic
//             if (binaryString.startsWith("<")) {
//                 // If it was previously edited, load the raw HTML
//                 container.innerHTML = `<div id="data-editor" style="background: white; color: black; padding: 50px; width: 800px; min-height: 100vh; margin: 0 auto;">${binaryString}</div>`;
//             } else {
//                 const bytes = new Uint8Array(binaryString.length);
//                 for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
//                 try {
//                     const res = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer });
//                     container.innerHTML = `<div id="data-editor" style="background: white; color: black; padding: 50px; width: 800px; min-height: 100vh; margin: 0 auto; box-shadow: 0 0 10px rgba(0,0,0,0.5);">${res.value}</div>`;
//                 } catch (e) {
//                     container.innerHTML = `<div style="color:red;">Failed to render Word Document.</div>`;
//                 }
//             }
//         }
//         else if (ext === 'xlsx' || ext === 'csv' || ext === 'xls') {
//             // Excel Logic
//             try {
//                 const workbook = XLSX.read(response.content, { type: 'base64' });
//                 const htmlStr = XLSX.utils.sheet_to_html(workbook.Sheets[workbook.SheetNames[0]]);
//                 container.innerHTML = `<div id="data-editor" style="background: white; color: black; padding: 20px; width: 95%; height: 95%; overflow: auto; margin: 0 auto;">${htmlStr}</div>`;
//             } catch (e) {
//                 container.innerHTML = `<div style="color:red;">Failed to render Excel Document.</div>`;
//             }
//         }
//         else {
//             // Text Files
//             container.innerHTML = `<textarea id="data-editor" style="width: 95%; height: 95%; margin: 20px; background: #2d2d2d; color: white; border: none; padding: 20px; resize:none;" readonly>${binaryString}</textarea>`;
//         }

//         // Show Edit Button if permitted
//         if (response.canEdit) {
//             document.getElementById('edit-btn').style.display = 'block';
//         } else {
//             document.getElementById('edit-btn').style.display = 'none';
//         }

//     } else {
//         // ... (Your existing error logic stays the same) ...
//         const savedAuth = await window.api.getAuth();
//         authScreen.innerHTML = `<h2 style="color: #dc3545;">Access Denied</h2><p>${response.error}</p>`;
//         attachLogout();
//     }
// }

// // 6. UNLOCK EDIT MODE (The "I can write" Fix)
// document.getElementById('edit-btn').addEventListener('click', () => {
//     document.getElementById('edit-btn').style.display = 'none';
//     document.getElementById('edit-tools').classList.remove('hidden');

//     // Remove strict copy/paste block
//     document.getElementById('viewer-container').classList.remove('read-only-mode');

//     // 🔥 Make the data TYPABLE
//     const editor = document.getElementById('data-editor');
//     if (editor) {
//         if (editor.tagName === 'TEXTAREA') {
//             editor.removeAttribute('readonly');
//         } else {
//             // THIS TURNS ON EXCEL AND WORD TYPING
//             editor.setAttribute('contenteditable', 'true');
//             editor.style.outline = "2px solid #007acc";
//         }
//         editor.focus();
//     } else {
//         const overlay = document.getElementById('pdf-overlay');
//         if (overlay) overlay.style.display = 'none';
//     }
// });

// // 7. SAVE BACK TO DATABASE (The "Pack it back up" Fix)
// document.getElementById('save-btn').addEventListener('click', async () => {
//     const editor = document.getElementById('data-editor');
//     if (editor) {
//         document.getElementById('save-btn').innerText = "Saving...";

//         let newB64Content = "";

//         // Determine how to save based on the file type!
//         if (currentExtension === 'xlsx' || currentExtension === 'csv' || currentExtension === 'xls') {
//             // 🔥 MAGIC: Convert the edited HTML table back into a pure XLSX file!
//             const table = document.querySelector('#data-editor table');
//             const workbook = XLSX.utils.table_to_book(table);
//             newB64Content = XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' });

//         } else if (currentExtension === 'docx' || currentExtension === 'doc') {
//             // Save the raw HTML string they typed
//             newB64Content = btoa(editor.innerHTML);

//         } else if (editor.tagName === 'TEXTAREA') {
//             // Save pure text
//             newB64Content = btoa(editor.value);

//         } else {
//             alert("Cannot save this format.");
//             document.getElementById('save-btn').innerText = "💾 Save Changes to Server";
//             return;
//         }

//         // Send to backend
//         const savedAuth = await window.api.getAuth();
//         const res = await window.api.saveDocumentEdits({ userId: savedAuth.userId, docId: currentActiveDocId, newB64Content });

//         if (res.success) {
//             document.getElementById('save-btn').innerText = "✅ Saved to DB!";
//             setTimeout(() => { document.getElementById('save-btn').innerText = "💾 Save Changes to Server"; }, 2000);
//         } else {
//             alert("Save Failed: " + res.error);
//             document.getElementById('save-btn').innerText = "💾 Save Changes to Server";
//         }
//     } else {
//         alert("Native PDF editing is restricted.");
//     }
// });

// // Utilities
// function showSystemReady(email) {
//     const authScreen = document.getElementById('auth-screen');
//     authScreen.classList.remove('hidden');
//     authScreen.innerHTML = `
//         <h2 style="color: #007acc;">System Ready</h2>
//         <p>Logged in as: <b>${email}</b></p>
//         <button id="logout-btn" class="btn" style="background: #dc3545; margin-top: 20px;">Log Out</button>
//     `;
//     attachLogout();
// }

// function attachLogout() {
//     document.getElementById('logout-btn').addEventListener('click', async () => {
//         await window.api.clearAuth();
//         window.location.reload();
//     });
// }






















// let currentActiveDocId = null;

// // 1. Listen for double-clicked file (App already open)
// window.api.onOpenFile((docId) => {
//     currentActiveDocId = docId;
//     checkAutoLogin();
// });

// // 2. On Startup (Check if app was launched via double-click)
// window.api.getStartupFile().then(docId => {
//     if (docId) {
//         currentActiveDocId = docId;
//     }
//     checkAutoLogin();
// });

// // 3. The Core Auto-Login & Verification Engine
// async function checkAutoLogin() {
//     const savedEmail = localStorage.getItem('vdr_email');
//     const savedPassword = localStorage.getItem('vdr_password');

//     if (savedEmail && savedPassword) {
//         document.getElementById('login-screen').classList.add('hidden');
//         document.getElementById('auth-screen').classList.remove('hidden');
//         document.getElementById('auth-screen').innerHTML = `<h2>Verifying security credentials...</h2>`;

//         // Ping the database to verify the password hasn't changed
//         const loginResult = await window.api.login({ email: savedEmail, password: savedPassword });

//         if (loginResult.success) {
//             // Password verified! Now check the file.
//             if (currentActiveDocId) {
//                 await loadSecureDocument(loginResult.userId, currentActiveDocId);
//             } else {
//                 // Logged in, but they just opened the app without a file
//                 showSystemReady(savedEmail);
//             }
//         } else {
//             // Password changed or user deleted! Wipe memory.
//             localStorage.clear();
//             document.getElementById('auth-screen').classList.add('hidden');
//             document.getElementById('login-screen').classList.remove('hidden');
//         }
//     } else {
//         // No saved credentials, show login screen
//         document.getElementById('auth-screen').classList.add('hidden');
//         document.getElementById('login-screen').classList.remove('hidden');
//     }
// }

// // 4. Manual Login Button
// document.getElementById('login-btn').addEventListener('click', async () => {
//     const email = document.getElementById('email').value.trim();
//     const password = document.getElementById('password').value.trim();

//     // Create an error div if it doesn't exist
//     let errorDiv = document.getElementById('login-error');
//     if (!errorDiv) {
//         errorDiv = document.createElement('div');
//         errorDiv.id = 'login-error';
//         errorDiv.style.color = 'red';
//         errorDiv.style.marginTop = '10px';
//         document.getElementById('login-btn').after(errorDiv);
//     }

//     if (!email || !password) return errorDiv.innerText = "Provide email and password.";
//     errorDiv.innerText = "Authenticating...";

//     const loginResult = await window.api.login({ email, password });

//     if (loginResult.success) {
//         // Save credentials locally for next time
//         localStorage.setItem('vdr_email', email);
//         localStorage.setItem('vdr_password', password);
//         localStorage.setItem('vdr_user_id', loginResult.userId); // Save ID for DB checks

//         document.getElementById('login-screen').classList.add('hidden');

//         if (currentActiveDocId) {
//             await loadSecureDocument(loginResult.userId, currentActiveDocId);
//         } else {
//             showSystemReady(email);
//         }
//     } else {
//         errorDiv.innerText = loginResult.error;
//     }
// });

// // 5. Cloud Decryption & Access Check
// async function loadSecureDocument(userId, docId) {
//     const authScreen = document.getElementById('auth-screen');
//     authScreen.classList.remove('hidden');
//     authScreen.innerHTML = `<h2>Decrypting file from Vault...</h2>`;

//     // Talk to main.js to check permissions AND download the file
//     const response = await window.api.verifyAccess({ userId, docId });

//     // if (response.success) {
//     //     // Access Granted! Show the file!
//     //     authScreen.classList.add('hidden');
//     //     document.getElementById('main-app').classList.remove('hidden');

//     //     const container = document.getElementById('document-container');
//     //     container.innerHTML = `
//     //         <div class="page" data-page="1">
//     //             <p style="white-space: pre-wrap; color: #333;">${response.content}</p>
//     //         </div>
//     //     `;


//     if (response.success) {
//         // Access Granted! Show the file!
//         authScreen.classList.add('hidden');
//         document.getElementById('main-app').classList.remove('hidden');

//         // 🔥 FIX 1: Grab the correct ID from your HTML ('viewer-container')
//         const container = document.getElementById('viewer-container');

//         // 🔥 FIX 2: Format the Base64 string so the browser knows it's a PDF
//         const pdfDataUri = `data:application/pdf;base64,${response.content}`;

//         // 🔥 FIX 3: Inject the iframe, not a <p> text tag!
//         container.innerHTML = `
//             <iframe
//                 src="${pdfDataUri}"
//                 width="100%"
//                 height="100%"
//                 style="border: none; min-height: 80vh;"
//                 allowfullscreen>
//             </iframe>
//         `;

//         // Optional: Use response.canEdit here to show/hide your edit buttons!
//         if (response.canEdit) {
//             document.getElementById('edit-btn').style.display = 'inline-block';
//         } else {
//             document.getElementById('edit-btn').style.display = 'none';
//         }

//     } else {
//         // ACCESS DENIED! Tell them why, and let them switch users.
//         const savedEmail = localStorage.getItem('vdr_email');
//         authScreen.innerHTML = `
//             <h2 style="color: #dc3545;">Access Denied</h2>
//             <p>${response.error}</p>
//             <p style="margin-bottom: 20px;">You are currently logged in as: <b>${savedEmail}</b></p>
//             <button id="logout-btn" style="background: #dc3545; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer;">
//                 Switch User / Log Out
//             </button>
//         `;
//         attachLogout();
//     }
// }

// // Helper: Show when app is open but no file is clicked
// function showSystemReady(email) {
//     const authScreen = document.getElementById('auth-screen');
//     authScreen.classList.remove('hidden');
//     authScreen.innerHTML = `
//         <h2 style="color: #007acc;">System Ready</h2>
//         <p>Logged in as: <b>${email}</b></p>
//         <p style="margin-bottom: 20px;">Leave this window open and double-click a .vdr file.</p>
//         <button id="logout-btn" style="background: #dc3545; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer;">
//             Log Out
//         </button>
//     `;
//     attachLogout();
// }

// // Helper: Wipe memory and restart
// function attachLogout() {
//     document.getElementById('logout-btn').addEventListener('click', () => {
//         localStorage.clear(); // Nukes the saved email/password
//         window.location.reload(); // Instantly restarts the UI
//     });
// }