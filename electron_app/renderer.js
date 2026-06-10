// renderer.js
window.addEventListener('contextmenu', (e) => e.preventDefault());

let currentActiveDocId = null;
let currentExtension = "";
let currentLogId = null;
let rawDecryptedContent = null;
let currentFileName = "";
let checkedOutPath = null; // Tracks the temp file

async function initApp() {
    if (!window.api) return document.body.innerHTML = `<h1 style="color:red; text-align:center;">Bridge Failed</h1>`;

    window.api.onSyncSuccess((msg) => {
        const btn = document.getElementById('checkout-btn');
        if (btn) {
            btn.innerText = "✅ Saved to Vault!";
            btn.style.background = "#28a745";
            setTimeout(() => { btn.innerText = "Check In & Close"; btn.style.background = "#dc3545"; }, 3000);
        }
    });

    window.api.onOpenFile((docId) => { currentActiveDocId = docId; checkAutoLogin(); });
    await checkAutoLogin();
}

async function checkAutoLogin() {
    const savedAuth = await window.api.getAuth();
    if (savedAuth && savedAuth.email && savedAuth.password) {
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('auth-screen').classList.remove('hidden');
        document.getElementById('auth-screen').innerHTML = `<h2>Verifying security credentials...</h2>`;
        const res = await window.api.login({ email: savedAuth.email, password: savedAuth.password });
        if (res.success) { showSystemReady(savedAuth.email); }
        else { await window.api.clearAuth(); document.getElementById('auth-screen').classList.add('hidden'); document.getElementById('login-screen').classList.remove('hidden'); }
    } else {
        document.getElementById('auth-screen').classList.add('hidden');
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
        showSystemReady(email);
    } else { document.getElementById('login-error').innerText = res.message; }
});

async function loadSecureDocument(userId, docId) {
    const authScreen = document.getElementById('auth-screen');
    authScreen.classList.remove('hidden');
    authScreen.innerHTML = `<h2>Decrypting file from Vault...</h2>`;

    const response = await window.api.verifyAccess({ userId, docId });

    if (response.success) {
        currentLogId = response.logId;
        currentActiveDocId = docId;
        rawDecryptedContent = response.content;
        currentFileName = response.fileName;

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
        } else if (binaryString.trim().startsWith("<html") || binaryString.trim().startsWith("<!DOCTYPE html>")) ext = 'html';

        currentExtension = ext;

        if (ext === 'pdf') {
            const pdfDataUri = `data:application/pdf;base64,${response.content}#toolbar=0&navpanes=0`;
            container.innerHTML = `<iframe src="${pdfDataUri}" width="100%" height="100%" style="border: none;" allowfullscreen></iframe>`;
        }
        else if (ext === 'docx' || ext === 'doc') {
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
            try {
                const res = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer });
                container.innerHTML = `<div style="width: 100%; display: flex; justify-content: center; background-color: #1e1e1e; padding: 20px;"><div id="data-editor" style="background: white !important; color: black !important; padding: 60px; width: 210mm; min-height: 297mm; box-shadow: 0 4px 10px rgba(0,0,0,0.8); font-family: Arial, sans-serif; line-height: 1.6; text-align: left;">${res.value}</div></div>`;
            } catch (e) { container.innerHTML = `<div style="color:red; padding:20px;">Failed to render Word Document.</div>`; }
        }
        else if (ext === 'xlsx' || ext === 'csv' || ext === 'xls') {
            try {
                const workbook = XLSX.read(response.content, { type: 'base64' });
                const htmlStr = XLSX.utils.sheet_to_html(workbook.Sheets[workbook.SheetNames[0]]);
                container.innerHTML = `<div id="data-editor" style="background: white; padding: 20px; width: 100%; height: 100%; overflow: auto;">${htmlStr}</div>`;
            } catch (e) { container.innerHTML = `<div style="color:red; padding:20px;">Failed to render Excel Document.</div>`; }
        }
        else {
            container.innerHTML = `<textarea id="data-editor" style="width: 90%; max-width: 800px; height: 90vh; margin: 20px auto; display: block; background: #2d2d2d; color: #e0e0e0; border: 1px solid #444; border-radius: 8px; padding: 30px; font-family: 'Courier New', monospace; font-size: 14px; resize:none; outline: none;" readonly>${binaryString}</textarea>`;
        }

        // 🔥 THE NEW EDIT LOGIC
        if (response.canEdit) {
            if (ext === 'pdf') {
                document.getElementById('edit-btn').style.display = 'none';
            } else if (ext === 'txt' || ext === 'html') {
                // Live HTML editing for basic text
                document.getElementById('edit-btn').style.display = 'block';
                document.getElementById('edit-btn').innerText = "Edit Text";
            } else {
                // Native OS Checkout for MS Office
                document.getElementById('edit-btn').style.display = 'block';
                document.getElementById('edit-btn').innerText = "Edit in MS Office";
                document.getElementById('edit-btn').style.background = "#007acc";
            }
        } else {
            document.getElementById('edit-btn').style.display = 'none';
        }

    } else {
        alert("Access Denied: " + response.error);
    }
}

