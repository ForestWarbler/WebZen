// --- Platform detection ---
const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform) || navigator.userAgent.includes('Mac')
if (isMac) document.body.classList.add('mac')

// --- DOM references ---
const btnClose = document.getElementById('btn-close')
const btnFullscreen = document.getElementById('btn-fullscreen')
const btnBackgrounds = document.getElementById('btn-backgrounds')
const btnEditWidgets = document.getElementById('btn-edit-widgets')
const btnAddPlugin = document.getElementById('btn-add-plugin')
const btnChangeDirectory = document.getElementById('btn-change-directory')
const iconFullscreen = document.getElementById('icon-fullscreen')
const iconExitFullscreen = document.getElementById('icon-exit-fullscreen')
const backgroundPanel = document.getElementById('background-panel')
const selectedDirectory = document.getElementById('selected-directory')
const panelStatus = document.getElementById('panel-status')
const backgroundGrid = document.getElementById('background-grid')
const backgroundImage = document.getElementById('background-image')
const backgroundVideo = document.getElementById('background-video')
const widgetLayer = document.getElementById('widget-layer')
const pluginPanel = document.getElementById('plugin-panel')
const pluginGrid = document.getElementById('plugin-grid')
const activePluginsList = document.getElementById('active-plugins-list')
const backstageOverlay = document.getElementById('backstage-overlay')
const backstageTitle = document.getElementById('backstage-title')
const backstageContent = document.getElementById('backstage-content')
const btnBackstageBack = document.getElementById('btn-backstage-back')

// --- App state ---
let activeBackgroundType = 'video'
let selectedAssetPath = backgroundVideo.currentSrc || backgroundVideo.getAttribute('src')
let isDraggingBackground = false
let startX = 0
let startY = 0
let posX = 50
let posY = 50
let latestLoadRequest = 0
let lastLoadedPath = ''
let currentAssets = []

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)
const LAST_DIRECTORY_STORAGE_KEY = 'webzen:last-directory'
const LAST_ASSET_STORAGE_KEY = 'webzen:last-asset'

// --- Fullscreen ---
const getBrowserFullscreenState = () =>
    !!document.fullscreenElement || !!document.webkitFullscreenElement

const getFullscreenState = async () => {
    if (window.electronAPI?.getFullscreenState) {
        return window.electronAPI.getFullscreenState()
    }

    return getBrowserFullscreenState()
}

const updateFullscreenIcon = async (isFullscreen = null) => {
    const fullscreenActive = isFullscreen ?? await getFullscreenState()
    iconFullscreen.style.display = fullscreenActive ? 'none' : 'block'
    iconExitFullscreen.style.display = fullscreenActive ? 'block' : 'none'
    btnFullscreen.title = fullscreenActive ? 'Exit fullscreen' : 'Fullscreen'
}

const toggleFullscreen = async () => {
    if (window.electronAPI?.toggleFullscreen) {
        const nextState = await window.electronAPI.toggleFullscreen()
        await updateFullscreenIcon(nextState)
        return
    }

    if (getBrowserFullscreenState()) {
        const exitFn = document.exitFullscreen || document.webkitExitFullscreen
        exitFn?.call(document)
    } else {
        const element = document.documentElement
        const requestFn = element.requestFullscreen || element.webkitRequestFullscreen
        requestFn?.call(element)
    }
}

// --- Background picker ---
const setPanelStatus = (message) => {
    panelStatus.textContent = message
}

const setSelectedDirectory = (directoryPath) => {
    selectedDirectory.textContent = directoryPath || 'No folder selected.'
}

const saveLastDirectory = (directoryPath) => {
    if (!directoryPath) return
    localStorage.setItem(LAST_DIRECTORY_STORAGE_KEY, directoryPath)
}

const getSavedDirectory = () => localStorage.getItem(LAST_DIRECTORY_STORAGE_KEY) || ''

const saveLastAsset = (assetPath) => {
    if (!assetPath) return
    localStorage.setItem(LAST_ASSET_STORAGE_KEY, assetPath)
}

const getSavedAsset = () => localStorage.getItem(LAST_ASSET_STORAGE_KEY) || ''

const setPickerOpen = (isOpen) => {
    backgroundPanel.classList.toggle('open', isOpen)
    backgroundPanel.setAttribute('aria-hidden', String(!isOpen))
}

const togglePicker = () => {
    setPickerOpen(!backgroundPanel.classList.contains('open'))
}

const applyMediaPosition = () => {
    const objectPosition = `${posX}% ${posY}%`
    backgroundImage.style.objectPosition = objectPosition
    backgroundVideo.style.objectPosition = objectPosition
}

