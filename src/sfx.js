/**
 * sfx.js — Procedural Web Audio sound effects
 * No external dependencies. AudioContext is lazily created on first play.
 *
 * Usage:
 *   import { sfx } from './sfx'
 *   sfx.click()
 *   sfx.toggleMute()
 *
 * React hook:
 *   import { useSFX } from './sfx'
 *   const { play, muted, toggleMute } = useSFX()
 *   play('snap')
 */

import { useCallback, useSyncExternalStore } from 'react'

// ─── Audio context (lazy) ────────────────────────────────────────────────────

let _ctx = null
function ctx() {
    if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)()
    if (_ctx.state === 'suspended') _ctx.resume()
    return _ctx
}

// ─── Mute state (module-level, shared across all hook instances) ─────────────

let _muted = true
const _listeners = new Set()
function _notifyMute() { _listeners.forEach(fn => fn()) }

// ─── Master gain ─────────────────────────────────────────────────────────────

let _master = null
function master() {
    if (!_master) {
        _master = ctx().createGain()
        _master.gain.value = _muted ? 0 : 0.4
        _master.connect(ctx().destination)
    }
    return _master
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function osc(type, freq, { attack = 0.004, decay = 0.12, peak = 0.6, detune = 0 } = {}) {
    const ac = ctx()
    const g = ac.createGain()
    g.gain.setValueAtTime(0, ac.currentTime)
    g.gain.linearRampToValueAtTime(peak, ac.currentTime + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + attack + decay)
    g.connect(master())

    const o = ac.createOscillator()
    o.type = type
    o.frequency.value = freq
    o.detune.value = detune
    o.connect(g)
    o.start(ac.currentTime)
    o.stop(ac.currentTime + attack + decay + 0.02)
}

function noise({ attack = 0.002, decay = 0.08, peak = 0.3, bandpass = null } = {}) {
    const ac = ctx()
    const bufSize = ac.sampleRate * (attack + decay + 0.05)
    const buf = ac.createBuffer(1, bufSize, ac.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1

    const src = ac.createBufferSource()
    src.buffer = buf

    const g = ac.createGain()
    g.gain.setValueAtTime(0, ac.currentTime)
    g.gain.linearRampToValueAtTime(peak, ac.currentTime + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + attack + decay)

    let node = src
    if (bandpass) {
        const bp = ac.createBiquadFilter()
        bp.type = 'bandpass'
        bp.frequency.value = bandpass
        bp.Q.value = 1.2
        src.connect(bp)
        node = bp
    }
    node.connect(g)
    g.connect(master())
    src.start(ac.currentTime)
}

function sweepOsc(type, freqStart, freqEnd, { attack = 0.01, decay = 0.25, peak = 0.5 } = {}) {
    const ac = ctx()
    const g = ac.createGain()
    g.gain.setValueAtTime(0, ac.currentTime)
    g.gain.linearRampToValueAtTime(peak, ac.currentTime + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + attack + decay)
    g.connect(master())

    const o = ac.createOscillator()
    o.type = type
    o.frequency.setValueAtTime(freqStart, ac.currentTime)
    o.frequency.exponentialRampToValueAtTime(freqEnd, ac.currentTime + attack + decay)
    o.connect(g)
    o.start(ac.currentTime)
    o.stop(ac.currentTime + attack + decay + 0.02)
}

// ─── Sound definitions ────────────────────────────────────────────────────────

const sounds = {
    /** Faint blip on hover */
    hover() {
        if (_muted) return
        osc('sine', 1100, { attack: 0.002, decay: 0.055, peak: 0.18 })
    },

    /** Crisp click on press */
    click() {
        if (_muted) return
        osc('square', 640, { attack: 0.002, decay: 0.04, peak: 0.22 })
        noise({ attack: 0.001, decay: 0.025, peak: 0.12, bandpass: 3200 })
    },

    /** Deep thud + shimmer on section snap */
    snap() {
        if (_muted) return
        sweepOsc('sine', 120, 55, { attack: 0.008, decay: 0.28, peak: 0.55 })
        osc('sine', 1800, { attack: 0.005, decay: 0.12, peak: 0.14 })
        noise({ attack: 0.002, decay: 0.06, peak: 0.08, bandpass: 4000 })
    },

    /** Rising confirmation ping (copy email, success) */
    ping() {
        if (_muted) return
        sweepOsc('sine', 660, 1320, { attack: 0.01, decay: 0.35, peak: 0.45 })
        sweepOsc('sine', 880, 1760, { attack: 0.015, decay: 0.25, peak: 0.2 })
    },

    /** Static glitch burst (tied to glitch text) */
    glitch() {
        if (_muted) return
        noise({ attack: 0.001, decay: 0.04, peak: 0.35, bandpass: 2200 })
        osc('sawtooth', 180, { attack: 0.001, decay: 0.03, peak: 0.2, detune: 15 })
    },

    /** Holographic shimmer (card expand) */
    shimmer() {
        if (_muted) return
        sweepOsc('sine', 900, 1800, { attack: 0.02, decay: 0.4, peak: 0.18 })
        sweepOsc('sine', 1350, 2700, { attack: 0.025, decay: 0.3, peak: 0.08 })
    },

    /** Mechanical tick (cog / letter hover) */
    tick() {
        if (_muted) return
        osc('square', 2400, { attack: 0.001, decay: 0.018, peak: 0.15 })
        noise({ attack: 0.001, decay: 0.012, peak: 0.1, bandpass: 6000 })
    },

    /** Soft piano note — random pentatonic pitch, plucked feel */
    piano() {
        if (_muted) return
        // C pentatonic major across 2 octaves: C4 D4 E4 G4 A4 C5 D5 E5 G5 A5
        const NOTES = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25, 783.99, 880.00]
        const freq = NOTES[Math.floor(Math.random() * NOTES.length)]
        const ac = ctx()

        // Gain envelope — fast attack, natural piano decay
        const g = ac.createGain()
        g.gain.setValueAtTime(0, ac.currentTime)
        g.gain.linearRampToValueAtTime(0.22, ac.currentTime + 0.006)
        g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 1.2)

        // Warm lowpass to soften the sine into something piano-adjacent
        const lp = ac.createBiquadFilter()
        lp.type = 'lowpass'
        lp.frequency.setValueAtTime(freq * 6, ac.currentTime)
        lp.frequency.exponentialRampToValueAtTime(freq * 1.5, ac.currentTime + 0.8)
        lp.Q.value = 0.8

        // Fundamental + soft 2nd harmonic for body
        const o1 = ac.createOscillator()
        o1.type = 'sine'
        o1.frequency.value = freq

        const o2 = ac.createOscillator()
        o2.type = 'sine'
        o2.frequency.value = freq * 2
        const g2 = ac.createGain()
        g2.gain.value = 0.12
        o2.connect(g2)
        g2.connect(lp)

        // Ambient delay — two taps for spaciousness
        const delay1 = ac.createDelay(2.0)
        delay1.delayTime.value = 0.36
        const delay2 = ac.createDelay(2.0)
        delay2.delayTime.value = 0.54
        const delayFb = ac.createGain()
        delayFb.gain.value = 0.48
        const delayWet = ac.createGain()
        delayWet.gain.value = 0.42
        // Feedback loop: delay1 → delay2 → delayFb → delay1
        delay1.connect(delay2)
        delay2.connect(delayFb)
        delayFb.connect(delay1)

        // Long convolver reverb (hall-like)
        const convolver = ac.createConvolver()
        const irLen = ac.sampleRate * 3.0
        const ir = ac.createBuffer(2, irLen, ac.sampleRate)
        for (let c = 0; c < 2; c++) {
            const ch = ir.getChannelData(c)
            for (let i = 0; i < irLen; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 1.6)
        }
        convolver.buffer = ir
        const reverbWet = ac.createGain()
        reverbWet.gain.value = 0.5

        o1.connect(lp)
        lp.connect(g)
        g.connect(master())
        g.connect(delay1)
        delay2.connect(delayWet)
        delayWet.connect(master())
        g.connect(convolver)
        convolver.connect(reverbWet)
        reverbWet.connect(master())

        o1.start(ac.currentTime)
        o2.start(ac.currentTime)
        o1.stop(ac.currentTime + 1.25)
        o2.stop(ac.currentTime + 1.25)
    },
}