// 🔥 SECURE NATIVE EDITING 
document.getElementById('edit-btn').addEventListener('click', async () => {
    if (currentExtension === 'txt' || currentExtension === 'html') {
        // Standard Live Edit
        document.getElementById('edit-btn').style.display = 'none';
        document.getElementById('edit-tools').classList.remove('hidden');
        document.getElementById('viewer-container').classList.remove('read-only-mode');
        const editor = document.getElementById('data-editor');
        if (editor) { editor.removeAttribute('readonly'); editor.focus(); }
    } else {
        // 🟢 THE NATIVE CHECKOUT
        const savedAuth = await window.api.getAuth();
        const btn = document.getElementById('edit-btn');
        btn.innerText = "Opening MS Office...";

        const res = await window.api.checkoutDocument({
            userId: savedAuth.userId, docId: currentActiveDocId, base64Content: rawDecryptedContent, fileName: currentFileName
        });

        if (res.success) {
            checkedOutPath = res.tempPath;
            btn.innerText = "Check In & Close";
            btn.style.background = "#dc3545"; // Turns red to remind them to close it
            btn.id = "checkout-btn"; // Temporarily repurpose button

            // Re-assign listener to Check-In
            btn.addEventListener('click', async () => {
                await window.api.checkinDocument(checkedOutPath);
                alert("File Securely Removed from Local Drive!");
                window.location.reload(); // Clean refresh
            }, { once: true });
        } else {
            alert("Failed to checkout document.");
            btn.innerText = "Edit in MS Office";
        }
    }
});

// (Keep your existing text 'save-btn' logic here exactly as it was for pure text saving)

function showSystemReady(email) {
    const authScreen = document.getElementById('auth-screen');
    authScreen.classList.remove('hidden');
    authScreen.innerHTML = `
        <h2 style="color: #007acc;">System Ready</h2>
        <p>Logged in as: <b>${email}</b></p>
        <button id="open-file-btn" class="btn" style="background: #28a745; margin-top: 20px; width: 200px; font-weight: bold; font-size: 14px;">📂 Open .vdr File</button>
        <br>
        <button id="logout-btn" class="btn" style="background: #dc3545; margin-top: 15px; width: 200px;">Log Out</button>
    `;
    attachLogout();
    document.getElementById('open-file-btn').addEventListener('click', async () => {
        document.getElementById('open-file-btn').innerText = "Opening...";
        const res = await window.api.openFileDialog();
        if (res.success && res.docId) {
            const savedAuth = await window.api.getAuth();
            await loadSecureDocument(savedAuth.userId, res.docId);
        } else {
            document.getElementById('open-file-btn').innerText = "📂 Open .vdr File";
            if (res.error) alert("Error opening file: " + res.error);
        }
    });
}

function attachLogout() {
    document.getElementById('logout-btn').addEventListener('click', async () => {
        if (currentLogId) window.api.closeLog(currentLogId);
        await window.api.clearAuth(); window.location.reload();
    });
}
document.addEventListener('DOMContentLoaded', initApp);
















