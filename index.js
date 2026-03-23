const { app, BrowserWindow, dialog, ipcMain, protocol, net, shell } = require('electron')
const fs = require('fs/promises')
const path = require('path')
const { pathToFileURL } = require('url')

let pty
try {
    pty = require('node-pty')
} catch (_e) {
    console.warn('node-pty not available. Terminal plugin will not work.')
}

const terminalSessions = new Map()
const browserSessions = new Map()
let mainWindow = null

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif'])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.m4v', '.ogg'])
const DEFAULT_WINDOW_STATE = {
    fullscreen: true,
    width: 800,
    height: 600,
    x: undefined,
    y: undefined
}

// --- Plugin directories ---
const BUNDLED_PLUGINS_DIR = path.join(__dirname, 'plugins')

function getUserPluginsDir() {
    return path.join(app.getPath('userData'), 'plugins')
}

// --- Window state persistence ---
function getWindowStatePath() {
    return path.join(app.getPath('userData'), 'window-state.json')
}

async function readWindowState() {
    try {
        const content = await fs.readFile(getWindowStatePath(), 'utf8')
        return {
            ...DEFAULT_WINDOW_STATE,
            ...JSON.parse(content)
        }
    } catch (error) {
        return { ...DEFAULT_WINDOW_STATE }
    }
}

async function writeWindowState(state) {
    const current = await readWindowState()
    const nextState = {
        ...current,
        ...state
    }

    await fs.writeFile(
        getWindowStatePath(),
        JSON.stringify(nextState, null, 2),
        'utf8'
    )
}

function sendFullscreenState(win) {
    win.webContents.send('fullscreen-changed', win.isFullScreen())
}

// --- Plugin scanner ---
async function readManifest(pluginDir) {
    const manifestPath = path.join(pluginDir, 'manifest.json')
    const content = await fs.readFile(manifestPath, 'utf8')
    const manifest = JSON.parse(content)

    if (!manifest.id || !manifest.name) {
        return null
    }

    const hasWindow = manifest.hasWindow !== false
    if (hasWindow && !manifest.entry) {
        return null
    }

    return {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version || '0.0.0',
        description: manifest.description || '',
        entry: manifest.entry || null,
        backstage: manifest.backstage || null,
        hasWindow,
        icon: manifest.icon || '📦',
        defaultWidth: manifest.defaultWidth || 320,
        defaultHeight: manifest.defaultHeight || 220,
        minWidth: manifest.minWidth || 220,
        minHeight: manifest.minHeight || 160,
        window: {
            transparent: manifest.window?.transparent ?? false,
            background: manifest.window?.background || 'rgba(30, 30, 30, 0.72)',
            borderColor: manifest.window?.borderColor || 'rgba(255, 255, 255, 0.12)',
            backdropFilter: manifest.window?.backdropFilter ?? 'blur(20px)',
            borderRadius: manifest.window?.borderRadius ?? 20
        },
        directory: pluginDir
    }
}

async function scanPluginsDir(dirPath) {
    const results = []

    try {
        await fs.mkdir(dirPath, { recursive: true })
    } catch (_error) {
        return results
    }

    let entries
    try {
        entries = await fs.readdir(dirPath, { withFileTypes: true })
    } catch (_error) {
        return results
    }

    for (const entry of entries) {
        if (!entry.isDirectory()) continue

        try {
            const manifest = await readManifest(path.join(dirPath, entry.name))
            if (manifest) {
                results.push(manifest)
            }
        } catch (_error) {
            // skip malformed plugins
        }
    }

    return results
}

async function discoverAllPlugins() {
    const [bundled, user] = await Promise.all([
        scanPluginsDir(BUNDLED_PLUGINS_DIR),
        scanPluginsDir(getUserPluginsDir())
    ])

    const seen = new Set()
    const merged = []

    for (const plugin of [...user, ...bundled]) {
        if (!seen.has(plugin.id)) {
            seen.add(plugin.id)
            merged.push(plugin)
        }
    }

    return merged
}

// --- Custom protocol for plugin content ---
protocol.registerSchemesAsPrivileged([{
    scheme: 'webzen-plugin',
    privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true
    }
}])

let pluginDirectoryMap = new Map()

function resolvePluginFilePath(pluginId, relativePath) {
    const pluginDir = pluginDirectoryMap.get(pluginId)
    if (!pluginDir) return null

    const resolved = path.resolve(path.join(pluginDir, relativePath))
    if (!resolved.startsWith(pluginDir)) return null

    return resolved
}

