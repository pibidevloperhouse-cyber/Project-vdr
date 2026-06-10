// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    login: (credentials) => ipcRenderer.invoke('login', credentials),
    verifyAccess: (data) => ipcRenderer.invoke('verify-access', data),
    getStartupFile: () => ipcRenderer.invoke('get-startup-file'),
    onOpenFile: (callback) => ipcRenderer.on('open-vdr-file', (event, data) => callback(data)),

    saveAuth: (data) => ipcRenderer.invoke('save-auth', data),
    getAuth: () => ipcRenderer.invoke('get-auth'),
    clearAuth: () => ipcRenderer.invoke('clear-auth'),
    closeLog: (logId) => ipcRenderer.send('close-log', logId),

    openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
    saveTextEdits: (data) => ipcRenderer.invoke('save-text-edits', data),
    checkoutOfficeDoc: (data) => ipcRenderer.invoke('checkout-office-doc', data),
    checkinOfficeDoc: (tempPath) => ipcRenderer.invoke('checkin-office-doc', tempPath),
    onSyncSuccess: (callback) => ipcRenderer.on('sync-success', (event, msg) => callback(msg))
});


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
//     closeLog: (logId) => ipcRenderer.send('close-log', logId),

//     // 🔥 NEW: Triggers the native OS file picker
//     openFileDialog: () => ipcRenderer.invoke('open-file-dialog')
// });