//editing problem fernt code
// // renderer.js
// window.addEventListener('contextmenu', (e) => e.preventDefault());

// let currentActiveDocId = null;
// let currentExtension = "";
// let currentLogId = null;

// const blurShield = document.createElement('div');
// blurShield.style.position = 'fixed'; blurShield.style.top = '0'; blurShield.style.left = '0';
// blurShield.style.width = '100vw'; blurShield.style.height = '100vh';
// blurShield.style.backgroundColor = 'black'; blurShield.style.color = 'red';
// blurShield.style.display = 'none'; blurShield.style.flexDirection = 'column';
// blurShield.style.alignItems = 'center'; blurShield.style.justifyContent = 'center';
// blurShield.style.zIndex = '999999'; blurShield.style.fontFamily = 'sans-serif';
// blurShield.innerHTML = `
//     <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="red" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
//     <h1 style="margin-top: 20px;">SECURITY LOCK</h1>
//     <p>Application lost focus. Click here to resume secure viewing.</p>
// `;
// document.body.appendChild(blurShield);
// window.addEventListener('blur', () => { blurShield.style.display = 'flex'; });
// window.addEventListener('focus', () => { blurShield.style.display = 'none'; });

// window.addEventListener('beforeunload', () => {
//     if (currentLogId) window.api.closeLog(currentLogId);
// });

// async function initApp() {
//     if (!window.api) return document.body.innerHTML = `<h1 style="color:red; text-align:center; margin-top:20vh;">Bridge Failed</h1>`;
//     window.api.onOpenFile((docId) => { currentActiveDocId = docId; checkAutoLogin(); });
//     const startupDocId = await window.api.getStartupFile();
//     if (startupDocId) currentActiveDocId = startupDocId;
//     await checkAutoLogin();
// }

// async function checkAutoLogin() {
//     const savedAuth = await window.api.getAuth();
//     if (savedAuth && savedAuth.email && savedAuth.password) {
//         document.getElementById('login-screen').classList.add('hidden');
//         document.getElementById('auth-screen').classList.remove('hidden');
//         document.getElementById('auth-screen').innerHTML = `<h2>Verifying security credentials...</h2>`;
//         const res = await window.api.login({ email: savedAuth.email, password: savedAuth.password });
//         if (res.success) {
//             if (currentActiveDocId) await loadSecureDocument(res.userId, currentActiveDocId);
//             else showSystemReady(savedAuth.email);
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

// document.getElementById('login-btn').addEventListener('click', async () => {
//     const email = document.getElementById('email').value.trim();
//     const password = document.getElementById('password').value.trim();
//     if (!email || !password) return;
//     document.getElementById('login-error').innerText = "Authenticating...";
//     const res = await window.api.login({ email, password });
//     if (res.success) {
//         await window.api.saveAuth({ email, password, userId: res.userId });
//         document.getElementById('login-screen').classList.add('hidden');
//         if (currentActiveDocId) await loadSecureDocument(res.userId, currentActiveDocId);
//         else showSystemReady(email);
//     } else { document.getElementById('login-error').innerText = res.message; }
// });

// async function loadSecureDocument(userId, docId) {
//     const authScreen = document.getElementById('auth-screen');
//     authScreen.classList.remove('hidden');
//     authScreen.innerHTML = `<h2>Decrypting file from Vault...</h2>`;

//     const response = await window.api.verifyAccess({ userId, docId });

//     if (response.success) {
//         currentLogId = response.logId;
//         currentActiveDocId = docId; // Ensure we track what is currently open

//         authScreen.classList.add('hidden');
//         document.getElementById('main-app').classList.remove('hidden');
//         const container = document.getElementById('viewer-container');
//         container.classList.add('read-only-mode');

//         const binaryString = atob(response.content);
//         let ext = response.fileName.includes('.') ? response.fileName.split('.').pop().toLowerCase() : '';

//         if (binaryString.startsWith("%PDF")) ext = 'pdf';
//         else if (binaryString.startsWith("PK")) {
//             if (binaryString.includes("word/document.xml")) ext = 'docx';
//             else if (binaryString.includes("xl/worksheets")) ext = 'xlsx';
//         } else if (binaryString.trim().startsWith("<html") || binaryString.trim().startsWith("<!DOCTYPE html>")) ext = 'html';

