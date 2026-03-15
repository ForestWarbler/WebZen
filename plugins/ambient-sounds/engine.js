const SETTINGS_KEY = 'webzen-ambient:settings'

const SOUND_DEFS = [
    { id: 'birds', name: 'Birds', icon: '🐦' },
    { id: 'bells', name: 'Bells', icon: '🔔' }
]

function getDefaults() {
    const volumes = {}
    SOUND_DEFS.forEach((s) => { volumes[s.id] = 0 })
    return { playing: false, showFrontend: true, volumes, bellDelay: 50, bellFrequency: 50 }
}

function loadSettings() {
    try {
        const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY))
        const defaults = getDefaults()
        return {
            playing: stored?.playing ?? defaults.playing,
            showFrontend: stored?.showFrontend ?? defaults.showFrontend,
            volumes: { ...defaults.volumes, ...(stored?.volumes || {}) },
            bellDelay: stored?.bellDelay ?? defaults.bellDelay,
            bellFrequency: stored?.bellFrequency ?? defaults.bellFrequency
        }
    } catch (_e) {
        return getDefaults()
    }
}

function saveSettings(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

function buildBirds(ctx, dest) {
    const gain = ctx.createGain()
    gain.gain.value = 0

    const reverbConv = ctx.createConvolver()
    const reverbLen = ctx.sampleRate * 1.2
    const reverbBuf = ctx.createBuffer(2, reverbLen, ctx.sampleRate)
    for (let ch = 0; ch < 2; ch++) {
        const data = reverbBuf.getChannelData(ch)
        for (let i = 0; i < reverbLen; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / reverbLen, 2)
        }
    }
    reverbConv.buffer = reverbBuf

    const dryGain = ctx.createGain()
    dryGain.gain.value = 0.75
    const wetGain = ctx.createGain()
    wetGain.gain.value = 0.25

    gain.connect(dryGain).connect(dest)
    gain.connect(reverbConv).connect(wetGain).connect(dest)

    function chirp() {
        const now = ctx.currentTime
        const osc = ctx.createOscillator()
        osc.type = 'sine'

        const chirpGain = ctx.createGain()
        const baseFreq = 2400 + Math.random() * 2000
        const duration = 0.06 + Math.random() * 0.08

        osc.frequency.setValueAtTime(baseFreq, now)
        osc.frequency.exponentialRampToValueAtTime(baseFreq * (1.2 + Math.random() * 0.6), now + duration * 0.5)
        osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.8, now + duration)

        chirpGain.gain.setValueAtTime(0, now)
        chirpGain.gain.linearRampToValueAtTime(0.15, now + duration * 0.2)
        chirpGain.gain.linearRampToValueAtTime(0, now + duration)

        osc.connect(chirpGain).connect(gain)
        osc.start(now)
        osc.stop(now + duration + 0.01)
    }

    function scheduleChirps() {
        const count = 1 + Math.floor(Math.random() * 3)
        for (let i = 0; i < count; i++) {
            setTimeout(chirp, i * (60 + Math.random() * 100))
        }
    }

    setInterval(() => {
        if (gain.gain.value > 0.01) scheduleChirps()
    }, 800 + Math.random() * 2000)

    return gain
}

// C major chord tones (C E G) + perfect 4th (F) across octaves
const BELL_NOTES = [
    261.63, 329.63, 349.23, 392.00,
    523.25, 659.25, 698.46, 783.99,
    // 1046.50, 1318.51, 1396.91, 1567.98
]