const resetMediaPosition = () => {
    posX = 50
    posY = 50
    applyMediaPosition()
}

const getActiveMediaSize = () => {
    if (activeBackgroundType === 'image') {
        return {
            width: backgroundImage.naturalWidth,
            height: backgroundImage.naturalHeight
        }
    }

    return {
        width: backgroundVideo.videoWidth,
        height: backgroundVideo.videoHeight
    }
}

const getExcess = () => {
    const { width, height } = getActiveMediaSize()

    if (!width || !height) {
        return { excessX: 0, excessY: 0 }
    }

    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const mediaRatio = width / height
    const viewportRatio = viewportWidth / viewportHeight

    let excessX = 0
    let excessY = 0

    if (mediaRatio > viewportRatio) {
        excessX = viewportHeight * mediaRatio - viewportWidth
    } else {
        excessY = viewportWidth / mediaRatio - viewportHeight
    }

    return { excessX, excessY }
}

const renderBackgroundGrid = () => {
    backgroundGrid.innerHTML = ''

    if (currentAssets.length === 0) {
        return
    }

    currentAssets.forEach((asset) => {
        const assetCard = document.createElement('button')
        assetCard.type = 'button'
        assetCard.className = 'asset-card'

        if (asset.path === selectedAssetPath) {
            assetCard.classList.add('active')
        }

        let previewElement

        if (asset.type === 'image') {
            previewElement = document.createElement('img')
            previewElement.src = asset.url
            previewElement.alt = asset.name
            previewElement.loading = 'lazy'
        } else {
            previewElement = document.createElement('video')
            previewElement.src = asset.url
            previewElement.muted = true
            previewElement.loop = true
            previewElement.autoplay = true
            previewElement.playsInline = true
            previewElement.preload = 'metadata'
        }

        previewElement.className = 'asset-preview'

        const assetName = document.createElement('div')
        assetName.className = 'asset-name'
        assetName.textContent = asset.name

        assetCard.append(previewElement, assetName)
        assetCard.addEventListener('click', () => {
            loadSelectedBackground(asset)
        })

        backgroundGrid.append(assetCard)
    })
}

const loadSelectedBackground = async (asset) => {
    selectedAssetPath = asset.path
    saveLastAsset(asset.path)
    resetMediaPosition()

    if (asset.type === 'image') {
        activeBackgroundType = 'image'
        backgroundImage.src = asset.url
        backgroundImage.classList.remove('hidden')
        backgroundVideo.pause()
        backgroundVideo.classList.add('hidden')
    } else {
        activeBackgroundType = 'video'
        backgroundVideo.src = asset.url
        backgroundVideo.muted = true
        backgroundVideo.defaultMuted = true
        backgroundVideo.volume = 0
        backgroundVideo.classList.remove('hidden')
        backgroundImage.classList.add('hidden')
        backgroundImage.removeAttribute('src')
        backgroundVideo.load()

        try {
            await backgroundVideo.play()
        } catch (error) {
            console.error('Failed to play selected video.', error)
        }
    }

    renderBackgroundGrid()
    setPickerOpen(false)
}


const loadAssetsFromPath = async (inputPath) => {
    const trimmedPath = inputPath.trim()

    if (!trimmedPath) {
        currentAssets = []
        backgroundGrid.innerHTML = ''
        lastLoadedPath = ''
        setSelectedDirectory('')
        setPanelStatus('Choose a local folder to load image and video backgrounds.')
        return
    }

    if (!window.electronAPI?.listBackgroundAssets) {
        setPanelStatus('Folder scanning is only available in the Electron app.')
        return
    }

    const requestId = ++latestLoadRequest
    setPanelStatus('Loading media from folder...')

    try {
        const result = await window.electronAPI.listBackgroundAssets(trimmedPath)

        if (requestId !== latestLoadRequest) {
            return
        }

        currentAssets = result.assets
        lastLoadedPath = result.directory
        setSelectedDirectory(result.directory)
        saveLastDirectory(result.directory)

        const savedAssetPath = getSavedAsset()
        const restoredAsset = currentAssets.find((asset) => asset.path === savedAssetPath)

        if (restoredAsset) {
            await loadSelectedBackground(restoredAsset)
            setPanelStatus(`Restored ${restoredAsset.name}.`)
            return
        }

        renderBackgroundGrid()

        if (currentAssets.length === 0) {
            setPanelStatus('No compatible images or videos were found in this folder.')
        } else {
            setPanelStatus(`Loaded ${currentAssets.length} background file(s).`)
        }
    } catch (error) {
        if (requestId !== latestLoadRequest) {
            return
        }

        currentAssets = []
        backgroundGrid.innerHTML = ''
        setPanelStatus(error.message || 'Failed to load media from the folder.')
    }
}

