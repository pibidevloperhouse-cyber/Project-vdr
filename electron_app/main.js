// main.js
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

ipcMain.handle('save-auth', (event, data) => { fs.writeFileSync(authFilePath, JSON.stringify(data)); return true; });
ipcMain.handle('get-auth', () => { try { if (fs.existsSync(authFilePath)) return JSON.parse(fs.readFileSync(authFilePath, 'utf8')); } catch (e) { } return null; });
ipcMain.handle('clear-auth', () => { if (fs.existsSync(authFilePath)) fs.unlinkSync(authFilePath); return true; });

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280, height: 800,
        kiosk: true, // FULL SCREEN KIOSK
        alwaysOnTop: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') }
    });
    mainWindow.setContentProtection(true); // BLOCKS SCREENSHOTS
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

ipcMain.handle('get-startup-file', () => null);

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
        const { data: doc, error: docErr } = await supabase.from('documents').select('file_path, dek_ref, name, uploaded_by').eq('id', docId).single();
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

        return { success: true, canEdit, fileName: doc.name, content: decryptedBase64, logId: logData ? logData.id : null };
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














// // main.js
// require('dotenv').config();
// const { app, BrowserWindow, ipcMain, globalShortcut, dialog } = require('electron');
// const path = require('path');
// const fs = require('fs');
// const { exec } = require('child_process'); // For opening native apps
// const { createClient } = require('@supabase/supabase-js');
// const WebSocket = require('ws');
// const fernet = require('fernet');

// const logPath = path.join(app.getPath('userData'), 'vdr_debug.log');
// console.log = console.error = (msg) => { fs.appendFileSync(logPath, new Date().toISOString() + ': ' + msg + '\n'); };

// const SUPABASE_URL = "https://xxlawcufvetxygaqwoxi.supabase.co";
// const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh4bGF3Y3VmdmV0eHlnYXF3b3hpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NDE3MzgsImV4cCI6MjA5NDMxNzczOH0.yw7i6-U8xuzdQy0vj9CsXnOjIj5iwO4F3BbsC1cuBaU";

// const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false }, global: { WebSocket: WebSocket } });

// let mainWindow;
// let activeWatcher = null; // Watches the checked-out file
// const authFilePath = path.join(app.getPath('userData'), 'vdr_auth.json');
// const tempDir = app.getPath('temp'); // The hidden OS temp folder

// ipcMain.handle('save-auth', (event, data) => { fs.writeFileSync(authFilePath, JSON.stringify(data)); return true; });
// ipcMain.handle('get-auth', () => { try { if (fs.existsSync(authFilePath)) return JSON.parse(fs.readFileSync(authFilePath, 'utf8')); } catch (e) { } return null; });
// ipcMain.handle('clear-auth', () => { if (fs.existsSync(authFilePath)) fs.unlinkSync(authFilePath); return true; });

// function parseVdrFile(filePath) { try { return fs.readFileSync(filePath, 'utf8').trim(); } catch (e) { return null; } }

// function createWindow() {
//     mainWindow = new BrowserWindow({
//         width: 1280, height: 800, kiosk: false, alwaysOnTop: false,
//         webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') }
//     });
//     mainWindow.loadFile('index.html');
// }

// app.whenReady().then(createWindow);

// ipcMain.handle('get-startup-file', () => null);

// ipcMain.handle('open-file-dialog', async () => {
//     const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, { filters: [{ name: 'VDR', extensions: ['vdr'] }], properties: ['openFile'] });
//     if (canceled || filePaths.length === 0) return { success: false };
//     return { success: true, docId: fs.readFileSync(filePaths[0], 'utf8').trim() };
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
//         if (docErr || !doc) throw new Error('File metadata not found.');

//         let canRead = true; let canEdit = true; // Hardcoded for test

//         const { data: fileData, error: downloadErr } = await supabase.storage.from('vault-files').download(doc.file_path);
//         if (downloadErr) throw new Error('Failed to download from vault.');

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

// // 🔥 THE SECURE NATIVE CHECKOUT ENGINE
// ipcMain.handle('checkout-document', async (event, args) => {
//     try {
//         const { userId, docId, base64Content, fileName } = Array.isArray(args) ? args[0] : args;

//         // 1. Write the raw decrypted file to a hidden temp folder
//         const tempFilePath = path.join(tempDir, `~vdr_secure_${Date.now()}_${fileName}`);
//         fs.writeFileSync(tempFilePath, Buffer.from(base64Content, 'base64'));

//         // 2. Open it in Microsoft Word/Excel natively
//         let command = process.platform === 'win32' ? `start "" "${tempFilePath}"` : `open "${tempFilePath}"`;
//         exec(command, (err) => { if (err) console.error("Failed to open file:", err); });