//         currentExtension = ext;

//         if (ext === 'pdf') {
//             const pdfDataUri = `data:application/pdf;base64,${response.content}#toolbar=0&navpanes=0`;
//             container.innerHTML = `<iframe src="${pdfDataUri}" width="100%" height="100%" style="border: none;" allowfullscreen></iframe>`;
//         }
//         else if (ext === 'docx' || ext === 'doc') {
//             const bytes = new Uint8Array(binaryString.length);
//             for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
//             try {
//                 const res = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer });
//                 container.innerHTML = `
//                 <div style="width: 100%; display: flex; justify-content: center; background-color: #1e1e1e; padding: 20px;">
//                     <div id="data-editor" style="background: white !important; color: black !important; padding: 60px; width: 210mm; min-height: 297mm; box-shadow: 0 4px 10px rgba(0,0,0,0.8); font-family: Arial, sans-serif; line-height: 1.6; text-align: left;">
//                         ${res.value}
//                     </div>
//                 </div>`;
//             } catch (e) {
//                 container.innerHTML = `<div style="color:red; padding:20px;">Failed to render Word Document.</div>`;
//             }
//         }
//         else if (ext === 'xlsx' || ext === 'csv' || ext === 'xls') {
//             try {
//                 const workbook = XLSX.read(response.content, { type: 'base64' });
//                 const htmlStr = XLSX.utils.sheet_to_html(workbook.Sheets[workbook.SheetNames[0]]);
//                 container.innerHTML = `
//                 <div style="background: #f3f2f1; padding: 20px; width: 100%; height: 100%; overflow: auto;">
//                     <style>
//                         #data-editor table { width: 100%; border-collapse: collapse; background: white; font-family: 'Segoe UI', sans-serif; font-size: 13px; }
//                         #data-editor th, #data-editor td { border: 1px solid #d2d2d2; padding: 8px; text-align: left; }
//                         #data-editor th { background-color: #e1dfdd; font-weight: bold; }
//                         #data-editor tr:hover { background-color: #f9f9f9; }
//                     </style>
//                     <div id="data-editor" style="box-shadow: 0 2px 6px rgba(0,0,0,0.1);">${htmlStr}</div>
//                 </div>`;
//             } catch (e) {
//                 container.innerHTML = `<div style="color:red; padding:20px;">Failed to render Excel Document.</div>`;
//             }
//         }
//         else {
//             container.innerHTML = `<textarea id="data-editor" style="width: 90%; max-width: 800px; height: 90vh; margin: 20px auto; display: block; background: #2d2d2d; color: #e0e0e0; border: 1px solid #444; border-radius: 8px; padding: 30px; font-family: 'Courier New', monospace; font-size: 14px; resize:none; outline: none;" readonly>${binaryString}</textarea>`;
//         }

//         document.getElementById('edit-btn').style.display = response.canEdit ? 'block' : 'none';

//         if (ext === 'docx' || ext === 'doc') {
//             document.getElementById('save-btn').innerText = "💾 Save & Lock as PDF";
//             document.getElementById('save-btn').style.background = "#dc3545";
//         } else {
//             document.getElementById('save-btn').innerText = "💾 Save Changes";
//             document.getElementById('save-btn').style.background = "#28a745";
//         }

//     } else {
//         const savedAuth = await window.api.getAuth();
//         authScreen.innerHTML = `<h2 style="color: #dc3545;">Access Denied</h2><p>${response.error}</p><button id="logout-btn" class="btn" style="background: #dc3545; margin-top:20px;">Switch User</button>`;
//         attachLogout();
//     }
// }

// document.getElementById('edit-btn').addEventListener('click', () => {
//     if (currentExtension === 'pdf') return alert("🔒 PDFs are secure. Edit the original .docx file instead.");

//     document.getElementById('edit-btn').style.display = 'none';
//     document.getElementById('edit-tools').classList.remove('hidden');
//     document.getElementById('viewer-container').classList.remove('read-only-mode');