const chooseDirectory = async () => {
    if (!window.electronAPI?.chooseBackgroundDirectory) {
        setPanelStatus('The native directory picker is only available in the Electron app.')
        return
    }

    try {
        const directoryPath = await window.electronAPI.chooseBackgroundDirectory()

        if (!directoryPath) {
            return
        }

        if (directoryPath === lastLoadedPath) {
            setSelectedDirectory(directoryPath)
            return
        }

        await loadAssetsFromPath(directoryPath)
    } catch (error) {
        setPanelStatus(error.message || 'Failed to open the directory picker.')
    }
}

// --- Plugin system ---
const PLUGINS_STORAGE_KEY = 'webzen:plugins'
const PLUGINS_FORMAT_KEY = 'webzen:plugins-format'
const DEFAULT_MIN_WIDTH = 220
const DEFAULT_MIN_HEIGHT = 160
const PLUGIN_MARGIN = 16
const PLUGIN_TOP_MARGIN = 56

const btnOpenPluginsFolder = document.getElementById('btn-open-plugins-folder')

let pluginCatalog = []
let manageMode = false
let pluginInteraction = null

const loadPlugins = () => {
    try {
        const stored = localStorage.getItem(PLUGINS_STORAGE_KEY)
        if (!stored) return []

        const parsed = JSON.parse(stored)
        if (!Array.isArray(parsed)) return []

        const valid = parsed.filter((plugin) =>
            plugin &&
            typeof plugin.id === 'string' &&
            typeof plugin.type === 'string' &&
            typeof plugin.name === 'string' &&
            Number.isFinite(plugin.x) &&
            Number.isFinite(plugin.y) &&
            Number.isFinite(plugin.width) &&
            Number.isFinite(plugin.height)
        )

        if (valid.length === 0) return valid

        const vw = window.innerWidth || 800
        const vh = window.innerHeight || 600
        const format = localStorage.getItem(PLUGINS_FORMAT_KEY)
        const hasAbsolutePixels = valid.some((p) => p.x > 1 || p.y > 1)

        if (hasAbsolutePixels) {
            valid.forEach((p) => {
                p.x = (p.x + p.width / 2) / vw
                p.y = (p.y + p.height / 2) / vh
            })
        } else if (format !== 'center') {
            valid.forEach((p) => {
                p.x = p.x + p.width / (2 * vw)
                p.y = p.y + p.height / (2 * vh)
            })
        }

        return valid
    } catch (_error) {
        return []
    }
}

let plugins = loadPlugins()
let nextPluginId = plugins.reduce((max, plugin) => {
    const match = plugin.id.match(/(\d+)$/)
    const value = match ? Number.parseInt(match[1], 10) : 0
    return Number.isNaN(value) ? max : Math.max(max, value)
}, 0) + 1

const savePlugins = () => {
    localStorage.setItem(PLUGINS_STORAGE_KEY, JSON.stringify(plugins))
    localStorage.setItem(PLUGINS_FORMAT_KEY, 'center')
}

savePlugins()

const getCatalogEntry = (type) => pluginCatalog.find((entry) => entry.id === type)

const getPluginBounds = () => ({
    minX: PLUGIN_MARGIN,
    minY: PLUGIN_TOP_MARGIN,
    maxX: window.innerWidth - PLUGIN_MARGIN,
    maxY: window.innerHeight - PLUGIN_MARGIN
})

const getMinSize = (plugin) => {
    const entry = getCatalogEntry(plugin.type)
    return {
        minW: entry?.minWidth || DEFAULT_MIN_WIDTH,
        minH: entry?.minHeight || DEFAULT_MIN_HEIGHT
    }
}

const normalizePlugin = (plugin) => {
    const { minW, minH } = getMinSize(plugin)
    plugin.width = Math.max(plugin.width, minW)
    plugin.height = Math.max(plugin.height, minH)
}

const pluginToPixels = (plugin) => ({
    px: plugin.x * window.innerWidth - plugin.width / 2,
    py: plugin.y * window.innerHeight - plugin.height / 2,
    w: plugin.width,
    h: plugin.height
})

const updatePluginElementFrame = (element, plugin) => {
    const { px, py, w, h } = pluginToPixels(plugin)
    element.style.left = `${px}px`
    element.style.top = `${py}px`
    element.style.width = `${w}px`
    element.style.height = `${h}px`
}

