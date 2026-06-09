// main.js
require('dotenv').config();
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto'); // 🔥 Fernet removed, native crypto used
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');

const logPath = path.join(app.getPath('userData'), 'vdr_debug.log');


console.log = (msg) => {
    fs.appendFileSync(logPath, new Date().toISOString() + ': ' + msg + '\n');
};

// 1. Initialize Supabase
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://your-project-id.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_KEY || 'your-anon-key';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { WebSocket: WebSocket }
});

let mainWindow;

// OS-Level Auth Storage
const authFilePath = path.join(app.getPath('userData'), 'vdr_auth.json');

ipcMain.handle('save-auth', (event, data) => {
    fs.writeFileSync(authFilePath, JSON.stringify(data));
    return true;
});
ipcMain.handle('get-auth', () => {
    try { if (fs.existsSync(authFilePath)) return JSON.parse(fs.readFileSync(authFilePath, 'utf8')); } catch (e) { }
    return null;
});
ipcMain.handle('clear-auth', () => {
    if (fs.existsSync(authFilePath)) fs.unlinkSync(authFilePath);
    return true;
});

let fileToOpen = null;
const candidatePath = process.argv.find(arg => arg.toLowerCase().endsWith('.vdr'));
if (candidatePath) fileToOpen = candidatePath;

function parseVdrFile(filePath) {
    try { return fs.readFileSync(filePath, 'utf8').trim(); } catch (e) { return null; }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280, height: 800,
        kiosk: true,
        alwaysOnTop: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            preload: path.join(__dirname, 'preload.js') // 🔥 BULLETPROOF PATH
        }
    });

    mainWindow.loadFile('index.html');
    // mainWindow.webContents.openDevTools(); // UNCOMMENT TO DEBUG UI IN EXE
}

app.on('second-instance', (event, commandLine) => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
        const backgroundPath = commandLine.find(arg => arg.toLowerCase().endsWith('.vdr'));
        if (backgroundPath) mainWindow.webContents.send('open-vdr-file', parseVdrFile(backgroundPath));
    }
});

app.whenReady().then(createWindow);

ipcMain.handle('get-startup-file', () => fileToOpen ? parseVdrFile(fileToOpen) : null);

// 🔥 BULLETPROOF LOGIN HANDLER
ipcMain.handle('login', async (event, args) => {
    try {
        // Fix the flattening issue in production builds
        const payload = Array.isArray(args) ? args[0] : args;

        if (!payload || !payload.email || !payload.password) {
            console.log("MAIN DEBUG: Payload missing credentials", JSON.stringify(payload));
            return { success: false, message: "System Error: Credentials lost in transit." };
        }

        const cleanEmail = payload.email.trim().toLowerCase();

        const { data: user, error } = await supabase
            .from('users')
            .select('id, name, email, password_hash, role')
            .eq('email', cleanEmail)
            .single();

        if (error || !user) return { success: false, message: "User not found or DB error." };
        if (user.password_hash !== payload.password) return { success: false, message: "Invalid password" };

        return { success: true, user: user, userId: user.id };
    } catch (err) {
        return { success: false, message: err.message };
    }
});