//         // 3. Start a File Watcher to detect when they hit 'Save' in MS Office
//         if (activeWatcher) activeWatcher.close();

//         let isUploading = false;
//         activeWatcher = fs.watch(tempFilePath, async (eventType) => {
//             if (eventType === 'change' && !isUploading) {
//                 isUploading = true;
//                 console.log("Detecting MS Office Save... Syncing to Vault!");

//                 try {
//                     // Read new saved data from hard drive
//                     const freshBuffer = fs.readFileSync(tempFilePath);
//                     const freshBase64 = freshBuffer.toString('base64');

//                     // Fetch metadata to encrypt
//                     const { data: doc } = await supabase.from('documents').select('file_path, dek_ref').eq('id', docId).single();
//                     const secret = new fernet.Secret(doc.dek_ref);
//                     const token = new fernet.Token({ secret: secret });
//                     const encryptedString = token.encode(freshBase64);

//                     const newFilePath = `${doc.file_path.split('_v')[0]}_v${Date.now()}`;

//                     // Upload new version to vault
//                     await supabase.storage.from('vault-files').upload(newFilePath, Buffer.from(encryptedString, 'utf8'), { contentType: 'text/plain' });

//                     // Update DB Path
//                     await supabase.from('documents').update({ file_path: newFilePath }).eq('id', docId);

//                     // Clean Old File
//                     await supabase.storage.from('vault-files').remove([doc.file_path]);

//                     // Log Edit
//                     await supabase.from('document_edit_logs').insert([{ user_id: userId, document_id: docId, action_type: 'native_edit', metadata: { status: 'Checked in successfully' } }]);

//                     // Notify Frontend
//                     mainWindow.webContents.send('sync-success', "Vault Synced!");
//                 } catch (syncErr) {
//                     console.error("Sync Error:", syncErr);
//                 }

//                 setTimeout(() => { isUploading = false; }, 3000); // Debounce
//             }
//         });

//         // 4. Return success to UI
//         return { success: true, tempPath: tempFilePath };
//     } catch (error) { return { success: false, error: error.message }; }
// });

// // 🔥 CLEANUP: Delete temp file when they click "Finish Editing"
// ipcMain.handle('checkin-document', async (event, tempPath) => {
//     try {
//         if (activeWatcher) activeWatcher.close();
//         if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); // Nuke the raw file!
//         return { success: true };
//     } catch (err) { return { success: false }; }
// });













// editing problem fernet not supoorting the file update
// // main.js
// require('dotenv').config();
// // 🔥 Added 'dialog' to imports
// const { app, BrowserWindow, ipcMain, globalShortcut, dialog } = require('electron');
// const path = require('path');
// const fs = require('fs');
// const { createClient } = require('@supabase/supabase-js');
// const WebSocket = require('ws');
// const fernet = require('fernet');

// const logPath = path.join(app.getPath('userData'), 'vdr_debug.log');
// console.log = console.error = (msg) => {
//     fs.appendFileSync(logPath, new Date().toISOString() + ': ' + msg + '\n');
// };

// const SUPABASE_URL = "https://xxlawcufvetxygaqwoxi.supabase.co";
// const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh4bGF3Y3VmdmV0eHlnYXF3b3hpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NDE3MzgsImV4cCI6MjA5NDMxNzczOH0.yw7i6-U8xuzdQy0vj9CsXnOjIj5iwO4F3BbsC1cuBaU";

// const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
//     auth: { persistSession: false },
//     global: { WebSocket: WebSocket }
// });

// let mainWindow;
// const authFilePath = path.join(app.getPath('userData'), 'vdr_auth.json');

// ipcMain.handle('save-auth', (event, data) => { fs.writeFileSync(authFilePath, JSON.stringify(data)); return true; });
// ipcMain.handle('get-auth', () => { try { if (fs.existsSync(authFilePath)) return JSON.parse(fs.readFileSync(authFilePath, 'utf8')); } catch (e) { } return null; });
// ipcMain.handle('clear-auth', () => { if (fs.existsSync(authFilePath)) fs.unlinkSync(authFilePath); return true; });

// let fileToOpen = null;
// const candidatePath = process.argv.find(arg => arg.toLowerCase().endsWith('.vdr'));
// if (candidatePath) fileToOpen = candidatePath;

// function parseVdrFile(filePath) { try { return fs.readFileSync(filePath, 'utf8').trim(); } catch (e) { return null; } }

// function createWindow() {
//     mainWindow = new BrowserWindow({
//         width: 1280, height: 800,
//         kiosk: false, // 🔥 Turned off for testing in npm start
//         alwaysOnTop: false, // 🔥 Turned off for testing in npm start
//         webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') }
//     });