const setElementFrame = (element, px, py, w, h) => {
    element.style.left = `${px}px`
    element.style.top = `${py}px`
    element.style.width = `${w}px`
    element.style.height = `${h}px`
}

const applyWindowStyles = (element, catalogEntry) => {
    if (!catalogEntry?.window) return

    const win = catalogEntry.window
    element.style.background = win.background || ''
    element.style.borderColor = win.borderColor || ''
    element.style.backdropFilter = win.backdropFilter ?? ''
    element.style.webkitBackdropFilter = win.backdropFilter ?? ''

    if (win.transparent) {
        element.style.boxShadow = 'none'
    }

    if (win.borderRadius !== undefined) {
        element.style.borderRadius = `${win.borderRadius}px`
    }
}

const createPluginContent = (plugin) => {
    const entry = getCatalogEntry(plugin.type)

    if (!entry) {
        const errorWrapper = document.createElement('div')
        errorWrapper.className = 'plugin-error'
        const icon = document.createElement('div')
        icon.className = 'plugin-error-icon'
        icon.textContent = '⚠️'
        const label = document.createElement('div')
        label.className = 'plugin-error-label'
        label.textContent = `Plugin "${plugin.type}" not found`
        errorWrapper.append(icon, label)
        return errorWrapper
    }

    const iframe = document.createElement('iframe')
    iframe.className = 'plugin-iframe'
    iframe.src = `webzen-plugin://${entry.id}/${entry.entry}`
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin')
    iframe.setAttribute('allowtransparency', 'true')
    return iframe
}

const setPluginPanelOpen = (isOpen) => {
    pluginPanel.classList.toggle('open', isOpen)
    pluginPanel.setAttribute('aria-hidden', String(!isOpen))
}

const togglePluginPanel = () => {
    if (!manageMode) return
    setPluginPanelOpen(!pluginPanel.classList.contains('open'))
}

const createNewPlugin = (catalogEntry) => {
    const plugin = {
        id: `plugin-${nextPluginId++}`,
        type: catalogEntry.id,
        name: catalogEntry.name,
        x: 0.5,
        y: 0.5,
        width: catalogEntry.defaultWidth,
        height: catalogEntry.defaultHeight
    }

    normalizePlugin(plugin)
    return plugin
}

const renderPluginCatalog = () => {
    pluginGrid.innerHTML = ''

    pluginCatalog.forEach((catalogEntry) => {
        const card = document.createElement('button')
        card.type = 'button'
        card.className = 'plugin-card'

        const preview = document.createElement('div')
        preview.className = 'plugin-card-preview'
        preview.textContent = catalogEntry.icon || '📦'

        const name = document.createElement('div')
        name.className = 'plugin-card-name'
        name.textContent = catalogEntry.name

        card.append(preview, name)
        card.addEventListener('click', () => {
            plugins.push(createNewPlugin(catalogEntry))
            savePlugins()
            renderPlugins()
            setPluginPanelOpen(false)
        })

        pluginGrid.append(card)
    })
}

