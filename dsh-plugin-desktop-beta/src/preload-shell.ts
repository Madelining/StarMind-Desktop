import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from './ipc.ts'
import { permissionBridge } from './preload-permissions.ts'

if (location.protocol === 'dsh-app:' && location.hostname === 'shell') {
  contextBridge.exposeInMainWorld('desktopNext', {
    gateway: {
      read: () => ipcRenderer.invoke(IPC.gateway, { action: 'read' }),
      save: (draft: unknown) => ipcRenderer.invoke(IPC.gateway, { action: 'save', draft }),
      discover: (draft: unknown) => ipcRenderer.invoke(IPC.gateway, { action: 'discover', draft }),
    },
    permissions: permissionBridge(),
    state: () => ipcRenderer.invoke(IPC.state),
    browserLinks: () => ipcRenderer.invoke(IPC.browserLinks),
    command: (command: unknown) => ipcRenderer.invoke(IPC.command, command),
  })
}