// --- Window creation ---
async function createWindow() {
    const windowState = await readWindowState()

    const windowOptions = {
        width: windowState.width,
        height: windowState.height,
        frame: false,
        fullscreenable: true,
        fullscreen: windowState.fullscreen,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js')
        }
    }

    if (Number.isFinite(windowState.x) && Number.isFinite(windowState.y)) {
        windowOptions.x = windowState.x
        windowOptions.y = windowState.y
    }

    const win = new BrowserWindow(windowOptions)
    mainWindow = win

    win.on('closed', () => {
        mainWindow = null
        for (const [, session] of browserSessions) {
            if (!session.window.isDestroyed()) session.window.close()
        }
        browserSessions.clear()
    })

    let saveTimer = null
    function scheduleBoundsWrite() {
        if (win.isFullScreen()) return
        clearTimeout(saveTimer)
        saveTimer = setTimeout(() => {
            const bounds = win.getBounds()
            writeWindowState({
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height
            }).catch(() => {})
        }, 300)
    }

    const syncBrowserWindowPositions = () => {
        if (!mainWindow || mainWindow.isDestroyed()) return
        const contentBounds = mainWindow.getContentBounds()
        for (const [, session] of browserSessions) {
            if (session.window.isDestroyed()) continue
            const vb = session.viewportBounds
            session.window.setBounds({
                x: contentBounds.x + Math.round(vb.x),
                y: contentBounds.y + Math.round(vb.y),
                width: Math.round(vb.width),
                height: Math.round(vb.height)
            })
        }
    }

    win.loadFile('index.html')
    win.on('resize', scheduleBoundsWrite)
    win.on('move', () => {
        scheduleBoundsWrite()
        syncBrowserWindowPositions()
    })
    win.on('enter-full-screen', async () => {
        sendFullscreenState(win)
        await writeWindowState({ fullscreen: true })
    })
    win.on('leave-full-screen', async () => {
        sendFullscreenState(win)
        await writeWindowState({ fullscreen: false })
    })
    win.webContents.on('did-finish-load', () => sendFullscreenState(win))
}