// --- Active plugins list ---
const renderActivePluginsList = () => {
    activePluginsList.innerHTML = ''

    if (plugins.length === 0) {
        const empty = document.createElement('div')
        empty.className = 'active-plugins-empty'
        empty.textContent = 'No plugins added yet.'
        activePluginsList.append(empty)
        return
    }

    plugins.forEach((plugin) => {
        const entry = getCatalogEntry(plugin.type)

        const item = document.createElement('div')
        item.className = 'active-plugin-item'

        const icon = document.createElement('span')
        icon.className = 'active-plugin-icon'
        icon.textContent = entry?.icon || '📦'

        const name = document.createElement('span')
        name.className = 'active-plugin-name'
        name.textContent = plugin.name

        item.append(icon, name)

        if (entry?.backstage) {
            item.classList.add('has-backstage')

            const badge = document.createElement('span')
            badge.className = 'active-plugin-badge'
            badge.textContent = '⚙'
            item.append(badge)

            item.addEventListener('click', (event) => {
                if (event.target.closest('.active-plugin-remove')) return
                openBackstage(plugin)
            })
        }

        const removeBtn = document.createElement('button')
        removeBtn.type = 'button'
        removeBtn.className = 'active-plugin-remove'
        removeBtn.title = 'Remove'
        removeBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        `
        removeBtn.addEventListener('click', (event) => {
            event.stopPropagation()
            removePlugin(plugin.id)
        })

        item.append(removeBtn)
        activePluginsList.append(item)
    })
}

// --- Backstage ---
const openBackstage = (plugin) => {
    const entry = getCatalogEntry(plugin.type)
    if (!entry?.backstage) return

    backstageTitle.textContent = `${entry.name} Settings`
    backstageContent.innerHTML = ''

    const iframe = document.createElement('iframe')
    iframe.className = 'backstage-iframe'
    iframe.src = `webzen-plugin://${entry.id}/${entry.backstage}`
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin')
    backstageContent.append(iframe)

    backstageOverlay.classList.add('open')
    backstageOverlay.setAttribute('aria-hidden', 'false')
    setPluginPanelOpen(false)
}

const closeBackstage = () => {
    backstageOverlay.classList.remove('open')
    backstageOverlay.setAttribute('aria-hidden', 'true')
    backstageContent.innerHTML = ''
}

const centerPluginHorizontally = (pluginId) => {
    const plugin = plugins.find((item) => item.id === pluginId)
    if (!plugin) return

    plugin.x = 0.5
    savePlugins()
    renderPlugins()
}

const removePlugin = (pluginId) => {
    plugins = plugins.filter((plugin) => plugin.id !== pluginId)
    savePlugins()
    renderPlugins()
}

const pluginElements = new Map()

const createPluginWindow = (plugin) => {
    const catalogEntry = getCatalogEntry(plugin.type)

    const pluginWindow = document.createElement('div')
    pluginWindow.className = 'plugin-window'
    pluginWindow.dataset.pluginId = plugin.id
    applyWindowStyles(pluginWindow, catalogEntry)

    const actions = document.createElement('div')
    actions.className = 'plugin-window-actions'

    const centerButton = document.createElement('button')
    centerButton.type = 'button'
    centerButton.className = 'plugin-action-btn'
    centerButton.title = 'Center horizontally'
    centerButton.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M4 12h16M8 6l-4 6 4 6M16 6l4 6-4 6" />
      </svg>
    `
    centerButton.addEventListener('mousedown', (event) => event.stopPropagation())
    centerButton.addEventListener('click', (event) => {
        event.stopPropagation()
        centerPluginHorizontally(plugin.id)
    })

    const removeButton = document.createElement('button')
    removeButton.type = 'button'
    removeButton.className = 'plugin-action-btn remove-plugin'
    removeButton.title = 'Remove plugin'
    removeButton.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 6L6 18M6 6l12 12" />
      </svg>
    `
    removeButton.addEventListener('mousedown', (event) => event.stopPropagation())
    removeButton.addEventListener('click', (event) => {
        event.stopPropagation()
        removePlugin(plugin.id)
    })

    actions.append(centerButton, removeButton)

    const content = document.createElement('div')
    content.className = 'plugin-content'
    content.append(createPluginContent(plugin))

    const resizeHandle = document.createElement('div')
    resizeHandle.className = 'plugin-resize-handle'

    pluginWindow.append(actions, content, resizeHandle)
    return pluginWindow
}

const renderPlugins = () => {
    renderActivePluginsList()

    const activeIds = new Set()

    plugins.forEach((plugin) => {
        normalizePlugin(plugin)

        const catalogEntry = getCatalogEntry(plugin.type)
        if (catalogEntry && catalogEntry.hasWindow === false) return

        activeIds.add(plugin.id)

        let pluginWindow = pluginElements.get(plugin.id)

        if (!pluginWindow) {
            pluginWindow = createPluginWindow(plugin)
            pluginElements.set(plugin.id, pluginWindow)
            widgetLayer.append(pluginWindow)
        }

        updatePluginElementFrame(pluginWindow, plugin)
        pluginWindow.classList.toggle('is-interacting', pluginInteraction?.pluginId === plugin.id)
    })

    for (const [id, element] of pluginElements) {
        if (!activeIds.has(id)) {
            element.remove()
            pluginElements.delete(id)
            window.electronAPI?.closeTerminal?.(id)
        }
    }

    updateManageModeListeners()

    if (!manageMode) {
        syncBrowserWindows()
    }
}

const updateManageModeListeners = () => {
    for (const [id, pluginWindow] of pluginElements) {
        const oldHandler = pluginWindow._dragHandler
        const oldResizeHandler = pluginWindow._resizeHandler

        if (oldHandler) pluginWindow.removeEventListener('mousedown', oldHandler)

        const resizeHandle = pluginWindow.querySelector('.plugin-resize-handle')
        if (oldResizeHandler && resizeHandle) resizeHandle.removeEventListener('mousedown', oldResizeHandler)

        if (manageMode) {
            const dragHandler = (event) => {
                if (event.button !== 0) return
                if (event.target.closest('.plugin-action-btn') || event.target.closest('.plugin-resize-handle')) return
                event.stopPropagation()
                event.preventDefault()
                startPluginInteraction('move', id, pluginWindow, event)
            }
            pluginWindow.addEventListener('mousedown', dragHandler)
            pluginWindow._dragHandler = dragHandler

            if (resizeHandle) {
                const resizeHandler = (event) => {
                    if (event.button !== 0) return
                    event.stopPropagation()
                    event.preventDefault()
                    startPluginInteraction('resize', id, pluginWindow, event)
                }
                resizeHandle.addEventListener('mousedown', resizeHandler)
                pluginWindow._resizeHandler = resizeHandler
            }
        } else {
            pluginWindow._dragHandler = null
            pluginWindow._resizeHandler = null
        }
    }
}

const startPluginInteraction = (mode, pluginId, element, event) => {
    const plugin = plugins.find((item) => item.id === pluginId)
    if (!plugin) return

    const { px, py } = pluginToPixels(plugin)

    pluginInteraction = {
        mode,
        pluginId,
        element,
        startMouseX: event.clientX,
        startMouseY: event.clientY,
        startLeft: px,
        startTop: py,
        startWidth: plugin.width,
        startHeight: plugin.height,
        currentPx: px,
        currentPy: py,
        currentW: plugin.width,
        currentH: plugin.height
    }

    element.classList.add('is-interacting')
}

const updatePluginInteraction = (event) => {
    if (!pluginInteraction) return

    const plugin = plugins.find((item) => item.id === pluginInteraction.pluginId)
    if (!plugin) return

    const bounds = getPluginBounds()
    const { minW, minH } = getMinSize(plugin)
    const deltaX = event.clientX - pluginInteraction.startMouseX
    const deltaY = event.clientY - pluginInteraction.startMouseY

    let px, py, w, h

    if (pluginInteraction.mode === 'move') {
        w = pluginInteraction.startWidth
        h = pluginInteraction.startHeight
        px = clamp(pluginInteraction.startLeft + deltaX, bounds.minX, bounds.maxX - w)
        py = clamp(pluginInteraction.startTop + deltaY, bounds.minY, bounds.maxY - h)
    } else {
        px = pluginInteraction.startLeft
        py = pluginInteraction.startTop
        w = clamp(pluginInteraction.startWidth + deltaX, minW, bounds.maxX - px)
        h = clamp(pluginInteraction.startHeight + deltaY, minH, bounds.maxY - py)
    }

    pluginInteraction.currentPx = px
    pluginInteraction.currentPy = py
    pluginInteraction.currentW = w
    pluginInteraction.currentH = h

    setElementFrame(pluginInteraction.element, px, py, w, h)
}

const finishPluginInteraction = () => {
    if (!pluginInteraction) return

    const plugin = plugins.find((item) => item.id === pluginInteraction.pluginId)
    if (plugin) {
        plugin.x = (pluginInteraction.currentPx + pluginInteraction.currentW / 2) / window.innerWidth
        plugin.y = (pluginInteraction.currentPy + pluginInteraction.currentH / 2) / window.innerHeight
        plugin.width = pluginInteraction.currentW
        plugin.height = pluginInteraction.currentH
    }

    pluginInteraction = null
    savePlugins()
    renderPlugins()
}

const cancelPluginInteraction = () => {
    if (!pluginInteraction) return
    pluginInteraction = null
    renderPlugins()
}

const setManageMode = (isEnabled) => {
    manageMode = isEnabled
    widgetLayer.classList.toggle('manage-mode', manageMode)
    btnEditWidgets.classList.toggle('active', manageMode)
    btnAddPlugin.disabled = !manageMode

    window.electronAPI?.setBrowserWindowsVisible?.(!manageMode)

    if (!manageMode) {
        setPluginPanelOpen(false)
        cancelPluginInteraction()
        syncBrowserWindows()
    } else {
        renderPlugins()
    }
}

const toggleManageMode = () => {
    setManageMode(!manageMode)
}

const normalizeAllPlugins = () => {
    renderPlugins()
}

// --- Browser window sync ---
const browserWindowSessions = new Set()

const syncBrowserWindows = () => {
    const activeBrowserIds = new Set()

    plugins.forEach((plugin) => {
        if (plugin.type !== 'browser') return
        activeBrowserIds.add(plugin.id)

        const { px, py, w, h } = pluginToPixels(plugin)
        const bounds = { x: Math.round(px), y: Math.round(py), width: Math.round(w), height: Math.round(h) }

        if (!browserWindowSessions.has(plugin.id)) {
            window.electronAPI?.createBrowserWindow?.(plugin.id, bounds)
            browserWindowSessions.add(plugin.id)
        } else {
            window.electronAPI?.updateBrowserBounds?.(plugin.id, bounds)
        }
    })

    for (const id of browserWindowSessions) {
        if (!activeBrowserIds.has(id)) {
            window.electronAPI?.closeBrowserWindow?.(id)
            browserWindowSessions.delete(id)
        }
    }
}

const loadPluginCatalog = async () => {
    if (!window.electronAPI?.listPlugins) return

    try {
        pluginCatalog = await window.electronAPI.listPlugins()
    } catch (error) {
        console.error('Failed to load plugin catalog.', error)
        pluginCatalog = []
    }

    renderPluginCatalog()
    renderPlugins()
}

loadPluginCatalog()

const findPluginIdBySource = (source) => {
    const iframe = Array.from(widgetLayer.querySelectorAll('.plugin-iframe')).find(
        (f) => f.contentWindow === source
    )
    if (!iframe) return null
    const pluginWindow = iframe.closest('.plugin-window')
    return pluginWindow?.dataset?.pluginId || null
}

window.addEventListener('message', (event) => {
    const msgType = event.data?.type

    if (msgType === 'webzen:set-window-visible') {
        const iframe = Array.from(widgetLayer.querySelectorAll('.plugin-iframe')).find(
            (f) => f.contentWindow === event.source
        )
        if (!iframe) return
        const pluginWindow = iframe.closest('.plugin-window')
        if (!pluginWindow) return
        pluginWindow.style.display = event.data.visible ? '' : 'none'
        return
    }

    if (msgType === 'webzen:terminal:create') {
        const pluginId = findPluginIdBySource(event.source)
        if (!pluginId) return
        window.electronAPI?.createTerminal?.(pluginId).then((result) => {
            if (result?.error) {
                event.source.postMessage({
                    type: 'webzen:terminal:error',
                    message: result.error
                }, '*')
            } else {
                event.source.postMessage({
                    type: 'webzen:terminal:ready',
                    shell: result.shell,
                    pid: result.pid
                }, '*')
            }
        }).catch((err) => {
            event.source.postMessage({
                type: 'webzen:terminal:error',
                message: err.message || 'Failed to create terminal'
            }, '*')
        })
        return
    }

    if (msgType === 'webzen:terminal:write') {
        const pluginId = findPluginIdBySource(event.source)
        if (pluginId) window.electronAPI?.writeTerminal?.(pluginId, event.data.data)
        return
    }

    if (msgType === 'webzen:terminal:resize') {
        const pluginId = findPluginIdBySource(event.source)
        if (pluginId) window.electronAPI?.resizeTerminal?.(pluginId, event.data.cols, event.data.rows)
        return
    }

    if (msgType === 'webzen:terminal:dispose') {
        const pluginId = findPluginIdBySource(event.source)
        if (pluginId) window.electronAPI?.closeTerminal?.(pluginId)
        return
    }
})

window.electronAPI?.onTerminalData?.(({ sessionId, data }) => {
    const pluginWindow = widgetLayer.querySelector(`.plugin-window[data-plugin-id="${sessionId}"]`)
    if (!pluginWindow) return
    const iframe = pluginWindow.querySelector('.plugin-iframe')
    if (iframe?.contentWindow) {
        iframe.contentWindow.postMessage({ type: 'webzen:terminal:data', data }, '*')
    }
})

window.electronAPI?.onTerminalExit?.(({ sessionId, exitCode }) => {
    const pluginWindow = widgetLayer.querySelector(`.plugin-window[data-plugin-id="${sessionId}"]`)
    if (!pluginWindow) return
    const iframe = pluginWindow.querySelector('.plugin-iframe')
    if (iframe?.contentWindow) {
        iframe.contentWindow.postMessage({ type: 'webzen:terminal:exit', exitCode }, '*')
    }
})

// --- Event wiring ---
;[btnClose, btnFullscreen, btnBackgrounds, btnEditWidgets, btnAddPlugin, btnChangeDirectory, btnOpenPluginsFolder, btnBackstageBack].forEach((button) => {
    button.addEventListener('mousedown', (event) => event.stopPropagation())
    button.addEventListener('click', (event) => event.stopPropagation())
})

backgroundPanel.addEventListener('mousedown', (event) => event.stopPropagation())
backgroundPanel.addEventListener('click', (event) => event.stopPropagation())
pluginPanel.addEventListener('mousedown', (event) => event.stopPropagation())
pluginPanel.addEventListener('click', (event) => event.stopPropagation())
backstageOverlay.addEventListener('mousedown', (event) => {
    if (event.target === backstageOverlay) closeBackstage()
})
backstageOverlay.addEventListener('click', (event) => event.stopPropagation())

btnClose.addEventListener('click', () => window.close())
btnFullscreen.addEventListener('click', async () => {
    await toggleFullscreen()
})
btnBackgrounds.addEventListener('click', togglePicker)
btnEditWidgets.addEventListener('click', toggleManageMode)
btnAddPlugin.addEventListener('click', togglePluginPanel)
btnChangeDirectory.addEventListener('click', chooseDirectory)
btnOpenPluginsFolder.addEventListener('click', () => {
    window.electronAPI?.openPluginsFolder?.()
})
btnBackstageBack.addEventListener('click', closeBackstage)

document.addEventListener('fullscreenchange', updateFullscreenIcon)
document.addEventListener('webkitfullscreenchange', updateFullscreenIcon)
window.electronAPI?.onFullscreenChanged?.((isFullscreen) => {
    updateFullscreenIcon(isFullscreen)
})

document.addEventListener('keydown', (event) => {
    if ((event.key === 'f' || event.key === 'F') && event.metaKey && event.shiftKey) {
        event.preventDefault()
        toggleFullscreen()
    }

    if (event.key === 'Escape') {
        if (backstageOverlay.classList.contains('open')) {
            closeBackstage()
        } else if (pluginPanel.classList.contains('open')) {
            setPluginPanelOpen(false)
        } else if (manageMode) {
            setManageMode(false)
        } else if (backgroundPanel.classList.contains('open')) {
            setPickerOpen(false)
        }
    }
})

document.addEventListener('mousedown', (event) => {
    if (backgroundPanel.classList.contains('open') &&
        !event.target.closest('#background-panel') &&
        !event.target.closest('#btn-backgrounds')) {
        setPickerOpen(false)
    }

    if (pluginPanel.classList.contains('open') &&
        !event.target.closest('#plugin-panel') &&
        !event.target.closest('#btn-add-plugin')) {
        setPluginPanelOpen(false)
    }
})

document.body.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return
    if (
        event.target.closest('#toolbar') ||
        event.target.closest('#background-panel') ||
        event.target.closest('#plugin-panel') ||
        event.target.closest('#widget-layer') ||
        event.target.closest('#backstage-overlay')
    ) {
        return
    }

    isDraggingBackground = true
    startX = event.clientX
    startY = event.clientY
    document.body.classList.add('dragging')
})