function buildBells(ctx, dest) {
    const convolver = ctx.createConvolver()
    const reverbLen = ctx.sampleRate * 3
    const reverbBuf = ctx.createBuffer(2, reverbLen, ctx.sampleRate)
    for (let ch = 0; ch < 2; ch++) {
        const data = reverbBuf.getChannelData(ch)
        for (let i = 0; i < reverbLen; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / reverbLen, 2.5)
        }
    }
    convolver.buffer = reverbBuf

    const pingPongTime = 1
    const delayL = ctx.createDelay(2)
    delayL.delayTime.value = pingPongTime
    const delayR = ctx.createDelay(2)
    delayR.delayTime.value = pingPongTime

    const pannerL = ctx.createStereoPanner()
    pannerL.pan.value = -1
    const pannerR = ctx.createStereoPanner()
    pannerR.pan.value = 1

    const feedbackGain = ctx.createGain()
    feedbackGain.gain.value = 0.45

    delayL.connect(pannerL)
    delayL.connect(feedbackGain).connect(delayR)
    delayR.connect(pannerR)
    delayR.connect(feedbackGain).connect(delayL)

    const dryGain = ctx.createGain()
    dryGain.gain.value = 0.3
    const wetGain = ctx.createGain()
    wetGain.gain.value = 0.7
    const pingPongGain = ctx.createGain()
    pingPongGain.gain.value = 0

    const masterGain = ctx.createGain()
    masterGain.gain.value = 0

    dryGain.connect(masterGain)
    convolver.connect(wetGain).connect(masterGain)
    pannerL.connect(pingPongGain).connect(masterGain)
    pannerR.connect(pingPongGain)
    masterGain.connect(dest)

    let bellDelay = 50
    let bellFrequency = 50

    function getTriggerMs() {
        return 100 + (100 - bellFrequency) * 200
    }

    function pluck() {
        const now = ctx.currentTime
        const freq = BELL_NOTES[Math.floor(Math.random() * BELL_NOTES.length)]

        const panner = ctx.createStereoPanner()
        panner.pan.value = (Math.random() - 0.5) * 0.6

        const osc = ctx.createOscillator()
        osc.type = 'sine'
        osc.frequency.value = freq

        const osc2 = ctx.createOscillator()
        osc2.type = 'sine'
        osc2.frequency.value = freq * 2.01

        const env = ctx.createGain()
        env.gain.setValueAtTime(0, now)
        env.gain.linearRampToValueAtTime(0.18, now + 0.005)
        env.gain.exponentialRampToValueAtTime(0.001, now + 2.5)

        osc.connect(env)
        osc2.connect(env)
        env.connect(panner)
        panner.connect(dryGain)
        panner.connect(convolver)
        panner.connect(delayL)

        osc.start(now)
        osc2.start(now)
        osc.stop(now + 3)
        osc2.stop(now + 3)
    }

    function applyDelay() {
        const d = bellDelay / 100
        wetGain.gain.value = 0.3 + d * 0.6
        dryGain.gain.value = 0.7 - d * 0.5
        pingPongGain.gain.value = d * 0.35
    }
    applyDelay()

    function scheduleNext() {
        const base = getTriggerMs()
        const jitter = base * 0.5
        const interval = base + Math.random() * jitter
        setTimeout(() => {
            if (masterGain.gain.value > 0.01) pluck()
            scheduleNext()
        }, interval)
    }

    scheduleNext()

    masterGain.setBellParams = (delay, freq) => {
        bellDelay = delay
        bellFrequency = freq
        applyDelay()
    }

    return masterGain
}

const BUILDERS = { birds: buildBirds, bells: buildBells }

function createEngine() {
    let ctx = null
    let gains = {}
    let started = false

    function ensureContext() {
        if (!ctx) {
            ctx = new AudioContext()
        }
        if (!started) {
            SOUND_DEFS.forEach((s) => {
                gains[s.id] = BUILDERS[s.id](ctx, ctx.destination)
            })
            started = true
        }
        return ctx
    }

    function setVolume(id, value) {
        if (!gains[id]) return
        gains[id].gain.setTargetAtTime(value, ctx.currentTime, 0.08)
    }

    function applySettings(settings) {
        if (!settings.playing) {
            if (ctx && ctx.state === 'running') ctx.suspend()
            return
        }

        ensureContext()
        if (ctx.state === 'suspended') ctx.resume()

        SOUND_DEFS.forEach((s) => {
            setVolume(s.id, settings.volumes[s.id] ?? 0)
        })

        if (gains.bells?.setBellParams) {
            gains.bells.setBellParams(settings.bellDelay ?? 50, settings.bellFrequency ?? 50)
        }
    }

    return { ensureContext, setVolume, applySettings }
}
