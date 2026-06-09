// preload.js
const { contextBridge, ipcRenderer } = require('electron');

console.log("PRELOAD: Bridge is initializing..."); // You MUST see this in DevTools

contextBridge.exposeInMainWorld('api', {
    login: (credentials) => {
        console.log("PRELOAD: Sending login data:", credentials); // Debug here!
        return ipcRenderer.invoke('login', credentials);
    },
});

contextBridge.exposeInMainWorld('api', {
    login: (credentials) => ipcRenderer.invoke('login', credentials),
    verifyAccess: (data) => ipcRenderer.invoke('verify-access', data),
    getStartupFile: () => ipcRenderer.invoke('get-startup-file'),
    onOpenFile: (callback) => ipcRenderer.on('open-vdr-file', (event, data) => callback(data)),

    // 🔥 NEW ONES ADDED HERE FOR SECURE LOGIN & SAVING
    saveAuth: (data) => ipcRenderer.invoke('save-auth', data),
    getAuth: () => ipcRenderer.invoke('get-auth'),
    clearAuth: () => ipcRenderer.invoke('clear-auth'),
    saveDocumentEdits: (data) => ipcRenderer.invoke('save-document-edits', data)
});










// const { contextBridge, ipcRenderer } = require('electron');

// contextBridge.exposeInMainWorld('api', {
//     login: (credentials) => ipcRenderer.invoke('login', credentials),
//     verifyAccess: (data) => ipcRenderer.invoke('verify-access', data),
//     saveEdit: (data) => ipcRenderer.invoke('save-edit', data),
//     getStartupFile: () => ipcRenderer.invoke('get-startup-file'),
//     onOpenFile: (callback) => ipcRenderer.on('open-vdr-file', (event, data) => callback(data))
// });