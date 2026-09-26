const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aeroflash", {
  store: {
    get: (key) => ipcRenderer.invoke("store-get", key),
    set: (key, val) => ipcRenderer.invoke("store-set", key, val),
  },
  ai: {
    status: () => ipcRenderer.invoke("ai:status"),
    extract: (payload) => ipcRenderer.invoke("ai:extract", payload),
    items: (payload) => ipcRenderer.invoke("ai:items", payload),
    critique: (payload) => ipcRenderer.invoke("ai:critique", payload),
    rewrite: (payload) => ipcRenderer.invoke("ai:rewrite", payload),
    grade: (payload) => ipcRenderer.invoke("ai:grade", payload),
    link: (payload) => ipcRenderer.invoke("ai:link", payload),
    teachback: (payload) => ipcRenderer.invoke("ai:teachback", payload),
  },
  pdf: {
    outline: (data) => ipcRenderer.invoke("pdf:outline", data),
    text: (payload) => ipcRenderer.invoke("pdf:text", payload),
  },
});
