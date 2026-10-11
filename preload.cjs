const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tenax", {
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
    notes: (payload) => ipcRenderer.invoke("ai:notes", payload),
    batchCreate: (payload) => ipcRenderer.invoke("ai:batch-create", payload),
    batchStatus: (batchId) => ipcRenderer.invoke("ai:batch-status", batchId),
    batchResults: (batchId) => ipcRenderer.invoke("ai:batch-results", batchId),
  },
  pdf: {
    outline: (data) => ipcRenderer.invoke("pdf:outline", data),
    text: (payload) => ipcRenderer.invoke("pdf:text", payload),
  },
  sync: {
    status: () => ipcRenderer.invoke("sync:status"),
    choose: () => ipcRenderer.invoke("sync:choose"),
    useSuggested: () => ipcRenderer.invoke("sync:use"),
    stop: () => ipcRenderer.invoke("sync:stop"),
    pull: (opts) => ipcRenderer.invoke("sync:pull", opts),
    flush: () => ipcRenderer.invoke("sync:flush"),
  },
  covers: {
    search: (q) => ipcRenderer.invoke("covers:search", q),
    fetch: (id) => ipcRenderer.invoke("covers:fetch", id),
  },
  version: () => ipcRenderer.invoke("app:version"),
  window: {
    platform: process.platform,
    chrome: (colors) => ipcRenderer.invoke("window:chrome", colors),
  },
  update: {
    status: () => ipcRenderer.invoke("app:update"),
    install: () => ipcRenderer.invoke("app:update-install"),
  },
  backup: {
    info: () => ipcRenderer.invoke("backup:info"),
    open: () => ipcRenderer.invoke("backup:open"),
  },
  book: {
    save: (data) => ipcRenderer.invoke("book:save", data),
    text: (payload) => ipcRenderer.invoke("book:text", payload),
    remove: (bookId) => ipcRenderer.invoke("book:delete", bookId),
    has: (bookId) => ipcRenderer.invoke("book:has", bookId),
  },
});