//     // mainWindow.setContentProtection(true); // You can keep this on or off for testing
//     mainWindow.loadFile('index.html');
// }

// app.on('second-instance', (event, commandLine) => {
//     if (mainWindow) {
//         if (mainWindow.isMinimized()) mainWindow.restore();
//         mainWindow.focus();
//         const backgroundPath = commandLine.find(arg => arg.toLowerCase().endsWith('.vdr'));
//         if (backgroundPath) mainWindow.webContents.send('open-vdr-file', parseVdrFile(backgroundPath));
//     }
// });

// app.whenReady().then(() => {
//     createWindow();
// });

// ipcMain.handle('get-startup-file', () => fileToOpen ? parseVdrFile(fileToOpen) : null);

// // 🔥 NEW: Native File Opener Dialog
// ipcMain.handle('open-file-dialog', async () => {
//     const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
//         title: 'Select VDR Keycard',
//         filters: [{ name: 'VDR Secure Files', extensions: ['vdr'] }],
//         properties: ['openFile']
//     });

//     if (canceled || filePaths.length === 0) return { success: false };

//     try {
//         const docId = fs.readFileSync(filePaths[0], 'utf8').trim();
//         return { success: true, docId: docId };
//     } catch (err) {
//         return { success: false, error: 'Failed to read file.' };
//     }
// });

// ipcMain.handle('login', async (event, args) => {
//     try {
//         const payload = Array.isArray(args) ? args[0] : args;
//         if (!payload || !payload.email) return { success: false, message: "No credentials received." };
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
//         if (!docId) throw new Error('No document ID provided.');

//         const { data: doc, error: docErr } = await supabase.from('documents').select('file_path, dek_ref, name, uploaded_by').eq('id', docId).single();
//         if (docErr || !doc) throw new Error('File metadata not found.');

//         let canRead = false; let canEdit = false;
//         if (doc.uploaded_by === userId) {
//             canRead = true; canEdit = true;
//         } else {
//             const { data: perm, error: permErr } = await supabase.from('document_permissions').select('can_read, can_edit').eq('user_id', userId).eq('doc_id', docId).single();
//             if (permErr || !perm) throw new Error('No permission record found.');
//             canRead = perm.can_read; canEdit = perm.can_edit;
//         }

//         if (!canRead) throw new Error('Access Denied: No Read Permission');

//         const { data: fileData, error: downloadErr } = await supabase.storage.from('vault-files').download(doc.file_path);
//         if (downloadErr) throw new Error('Failed to download from vault.');

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
//             const duration = Math.floor((end - start) / 1000);
//             await supabase.from('document_access_logs').update({ closed_at: new Date().toISOString(), duration_sec: duration }).eq('id', logId);
//         }
//     } catch (e) { console.error("Failed to close log", e); }
// });

// ipcMain.handle('save-document-edits', async (event, args) => {
//     try {
//         const { userId, docId, newB64Content, isPdfConversion } = Array.isArray(args) ? args[0] : args;

//         const { data: doc, error: docErr } = await supabase.from('documents').select('file_path, dek_ref, name').eq('id', docId).single();
//         if (docErr || !doc) throw new Error('Could not find document metadata.');

//         const secret = new fernet.Secret(doc.dek_ref);
//         const token = new fernet.Token({ secret: secret });
//         const encryptedString = token.encode(newB64Content);

//         const encoder = new TextEncoder();
//         const uint8Array = encoder.encode(encryptedString);
//         const newFilePath = `${doc.file_path}_v${Date.now()}`;

//         const { error: uploadErr } = await supabase.storage.from('vault-files').upload(newFilePath, uint8Array, {
//             contentType: 'text/plain', cacheControl: 'no-cache', upsert: false
//         });

//         if (uploadErr) throw new Error('Vault Upload Rejected: ' + uploadErr.message);

//         let dbUpdates = { file_path: newFilePath };
//         if (isPdfConversion) {
//             dbUpdates.name = doc.name.replace(/\.docx?$/, '.pdf');
//             dbUpdates.mime_type = 'application/pdf';
//         }

//         const { error: dbUpdateErr } = await supabase.from('documents').update(dbUpdates).eq('id', docId);
//         if (dbUpdateErr) throw new Error('Database path update failed: ' + dbUpdateErr.message);

//         await supabase.storage.from('vault-files').remove([doc.file_path]);

//         await supabase.from('document_edit_logs').insert([{
//             user_id: userId, document_id: docId, action_type: isPdfConversion ? 'converted_to_pdf' : 'edit', metadata: { status: 'Saved successfully' }
//         }]);

//         return { success: true };
//     } catch (error) { return { success: false, error: error.message }; }
// });

















