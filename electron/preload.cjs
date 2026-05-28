const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mindlinkerRuntimeLog", {
  append: (entry) => ipcRenderer.invoke("runtime-log:append", entry),
  read: () => ipcRenderer.invoke("runtime-log:read"),
  clear: () => ipcRenderer.invoke("runtime-log:clear")
});

