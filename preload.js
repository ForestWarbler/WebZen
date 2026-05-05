const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
    toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
    getFullscreenState: () => ipcRenderer.invoke('get-fullscreen-state'),
    chooseBackgroundDirectory: () => ipcRenderer.invoke('choose-background-directory'),
    listBackgroundAssets: (assetPath) => ipcRenderer.invoke('list-background-assets', assetPath),
    listPlugins: () => ipcRenderer.invoke('list-plugins'),
    getPluginsPath: () => ipcRenderer.invoke('get-plugins-path'),
    openPluginsFolder: () => ipcRenderer.invoke('open-plugins-folder'),
    onFullscreenChanged: (callback) => {
        ipcRenderer.on('fullscreen-changed', (_event, isFullscreen) => {
            callback(isFullscreen)
        })
    },
    createTerminal: (sessionId) => ipcRenderer.invoke('create-terminal', sessionId),
    writeTerminal: (sessionId, data) => ipcRenderer.invoke('write-terminal', sessionId, data),
    resizeTerminal: (sessionId, cols, rows) => ipcRenderer.invoke('resize-terminal', sessionId, cols, rows),
    closeTerminal: (sessionId) => ipcRenderer.invoke('close-terminal', sessionId),
    onTerminalData: (callback) => {
        ipcRenderer.on('terminal-data', (_event, payload) => callback(payload))
    },
    onTerminalExit: (callback) => {
        ipcRenderer.on('terminal-exit', (_event, payload) => callback(payload))
    }
})
