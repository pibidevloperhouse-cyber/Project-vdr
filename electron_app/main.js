require('dotenv').config();
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
const fernet = require('fernet');

// 1. Initialize Supabase
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { WebSocket: WebSocket }
});
let mainWindow;

// 🔥 NEW: SECURE OS-LEVEL AUTH STORAGE
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
            preload: path.join(__dirname, 'preload.js')
        }
    });

    mainWindow.loadFile('index.html');
    mainWindow.webContents.on('zoom-changed', (event, zoomDirection) => {
        let currentZoom = mainWindow.webContents.getZoomLevel();
        mainWindow.webContents.setZoomLevel(zoomDirection === 'in' ? currentZoom + 0.5 : currentZoom - 0.5);
    });
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

ipcMain.handle('login', async (event, { email, password }) => {
    try {
        const { data: user, error } = await supabase.from('users').select('id, password_hash').eq('email', email).single();
        if (error || !user) throw new Error('User not found.');
        if (user.password_hash !== password) throw new Error('Invalid password.');
        return { success: true, userId: user.id };
    } catch (error) { return { success: false, error: error.message }; }
});


// Step 2: Verify Access, Download, and Decrypt
ipcMain.handle('verify-access', async (event, { userId, docId }) => {
    try {
        if (!docId) throw new Error('No document ID provided. Please open a valid .vdr file.');

        // 1. Fetch File Metadata FIRST (We added 'uploaded_by' here)
        const { data: doc, error: docErr } = await supabase
            .from('documents')
            .select('file_path, dek_ref, name, uploaded_by')
            .eq('id', docId)
            .single();

        if (docErr || !doc?.file_path) throw new Error('Access Denied: File metadata not found.');

        // 2. THE ADMIN BYPASS LOGIC
        let canRead = false;
        let canEdit = false;

        if (doc.uploaded_by === userId) {
            // 🔥 Admin Bypass! If you uploaded this file, you get 100% full access.
            canRead = true;
            canEdit = true;
        } else {
            // Normal User Permission Check
            const { data: perm, error: permErr } = await supabase
                .from('document_permissions')
                .select('can_read, can_edit')
                .eq('user_id', userId)
                .eq('doc_id', docId)
                .single();

            if (permErr || !perm?.can_read) throw new Error('Access Denied: No Read Permission');
            canRead = perm.can_read;
            canEdit = perm.can_edit;
        }

        if (!canRead) throw new Error("Access Denied.");

        // 3. Download and Decrypt
        const { data: fileData, error: downloadErr } = await supabase.storage.from('vault').download(doc.file_path);
        if (downloadErr) throw new Error('Failed to download encrypted file from secure cloud vault.');

        const encryptedText = await fileData.text();
        const secret = new fernet.Secret(doc.dek_ref);
        const token = new fernet.Token({ token: encryptedText, secret: secret, ttl: 0 });
        const decryptedContent = token.decode();

        await supabase.from('document_access_logs').insert([{ user_id: userId, document_id: docId }]);

        return { success: true, canEdit: canEdit, fileName: doc.name, content: decryptedContent };
    } catch (error) {
        return { success: false, error: error.message };
    }
});



// ipcMain.handle('verify-access', async (event, { userId, docId }) => {
//     try {
//         if (!docId) throw new Error('No document ID provided.');

//         const { data: perm, error: permErr } = await supabase.from('document_permissions').select('can_read, can_edit').eq('user_id', userId).eq('doc_id', docId).single();
//         if (permErr || !perm?.can_read) throw new Error('Access Denied: No Read Permission');

//         // 🔥 FIX: Select 'name' to get the file extension!
//         const { data: doc, error: docErr } = await supabase.from('documents').select('file_path, dek_ref, name').eq('id', docId).single();
//         if (docErr || !doc?.file_path) throw new Error('Access Denied: File metadata not found.');

//         const { data: fileData, error: downloadErr } = await supabase.storage.from('vault').download(doc.file_path);
//         if (downloadErr) throw new Error('Failed to download encrypted file.');

//         const encryptedText = await fileData.text();
//         const secret = new fernet.Secret(doc.dek_ref);
//         const token = new fernet.Token({ token: encryptedText, secret: secret, ttl: 0 });
//         const decryptedContent = token.decode();

//         await supabase.from('document_access_logs').insert([{ user_id: userId, document_id: docId }]);

//         // 🔥 FIX: Return the fileName!
//         return { success: true, canEdit: perm.can_edit, fileName: doc.name, content: decryptedContent };
//     } catch (error) { return { success: false, error: error.message }; }
// });

// 🔥 NEW: SAVE EDITS BACK TO PYTHON BACKEND


// 🔥 UPDATED: SAVE EDITS BACK TO PYTHON BACKEND (WITH LOUD ERRORS)
ipcMain.handle('save-document-edits', async (event, { userId, docId, newB64Content }) => {
    try {
        const formData = new URLSearchParams();
        formData.append('doc_id', docId);
        formData.append('user_id', userId);
        formData.append('new_b64_content', newB64Content);

        const response = await fetch('http://127.0.0.1:8000/api/update', {
            method: 'POST',
            body: formData,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        // 🔥 THE FIX: Grab the exact error message from Python!
        if (!response.ok) {
            const errorDetails = await response.text();
            throw new Error(`Python Server Error (${response.status}): ${errorDetails}`);
        }

        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});
ipcMain.handle('save-edit', async (event, { userId, docId, actionType, textLength }) => {
    // Audit logging
    await supabase.from('document_edit_logs').insert([{ user_id: userId, document_id: docId, action_type: actionType }]);
    return { success: true };
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