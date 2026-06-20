require('dotenv').config();
const { app, BrowserWindow, ipcMain, globalShortcut, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
const fernet = require('fernet');

const SUPABASE_URL = "https://xxlawcufvetxygaqwoxi.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh4bGF3Y3VmdmV0eHlnYXF3b3hpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NDE3MzgsImV4cCI6MjA5NDMxNzczOH0.yw7i6-U8xuzdQy0vj9CsXnOjIj5iwO4F3BbsC1cuBaU";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false }, global: { WebSocket: WebSocket } });

let mainWindow;
let activeWatcherPath = null;
const authFilePath = path.join(app.getPath('userData'), 'vdr_auth.json');
const tempDir = app.getPath('temp');

// 🔥 CATCH STARTUP FILE IF DOUBLE-CLICKED FROM OS
let startupDocId = null;
const fileArg = process.argv.find(arg => arg.endsWith('.vdr'));
if (fileArg && fs.existsSync(fileArg)) {
    try { startupDocId = fs.readFileSync(fileArg, 'utf8').trim(); } catch (e) { }
}

ipcMain.handle('save-auth', (event, data) => { fs.writeFileSync(authFilePath, JSON.stringify(data)); return true; });
ipcMain.handle('get-auth', () => { try { if (fs.existsSync(authFilePath)) return JSON.parse(fs.readFileSync(authFilePath, 'utf8')); } catch (e) { } return null; });
ipcMain.handle('clear-auth', () => { if (fs.existsSync(authFilePath)) fs.unlinkSync(authFilePath); return true; });
ipcMain.handle('get-startup-file', () => { return startupDocId ? { success: true, docId: startupDocId } : { success: false }; });

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280, height: 800,
        kiosk: true, // FULL LOCKDOWN
        alwaysOnTop: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') }
    });
    mainWindow.setContentProtection(true); // OBS BLACKOUT
    mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
    createWindow();
    globalShortcut.register('CommandOrControl+R', () => { });
    globalShortcut.register('CommandOrControl+Shift+I', () => { });
    globalShortcut.register('F11', () => { });
    globalShortcut.register('Escape', () => { });
});

app.on('will-quit', () => { globalShortcut.unregisterAll(); });

ipcMain.handle('open-file-dialog', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: 'Select VDR Keycard',
        filters: [{ name: 'VDR Keycards', extensions: ['vdr'] }],
        properties: ['openFile']
    });
    if (canceled || filePaths.length === 0) return { success: false };
    try { return { success: true, docId: fs.readFileSync(filePaths[0], 'utf8').trim() }; }
    catch (err) { return { success: false, error: 'Failed to read keycard file.' }; }
});

