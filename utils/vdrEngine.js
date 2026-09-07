import fernet from 'fernet';

export const generateSecureHtmlWrapper = (docId, fileName, fileType, encryptedPayload, backendUrl, watermarkSettings = null, brandLogo = null, downloadedByEmail = null) => {
    const cleanExt = (fileType || fileName).split('.').pop().toLowerCase().replace(/[^a-z0-9]/gi, '');
    const safePayload = btoa(encryptedPayload);

    const htmlContent = `<!DOCTYPE html>
<html>
<head>
    <title>SECURE: ${fileName}</title>
    
    <script src="https://cdn.jsdelivr.net/npm/fernet@0.4.0/fernetBrowser.js"><\/script>
    <script src="https://cdn.jsdelivr.net/npm/pdfjs-dist@2.16.105/build/pdf.min.js"><\/script>
    <script src="https://unpkg.com/jszip/dist/jszip.min.js"><\/script>
    <script src="https://unpkg.com/docx-preview/dist/docx-preview.min.js"><\/script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.4.21/mammoth.browser.min.js"><\/script>
    <link href="https://cdn.quilljs.com/1.3.6/quill.snow.css" rel="stylesheet">
    <script src="https://cdn.quilljs.com/1.3.6/quill.min.js"><\/script>
    <script src="https://unpkg.com/html-docx-js@0.3.1/dist/html-docx.js"><\/script>
    
    <link rel='stylesheet' href='https://cdn.jsdelivr.net/npm/luckysheet/dist/plugins/css/pluginsCss.css' />
    <link rel='stylesheet' href='https://cdn.jsdelivr.net/npm/luckysheet/dist/plugins/plugins.css' />
    <link rel='stylesheet' href='https://cdn.jsdelivr.net/npm/luckysheet/dist/css/luckysheet.css' />
    <script src="https://cdn.jsdelivr.net/npm/luckysheet/dist/plugins/js/plugin.js"><\/script>
    <script src="https://cdn.jsdelivr.net/npm/luckysheet/dist/luckysheet.umd.js"><\/script>
    <script src="https://cdn.jsdelivr.net/npm/luckyexcel/dist/luckyexcel.umd.js"><\/script>

    <style>
        body, html { margin: 0; padding: 0; width: 100%; height: 100%; background: #1a1a1a; color: #fff; font-family: sans-serif; overflow: hidden; }
        body { -webkit-user-select: none; -moz-user-select: none; -ms-user-select: none; user-select: none; }
        
        .login-box { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #ffffff; padding: 40px; border-radius: 12px; text-align: center; width: 350px; box-shadow: 0 20px 25px rgba(0, 0, 0, 0.5); z-index: 1000; }
        .input-group { position: relative; width: 100%; margin: 15px 0; }
        .login-box input { width: 100%; padding: 12px 15px; border: 1px solid #cbd5e1; background: #f8fafc; color: #1e293b; border-radius: 8px; box-sizing: border-box; font-size: 14px; outline: none; }
        .btn { background: #3b82f6; color: white; padding: 12px 20px; border: none; cursor: pointer; border-radius: 8px; font-weight: 600; width: 100%; transition: 0.2s; font-size: 14px; }
        .btn:hover { background: #2563eb; }
        
        #toolbar { display: none; height: 60px; background: #0f172a; align-items: center; justify-content: space-between; padding: 0 24px; border-bottom: 1px solid #1e293b; position: fixed; top: 0; width: 100%; box-sizing: border-box; z-index: 999; box-shadow: 0 4px 6px rgba(0,0,0,0.3); }
        .btn-toolbar { width: auto; margin: 0; padding: 8px 16px; font-size: 13px; }
        
        #main-wrapper { display: none; width: 100vw; height: calc(100vh - 60px); margin-top: 60px; position: relative; overflow-y: auto; background: #222; }
        #scroll-container { display: flex; flex-direction: column; align-items: center; padding: 40px 0; width: 100%; min-height: 100%; }
        #luckysheet-container { display: none; position: absolute; width: 100%; height: 100%; left: 0; top: 0; background: #ffffff; z-index: 10; }

        .txt-page-wrapper { background: #ffffff !important; width: 210mm; min-height: 297mm; height: max-content; margin-bottom: 30px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5); padding: 25mm; box-sizing: border-box; color: #000000 !important; display: flex; flex-direction: column; }
        .txt-view { white-space: pre-wrap; font-family: monospace; font-size: 14px; margin: 0; word-wrap: break-word; color: #000000 !important; width: 100%; }
        .txt-edit { width: 100%; min-height: 250mm; border: none; outline: none; resize: none; font-family: monospace; font-size: 14px; background: transparent; color: #000000 !important; white-space: pre-wrap; line-height: 1.5; overflow: hidden !important; }
        
        .pdf-page-wrapper { margin-bottom: 20px; background: white; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5); pointer-events: none; }
        
        .docx-wrapper { background: transparent !important; padding: 0 !important; display: flex; flex-direction: column; align-items: center; width: 100%; }
        .docx-wrapper > section.docx { background: #ffffff !important; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5) !important; margin-bottom: 30px !important; min-height: 297mm !important; width: 210mm !important; }

        .doc-edit-wrapper { background: #ffffff !important; width: 210mm; min-height: 297mm; margin-bottom: 30px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5); padding: 25mm; box-sizing: border-box; }
        .doc-edit-wrapper * { color: #000000 !important; }
        .ql-container.ql-snow { border: none !important; min-height: 200mm; font-family: "Times New Roman", Times, serif; font-size: 16px; }
        .ql-editor { min-height: 200mm; color: #000000 !important; }
        .ql-toolbar { background: #f1f5f9; border: 1px solid #cbd5e1 !important; border-radius: 6px; margin-bottom: 15px; }
        
        .toast { position: fixed; bottom: 20px; right: 20px; background: #10b981; color: white; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px; display: none; z-index: 10000; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3); }
    <\/style>
<\/head>
<body>
    <script id="secure-payload" type="text/plain">${safePayload}<\/script>

    <div id="login-ui" class="login-box">
        <h2 style="margin-top:0; margin-bottom: 5px; color: #0f172a;">Secure Viewer<\/h2>
        <p style="color: #64748b; font-size: 13px; margin-bottom: 25px; margin-top: 0;">Login required to decrypt<\/p>
        <div class="input-group"><input type="email" id="email" value="${downloadedByEmail || ''}" ${downloadedByEmail ? 'readonly style="background: #e2e8f0; cursor: not-allowed;"' : 'placeholder="Enter your email"'} required><\/div>
        <div class="input-group"><input type="password" id="password" placeholder="Enter your password" required><\/div>
        <button id="auth-btn" class="btn">Unlock Document<\/button>
        <div id="error-msg" style="color: #ef4444; margin-top: 15px; font-size: 13px; font-weight: 500;"><\/div>
    <\/div>

    <div id="toolbar">
        <div style="display: flex; align-items: center; gap: 15px;">
            <span style="background: #3b82f6; color: white; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">SECURE VDR<\/span>
            <span id="title-display" style="font-size: 15px; font-weight: 600; color: #f8fafc;">${fileName}<\/span>
        <\/div>
        <div style="display: flex; gap: 10px;">
            <button id="edit-btn" class="btn btn-toolbar" style="display: none;">✏️ Edit Document<\/button>
            <button id="save-btn" class="btn btn-toolbar" style="display: none; background: #10b981;">💾 Save &amp; Sync<\/button>
        <\/div>
    <\/div>

    <div id="main-wrapper">
        <div id="scroll-container"><\/div>
        <div id="luckysheet-container"><\/div>
    <\/div>
    
    <div id="toast" class="toast">✅ Saved Successfully<\/div>

    <script>
        document.addEventListener('contextmenu', e => e.preventDefault());
        document.addEventListener('copy', e => e.preventDefault());
        document.addEventListener('cut', e => e.preventDefault());
        document.addEventListener('paste', e => e.preventDefault());

        const SUPABASE_URL = "${process.env.NEXT_PUBLIC_SUPABASE_URL}";
        const SUPABASE_ANON_KEY = "${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}";

        const SECURE_DATA = { 
            docId: "${docId}", 
            fileExt: "${cleanExt}", 
            downloadedByEmail: "${downloadedByEmail || ''}",
            fernetKey: null, 
            canEdit: false,
            rawBuffer: null,
            utf8Text: null,
            filePath: null
        };

        window.__watermarkSettings = ${JSON.stringify(watermarkSettings || {})};
        window.__brandLogo = ${JSON.stringify(brandLogo || null)};
        window.__resolveLogoUrl = (path) => path;

        const hexToRGBA = (hex, opacity) => {
            if (!hex) return \`rgba(100, 116, 139, \${opacity / 100})\`;
            if (/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)) {
                let c = hex.substring(1).split('');
                if (c.length === 3) c = [c[0], c[0], c[1], c[1], c[2], c[2]];
                c = '0x' + c.join('');
                return \`rgba(\${[(c >> 16) & 255, (c >> 8) & 255, c & 255].join(',')},\${opacity / 100})\`;
            }
            return \`rgba(100, 116, 139, \${opacity / 100})\`;
        };

        const getLogoUrl = (path) => {
            if (!path) return null;
            if (window.__resolveLogoUrl) return window.__resolveLogoUrl(path);
            return path;
        };

        const generateWatermarkContentHTML = (info, ip, settings, bLogo, scale = 1.0) => {
            const type = settings?.watermark_type || 'dynamic';
            const rawFontSize = settings?.font_size || 22;
            const fontSize = Math.round(rawFontSize * scale);
            const textColor = settings?.text_color || '#334155';
            const textOpacity = settings?.text_opacity ?? 25;
            const rotation = settings?.rotation ?? -30;
            const logoPath = settings?.logo_path || bLogo;
            const logoOpacity = settings?.logo_opacity ?? 0.5;

            let lines = [];
            if (type === 'static') {
                lines.push(settings?.custom_text || 'CONFIDENTIAL');
            } else {
                lines.push(settings?.custom_text || 'CONFIDENTIAL');
                if (settings?.email_address || info?.email) lines.push(settings?.email_address || info?.email);
                if (settings?.attributes?.ip) lines.push(ip || 'Unknown IP');
                if (settings?.attributes?.date) lines.push(new Date().toLocaleString());
            }

            let html = \`<div style="transform: rotate(\${rotation}deg); color: \${hexToRGBA(textColor, textOpacity)}; font-weight: bold; transform-origin: center; display: flex; flex-direction: column; align-items: center; justify-content: center; transition: all 0.2s;">\`;
            if (logoPath) {
                html += \`<img src="\${getLogoUrl(logoPath)}" alt="logo" style="height: 40px; object-fit: contain; margin-bottom: 6px; opacity: \${logoOpacity};" />\`;
            }
            html += \`<div style="font-size: \${fontSize}px; white-space: nowrap; display: flex; flex-direction: column; align-items: center;">\`;
            lines.forEach(line => {
                html += \`<span style="line-height: 1.2;">\${line}</span>\`;
            });
            html += \`</div></div>\`;
            return html;
        };

        const appendWatermarkToElement = (element, info, ip, scale = 1.0) => {
            if (!element) return;
            element.style.position = 'relative';

            const overlay = document.createElement('div');
            overlay.className = 'page-watermark-overlay';
            overlay.style.position = 'absolute';
            overlay.style.inset = '0';
            overlay.style.pointerEvents = 'none';
            overlay.style.zIndex = '10';
            overlay.style.overflow = 'hidden';
            overlay.style.display = 'grid';
            overlay.style.gridTemplateColumns = 'repeat(3, 1fr)';
            overlay.style.gridTemplateRows = 'repeat(3, 1fr)';
            overlay.style.padding = '32px';

            const settings = window.__watermarkSettings || {};
            const positions = settings.positions || { 'middle-center': true };

            const gridCells = [
                { key: 'top-left', cls: 'align-items: flex-start; justify-content: flex-start;' },
                { key: 'top-center', cls: 'align-items: flex-start; justify-content: center;' },
                { key: 'top-right', cls: 'align-items: flex-start; justify-content: flex-end;' },
                { key: 'middle-left', cls: 'align-items: center; justify-content: flex-start;' },
                { key: 'middle-center', cls: 'align-items: center; justify-content: center;' },
                { key: 'middle-right', cls: 'align-items: center; justify-content: flex-end;' },
                { key: 'bottom-left', cls: 'align-items: flex-end; justify-content: flex-start;' },
                { key: 'bottom-center', cls: 'align-items: flex-end; justify-content: center;' },
                { key: 'bottom-right', cls: 'align-items: flex-end; justify-content: flex-end;' },
            ];

            let contentHtml = generateWatermarkContentHTML(info, ip, settings, window.__brandLogo, scale);

            gridCells.forEach(({ key, cls }) => {
                const cell = document.createElement('div');
                cell.style.display = 'flex';
                cell.style.overflow = 'visible';
                cell.style.cssText += cls;
                if (positions[key]) {
                    cell.innerHTML = contentHtml;
                }
                overlay.appendChild(cell);
            });

            element.appendChild(overlay);
        };

        let clientIp = 'Unknown IP';
        fetch('https://api.ipify.org?format=json').then(r => r.json()).then(d => clientIp = d.ip).catch(()=>{});

        function showToast(message) {
            const toast = document.getElementById('toast');
            toast.innerText = message;
            toast.style.display = 'block';
            setTimeout(() => { toast.style.display = 'none'; }, 3000);
        }

        async function fetchSupabase(table, query) {
            const res = await fetch(\`\${SUPABASE_URL}/rest/v1/\${table}?\${query}\`, {
                headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': \`Bearer \${SUPABASE_ANON_KEY}\` }
            });
            if (!res.ok) throw new Error("Database connection failed");
            return await res.json();
        }

        document.addEventListener('DOMContentLoaded', () => {
            const authBtn = document.getElementById('auth-btn');
            const editBtn = document.getElementById('edit-btn');
            const saveBtn = document.getElementById('save-btn');

            if (authBtn) {
                authBtn.addEventListener('click', async () => {
                    const email = document.getElementById('email').value.trim();
                    const password = document.getElementById('password').value;
                    const errorDiv = document.getElementById('error-msg');

                    if (!email || !password) {
                        errorDiv.innerText = "Please enter both email and password.";
                        return;
                    }

                    authBtn.innerText = "Verifying Access...";
                    authBtn.style.opacity = '0.8';
                    authBtn.disabled = true;

                    try {
                        if (SECURE_DATA.downloadedByEmail && email !== SECURE_DATA.downloadedByEmail) {
                            throw new Error("This file is locked. It can only be opened by " + SECURE_DATA.downloadedByEmail);
                        }

                        const users = await fetchSupabase('users', \`email=eq.\${encodeURIComponent(email)}&select=id,role,password_hash\`);
                        if (!users.length || users[0].password_hash !== password) {
                            throw new Error("Invalid email or password.");
                        }
                        const user = users[0];

                        const docs = await fetchSupabase('documents', \`id=eq.\${SECURE_DATA.docId}&select=dek_ref,folder_id,uploaded_by,creator_revoked,file_path\`);
                        if (!docs.length) throw new Error("Document not found in Vault.");
                        const docData = docs[0];
                        SECURE_DATA.filePath = docData.file_path; 

                        let hasAccess = false;
                        let canEdit = false;

                        if (user.role === 'super_admin' || (docData.uploaded_by === user.id && docData.creator_revoked !== true)) {
                            hasAccess = true; 
                            canEdit = true;
                        } else {
                            const userGroups = await fetchSupabase('user_groups', \`user_id=eq.\${user.id}&select=group_id\`);
                            
                            if (userGroups.length > 0) {
                                const groupIds = userGroups.map(g => g.group_id).join(',');
                                
                                let queryStr = 'group_id=in.(' + groupIds + ')&select=scope,document_id,folder_id,can_view,can_edit,can_download_secure';
                                if (docData.folder_id) {
                                    queryStr += \`&or=(document_id.eq.\${SECURE_DATA.docId},folder_id.eq.\${docData.folder_id})\`;
                                } else {
                                    queryStr += \`&document_id=eq.\${SECURE_DATA.docId}\`;
                                }
                                
                                const perms = await fetchSupabase('permissions', queryStr);
                                
                                const docPerms = perms.filter(p => p.scope === 'document' && p.document_id === SECURE_DATA.docId);
                                const folderPerms = perms.filter(p => p.scope === 'folder' && p.folder_id === docData.folder_id);

                                if (docPerms.length > 0) {
                                    if (docPerms.some(p => p.can_download_secure === true)) hasAccess = true;
                                    if (docPerms.some(p => p.can_edit === true)) canEdit = true;
                                } else if (folderPerms.length > 0) {
                                    if (folderPerms.some(p => p.can_download_secure === true)) hasAccess = true;
                                    if (folderPerms.some(p => p.can_edit === true)) canEdit = true;
                                }
                            }
                        }

                        if (!hasAccess) {
                            throw new Error("Access Revoked: You do not have permission to view this file.");
                        }

                        SECURE_DATA.fernetKey = docData.dek_ref;
                        SECURE_DATA.canEdit = canEdit && ['xlsx', 'xls', 'csv', 'docx', 'doc', 'txt', 'text'].includes(SECURE_DATA.fileExt);
                        
                        if (SECURE_DATA.canEdit && editBtn) {
                            editBtn.style.display = 'block';
                        } else if (editBtn) {
                            editBtn.style.display = 'none'; 
                        }
                        
                        decryptAndRender(false);

                    } catch(e) { 
                        authBtn.innerText = "Retry Unlock";
                        authBtn.style.opacity = '1';
                        authBtn.disabled = false;
                        authBtn.style.background = "#ef4444";
                        errorDiv.innerText = e.message; 
                    }
                });
            }

            if (editBtn) {
                editBtn.addEventListener('click', () => {
                    editBtn.style.display = 'none';
                    saveBtn.style.display = 'block';
                    renderEditMode();
                });
            }

            // 🔥 FIX: RESTORED THE REAL SAVE LOGIC (Removed the accidental unlock copy/paste!)
            if (saveBtn) {
                saveBtn.addEventListener('click', async () => {
                    saveBtn.innerText = "Saving...";
                    saveBtn.disabled = true;
                    
                    try {
                        let base64Update = "";

                        if (['xlsx', 'xls'].includes(SECURE_DATA.fileExt)) {
                            const rawDataString = JSON.stringify(window.luckysheet.getAllSheets());
                            base64Update = btoa(unescape(encodeURIComponent(rawDataString)));
                        } 
                        else if (SECURE_DATA.fileExt === 'csv') {
                            const sheetData = window.luckysheet.getAllSheets()[0].data;
                            const csvRows = sheetData.map(row => row.map(cell => (cell && cell.v !== null && cell.v !== undefined) ? cell.v : '').join(','));
                            const textStr = csvRows.join('\\n');
                            const bytes = new TextEncoder().encode(textStr);
                            let binary = '';
                            for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
                            base64Update = window.btoa(binary);
                        }
                        else if (['docx', 'doc'].includes(SECURE_DATA.fileExt)) {
                            const htmlContent = window.quill.root.innerHTML;
                            const docxBlob = htmlDocx.asBlob(htmlContent); 
                            const buffer = await docxBlob.arrayBuffer();
                            const bytes = new Uint8Array(buffer);
                            let binary = '';
                            for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
                            base64Update = window.btoa(binary);
                        } 
                        else if (['txt', 'text'].includes(SECURE_DATA.fileExt)) {
                            const inputs = Array.from(document.querySelectorAll('.txt-edit'));
                            const textStr = inputs.map(input => input.value).join('\\n');
                            const bytes = new TextEncoder().encode(textStr);
                            let binary = '';
                            for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
                            base64Update = window.btoa(binary);
                        }

                        const secret = new window.fernet.Secret(SECURE_DATA.fernetKey);
                        const token = new window.fernet.Token({ secret });
                        const newEncryptedPayload = token.encode(base64Update);

                        // 🔥 PROPERLY ESCAPED STORAGE URL (No random spaces!)
                        const res = await fetch(\`\${SUPABASE_URL}/storage/v1/object/vault-files/\${SECURE_DATA.filePath}\`, {
                            method: 'PUT',
                            headers: { 
                                'apikey': SUPABASE_ANON_KEY, 
                                'Authorization': \`Bearer \${SUPABASE_ANON_KEY}\`,
                                'Content-Type': 'text/plain' 
                            },
                            body: new Blob([newEncryptedPayload], { type: 'text/plain' })
                        });
                        
                        if (!res.ok) throw new Error("Storage Sync Failed");
                        
                        showToast("✅ Securely saved to Vault");

                        document.getElementById('secure-payload').innerText = btoa(newEncryptedPayload);
                        document.getElementById('save-btn').style.display = 'none';
                        document.getElementById('edit-btn').style.display = 'block';

                        decryptAndRender(false);

                    } catch (e) { 
                        alert("Error Saving: " + e.message); 
                    } finally {
                        saveBtn.innerText = "💾 Save & Sync";
                        saveBtn.disabled = false;
                    }
                });
            }
        });

        function decryptAndRender(isEditMode) {
            try {
                const safePayloadStr = document.getElementById('secure-payload').innerText.trim();
                const fernetString = atob(safePayloadStr); 
                
                const secret = new window.fernet.Secret(SECURE_DATA.fernetKey);
                const token = new window.fernet.Token({ token: fernetString, secret, ttl: 0 });
                
                const decryptedBase64 = token.decode();
                const binaryString = atob(decryptedBase64);
                
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                
                SECURE_DATA.rawBuffer = bytes.buffer; 
                SECURE_DATA.utf8Text = new TextDecoder('utf-8').decode(bytes);
                
                document.getElementById('login-ui').style.display = 'none';
                document.getElementById('toolbar').style.display = 'flex';
                document.getElementById('main-wrapper').style.display = 'flex';
                
                const container = document.getElementById('scroll-container');
                const sheetContainer = document.getElementById('luckysheet-container');
                
                container.innerHTML = "";
                container.style.display = 'none';
                sheetContainer.style.display = 'none';

                // --- MAGIC BYTE DETECTION ---
                // If a PPT/PPTX was converted to PDF on the server, the encrypted bytes will start with %PDF
                if (bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
                    container.style.display = 'flex';
                    renderPDF(bytes, container);
                    
                    // Hide Edit button for converted PPTs (cannot edit PDF in browser)
                    const editBtn = document.getElementById('edit-btn');
                    if (editBtn) editBtn.style.display = 'none';
                    return;
                }

                if (['xlsx', 'xls', 'csv'].includes(SECURE_DATA.fileExt)) {
                    sheetContainer.style.display = 'block';
                    if (window.luckysheet) { try { window.luckysheet.destroy(); } catch(e){} }
                    const luckyOptions = {
                        container: 'luckysheet-container', lang: 'en', showinfobar: false,      
                        showtoolbar: false, showsheetbar: true, showstatisticBar: true,
                        allowEdit: false, enableAddRow: false, enableAddCol: false, sheetFormulaBar: false
                    };
                    if (SECURE_DATA.fileExt === 'csv') {
                        const rows = SECURE_DATA.utf8Text.split(/\\r?\\n/).filter(r => r.length > 0);
                        const data = rows.map(row => row.split(',').map(val => ({ v: val, m: val })));
                        window.luckysheet.create({ ...luckyOptions, data: [{ name: "CSV Data", status: 1, data: data }] });
                    } else {
                        window.LuckyExcel.transformExcelToLucky(new File([bytes], "file.xlsx"), (json) => {
                            window.luckysheet.create({ ...luckyOptions, data: json.sheets, title: SECURE_DATA.docId });
                        });
                    }
                    setTimeout(() => {
                        const luckysheetBox = document.getElementById('luckysheet-container');
                        if (luckysheetBox) appendWatermarkToElement(luckysheetBox, { email: document.getElementById('email').value }, clientIp);
                    }, 500);
                } 
                else if (SECURE_DATA.fileExt === 'pdf') {
                    container.style.display = 'flex';
                    renderPDF(bytes, container);
                } 
                else if (['docx', 'doc'].includes(SECURE_DATA.fileExt)) {
                    container.style.display = 'flex';
                    window.docx.renderAsync(SECURE_DATA.rawBuffer, container, null, {
                        className: "docx",
                        inWrapper: true,
                        ignoreWidth: false,
                        ignoreHeight: false,
                        breakPages: true, 
                        ignoreLastRenderedPageBreak: false, 
                        experimental: true
                    }).then(() => {
                        const sections = container.querySelectorAll('section.docx');
                        sections.forEach(sec => appendWatermarkToElement(sec, { email: document.getElementById('email').value }, clientIp));
                    }).catch(err => {
                        container.innerHTML = "<p style='color:red;'>Error parsing DOCX: " + err.message + "</p>";
                    });
                }
                else if (['txt', 'text'].includes(SECURE_DATA.fileExt)) {
                    container.style.display = 'flex';
                    const lines = SECURE_DATA.utf8Text.split(/\\r?\\n/);
                    const LINES_PER_PAGE = 40; 
                    let html = '';
                    for (let i = 0; i < lines.length; i += LINES_PER_PAGE) {
                        const chunk = lines.slice(i, i + LINES_PER_PAGE).join('\\n');
                        html += \`
                            <div class="txt-page-wrapper">
                                <pre class="txt-view">\${chunk}</pre>
                            </div>
                        \`;
                    }
                    container.innerHTML = html;
                    const txtPages = container.querySelectorAll('.txt-page-wrapper');
                    txtPages.forEach(p => appendWatermarkToElement(p, { email: document.getElementById('email').value }, clientIp));
                } 
                else if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(SECURE_DATA.fileExt)) {
                    container.style.display = 'flex';
                    container.style.alignItems = 'center';
                    container.style.justifyContent = 'center';
                    container.style.height = '100%';
                    
                    const blob = new Blob([bytes]);
                    const url = URL.createObjectURL(blob);
                    
                    const imgWrapper = document.createElement('div');
                    imgWrapper.style.position = 'relative';
                    imgWrapper.style.maxWidth = '100%';
                    imgWrapper.style.maxHeight = '100%';
                    imgWrapper.style.display = 'flex';
                    imgWrapper.style.alignItems = 'center';
                    imgWrapper.style.justifyContent = 'center';
                    
                    const img = document.createElement('img');
                    img.src = url;
                    img.style.maxWidth = '90vw';
                    img.style.maxHeight = '80vh';
                    img.style.objectFit = 'contain';
                    img.style.boxShadow = '0 10px 30px rgba(0,0,0,0.5)';
                    img.style.borderRadius = '8px';
                    img.style.userSelect = 'none';
                    img.style.pointerEvents = 'none';
                    
                    imgWrapper.appendChild(img);
                    container.appendChild(imgWrapper);
                    
                    setTimeout(() => {
                         appendWatermarkToElement(imgWrapper, { email: document.getElementById('email').value }, clientIp);
                    }, 100);
                }
                else {
                    container.style.display = 'flex';
                    container.innerHTML = '<div style="color: white; padding: 40px;">Unsupported Format: ' + SECURE_DATA.fileExt + '</div>';
                }

            } catch(e) {
                console.error(e);
                alert("Rendering Error: " + e.message);
            }
        }

        async function renderPDF(bytes, container) {
            const pdfjsLib = window['pdfjs-dist/build/pdf'];
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
            const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
            
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const viewport = page.getViewport({ scale: 1.5 });
                const wrapper = document.createElement('div');
                wrapper.className = 'pdf-page-wrapper';
                wrapper.style.width = viewport.width + 'px';
                wrapper.style.height = viewport.height + 'px';
                const canvas = document.createElement('canvas');
                canvas.width = viewport.width; canvas.height = viewport.height;
                wrapper.appendChild(canvas);
                container.appendChild(wrapper);
                await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
                appendWatermarkToElement(wrapper, { email: document.getElementById('email').value }, clientIp, 1.5);
            }
        }

        function renderEditMode() {
             const container = document.getElementById('scroll-container');
             
             if (['xlsx', 'xls', 'csv'].includes(SECURE_DATA.fileExt)) {
                 const luckyOptions = {
                     container: 'luckysheet-container', lang: 'en', showinfobar: false,      
                     showtoolbar: true, showsheetbar: true, showstatisticBar: true,
                     allowEdit: true, enableAddRow: true, enableAddCol: true, sheetFormulaBar: true,
                     showtoolbarConfig: {
                         undoRedo: true, paintFormat: true, currencyFormat: true, percentageFormat: true,
                         numberDecrease: true, numberIncrease: true, moreFormats: true, font: true, fontSize: true,
                         bold: true, italic: true, strikethrough: true, underline: true, textColor: true,
                         fillColor: true, border: true, mergeCell: true, horizontalAlignMode: true,
                         verticalAlignMode: true, textWrapMode: true, textRotateMode: true, image: true,
                         link: true, chart: true, postil: true, pivotTable: true, function: true,
                         frozenMode: true, sortAndFilter: true, conditionalFormat: true, dataVerification: true,
                         splitColumn: true, screenshot: true, findAndReplace: true, protection: true, print: true
                     }
                 };
                 let existingData = window.luckysheet.getAllSheets();
                 window.luckysheet.destroy();
                 window.luckysheet.create({ ...luckyOptions, data: existingData });
             } 
             else if (['docx', 'doc'].includes(SECURE_DATA.fileExt)) {
                 container.innerHTML = "";
                 window.mammoth.convertToHtml({ arrayBuffer: SECURE_DATA.rawBuffer }).then(res => {
                     container.innerHTML = '<div class="doc-edit-wrapper"><div id="quill-container">' + res.value + '</div></div>';
                     window.quill = new window.Quill('#quill-container', { theme: 'snow' });
                 });
             }
             else if (['txt', 'text'].includes(SECURE_DATA.fileExt)) {
                 const lines = SECURE_DATA.utf8Text.split(/\\r?\\n/);
                 const LINES_PER_PAGE = 40; 
                 let html = '';
                 
                 for (let i = 0; i < lines.length; i += LINES_PER_PAGE) {
                     const chunk = lines.slice(i, i + LINES_PER_PAGE).join('\\n');
                     html += \`
                         <div class="txt-page-wrapper">
                             <textarea class="txt-edit" oninput="this.style.height='auto'; this.style.height=(this.scrollHeight)+'px';">\${chunk}</textarea>
                         </div>
                     \`;
                 }
                 container.innerHTML = html;

                 setTimeout(() => {
                     const textareas = document.querySelectorAll('.txt-edit');
                     textareas.forEach(ta => {
                         ta.style.height = 'auto';
                         ta.style.height = (ta.scrollHeight) + 'px';
                     });
                 }, 100);
             }
        }
    <\/script>
<\/body>
<\/html>`;

    return htmlContent;
};