// 🔥 BULLETPROOF DECRYPTION HANDLER
ipcMain.handle('verify-access', async (event, payload) => {
    try {
        const { userId, docId } = Array.isArray(payload) ? payload[0] : payload;
        if (!docId) throw new Error('No document ID provided.');

        const { data: doc, error: docErr } = await supabase
            .from('documents')
            .select('file_path, dek_ref, name, uploaded_by')
            .eq('id', docId)
            .single();

        if (docErr || !doc) throw new Error('File metadata not found in database.');

        let canRead = false;
        let canEdit = false;

        if (doc.uploaded_by === userId) {
            canRead = true; canEdit = true;
        } else {
            const { data: perm, error: permErr } = await supabase
                .from('document_permissions')
                .select('can_read, can_edit')
                .eq('user_id', userId)
                .eq('doc_id', docId)
                .single();

            if (permErr || !perm) throw new Error('No permission record found.');
            canRead = perm.can_read;
            canEdit = perm.can_edit;
        }

        if (!canRead) throw new Error('Access Denied: No Read Permission');

        const { data: fileData, error: downloadErr } = await supabase.storage.from('vault-files').download(doc.file_path);
        if (downloadErr) throw new Error('Failed to download from vault.');

        // 🔥 NATIVE AES-GCM DECRYPTION
        const fileBuffer = Buffer.from(await fileData.arrayBuffer());
        const [ivBase64, keyBase64] = doc.dek_ref.split(':');

        const iv = Buffer.from(ivBase64, 'base64');
        const key = Buffer.from(keyBase64, 'base64');

        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        const decrypted = Buffer.concat([decipher.update(fileBuffer), decipher.final()]);

        await supabase.from('document_access_logs').insert([{ user_id: userId, document_id: docId }]);

        return { success: true, canEdit, fileName: doc.name, content: decrypted.toString('base64') };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// SAVE EDITS
ipcMain.handle('save-document-edits', async (event, args) => {
    try {
        const { userId, docId, newB64Content } = Array.isArray(args) ? args[0] : args;
        const formData = new URLSearchParams();
        formData.append('doc_id', docId);
        formData.append('user_id', userId);
        formData.append('new_b64_content', newB64Content);

        const response = await fetch('http://127.0.0.1:8000/api/update', {
            method: 'POST', body: formData, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        if (!response.ok) {
            const errorDetails = await response.text();
            throw new Error(`Server Error: ${errorDetails}`);
        }
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});










// require('dotenv').config();
// const { app, BrowserWindow, ipcMain } = require('electron');
// const path = require('path');
// const fs = require('fs');
// const { createClient } = require('@supabase/supabase-js');
// const WebSocket = require('ws');
// const fernet = require('fernet'); // The Decryption Engine

// // 1. Initialize Supabase (Use your actual URL and ANON KEY here)
// const SUPABASE_URL = "https://rkrcemzisyoaewocqtlh.supabase.co";
// // MAKE SURE THIS IS YOUR ANON KEY (Not the service_role key used in your Python app)
// const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJrcmNlbXppc3lvYWV3b2NxdGxoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDEzMDM5NywiZXhwIjoyMDk1NzA2Mzk3fQ.BG7fHku_h5mAQIfyRyqm9fqNwgO4UporHxYMPFNEBvY";
// const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
//     auth: { persistSession: false },
//     global: { WebSocket: WebSocket }
// });
// let mainWindow;

// // 2. Double-Click .vdr File Handling
// let fileToOpen = null;

// // Look for a .vdr file in the launch arguments
// const candidatePath = process.argv.find(arg => arg.toLowerCase().endsWith('.vdr'));
// if (candidatePath) {
//     fileToOpen = candidatePath;
// }

// // This extracts the doc_id that your Python app wrote into the .vdr file
// function parseVdrFile(filePath) {
//     try {
//         return fs.readFileSync(filePath, 'utf8').trim(); // Returns the doc_id
//     } catch (e) {
//         return null;
//     }
// }

// // 3. Create the Kiosk Window
// function createWindow() {
//     mainWindow = new BrowserWindow({
//         width: 1280, height: 800,
//         kiosk: true, // Secure full-screen mode
//         alwaysOnTop: true,
//         webPreferences: {
//             nodeIntegration: false,
//             contextIsolation: true,
//             preload: path.join(__dirname, 'preload.js')
//         }
//     });

//     mainWindow.loadFile('index.html');

//     // Zoom control
//     mainWindow.webContents.on('zoom-changed', (event, zoomDirection) => {
//         let currentZoom = mainWindow.webContents.getZoomLevel();
//         mainWindow.webContents.setZoomLevel(zoomDirection === 'in' ? currentZoom + 0.5 : currentZoom - 0.5);
//     });
// }

// // Background Launch Handler (If app is already open and they double-click another file)
// app.on('second-instance', (event, commandLine) => {
//     if (mainWindow) {
//         if (mainWindow.isMinimized()) mainWindow.restore();
//         mainWindow.focus();

//         const backgroundPath = commandLine.find(arg => arg.toLowerCase().endsWith('.vdr'));
//         if (backgroundPath) {
//             mainWindow.webContents.send('open-vdr-file', parseVdrFile(backgroundPath));
//         }
//     }
// });

// app.whenReady().then(createWindow);

// // ---------------------------------------------------------
// // IPC HANDLERS: The Core DRM Logic
// // ---------------------------------------------------------

// // Called by frontend on load to get the doc_id
// ipcMain.handle('get-startup-file', () => {
//     return fileToOpen ? parseVdrFile(fileToOpen) : null;
// });

// // Step 1: Login Check
// ipcMain.handle('login', async (event, { email, password }) => {
//     try {
//         const { data: user, error } = await supabase
//             .from('users')
//             .select('id, password_hash')
//             .eq('email', email)
//             .single();

//         if (error || !user) throw new Error('User not found.');
//         if (user.password_hash !== password) throw new Error('Invalid password.');

//         return { success: true, userId: user.id };
//     } catch (error) {
//         return { success: false, error: error.message };
//     }
// });

// // Step 2: Verify Access, Download, and Decrypt
// ipcMain.handle('verify-access', async (event, { userId, docId }) => {
//     try {
//         if (!docId) throw new Error('No document ID provided. Please open a valid .vdr file.');

//         // A. Verify user has permission (The Gatekeeper)
//         const { data: perm, error: permErr } = await supabase
//             .from('document_permissions')
//             .select('can_read, can_edit')
//             .eq('user_id', userId)
//             .eq('doc_id', docId)
//             .single();

//         // If no row exists, or can_read is false, BLOCK THEM.
//         if (permErr || !perm?.can_read) throw new Error('Access Denied: You do not have Read Permission for this file.');

//         // B. Fetch Document Metadata (Path and Encryption Key)
//         const { data: doc, error: docErr } = await supabase
//             .from('documents')
//             .select('file_path, dek_ref')
//             .eq('id', docId)
//             .single();

//         if (docErr || !doc?.file_path) throw new Error('Access Denied: File metadata not found in database.');

//         // C. Download the encrypted bytes from the 'vault' bucket
//         const { data: fileData, error: downloadErr } = await supabase.storage
//             .from('vault')
//             .download(doc.file_path);

//         if (downloadErr) throw new Error('Failed to download encrypted file from secure cloud vault.');

//         // D. Read the downloaded bytes (Fernet tokens are text strings)
//         const encryptedText = await fileData.text();

//         // E. Decrypt the file dynamically in RAM
//         const secret = new fernet.Secret(doc.dek_ref);
//         const token = new fernet.Token({ token: encryptedText, secret: secret, ttl: 0 });
//         const decryptedContent = token.decode(); // Now holds the decrypted string

//         // F. Log the access silently
//         await supabase.from('document_access_logs').insert([{
//             user_id: userId,
//             document_id: docId
//         }]);

//         // G. Send the decrypted content + the edit boolean to the frontend UI!
//         return {
//             success: true,
//             canEdit: perm.can_edit,
//             content: decryptedContent
//         };
//     } catch (error) {
//         return { success: false, error: error.message };
//     }
// });

// // Step 3: Handle Editing/Saving logs (if applicable)
// ipcMain.handle('save-edit', async (event, { userId, docId, actionType, textLength }) => {
//     try {
//         const { error } = await supabase.from('document_edit_logs').insert([{
//             user_id: userId,
//             document_id: docId,
//             action_type: actionType,
//             metadata: { chars_modified: textLength }
//         }]);

//         if (error) throw error;
//         return { success: true };
//     } catch (error) {
//         return { success: false, error: error.message };
//     }
// });















// require('dotenv').config();
// const { app, BrowserWindow, ipcMain } = require('electron');
// const path = require('path');
// const fs = require('fs');
// const { createClient } = require('@supabase/supabase-js');
// const WebSocket = require('ws');
// const fernet = require('fernet'); // The Decryption Engine

// // 1. Initialize Supabase (Uses ANON key because this is the client side)
// // 1. Initialize Supabase (Hardcoded for Production)
// const SUPABASE_URL = "https://rkrcemzisyoaewocqtlh.supabase.co";
// const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJrcmNlbXppc3lvYWV3b2NxdGxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxMzAzOTcsImV4cCI6MjA5NTcwNjM5N30.fRQoMfud8UkE7kdU6VaIAXV5UKXFylJQ44qSa0l7eaI";

// const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
//     auth: { persistSession: false },
//     global: { WebSocket: WebSocket }
// });
// let mainWindow;

// // 2. Double-Click File Handling (Dev & Production safe)
// let fileToOpen = null;

// const candidatePath = process.argv.find(arg => arg.toLowerCase().endsWith('.vdr'));
// if (candidatePath) {
//     fileToOpen = candidatePath;
// }

// function parseVdrFile(filePath) {
//     try {
//         return fs.readFileSync(filePath, 'utf8').trim();
//     } catch (e) {
//         return null;
//     }
// }

// // 3. Create the Kiosk Window
// function createWindow() {
//     mainWindow = new BrowserWindow({
//         width: 1280, height: 800,
//         kiosk: true,
//         alwaysOnTop: true,
//         webPreferences: {
//             nodeIntegration: false,
//             contextIsolation: true,
//             preload: path.join(__dirname, 'preload.js')
//         }
//     });

//     mainWindow.loadFile('index.html');
//     // mainWindow.webContents.openDevTools(); // Kept hidden for production

//     // Touchpad Zoom Handling
//     mainWindow.webContents.on('zoom-changed', (event, zoomDirection) => {
//         let currentZoom = mainWindow.webContents.getZoomLevel();
//         mainWindow.webContents.setZoomLevel(zoomDirection === 'in' ? currentZoom + 0.5 : currentZoom - 0.5);
//     });
// }

// // Background Launch Handler (If app is already open and they click another file)
// app.on('second-instance', (event, commandLine) => {
//     if (mainWindow) {
//         if (mainWindow.isMinimized()) mainWindow.restore();
//         mainWindow.focus();

//         const backgroundPath = commandLine.find(arg => arg.toLowerCase().endsWith('.vdr'));
//         if (backgroundPath) {
//             mainWindow.webContents.send('open-vdr-file', parseVdrFile(backgroundPath));
//         }
//     }
// });

// app.whenReady().then(createWindow);

// // ---------------------------------------------------------
// // IPC HANDLERS
// // ---------------------------------------------------------

// ipcMain.handle('get-startup-file', () => {
//     return fileToOpen ? parseVdrFile(fileToOpen) : null;
// });

// ipcMain.handle('login', async (event, { email, password }) => {
//     try {
//         const { data: user, error } = await supabase
//             .from('users')
//             .select('id, password_hash')
//             .eq('email', email)
//             .single();

//         if (error || !user) throw new Error('User not found.');
//         if (user.password_hash !== password) throw new Error('Invalid password.');

//         return { success: true, userId: user.id };
//     } catch (error) {
//         return { success: false, error: error.message };
//     }
// });

// // THE FINAL BOSS: Verify, Download, and Decrypt from the Cloud
// ipcMain.handle('verify-access', async (event, { userId, docId }) => {
//     try {
//         // 1. Verify user has permission
//         const { data: perm, error: permErr } = await supabase
//             .from('document_permissions')
//             .select('can_read, can_edit')
//             .eq('user_id', userId)
//             .eq('doc_id', docId)
//             .single();

//         if (permErr || !perm?.can_read) throw new Error('Access Denied: No Read Permission');

//         // 2. Fetch Document Metadata (Cloud Path and Key)
//         const { data: doc, error: docErr } = await supabase
//             .from('documents')
//             .select('file_path, dek_ref')
//             .eq('id', docId)
//             .single();

//         if (docErr || !doc?.file_path) throw new Error('Access Denied: File not found in database');

//         // 3. Download the encrypted bytes directly from Supabase Storage
//         const { data: fileData, error: downloadErr } = await supabase.storage
//             .from('vault')
//             .download(doc.file_path);

//         if (downloadErr) throw new Error('Failed to download encrypted file from cloud vault.');

//         // 4. Read the downloaded bytes
//         const encryptedText = await fileData.text();

//         // 5. Decrypt the file dynamically in RAM using the Fernet Key
//         const secret = new fernet.Secret(doc.dek_ref);

//         // ttl: 0 ensures files don't "expire" like web tokens do
//         const token = new fernet.Token({ token: encryptedText, secret: secret, ttl: 0 });
//         const decryptedContent = token.decode();

//         // 6. Log the access
//         await supabase.from('document_access_logs').insert([{
//             user_id: userId,
//             document_id: docId
//         }]);

//         // Return the actual decrypted content to the frontend!
//         return { success: true, key: doc.dek_ref, canEdit: perm.can_edit, content: decryptedContent };
//     } catch (error) {
//         return { success: false, error: error.message };
//     }
// });

// ipcMain.handle('save-edit', async (event, { userId, docId, actionType, textLength }) => {
//     try {
//         const { error } = await supabase.from('document_edit_logs').insert([{
//             user_id: userId,
//             document_id: docId,
//             action_type: actionType,
//             metadata: { chars_modified: textLength }
//         }]);

//         if (error) throw error;
//         return { success: true };
//     } catch (error) {
//         return { success: false, error: error.message };
//     }
// });