// ─── Background track ────────────────────────────────────────────────────────

let _bgAudio = null

function getBgAudio() {
    if (!_bgAudio) {
        _bgAudio = new Audio('/sounds/main-track.m4a')
        _bgAudio.loop = true
        _bgAudio.volume = 0.11
    }
    return _bgAudio
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const sfx = {
    ...sounds,

    /** play by name: sfx.play('snap') */
    play(name) { sounds[name]?.() },

    /** Spine startup whoosh — machinery spinning up */
    spineStart() {
        if (_muted) return
        sweepOsc('sawtooth', 40, 180, { attack: 0.04, decay: 0.6, peak: 0.35 })
        sweepOsc('sine', 200, 800, { attack: 0.06, decay: 0.5, peak: 0.18 })
        noise({ attack: 0.01, decay: 0.3, peak: 0.12, bandpass: 1200 })
    },

    /** Sustained mechanical hum — returns a stop() function */
    mechanicalHum() {
        if (_muted) return () => {}
        const ac = ctx()
        const g = ac.createGain()
        g.gain.setValueAtTime(0, ac.currentTime)
        g.gain.linearRampToValueAtTime(0.12, ac.currentTime + 0.8)
        g.connect(master())

        const o1 = ac.createOscillator()
        o1.type = 'sawtooth'
        o1.frequency.value = 72
        o1.connect(g)
        o1.start()

        const o2 = ac.createOscillator()
        o2.type = 'square'
        o2.frequency.value = 108
        o2.connect(g)
        o2.start()

        return function stop() {
            const now = ac.currentTime
            g.gain.cancelScheduledValues(now)
            g.gain.setTargetAtTime(0, now, 0.4)
            setTimeout(() => { try { o1.stop(); o2.stop() } catch (_) {} }, 1500)
        }
    },

    /** Soft cog emergence tick */
    cogTick() {
        if (_muted) return
        osc('square', 1800, { attack: 0.001, decay: 0.022, peak: 0.09 })
        noise({ attack: 0.001, decay: 0.01, peak: 0.06, bandpass: 4500 })
    },

    /** Start looping background track — call after a user gesture */
    startBgTrack() {
        const audio = getBgAudio()
        audio.muted = _muted
        return audio.play() // return promise so caller can detect if autoplay was blocked
    },

    toggleMute() {
        _muted = !_muted
        if (_master) _master.gain.setTargetAtTime(_muted ? 0 : 0.4, ctx().currentTime, 0.05)
        if (_bgAudio) _bgAudio.muted = _muted
        _notifyMute()
    },

    setMuted(val) {
        if (_muted === val) return
        _muted = val
        if (_master) _master.gain.setTargetAtTime(_muted ? 0 : 0.4, ctx().currentTime, 0.05)
        if (_bgAudio) _bgAudio.muted = _muted
        _notifyMute()
    },

    isMuted() { return _muted },
}

// ─── React hook ───────────────────────────────────────────────────────────────

function subscribe(cb) {
    _listeners.add(cb)
    return () => _listeners.delete(cb)
}
function getSnapshot() { return _muted }

export function useSFX() {
    const muted = useSyncExternalStore(subscribe, getSnapshot)
    const play = useCallback((name) => sfx.play(name), [])
    const toggleMute = useCallback(() => sfx.toggleMute(), [])
    return { play, muted, toggleMute }
}