app.whenReady().then(async () => {
    protocol.handle('webzen-plugin', (request) => {
        const url = new URL(request.url)
        const pluginId = url.hostname
        const filePath = resolvePluginFilePath(pluginId, decodeURIComponent(url.pathname))

        if (!filePath) {
            return new Response('Plugin not found', { status: 404 })
        }

        return net.fetch(pathToFileURL(filePath).href)
    })

    const allPlugins = await discoverAllPlugins()
    for (const plugin of allPlugins) {
        pluginDirectoryMap.set(plugin.id, plugin.directory)
    }

    createWindow()

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow()
        }
    })

    // --- IPC handlers ---
    ipcMain.handle('toggle-fullscreen', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender)
        const nextState = !win.isFullScreen()
        win.setFullScreen(nextState)
        sendFullscreenState(win)
        writeWindowState({ fullscreen: nextState }).catch(() => {})
        return nextState
    })

    ipcMain.handle('get-fullscreen-state', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender)
        return win.isFullScreen()
    })

    ipcMain.handle('choose-background-directory', async (event) => {
        const win = BrowserWindow.fromWebContents(event.sender)
        const result = await dialog.showOpenDialog(win, {
            properties: ['openDirectory']
        })

        if (result.canceled || result.filePaths.length === 0) {
            return null
        }

        return result.filePaths[0]
    })

    ipcMain.handle('list-background-assets', async (_event, assetPath) => {
        if (!assetPath || typeof assetPath !== 'string') {
            throw new Error('Please choose a folder first.')
        }

        const resolvedPath = path.resolve(assetPath.trim())
        const stat = await fs.stat(resolvedPath)

        if (!stat.isDirectory()) {
            throw new Error('The path must point to a folder.')
        }

        const entries = await fs.readdir(resolvedPath, { withFileTypes: true })
        const assets = entries
            .filter((entry) => entry.isFile())
            .map((entry) => {
                const fullPath = path.join(resolvedPath, entry.name)
                const extension = path.extname(entry.name).toLowerCase()

                if (IMAGE_EXTENSIONS.has(extension)) {
                    return {
                        name: entry.name,
                        path: fullPath,
                        type: 'image',
                        url: pathToFileURL(fullPath).href
                    }
                }

                if (VIDEO_EXTENSIONS.has(extension)) {
                    return {
                        name: entry.name,
                        path: fullPath,
                        type: 'video',
                        url: pathToFileURL(fullPath).href
                    }
                }

                return null
            })
            .filter(Boolean)
            .sort((a, b) => a.name.localeCompare(b.name))

        return {
            directory: resolvedPath,
            assets
        }
    })

    ipcMain.handle('list-plugins', async () => {
        const allPlugins = await discoverAllPlugins()
        for (const plugin of allPlugins) {
            pluginDirectoryMap.set(plugin.id, plugin.directory)
        }

        return allPlugins.map(({ directory, ...rest }) => rest)
    })

    ipcMain.handle('get-plugins-path', () => {
        return getUserPluginsDir()
    })

    ipcMain.handle('open-plugins-folder', async () => {
        const userDir = getUserPluginsDir()
        await fs.mkdir(userDir, { recursive: true })
        shell.openPath(userDir)
    })

    // --- Terminal IPC ---
    ipcMain.handle('create-terminal', (event, sessionId) => {
        if (!pty) {
            return { error: 'node-pty is not installed. Run: npm install node-pty && npx @electron/rebuild' }
        }

        const existing = terminalSessions.get(sessionId)
        if (existing) {
            try { existing.kill() } catch (_e) { /* ignore */ }
            terminalSessions.delete(sessionId)
        }

        const isWin = process.platform === 'win32'
        const shellPath = isWin
            ? 'powershell.exe'
            : (process.env.SHELL || '/bin/zsh')

        const terminal = pty.spawn(shellPath, [], {
            name: 'xterm-256color',
            cols: 80,
            rows: 24,
            cwd: process.env.HOME || process.env.USERPROFILE || '/',
            env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
        })

        const win = BrowserWindow.fromWebContents(event.sender)
        terminalSessions.set(sessionId, terminal)

        terminal.onData((data) => {
            if (win && !win.isDestroyed()) {
                win.webContents.send('terminal-data', { sessionId, data })
            }
        })

        terminal.onExit(({ exitCode }) => {
            terminalSessions.delete(sessionId)
            if (win && !win.isDestroyed()) {
                win.webContents.send('terminal-exit', { sessionId, exitCode })
            }
        })

        return { shell: path.basename(shellPath), pid: terminal.pid }
    })

    ipcMain.handle('write-terminal', (_event, sessionId, data) => {
        const terminal = terminalSessions.get(sessionId)
        if (terminal) terminal.write(data)
    })

    ipcMain.handle('resize-terminal', (_event, sessionId, cols, rows) => {
        const terminal = terminalSessions.get(sessionId)
        if (terminal) {
            try { terminal.resize(Math.max(cols, 1), Math.max(rows, 1)) } catch (_e) { /* ignore */ }
        }
    })

    ipcMain.handle('close-terminal', (_event, sessionId) => {
        const terminal = terminalSessions.get(sessionId)
        if (terminal) {
            try { terminal.kill() } catch (_e) { /* ignore */ }
            terminalSessions.delete(sessionId)
        }
    })

    // --- Browser window IPC ---
    ipcMain.handle('create-browser-window', (_event, sessionId, bounds) => {
        if (!mainWindow || mainWindow.isDestroyed()) return

        const existing = browserSessions.get(sessionId)
        if (existing && !existing.window.isDestroyed()) return

        const pluginDir = pluginDirectoryMap.get('browser')
        if (!pluginDir) return

        const contentBounds = mainWindow.getContentBounds()
        const browserWin = new BrowserWindow({
            x: contentBounds.x + Math.round(bounds.x),
            y: contentBounds.y + Math.round(bounds.y),
            width: Math.round(bounds.width),
            height: Math.round(bounds.height),
            frame: false,
            parent: mainWindow,
            skipTaskbar: true,
            resizable: false,
            movable: false,
            minimizable: false,
            maximizable: false,
            fullscreenable: false,
            webPreferences: {
                webviewTag: true
            }
        })

        browserWin.loadFile(path.join(pluginDir, 'browser.html'))
        browserSessions.set(sessionId, { window: browserWin, viewportBounds: bounds })

        browserWin.on('closed', () => {
            browserSessions.delete(sessionId)
        })
    })

    ipcMain.handle('update-browser-bounds', (_event, sessionId, bounds) => {
        if (!mainWindow || mainWindow.isDestroyed()) return
        const session = browserSessions.get(sessionId)
        if (!session || session.window.isDestroyed()) return

        session.viewportBounds = bounds
        const contentBounds = mainWindow.getContentBounds()
        session.window.setBounds({
            x: contentBounds.x + Math.round(bounds.x),
            y: contentBounds.y + Math.round(bounds.y),
            width: Math.round(bounds.width),
            height: Math.round(bounds.height)
        })
    })

    ipcMain.handle('close-browser-window', (_event, sessionId) => {
        const session = browserSessions.get(sessionId)
        if (session && !session.window.isDestroyed()) {
            session.window.close()
        }
        browserSessions.delete(sessionId)
    })

    ipcMain.handle('set-browser-windows-visible', (_event, visible) => {
        for (const [, session] of browserSessions) {
            if (session.window.isDestroyed()) continue
            if (visible) {
                session.window.showInactive()
            } else {
                session.window.hide()
            }
        }
    })
})

app.on('window-all-closed', () => {
    for (const [id, terminal] of terminalSessions) {
        try { terminal.kill() } catch (_e) { /* ignore */ }
    }
    terminalSessions.clear()
    if (process.platform !== 'darwin') app.quit()
})
