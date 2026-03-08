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

let _muted = false
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
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const sfx = {
    ...sounds,

    /** play by name: sfx.play('snap') */
    play(name) { sounds[name]?.() },

    toggleMute() {
        _muted = !_muted
        if (_master) _master.gain.setTargetAtTime(_muted ? 0 : 0.4, ctx().currentTime, 0.05)
        _notifyMute()
    },

    setMuted(val) {
        if (_muted === val) return
        _muted = val
        if (_master) _master.gain.setTargetAtTime(_muted ? 0 : 0.4, ctx().currentTime, 0.05)
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