document.addEventListener('mousemove', (event) => {
    if (pluginInteraction) {
        updatePluginInteraction(event)
        return
    }

    if (!isDraggingBackground) {
        return
    }

    const dx = event.clientX - startX
    const dy = event.clientY - startY
    startX = event.clientX
    startY = event.clientY

    const { excessX, excessY } = getExcess()

    if (excessX > 0) {
        posX = clamp(posX - (dx / excessX) * 100, 0, 100)
    }
    if (excessY > 0) {
        posY = clamp(posY - (dy / excessY) * 100, 0, 100)
    }

    applyMediaPosition()
})

document.addEventListener('mouseup', () => {
    if (pluginInteraction) {
        finishPluginInteraction()
        return
    }

    if (!isDraggingBackground) {
        return
    }

    isDraggingBackground = false
    document.body.classList.remove('dragging')
})

document.addEventListener('mouseleave', () => {
    if (pluginInteraction) {
        cancelPluginInteraction()
        return
    }

    if (!isDraggingBackground) {
        return
    }

    isDraggingBackground = false
    document.body.classList.remove('dragging')
})

backgroundImage.addEventListener('load', applyMediaPosition)
backgroundVideo.addEventListener('loadedmetadata', applyMediaPosition)
backgroundVideo.muted = true
backgroundVideo.defaultMuted = true
backgroundVideo.volume = 0

window.addEventListener('resize', () => {
    normalizeAllPlugins()
})

updateFullscreenIcon()
applyMediaPosition()
setSelectedDirectory('')
setManageMode(false)

const initializeSavedDirectory = async () => {
    const savedDirectory = getSavedDirectory()

    if (!savedDirectory) {
        return
    }

    setSelectedDirectory(savedDirectory)
    setPanelStatus('Loading last used directory...')
    await loadAssetsFromPath(savedDirectory)
}

initializeSavedDirectory()