ipcMain.handle('login', async (event, args) => {
    try {
        const payload = Array.isArray(args) ? args[0] : args;
        const cleanEmail = payload.email.trim().toLowerCase();
        const { data: user, error } = await supabase.from('users').select('*').eq('email', cleanEmail).single();
        if (error || !user) return { success: false, message: "User not found." };
        if (user.password_hash !== payload.password) return { success: false, message: "Invalid password" };
        return { success: true, user: user, userId: user.id };
    } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('verify-access', async (event, payload) => {
    try {
        const { userId, docId } = Array.isArray(payload) ? payload[0] : payload;

        const { data: doc, error: docErr } = await supabase.from('documents')
            .select('file_path, dek_ref, name, uploaded_by, company_id')
            .eq('id', docId).single();

        if (docErr || !doc) throw new Error('File metadata not found in Vault.');

        let canRead = false; let canEdit = false;
        if (doc.uploaded_by === userId) {
            canRead = true; canEdit = true;
        } else {
            const { data: perm, error: permErr } = await supabase.from('document_permissions').select('can_read, can_edit').eq('user_id', userId).eq('doc_id', docId).single();
            if (permErr || !perm) throw new Error('Access Denied: You do not have permission.');
            canRead = perm.can_read; canEdit = perm.can_edit;
        }

        if (!canRead) throw new Error('Access Denied: Read permission revoked.');

        const { data: logData } = await supabase.from('document_access_logs').insert([{ user_id: userId, document_id: docId }]).select('id').single();

        const { data: fileData, error: downloadErr } = await supabase.storage.from('vault-files').download(doc.file_path);
        if (downloadErr) throw new Error('Failed to download encrypted file.');

        const encryptedText = await fileData.text();
        const token = new fernet.Token({ token: encryptedText, secret: new fernet.Secret(doc.dek_ref), ttl: 0 });
        const decryptedBase64 = token.decode();

        // 🔥 THE FIX: Querying new watermark_templates table for "present = true"
        let watermarkConfig = null;
        try {
            if (doc.company_id) {
                // 1. Check for the applied active template
                let { data: wm } = await supabase.from('watermark_templates')
                    .select('*')
                    .eq('company_id', doc.company_id)
                    .eq('present', true)
                    .single();

                // 2. If no template is marked 'present', fallback to the first one available
                if (!wm) {
                    const { data: fallbackWm } = await supabase.from('watermark_templates')
                        .select('*')
                        .eq('company_id', doc.company_id)
                        .limit(1)
                        .single();
                    wm = fallbackWm;
                }
                if (wm) watermarkConfig = wm;
            }
        } catch (wmErr) { console.log("Watermark fetch error:", wmErr.message); }

        return {
            success: true,
            canEdit,
            fileName: doc.name,
            content: decryptedBase64,
            logId: logData ? logData.id : null,
            watermark: watermarkConfig
        };
    } catch (error) { return { success: false, error: error.message }; }
});

ipcMain.on('close-log', async (event, logId) => {
    if (!logId) return;
    try {
        const { data: log } = await supabase.from('document_access_logs').select('accessed_at').eq('id', logId).single();
        if (log) {
            const start = new Date(log.accessed_at).getTime();
            const end = new Date().getTime();
            const durationSec = Math.floor((end - start) / 1000);
            const formatted = `${Math.floor(durationSec / 60)} min ${durationSec % 60} sec`;

            await supabase.from('document_access_logs').update({
                closed_at: new Date().toISOString(), duration_sec: durationSec, duration_formatted: formatted
            }).eq('id', logId);
        }
    } catch (e) { }
});

ipcMain.handle('save-text-edits', async (event, args) => {
    try {
        const { userId, docId, newB64Content } = Array.isArray(args) ? args[0] : args;
        const { data: doc } = await supabase.from('documents').select('file_path, dek_ref').eq('id', docId).single();
        const token = new fernet.Token({ secret: new fernet.Secret(doc.dek_ref) });
        const newFilePath = `${doc.file_path.split('_v')[0]}_v${Date.now()}`;

        await supabase.storage.from('vault-files').upload(newFilePath, Buffer.from(token.encode(newB64Content), 'utf8'), { contentType: 'text/plain' });
        await supabase.from('documents').update({ file_path: newFilePath }).eq('id', docId);
        await supabase.storage.from('vault-files').remove([doc.file_path]);
        await supabase.from('document_edit_logs').insert([{ user_id: userId, document_id: docId, action_type: 'edit', metadata: { status: 'Saved successfully' } }]);
        return { success: true };
    } catch (error) { return { success: false, error: error.message }; }
});

ipcMain.handle('checkout-office-doc', async (event, args) => {
    try {
        const { userId, docId, base64Content, fileName } = Array.isArray(args) ? args[0] : args;
        const tempFilePath = path.join(tempDir, `~vdr_${Date.now()}_${fileName}`);
        fs.writeFileSync(tempFilePath, Buffer.from(base64Content, 'base64'));

        let command = process.platform === 'win32' ? `start "" "${tempFilePath}"` : `open "${tempFilePath}"`;
        exec(command);

        if (activeWatcherPath) fs.unwatchFile(activeWatcherPath);
        activeWatcherPath = tempFilePath;
        let isUploading = false;

        setTimeout(() => {
            fs.watchFile(tempFilePath, { interval: 1000 }, async (curr, prev) => {
                if (curr.mtimeMs > prev.mtimeMs && !isUploading) {
                    isUploading = true;
                    try {
                        const freshBase64 = fs.readFileSync(tempFilePath).toString('base64');
                        const { data: doc } = await supabase.from('documents').select('file_path, dek_ref').eq('id', docId).single();
                        const token = new fernet.Token({ secret: new fernet.Secret(doc.dek_ref) });
                        const newFilePath = `${doc.file_path.split('_v')[0]}_v${Date.now()}`;

                        await supabase.storage.from('vault-files').upload(newFilePath, Buffer.from(token.encode(freshBase64), 'utf8'), { contentType: 'text/plain' });
                        await supabase.from('documents').update({ file_path: newFilePath }).eq('id', docId);
                        await supabase.storage.from('vault-files').remove([doc.file_path]);
                        await supabase.from('document_edit_logs').insert([{ user_id: userId, document_id: docId, action_type: 'native_edit', metadata: { status: 'Checked in' } }]);

                        fs.unwatchFile(tempFilePath);
                        activeWatcherPath = null;

                        if (process.platform === 'win32') {
                            exec('taskkill /F /IM WINWORD.EXE');
                            exec('taskkill /F /IM EXCEL.EXE');
                        } else {
                            exec('pkill -9 "Microsoft Word"');
                            exec('pkill -9 "Microsoft Excel"');
                        }

                        setTimeout(() => { try { fs.unlinkSync(tempFilePath); } catch (e) { } }, 1000);
                        mainWindow.webContents.send('sync-success', "Vault Synced!");
                    } catch (e) { isUploading = false; }
                }
            });
        }, 3500);

        return { success: true, tempPath: tempFilePath };
    } catch (error) { return { success: false, error: error.message }; }
});

ipcMain.handle('checkin-office-doc', async (event, tempPath) => {
    try {
        if (activeWatcherPath) { fs.unwatchFile(activeWatcherPath); activeWatcherPath = null; }
        if (process.platform === 'win32') {
            exec('taskkill /F /IM WINWORD.EXE');
            exec('taskkill /F /IM EXCEL.EXE');
        } else {
            exec('pkill -9 "Microsoft Word"');
            exec('pkill -9 "Microsoft Excel"');
        }
        setTimeout(() => { if (fs.existsSync(tempPath)) { try { fs.unlinkSync(tempPath); } catch (err) { } } }, 1000);
        return { success: true };
    } catch (err) { return { success: false }; }
});







// // main.js
// require('dotenv').config();
// const { app, BrowserWindow, ipcMain, globalShortcut, dialog } = require('electron');
// const path = require('path');
// const fs = require('fs');
// const { exec } = require('child_process');
// const { createClient } = require('@supabase/supabase-js');
// const WebSocket = require('ws');
// const fernet = require('fernet');

// const SUPABASE_URL = "https://xxlawcufvetxygaqwoxi.supabase.co";
// const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh4bGF3Y3VmdmV0eHlnYXF3b3hpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NDE3MzgsImV4cCI6MjA5NDMxNzczOH0.yw7i6-U8xuzdQy0vj9CsXnOjIj5iwO4F3BbsC1cuBaU";

// const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false }, global: { WebSocket: WebSocket } });

// let mainWindow;
// let activeWatcherPath = null;
// const authFilePath = path.join(app.getPath('userData'), 'vdr_auth.json');
// const tempDir = app.getPath('temp');

// ipcMain.handle('save-auth', (event, data) => { fs.writeFileSync(authFilePath, JSON.stringify(data)); return true; });
// ipcMain.handle('get-auth', () => { try { if (fs.existsSync(authFilePath)) return JSON.parse(fs.readFileSync(authFilePath, 'utf8')); } catch (e) { } return null; });
// ipcMain.handle('clear-auth', () => { if (fs.existsSync(authFilePath)) fs.unlinkSync(authFilePath); return true; });

// function createWindow() {
//     mainWindow = new BrowserWindow({
//         width: 1280, height: 800,
//         kiosk: true, // FULL LOCKDOWN ENVIRONMENT
//         alwaysOnTop: false,
//         webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') }
//     });
//     mainWindow.setContentProtection(true); // TOTAL SCREENSHOT/OBS BLACKOUT BLOCK
//     mainWindow.loadFile('index.html');
// }

// app.whenReady().then(() => {
//     createWindow();
//     globalShortcut.register('CommandOrControl+R', () => { });
//     globalShortcut.register('CommandOrControl+Shift+I', () => { });
//     globalShortcut.register('F11', () => { });
//     globalShortcut.register('Escape', () => { });
// });

// app.on('will-quit', () => { globalShortcut.unregisterAll(); });

// ipcMain.handle('get-startup-file', () => null);

// ipcMain.handle('open-file-dialog', async () => {
//     const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
//         title: 'Select VDR Keycard',
//         filters: [{ name: 'VDR Keycards', extensions: ['vdr'] }],
//         properties: ['openFile']
//     });
//     if (canceled || filePaths.length === 0) return { success: false };
//     try { return { success: true, docId: fs.readFileSync(filePaths[0], 'utf8').trim() }; }
//     catch (err) { return { success: false, error: 'Failed to read keycard file.' }; }
// });

// ipcMain.handle('login', async (event, args) => {
//     try {
//         const payload = Array.isArray(args) ? args[0] : args;
//         const cleanEmail = payload.email.trim().toLowerCase();
//         const { data: user, error } = await supabase.from('users').select('*').eq('email', cleanEmail).single();
//         if (error || !user) return { success: false, message: "User not found." };
//         if (user.password_hash !== payload.password) return { success: false, message: "Invalid password" };
//         return { success: true, user: user, userId: user.id };
//     } catch (err) { return { success: false, message: err.message }; }
// });

// ipcMain.handle('verify-access', async (event, payload) => {
//     try {
//         const { userId, docId } = Array.isArray(payload) ? payload[0] : payload;

//         // Grab document metadata including company_id mapping
//         const { data: doc, error: docErr } = await supabase.from('documents')
//             .select('file_path, dek_ref, name, uploaded_by, company_id')
//             .eq('id', docId).single();

//         if (docErr || !doc) throw new Error('File metadata not found in Vault.');

//         let canRead = false; let canEdit = false;
//         if (doc.uploaded_by === userId) {
//             canRead = true; canEdit = true;
//         } else {
//             const { data: perm, error: permErr } = await supabase.from('document_permissions').select('can_read, can_edit').eq('user_id', userId).eq('doc_id', docId).single();
//             if (permErr || !perm) throw new Error('Access Denied: You do not have permission.');
//             canRead = perm.can_read; canEdit = perm.can_edit;
//         }

//         if (!canRead) throw new Error('Access Denied: Read permission revoked.');

//         // Insert unique tracking access token row
//         const { data: logData } = await supabase.from('document_access_logs').insert([{ user_id: userId, document_id: docId }]).select('id').single();

//         // Download and decrypt payload stream
//         const { data: fileData, error: downloadErr } = await supabase.storage.from('vault-files').download(doc.file_path);
//         if (downloadErr) throw new Error('Failed to download encrypted file.');

//         const encryptedText = await fileData.text();
//         const token = new fernet.Token({ token: encryptedText, secret: new fernet.Secret(doc.dek_ref), ttl: 0 });
//         const decryptedBase64 = token.decode();

//         // 🔥 THE FIX: Querying custom text layout parameters from `watermark_settings`
//         let watermarkConfig = null;
//         try {
//             if (doc.company_id) {
//                 const { data: wm } = await supabase.from('watermark_settings')
//                     .select('*')
//                     .eq('company_id', doc.company_id)
//                     .order('updated_at', { ascending: false })
//                     .limit(1)
//                     .single();
//                 if (wm) watermarkConfig = wm;
//             }
//         } catch (wmErr) { console.log("Watermark fetch bypassed/not available:", wmErr.message); }

//         return {
//             success: true,
//             canEdit,
//             fileName: doc.name,
//             content: decryptedBase64,
//             logId: logData ? logData.id : null,
//             watermark: watermarkConfig
//         };
//     } catch (error) { return { success: false, error: error.message }; }
// });

// ipcMain.on('close-log', async (event, logId) => {
//     if (!logId) return;
//     try {
//         const { data: log } = await supabase.from('document_access_logs').select('accessed_at').eq('id', logId).single();
//         if (log) {
//             const start = new Date(log.accessed_at).getTime();
//             const end = new Date().getTime();
//             const durationSec = Math.floor((end - start) / 1000);
//             const formatted = `${Math.floor(durationSec / 60)} min ${durationSec % 60} sec`;

//             await supabase.from('document_access_logs').update({
//                 closed_at: new Date().toISOString(), duration_sec: durationSec, duration_formatted: formatted
//             }).eq('id', logId);
//         }
//     } catch (e) { }
// });

// ipcMain.handle('save-text-edits', async (event, args) => {
//     try {
//         const { userId, docId, newB64Content } = Array.isArray(args) ? args[0] : args;
//         const { data: doc } = await supabase.from('documents').select('file_path, dek_ref').eq('id', docId).single();
//         const token = new fernet.Token({ secret: new fernet.Secret(doc.dek_ref) });
//         const newFilePath = `${doc.file_path.split('_v')[0]}_v${Date.now()}`;

//         await supabase.storage.from('vault-files').upload(newFilePath, Buffer.from(token.encode(newB64Content), 'utf8'), { contentType: 'text/plain' });
//         await supabase.from('documents').update({ file_path: newFilePath }).eq('id', docId);
//         await supabase.storage.from('vault-files').remove([doc.file_path]);
//         await supabase.from('document_edit_logs').insert([{ user_id: userId, document_id: docId, action_type: 'edit', metadata: { status: 'Saved successfully' } }]);
//         return { success: true };
//     } catch (error) { return { success: false, error: error.message }; }
// });

// ipcMain.handle('checkout-office-doc', async (event, args) => {
//     try {
//         const { userId, docId, base64Content, fileName } = Array.isArray(args) ? args[0] : args;
//         const tempFilePath = path.join(tempDir, `~vdr_${Date.now()}_${fileName}`);
//         fs.writeFileSync(tempFilePath, Buffer.from(base64Content, 'base64'));

//         let command = process.platform === 'win32' ? `start "" "${tempFilePath}"` : `open "${tempFilePath}"`;
//         exec(command);

//         if (activeWatcherPath) fs.unwatchFile(activeWatcherPath);
//         activeWatcherPath = tempFilePath;
//         let isUploading = false;

//         setTimeout(() => {
//             fs.watchFile(tempFilePath, { interval: 1000 }, async (curr, prev) => {
//                 if (curr.mtimeMs > prev.mtimeMs && !isUploading) {
//                     isUploading = true;
//                     try {
//                         const freshBase64 = fs.readFileSync(tempFilePath).toString('base64');
//                         const { data: doc } = await supabase.from('documents').select('file_path, dek_ref').eq('id', docId).single();
//                         const token = new fernet.Token({ secret: new fernet.Secret(doc.dek_ref) });
//                         const newFilePath = `${doc.file_path.split('_v')[0]}_v${Date.now()}`;

//                         await supabase.storage.from('vault-files').upload(newFilePath, Buffer.from(token.encode(freshBase64), 'utf8'), { contentType: 'text/plain' });
//                         await supabase.from('documents').update({ file_path: newFilePath }).eq('id', docId);
//                         await supabase.storage.from('vault-files').remove([doc.file_path]);
//                         await supabase.from('document_edit_logs').insert([{ user_id: userId, document_id: docId, action_type: 'native_edit', metadata: { status: 'Checked in' } }]);

//                         fs.unwatchFile(tempFilePath);
//                         activeWatcherPath = null;

//                         if (process.platform === 'win32') {
//                             exec('taskkill /F /IM WINWORD.EXE');
//                             exec('taskkill /F /IM EXCEL.EXE');
//                         } else {
//                             exec('pkill -9 "Microsoft Word"');
//                             exec('pkill -9 "Microsoft Excel"');
//                         }

//                         setTimeout(() => { try { fs.unlinkSync(tempFilePath); } catch (e) { } }, 1000);
//                         mainWindow.webContents.send('sync-success', "Vault Synced!");
//                     } catch (e) { isUploading = false; }
//                 }
//             });
//         }, 3500);

//         return { success: true, tempPath: tempFilePath };
//     } catch (error) { return { success: false, error: error.message }; }
// });

// ipcMain.handle('checkin-office-doc', async (event, tempPath) => {
//     try {
//         if (activeWatcherPath) { fs.unwatchFile(activeWatcherPath); activeWatcherPath = null; }
//         if (process.platform === 'win32') {
//             exec('taskkill /F /IM WINWORD.EXE');
//             exec('taskkill /F /IM EXCEL.EXE');
//         } else {
//             exec('pkill -9 "Microsoft Word"');
//             exec('pkill -9 "Microsoft Excel"');
//         }
//         setTimeout(() => { if (fs.existsSync(tempPath)) { try { fs.unlinkSync(tempPath); } catch (err) { } } }, 1000);
//         return { success: true };
//     } catch (err) { return { success: false }; }
// });






//perfect one without watermark
// // main.js
// require('dotenv').config();
// const { app, BrowserWindow, ipcMain, globalShortcut, dialog } = require('electron');
// const path = require('path');
// const fs = require('fs');
// const { exec } = require('child_process');
// const { createClient } = require('@supabase/supabase-js');
// const WebSocket = require('ws');
// const fernet = require('fernet');

// const SUPABASE_URL = "https://xxlawcufvetxygaqwoxi.supabase.co";
// const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh4bGF3Y3VmdmV0eHlnYXF3b3hpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NDE3MzgsImV4cCI6MjA5NDMxNzczOH0.yw7i6-U8xuzdQy0vj9CsXnOjIj5iwO4F3BbsC1cuBaU";

// const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false }, global: { WebSocket: WebSocket } });

// let mainWindow;
// let activeWatcherPath = null;
// const authFilePath = path.join(app.getPath('userData'), 'vdr_auth.json');
// const tempDir = app.getPath('temp');

// ipcMain.handle('save-auth', (event, data) => { fs.writeFileSync(authFilePath, JSON.stringify(data)); return true; });
// ipcMain.handle('get-auth', () => { try { if (fs.existsSync(authFilePath)) return JSON.parse(fs.readFileSync(authFilePath, 'utf8')); } catch (e) { } return null; });
// ipcMain.handle('clear-auth', () => { if (fs.existsSync(authFilePath)) fs.unlinkSync(authFilePath); return true; });

// function createWindow() {
//     mainWindow = new BrowserWindow({
//         width: 1280, height: 800,
//         kiosk: true, // FULL SCREEN KIOSK
//         alwaysOnTop: false,
//         webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') }
//     });
//     mainWindow.setContentProtection(true); // BLOCKS SCREENSHOTS
//     mainWindow.loadFile('index.html');
// }

// app.whenReady().then(() => {
//     createWindow();
//     globalShortcut.register('CommandOrControl+R', () => { });
//     globalShortcut.register('CommandOrControl+Shift+I', () => { });
//     globalShortcut.register('F11', () => { });
//     globalShortcut.register('Escape', () => { });
// });

// app.on('will-quit', () => { globalShortcut.unregisterAll(); });

// ipcMain.handle('get-startup-file', () => null);

// ipcMain.handle('open-file-dialog', async () => {
//     const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
//         title: 'Select VDR Keycard',
//         filters: [{ name: 'VDR Keycards', extensions: ['vdr'] }],
//         properties: ['openFile']
//     });
//     if (canceled || filePaths.length === 0) return { success: false };
//     try { return { success: true, docId: fs.readFileSync(filePaths[0], 'utf8').trim() }; }
//     catch (err) { return { success: false, error: 'Failed to read keycard file.' }; }
// });

// ipcMain.handle('login', async (event, args) => {
//     try {
//         const payload = Array.isArray(args) ? args[0] : args;
//         const cleanEmail = payload.email.trim().toLowerCase();
//         const { data: user, error } = await supabase.from('users').select('*').eq('email', cleanEmail).single();
//         if (error || !user) return { success: false, message: "User not found." };
//         if (user.password_hash !== payload.password) return { success: false, message: "Invalid password" };
//         return { success: true, user: user, userId: user.id };
//     } catch (err) { return { success: false, message: err.message }; }
// });

// ipcMain.handle('verify-access', async (event, payload) => {
//     try {
//         const { userId, docId } = Array.isArray(payload) ? payload[0] : payload;
//         const { data: doc, error: docErr } = await supabase.from('documents').select('file_path, dek_ref, name, uploaded_by').eq('id', docId).single();
//         if (docErr || !doc) throw new Error('File metadata not found in Vault.');

//         let canRead = false; let canEdit = false;
//         if (doc.uploaded_by === userId) {
//             canRead = true; canEdit = true;
//         } else {
//             const { data: perm, error: permErr } = await supabase.from('document_permissions').select('can_read, can_edit').eq('user_id', userId).eq('doc_id', docId).single();
//             if (permErr || !perm) throw new Error('Access Denied: You do not have permission.');
//             canRead = perm.can_read; canEdit = perm.can_edit;
//         }

//         if (!canRead) throw new Error('Access Denied: Read permission revoked.');

//         const { data: logData } = await supabase.from('document_access_logs').insert([{ user_id: userId, document_id: docId }]).select('id').single();

//         const { data: fileData, error: downloadErr } = await supabase.storage.from('vault-files').download(doc.file_path);
//         if (downloadErr) throw new Error('Failed to download encrypted file.');

//         const encryptedText = await fileData.text();
//         const token = new fernet.Token({ token: encryptedText, secret: new fernet.Secret(doc.dek_ref), ttl: 0 });
//         const decryptedBase64 = token.decode();

//         return { success: true, canEdit, fileName: doc.name, content: decryptedBase64, logId: logData ? logData.id : null };
//     } catch (error) { return { success: false, error: error.message }; }
// });

// ipcMain.on('close-log', async (event, logId) => {
//     if (!logId) return;
//     try {
//         const { data: log } = await supabase.from('document_access_logs').select('accessed_at').eq('id', logId).single();
//         if (log) {
//             const start = new Date(log.accessed_at).getTime();
//             const end = new Date().getTime();
//             const durationSec = Math.floor((end - start) / 1000);
//             const formatted = `${Math.floor(durationSec / 60)} min ${durationSec % 60} sec`;

//             await supabase.from('document_access_logs').update({
//                 closed_at: new Date().toISOString(), duration_sec: durationSec, duration_formatted: formatted
//             }).eq('id', logId);
//         }
//     } catch (e) { }
// });

// ipcMain.handle('save-text-edits', async (event, args) => {
//     try {
//         const { userId, docId, newB64Content } = Array.isArray(args) ? args[0] : args;
//         const { data: doc } = await supabase.from('documents').select('file_path, dek_ref').eq('id', docId).single();
//         const token = new fernet.Token({ secret: new fernet.Secret(doc.dek_ref) });
//         const newFilePath = `${doc.file_path.split('_v')[0]}_v${Date.now()}`;

//         await supabase.storage.from('vault-files').upload(newFilePath, Buffer.from(token.encode(newB64Content), 'utf8'), { contentType: 'text/plain' });
//         await supabase.from('documents').update({ file_path: newFilePath }).eq('id', docId);
//         await supabase.storage.from('vault-files').remove([doc.file_path]);
//         await supabase.from('document_edit_logs').insert([{ user_id: userId, document_id: docId, action_type: 'edit', metadata: { status: 'Saved successfully' } }]);
//         return { success: true };
//     } catch (error) { return { success: false, error: error.message }; }
// });

// ipcMain.handle('checkout-office-doc', async (event, args) => {
//     try {
//         const { userId, docId, base64Content, fileName } = Array.isArray(args) ? args[0] : args;
//         const tempFilePath = path.join(tempDir, `~vdr_${Date.now()}_${fileName}`);
//         fs.writeFileSync(tempFilePath, Buffer.from(base64Content, 'base64'));

//         let command = process.platform === 'win32' ? `start "" "${tempFilePath}"` : `open "${tempFilePath}"`;
//         exec(command);

//         if (activeWatcherPath) fs.unwatchFile(activeWatcherPath);
//         activeWatcherPath = tempFilePath;
//         let isUploading = false;

//         setTimeout(() => {
//             fs.watchFile(tempFilePath, { interval: 1000 }, async (curr, prev) => {
//                 if (curr.mtimeMs > prev.mtimeMs && !isUploading) {
//                     isUploading = true;
//                     try {
//                         const freshBase64 = fs.readFileSync(tempFilePath).toString('base64');
//                         const { data: doc } = await supabase.from('documents').select('file_path, dek_ref').eq('id', docId).single();
//                         const token = new fernet.Token({ secret: new fernet.Secret(doc.dek_ref) });
//                         const newFilePath = `${doc.file_path.split('_v')[0]}_v${Date.now()}`;

//                         await supabase.storage.from('vault-files').upload(newFilePath, Buffer.from(token.encode(freshBase64), 'utf8'), { contentType: 'text/plain' });
//                         await supabase.from('documents').update({ file_path: newFilePath }).eq('id', docId);
//                         await supabase.storage.from('vault-files').remove([doc.file_path]);
//                         await supabase.from('document_edit_logs').insert([{ user_id: userId, document_id: docId, action_type: 'native_edit', metadata: { status: 'Checked in' } }]);

//                         fs.unwatchFile(tempFilePath);
//                         activeWatcherPath = null;

//                         if (process.platform === 'win32') {
//                             exec('taskkill /F /IM WINWORD.EXE');
//                             exec('taskkill /F /IM EXCEL.EXE');
//                         } else {
//                             exec('pkill -9 "Microsoft Word"');
//                             exec('pkill -9 "Microsoft Excel"');
//                         }

//                         setTimeout(() => { try { fs.unlinkSync(tempFilePath); } catch (e) { } }, 1000);
//                         mainWindow.webContents.send('sync-success', "Vault Synced!");
//                     } catch (e) { isUploading = false; }
//                 }
//             });
//         }, 3500);

//         return { success: true, tempPath: tempFilePath };
//     } catch (error) { return { success: false, error: error.message }; }
// });

// ipcMain.handle('checkin-office-doc', async (event, tempPath) => {
//     try {
//         if (activeWatcherPath) { fs.unwatchFile(activeWatcherPath); activeWatcherPath = null; }
//         if (process.platform === 'win32') {
//             exec('taskkill /F /IM WINWORD.EXE');
//             exec('taskkill /F /IM EXCEL.EXE');
//         } else {
//             exec('pkill -9 "Microsoft Word"');
//             exec('pkill -9 "Microsoft Excel"');
//         }
//         setTimeout(() => { if (fs.existsSync(tempPath)) { try { fs.unlinkSync(tempPath); } catch (err) { } } }, 1000);
//         return { success: true };
//     } catch (err) { return { success: false }; }
// });






// [perfectly working one]
// // main.js
// require('dotenv').config();
// const { app, BrowserWindow, ipcMain, globalShortcut, dialog } = require('electron');
// const path = require('path');
// const fs = require('fs');
// const { exec } = require('child_process');
// const { createClient } = require('@supabase/supabase-js');
// const WebSocket = require('ws');
// const fernet = require('fernet');

// const SUPABASE_URL = "https://xxlawcufvetxygaqwoxi.supabase.co";
// const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh4bGF3Y3VmdmV0eHlnYXF3b3hpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NDE3MzgsImV4cCI6MjA5NDMxNzczOH0.yw7i6-U8xuzdQy0vj9CsXnOjIj5iwO4F3BbsC1cuBaU";

// const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false }, global: { WebSocket: WebSocket } });

// let mainWindow;

// // 🔥 NEW: Tracker for watchFile
// let activeWatcherPath = null;

// const authFilePath = path.join(app.getPath('userData'), 'vdr_auth.json');
// const tempDir = app.getPath('temp');

// ipcMain.handle('save-auth', (event, data) => { fs.writeFileSync(authFilePath, JSON.stringify(data)); return true; });
// ipcMain.handle('get-auth', () => { try { if (fs.existsSync(authFilePath)) return JSON.parse(fs.readFileSync(authFilePath, 'utf8')); } catch (e) { } return null; });
// ipcMain.handle('clear-auth', () => { if (fs.existsSync(authFilePath)) fs.unlinkSync(authFilePath); return true; });

// function parseVdrFile(filePath) { try { return fs.readFileSync(filePath, 'utf8').trim(); } catch (e) { return null; } }

// function createWindow() {
//     mainWindow = new BrowserWindow({
//         width: 1280, height: 800, kiosk: false, webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') }
//     });
//     mainWindow.loadFile('index.html');
// }

// app.whenReady().then(createWindow);

// ipcMain.handle('get-startup-file', () => null);

// ipcMain.handle('open-file-dialog', async () => {
//     const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
//         title: 'Select VDR Keycard',
//         filters: [{ name: 'VDR Keycards', extensions: ['vdr'] }],
//         properties: ['openFile']
//     });
//     if (canceled || filePaths.length === 0) return { success: false };
//     try {
//         const docId = fs.readFileSync(filePaths[0], 'utf8').trim();
//         return { success: true, docId: docId };
//     } catch (err) { return { success: false, error: 'Failed to read keycard file.' }; }
// });

// ipcMain.handle('login', async (event, args) => {
//     try {
//         const payload = Array.isArray(args) ? args[0] : args;
//         const cleanEmail = payload.email.trim().toLowerCase();
//         const { data: user, error } = await supabase.from('users').select('*').eq('email', cleanEmail).single();
//         if (error || !user) return { success: false, message: "User not found." };
//         if (user.password_hash !== payload.password) return { success: false, message: "Invalid password" };
//         return { success: true, user: user, userId: user.id };
//     } catch (err) { return { success: false, message: err.message }; }
// });

// ipcMain.handle('verify-access', async (event, payload) => {
//     try {
//         const { userId, docId } = Array.isArray(payload) ? payload[0] : payload;
//         const { data: doc, error: docErr } = await supabase.from('documents').select('file_path, dek_ref, name, uploaded_by').eq('id', docId).single();
//         if (docErr || !doc) throw new Error('File metadata not found in Vault.');

//         let canRead = true; let canEdit = true;

//         const { data: fileData, error: downloadErr } = await supabase.storage.from('vault-files').download(doc.file_path);
//         if (downloadErr) throw new Error('Failed to download encrypted file.');

//         const encryptedText = await fileData.text();
//         const secret = new fernet.Secret(doc.dek_ref);
//         const token = new fernet.Token({ token: encryptedText, secret: secret, ttl: 0 });
//         const decryptedBase64 = token.decode();

//         const { data: logData } = await supabase.from('document_access_logs').insert([{ user_id: userId, document_id: docId }]).select('id').single();

//         return { success: true, canEdit, fileName: doc.name, content: decryptedBase64, logId: logData ? logData.id : null };
//     } catch (error) { return { success: false, error: error.message }; }
// });

// ipcMain.on('close-log', async (event, logId) => {
//     if (!logId) return;
//     try {
//         const { data: log } = await supabase.from('document_access_logs').select('accessed_at').eq('id', logId).single();
//         if (log) {
//             const start = new Date(log.accessed_at).getTime();
//             const end = new Date().getTime();
//             await supabase.from('document_access_logs').update({ closed_at: new Date().toISOString(), duration_sec: Math.floor((end - start) / 1000) }).eq('id', logId);
//         }
//     } catch (e) { }
// });

// ipcMain.handle('save-text-edits', async (event, args) => {
//     try {
//         const { userId, docId, newB64Content } = Array.isArray(args) ? args[0] : args;

//         const { data: doc } = await supabase.from('documents').select('file_path, dek_ref').eq('id', docId).single();
//         const token = new fernet.Token({ secret: new fernet.Secret(doc.dek_ref) });
//         const encryptedString = token.encode(newB64Content);

//         const newFilePath = `${doc.file_path.split('_v')[0]}_v${Date.now()}`;

//         await supabase.storage.from('vault-files').upload(newFilePath, Buffer.from(encryptedString, 'utf8'), { contentType: 'text/plain' });
//         await supabase.from('documents').update({ file_path: newFilePath }).eq('id', docId);
//         await supabase.storage.from('vault-files').remove([doc.file_path]);

//         await supabase.from('document_edit_logs').insert([{ user_id: userId, document_id: docId, action_type: 'edit', metadata: { status: 'Saved successfully' } }]);
//         return { success: true };
//     } catch (error) { return { success: false, error: error.message }; }
// });

// // 📝 2. MS OFFICE NATIVE ENGINE (With Delay & Modified Time Check)
// ipcMain.handle('checkout-office-doc', async (event, args) => {
//     try {
//         const { userId, docId, base64Content, fileName } = Array.isArray(args) ? args[0] : args;
//         const tempFilePath = path.join(tempDir, `~vdr_${Date.now()}_${fileName}`);

//         fs.writeFileSync(tempFilePath, Buffer.from(base64Content, 'base64'));

//         let command = process.platform === 'win32' ? `start "" "${tempFilePath}"` : `open "${tempFilePath}"`;
//         exec(command);

//         // Remove old watcher if exists
//         if (activeWatcherPath) {
//             fs.unwatchFile(activeWatcherPath);
//         }

//         activeWatcherPath = tempFilePath;
//         let isUploading = false;

//         // 🔥 THE FIX: Wait 3.5 seconds before we even start watching the file.
//         // This gives MS Office enough time to open, build lock files, and settle down.
//         setTimeout(() => {
//             // 🔥 THE FIX: Use fs.watchFile (polls every 1 second) instead of fs.watch (instant)
//             fs.watchFile(tempFilePath, { interval: 1000 }, async (curr, prev) => {

//                 // Only trigger if the modified time ACTUALLY increased
//                 if (curr.mtimeMs > prev.mtimeMs && !isUploading) {
//                     isUploading = true;
//                     console.log("Real Save Detected! Processing upload...");

//                     try {
//                         const freshBase64 = fs.readFileSync(tempFilePath).toString('base64');
//                         const { data: doc } = await supabase.from('documents').select('file_path, dek_ref').eq('id', docId).single();

//                         const token = new fernet.Token({ secret: new fernet.Secret(doc.dek_ref) });
//                         const encryptedString = token.encode(freshBase64);
//                         const newFilePath = `${doc.file_path.split('_v')[0]}_v${Date.now()}`;

//                         await supabase.storage.from('vault-files').upload(newFilePath, Buffer.from(encryptedString, 'utf8'), { contentType: 'text/plain' });
//                         await supabase.from('documents').update({ file_path: newFilePath }).eq('id', docId);
//                         await supabase.storage.from('vault-files').remove([doc.file_path]);

//                         await supabase.from('document_edit_logs').insert([{ user_id: userId, document_id: docId, action_type: 'native_edit', metadata: { status: 'Checked in' } }]);

//                         // Stop watching the file
//                         fs.unwatchFile(tempFilePath);
//                         activeWatcherPath = null;

//                         // Forcefully kill MS Word & Excel
//                         if (process.platform === 'win32') {
//                             exec('taskkill /F /IM WINWORD.EXE', () => { });
//                             exec('taskkill /F /IM EXCEL.EXE', () => { });
//                         } else {
//                             exec('pkill -9 "Microsoft Word"', () => { });
//                             exec('pkill -9 "Microsoft Excel"', () => { });
//                         }

//                         // Delete the temp file cleanly
//                         setTimeout(() => {
//                             try { fs.unlinkSync(tempFilePath); } catch (e) { }
//                         }, 1000);

//                         mainWindow.webContents.send('sync-success', "Vault Synced!");
//                     } catch (e) {
//                         console.error(e);
//                         isUploading = false;
//                     }
//                 }
//             });
//         }, 3500);

//         return { success: true, tempPath: tempFilePath };
//     } catch (error) { return { success: false, error: error.message }; }
// });

// ipcMain.handle('checkin-office-doc', async (event, tempPath) => {
//     try {
//         if (activeWatcherPath) {
//             fs.unwatchFile(activeWatcherPath);
//             activeWatcherPath = null;
//         }
//         if (process.platform === 'win32') {
//             exec('taskkill /F /IM WINWORD.EXE', () => { });
//             exec('taskkill /F /IM EXCEL.EXE', () => { });
//         } else {
//             exec('pkill -9 "Microsoft Word"', () => { });
//             exec('pkill -9 "Microsoft Excel"', () => { });
//         }

//         setTimeout(() => {
//             if (fs.existsSync(tempPath)) {
//                 try { fs.unlinkSync(tempPath); } catch (err) { }
//             }
//         }, 1000);

//         return { success: true };
//     } catch (err) { return { success: false }; }
// });












