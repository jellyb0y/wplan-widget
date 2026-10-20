// Безопасный мост рендерер↔main (contextIsolation).
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  invoke: (channel: string, data?: unknown) => ipcRenderer.invoke(channel, data),
  on: (channel: string, cb: (data: unknown) => void) =>
    ipcRenderer.on(channel, (_e, data) => cb(data)),
});
