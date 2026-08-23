const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aeroflash", {
  store: {
    get: (key) => ipcRenderer.invoke("store-get", key),
    set: (key, val) => ipcRenderer.invoke("store-set", key, val),
  },
  ai: {
    generateCards: (noteText) => ipcRenderer.invoke("ai:generateCards", noteText),
    gradeAnswer: (payload) => ipcRenderer.invoke("ai:gradeAnswer", payload),
  },
});
