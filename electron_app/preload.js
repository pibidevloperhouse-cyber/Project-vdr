// preload.js
const { contextBridge, ipcRenderer } = require('electron');

console.log("PRELOAD: Security Bridge Initialized.");

contextBridge.exposeInMainWorld('api', {
    login: (credentials) => ipcRenderer.invoke('login', credentials),
    verifyAccess: (data) => ipcRenderer.invoke('verify-access', data),
    getStartupFile: () => ipcRenderer.invoke('get-startup-file'),
    onOpenFile: (callback) => ipcRenderer.on('open-vdr-file', (event, data) => callback(data)),

    // Auth, Edit & Logging Actions
    saveAuth: (data) => ipcRenderer.invoke('save-auth', data),
    getAuth: () => ipcRenderer.invoke('get-auth'),
    clearAuth: () => ipcRenderer.invoke('clear-auth'),
    saveDocumentEdits: (data) => ipcRenderer.invoke('save-document-edits', data),
    closeLog: (logId) => ipcRenderer.send('close-log', logId),

    // 🔥 NEW: Triggers the native OS file picker
    openFileDialog: () => ipcRenderer.invoke('open-file-dialog')
});



//npm start n o file open
// // preload.js
// const { contextBridge, ipcRenderer } = require('electron');

// console.log("PRELOAD: Security Bridge Initialized.");

// contextBridge.exposeInMainWorld('api', {
//     login: (credentials) => ipcRenderer.invoke('login', credentials),
//     verifyAccess: (data) => ipcRenderer.invoke('verify-access', data),
//     getStartupFile: () => ipcRenderer.invoke('get-startup-file'),
//     onOpenFile: (callback) => ipcRenderer.on('open-vdr-file', (event, data) => callback(data)),

//     // Auth, Edit & Logging Actions
//     saveAuth: (data) => ipcRenderer.invoke('save-auth', data),
//     getAuth: () => ipcRenderer.invoke('get-auth'),
//     clearAuth: () => ipcRenderer.invoke('clear-auth'),
//     saveDocumentEdits: (data) => ipcRenderer.invoke('save-document-edits', data),

//     // 🔥 THE DEATH SIGNAL: Fires when window closes to complete the access log
//     closeLog: (logId) => ipcRenderer.send('close-log', logId)
// });