//     const editor = document.getElementById('data-editor');
//     if (editor) {
//         if (editor.tagName === 'TEXTAREA') editor.removeAttribute('readonly');
//         else { editor.setAttribute('contenteditable', 'true'); editor.style.outline = "2px dashed #ffc107"; }
//         editor.focus();
//     }
// });

// document.getElementById('save-btn').addEventListener('click', async () => {
//     const editor = document.getElementById('data-editor');
//     if (!editor) return;

//     const saveBtn = document.getElementById('save-btn');
//     saveBtn.innerText = "Encrypting & Saving...";
//     let newB64Content = "";
//     let isConvertingToPdf = false;

//     try {
//         if (currentExtension === 'docx' || currentExtension === 'doc') {
//             isConvertingToPdf = true;
//             saveBtn.innerText = "Generating PDF...";

//             const opt = { margin: 10, filename: 'converted.pdf', image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } };
//             const pdfArrayBuffer = await html2pdf().set(opt).from(editor).output('arraybuffer');

//             const bytes = new Uint8Array(pdfArrayBuffer);
//             let binary = '';
//             for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
//             newB64Content = btoa(binary);
//         } else {
//             if (currentExtension === 'xlsx' || currentExtension === 'csv' || currentExtension === 'xls') {
//                 const table = document.querySelector('#data-editor table');
//                 newB64Content = XLSX.write(XLSX.utils.table_to_book(table), { type: 'base64', bookType: 'xlsx' });
//             } else if (editor.tagName === 'TEXTAREA') {
//                 newB64Content = btoa(unescape(encodeURIComponent(editor.value)));
//             } else {
//                 newB64Content = btoa(unescape(encodeURIComponent(editor.innerHTML)));
//             }
//         }

//         const savedAuth = await window.api.getAuth();
//         const res = await window.api.saveDocumentEdits({
//             userId: savedAuth.userId, docId: currentActiveDocId, newB64Content: newB64Content, isPdfConversion: isConvertingToPdf
//         });

//         if (res.success) {
//             saveBtn.innerText = isConvertingToPdf ? "✅ Locked as PDF!" : "✅ Verified & Locked in Vault!";
//             saveBtn.style.background = "#28a745";
//             if (currentLogId) window.api.closeLog(currentLogId);
//             setTimeout(() => { window.location.reload(); }, 2500);
//         } else {
//             throw new Error(res.error);
//         }
//     } catch (error) {
//         alert("❌ FAILED TO SAVE:\n" + error.message);
//         saveBtn.innerText = "⚠️ Retry";
//         saveBtn.style.background = "#dc3545";
//     }
// });

// // 🔥 NEW: showSystemReady now contains the Open File button
// function showSystemReady(email) {
//     const authScreen = document.getElementById('auth-screen');
//     authScreen.classList.remove('hidden');
//     authScreen.innerHTML = `
//         <h2 style="color: #007acc;">System Ready</h2>
//         <p>Logged in as: <b>${email}</b></p>
//         <button id="open-file-btn" class="btn" style="background: #28a745; margin-top: 20px; width: 200px; font-weight: bold;">📂 Open .vdr File</button>
//         <br>
//         <button id="logout-btn" class="btn" style="background: #dc3545; margin-top: 15px; width: 200px;">Log Out</button>
//     `;

//     attachLogout();

//     // Attach File Picker logic
//     document.getElementById('open-file-btn').addEventListener('click', async () => {
//         const res = await window.api.openFileDialog();
//         if (res.success && res.docId) {
//             const savedAuth = await window.api.getAuth();
//             await loadSecureDocument(savedAuth.userId, res.docId);
//         } else if (res.error) {
//             alert("Error opening file: " + res.error);
//         }
//     });
// }

// function attachLogout() {
//     document.getElementById('logout-btn').addEventListener('click', async () => {
//         if (currentLogId) window.api.closeLog(currentLogId);
//         await window.api.clearAuth();
//         window.location.reload();
//     });
// }
// document.addEventListener('DOMContentLoaded', initApp);







