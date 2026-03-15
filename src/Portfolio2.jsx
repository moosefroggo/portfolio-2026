import React, { useRef, useMemo, useState, useEffect, useCallback } from 'react'
import { sfx, useSFX } from './sfx'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, Text, Text3D, Center, useGLTF, Line, useTexture, useProgress, Html, RoundedBox } from '@react-three/drei'
import { EffectComposer, SelectiveBloom, ChromaticAberration } from '@react-three/postprocessing'
import * as THREE from 'three'

// Enable Draco decoder for compressed GLBs
useGLTF.setDecoderPath('/draco/')

// 🟢 Global warp offset for velocity-driven chromatic aberration
const warpOffset = new THREE.Vector2(0.002, 0.002)

// 🎡 Per-card drag rotation state (module-level, read in useFrame)
const dragRotState = {
    isDragging: false,
    lastX: 0, lastY: 0,
    cardIndex: -1,        // which card is being dragged (0-1)
    rotX: [0, 0],        // accumulated pitch per card
    rotY: [0, 0],        // accumulated yaw per card
}

// ── Hero Intro Shared State (module-level) ────────────────────────────────────
// Phase: 'loading' | 'pullback' | 'done'
let loaderFullyHidden = false  // set true when EliteLoader unmounts
const heroIntroState = {
    phase: 'loading',
    morphProgress: 1,             // 1 = fully scattered, 0 = fully formed
    // Post-processing overrides — read by PostProcessingEffects
    bloomOverride: 2.5,       // starts hot, eases to null
    chromaticSpike: 0,        // 0 = no spike, >0 = spike magnitude
    hasEntered: false,
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. CONFIGURATION & CAMERA PATH
// ═════════════════════════════════════════════════════════════════════════════

// Ethos position — a dark empty zone the camera pans toward
const ETHOS_POS = [70, 0, -5]

// ── Camera track for the page scroll ──
const CAMERA_PATH = [
    // ── Hero area (start) ──
    { t: 0.00, pos: [0, 2, 18], look: [0, 2, 0], fov: 60, roll: 0 },
    // ── Ethos transition ──
    { t: 0.08, pos: [40, 0.3, 14], look: ETHOS_POS, fov: 64, roll: 0 },
    { t: 0.24, pos: [65, 0, 12], look: ETHOS_POS, fov: 60, roll: 0 },
    // ── Transition to project rail (30-unit gap: ethos X=70 → cards X=100) ──
    { t: 0.30, pos: [80, 0.5, 12], look: [80, 0, 0], fov: 68, roll: 0 },
    // ── Card 1 — X=100 ──
    { t: 0.38, pos: [100, 1, 9], look: [100, -1, 0], fov: 62, roll: -1 },
    { t: 0.44, pos: [100, -2, 7], look: [100, -2, 0], fov: 44, roll: 0 },
    // ── Card 2 — X=120 ──
    { t: 0.52, pos: [110, 0.3, 10], look: [110, -1, 0], fov: 60, roll: 1 },
    { t: 0.58, pos: [120, 0, 9], look: [120, -1, 0], fov: 58, roll: -0.5 },
    { t: 0.62, pos: [120, -2, 7], look: [120, -2, 0], fov: 44, roll: 0 },
    // ── Card 3 — X=140 ──
    { t: 0.70, pos: [130, 0.3, 10], look: [130, -1, 0], fov: 60, roll: 0.5 },
    { t: 0.76, pos: [140, 0, 9], look: [140, -1, 0], fov: 58, roll: -0.5 },
    { t: 0.80, pos: [140, 1, 7], look: [140, -0.5, 0], fov: 52, roll: 0 },
    // ── Bio section ──
    { t: 0.86, pos: [140, 0, -2], look: [140, -3.2, -30], fov: 54, roll: 0 },
    { t: 0.93, pos: [140, 0, -12], look: [140, -3.2, -30], fov: 52, roll: 0 },
    { t: 1.00, pos: [140, 0, -20], look: [140, -3.2, -30], fov: 50, roll: 0 },
    // ── Dossier — eased approach: mid-waypoint to soften the deep Z plunge ──
    { t: 1.05, pos: [140, -1.8, -58], look: [140, -3.2, -72], fov: 44, roll: 0 },
    { t: 1.10, pos: [140, -1.5, -100], look: [140, -1.5, -110], fov: 44, roll: 0 },
]

// Section snap stops — camera always rests at one of these t-values
const SECTION_STOPS = [
    0.00,   // hero
    0.24,   // ethos
    0.44,   // card 1 park
    0.62,   // card 2 park
    0.96,   // bio patch
    1.10,   // dossier (close-up camera on bust + resume panel)
]
const WHEEL_THRESHOLD = 300  // deltaY pixels to trigger a section advance
const SECTION_LABELS = ['HERO', 'ETHOS', 'NEXUS', 'Workflows', 'EXPERIENCE', 'DOSSIER']
// Visual positions in the nav bar (independent of scroll stops)
const SECTION_BAR_POSITIONS = [0.00, 0.13, 0.30, 0.47, 0.67, 1.00]

// Shared flag: true when mouse is over an HTML UI element (not the canvas)
const uiHoveredRef = { current: false }

// ─── Font options for subtitle testing ────────────────────────────────────────
const SUBTITLE_FONT = '/fonts/Space_Mono/SpaceMono-Regular.ttf'

const PROJECT_CARDS = [
    {
        pos: [100, -2, 0], rot: [0, 0, 0], color: '#00aaff', appear: 0.44,
        title: 'Engine Immobilizer', subtitle: 'Allowing fleet managers to remotely immobilize stolen vehicles',
        desc: 'Allowing fleet managers to remotely immobilize stolen vehicles',
        tech: ['Blender', 'Figma', 'Origami Studio'],
        stats: { role: 'Product Design Lead', year: '2024', company: 'Motive' },
        objectType: 'truck_immobilizer',
        video: '/demos/ei-noborder.mp4',
        caseStudy: {
            meta: { role: 'Product Design Lead', duration: '2 months', team: 'Design, PM, Engineering, Hardware' },
            sections: [
                {
                    type: 'intro',
                    label: 'THE PROBLEM',
                    title: '90% of prospects needed something we didn\'t have',
                    body: 'When Motive started expanding to Mexico in Q3 2023, the feedback was clear: 90% of prospects asked for remote immobilization. We\'d already lost deals over it. This went from a nice-to-have feature to a blocker between us and an entire market. We had until end of Q4 to figure it out and ship in Q1 2024.',
                },
                {
                    type: 'research',
                    label: 'WHY THIS WAS HARD',
                    title: 'Four concurrent platform initiatives',
                    body: 'The timing was brutal. Admin was mid-migration from 1.0 to 2.0, and the Vehicles page we needed to redesign hadn\'t been rebuilt yet. Fleet View was getting new map icons simultaneously. A Device Hub was in early development that would eventually own all device controls. On top of that, we were sourcing hardware from a third-party vendor for the first time, which limited what device data we could surface and how it communicated with our systems.',
                },
                {
                    type: 'images',
                    layout: 'pair',
                    images: ['/case-material/admin1.0.png', '/case-material/Admin2.0.png'],
                    caption: 'Admin 1.0 (left) and the planned 2.0 redesign (right). Neither was built for immobilization.',
                },
                {
                    type: 'quotes',
                    label: 'CUSTOMER RESEARCH',
                    quotes: [
                        '"Fleet managers, not drivers, control immobilization." The decision to kill the engine sits with the manager, not the driver.',
                        '"Vehicles get immobilized roughly five times a month." Top reasons: attempted robbery and drunk driving.',
                        '"Tampering is a real fear." Thieves know where devices are installed and can damage the wiring to disable the system.',
                        '"Dead zones on highways are a problem." If there\'s no signal, the device is useless and customers wanted a fallback.',
                    ],
                },
                {
                    type: 'images',
                    layout: 'full',
                    images: ['/case-material/customer-call.png'],
                    caption: 'Walking fleet managers through the solution. Designs were in Spanish for the call.',
                },
                {
                    type: 'research',
                    label: 'KEY DESIGN DECISIONS',
                    title: 'Five iterations to find the right pattern',
                    body: 'Placement was the critical decision. I tested five different positions: action bar, below vehicle status, next to it, a dedicated section, and a persistent banner. The banner won because immobilized vehicles are rare (less than 1% of fleets), so it needed to stand out without cluttering the normal view. I also positioned Fleet View as a real-time status page and scoped the first release to the starter line, saving things like fuel line deceleration for later.',
                },
                {
                    type: 'images',
                    layout: 'trio',
                    images: ['/case-material/iteration-4.png', '/case-material/iteration-1.png', '/case-material/iteration-final.png'],
                    caption: 'Iteration 1 (action button top-right) → Iteration 4 (dedicated section) → Final (persistent banner). The banner was the clear winner.',
                },
                {
                    type: 'features',
                    label: 'WHAT SHIPPED',
                    items: [
                        { name: 'Immobilized Banner', desc: 'A persistent banner on the vehicle detail page showing who immobilized the vehicle, when, and from where.', video: '/demos/banner-video.webm' },
                        { name: 'Live Tracking', desc: 'Real-time location data, live video feed, and follow mode to track stolen vehicles. Immobilized vehicles surface at the top of the fleet list.', video: '/demos/map-video.webm' },
                        { name: 'Trip Timeline', desc: 'Immobilization events logged on the vehicle\'s trip timeline, alongside dashcam footage for full context.', video: '/demos/vehicle-history.webm' },
                        { name: 'Tamper & Jammer Alerts', desc: 'Post-launch alerts for physical device removal and signal jamming, added based on direct customer feedback.', video: '/demos/notifications-video.webm' },
                    ],
                },
                {
                    type: 'research',
                    label: 'IMPACT',
                    title: 'Seven figures in new revenue',
                    body: 'Engine Immobilizer opened the Mexican market for Motive and drove seven figures in Q1 2024 revenue. Customers reported lower insurance premiums and a measurable drop in cargo theft.',
                    stat: '7-figure impact',
                },
                {
                    type: 'cta',
                    body: 'This case study describes a two-month sprint to ship. Want the full story on how we navigated the constraints? Let\'s talk.',
                },
            ],
        },
    },
    {
        pos: [120, -2.5, 0], rot: [0, 0.2, 0], color: '#44ff88', appear: 0.62,
        title: 'Workflows', subtitle: 'A central hub for project and documentation management helping fast moving teams optimize for outcomes',
        desc: 'A central hub for project and documentation management helping development teams reduce Slack messages',
        tech: ['Figma', 'Rive', 'JavaScript', 'Miro'],
        stats: { role: 'Product Design', year: '2023', company: 'Educative' },
        objectType: 'workflows',
        video: '/demos/wf-noborder.mp4',
        caseStudy: {
            meta: { role: 'Product Design', duration: '8 months', team: 'Design, PM, Engineering' },
            sections: [
                {
                    type: 'intro',
                    label: 'THE PROBLEM',
                    title: 'The scalability problem',
                    body: 'As our team at Educative scaled from 50 people to over 600, a centralized repository of projects, communication, and documentation became necessary. The existing tools provided separate solutions, requiring a lot of context switching and maintenance. To solve this problem for multiple personas across the company, we set on to build a product called Workflows.',
                },
                {
                    type: 'role',
                    label: 'MY ROLE',
                    title: 'The Manager + IC Hybrid',
                    body: 'By this point, I had been at Educative for over 2 years. It was an ambitious product that our leadership was heavily focused on and I worked directly with sales, engineering, and product leadership on the end-to-end process. Besides this, I was also involved in hiring and developing an outcome focused team of Designers and Illustrators.',
                },
                {
                    type: 'research',
                    label: 'RESEARCH',
                    title: 'Talking to the demographic',
                    body: 'I spoke to a total of 31 people (18 Engineering Managers, 13 Software Engineers) sourced through my LinkedIn references. Since this was an exploratory phase for us, I deemed it best to get their perspectives about the current state of work management tools, focusing on how they use the existing tools, what they like, what they not like, and where the gaps exist in those tools.',
                },
                {
                    type: 'quotes',
                    label: 'KEY INSIGHTS',
                    quotes: [
                        '"I can never figure out project progress." Engineering Managers have tight schedules and don\'t want to search for documents or projects.',
                        '"Design, PM, and dev docs get lost." Team alignment is broken when related docs live in different platforms.',
                        '"Signoffs become blockers and I have to remind people via Slack." People forget things, and PMs constantly remind via messaging apps.',
                        '"Discussions on technical docs are difficult to resolve." Implementation discussions stay in limbo, preventing document approval.',
                    ],
                },
                {
                    type: 'features',
                    label: 'FINAL DESIGNS',
                    items: [
                        { name: 'Task Manager', desc: 'Complete end-to-end task manager from scratch. Tasks are associated to Projects and Documents and can be assigned to anyone.', video: '/demos/task-page.webm' },
                        { name: 'Review Manager', desc: 'Request reviews on documents from any team member. Full review flow with status tracking and resolution.', video: '/demos/reviews-video.webm' },
                        { name: 'Project Manager', desc: 'A project contains several tasks and documents. It can have a due date and multiple collaborators.', video: '/demos/project-video.webm' },
                        { name: 'Document Editor', desc: 'Live multiplayer document editor with auto-save. Tasks and reviews are embedded in-document with clear status.', video: '/demos/doc-video.webm' },
                    ],
                },
                {
                    type: 'cta',
                    body: 'The work listed in this case study is a bird\'s eye view of the project over eight months. Want to dive deep into the designs? Feel free to reach out.',
                },
            ],
        },
    },
]

// ═════════════════════════════════════════════════════════════════════════════
// 2. HERO CONFIGURATION — edit here to tune the hero section
// ═════════════════════════════════════════════════════════════════════════════

const HERO_CONFIG = {
    // Per-letter tweaks: yOffset and zOffset are in world units (pre-scale)
    letters: [
        { char: 'M', xOffset: -0.6, yOffset: 0, zOffset: 0 },
        { char: 'U', yOffset: 0, zOffset: 0 },
        { char: 'S', yOffset: 0, zOffset: 0 },
        { char: 'T', yOffset: 0, zOffset: 0 },
        { char: 'A', yOffset: 0, zOffset: 0 },
        { char: 'F', yOffset: 0, zOffset: 0 },
        { char: 'A', yOffset: 0, zOffset: 0 },
    ],
    spacing: 4.2,            // units between letter centers (pre-scale)
    groupY: 2.8,             // vertical offset of the whole hero group
    targetFraction: 0.72,    // fraction of viewport width that MUSTAFA fills

    subtitleText: 'I am a product designer and sometimes a frontend developer. ',
    subtitleYOffset: -5.8,   // Y below letter baseline (pre-scale)
    subtitleFontSize: 0.6,   // font size (pre-scale)
    subtitleLetterSpacing: 0.15,
    spineRotationSpeed: 0,     // radians/sec — spin of individual spine pieces around their tangent axis
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. UTILITIES
// ═════════════════════════════════════════════════════════════════════════════

const clamp = (val, min, max) => Math.max(min, Math.min(max, val))
const remap = (val, inMin, inMax, outMin, outMax) => outMin + ((clamp(val, inMin, inMax) - inMin) * (outMax - outMin)) / (inMax - inMin)
const smoothstep = (x) => x * x * (3 - 2 * x)
const dampValue = (current, target, smoothing, delta) => THREE.MathUtils.damp(current, target, smoothing, delta)

// ═════════════════════════════════════════════════════════════════════════════
// 3. CORE ENGINE
// ═════════════════════════════════════════════════════════════════════════════

const SCROLL_SMOOTHING = 3  // higher = snappier, lower = more damped

// Module-level scroll value — updated every frame, readable by any component without prop drilling
let _scrollT = 0

function ScrollSmoother({ currentSectionRef, scrollRef }) {
    useFrame((_, delta) => {
        const target = SECTION_STOPS[currentSectionRef.current]
        scrollRef.current = dampValue(scrollRef.current, target, SCROLL_SMOOTHING, delta)
        _scrollT = scrollRef.current
    })
    return null
}

// Section active range helpers (with margin so transitions feel smooth)
const inHero     = () => _scrollT < 0.18
const inEthos    = () => _scrollT > 0.05 && _scrollT < 0.40
const inProjects = () => _scrollT > 0.35 && _scrollT < 0.85
const inBio      = () => _scrollT > 0.80 && _scrollT < 1.05
const inDossier  = () => _scrollT > 1.00

// Max camera strafe offset in world units — camera drifts toward mouse position
const PROJ_NUDGE_X = 1.6   // horizontal lean (world units)
const PROJ_NUDGE_Y = 0.9   // vertical lift (world units)

// ── Cinematic Hero Intro Camera ───────────────────────────────────────────────
// Starts zoomed into a single cog, pulls back through damped stops, then
// hands off to the scroll-driven CameraController.
const HERO_INTRO_START = { pos: [0, 2.8, 1.8], look: [0, 2.8, 0], fov: 20 }
const HERO_INTRO_END = { pos: [0, 2, 18], look: [0, 2, 0], fov: 60 }
const HERO_ANIMATION_DURATION = 3.5  // seconds for the entire smooth pullback

// HeroIntroCam has been cleanly merged directly into CameraController to prevent handoff jumps


function CameraController({ scrollRef }) {
    const { camera, size } = useThree()
    const { progress, active: loadingActive } = useProgress()

    // Intro animation state
    const animTimeRef = useRef(0)
    const delayRef = useRef(0.2)

    // Scroll animation state
    const lookAtTarget = useRef(new THREE.Vector3(...HERO_INTRO_START.look))
    const prevScroll = useRef(0)
    const velocityRef = useRef(0)
    const nudgeXRef = useRef(0)
    const nudgeYRef = useRef(0)

    const _targetPos = useMemo(() => new THREE.Vector3(), [])
    const _targetLook = useMemo(() => new THREE.Vector3(), [])
    const _startPos = useMemo(() => new THREE.Vector3(), [])
    const _endPos = useMemo(() => new THREE.Vector3(), [])
    const _startLook = useMemo(() => new THREE.Vector3(), [])
    const _endLook = useMemo(() => new THREE.Vector3(), [])

    const isPortrait = size.width < size.height
    const heroZ = isPortrait ? 2 : 22
    const activeCameraPath = useMemo(() => {
        if (!isPortrait) return [
            { ...CAMERA_PATH[0], pos: [0, 2, heroZ] },
            ...CAMERA_PATH.slice(1)
        ]
        // On portrait: hero closer + project card keyframes zoomed in
        return CAMERA_PATH.map((kf, i) => {
            if (i === 0) return { ...kf, pos: [0, 2, heroZ] }
            // Card settle keyframes — portrait: pull back and center on card (card is at y=-2)
            if (kf.t === 0.44 || kf.t === 0.62 || kf.t === 0.80) return { ...kf, pos: [kf.pos[0], 1, 8], look: [kf.pos[0], -1.5, 0], fov: 62 }
            // Experience section — bring camera closer to the patch
            if (kf.t === 0.86) return { ...kf, pos: [140, 0, -18] }
            if (kf.t === 0.93) return { ...kf, pos: [140, 0, -22] }
            if (kf.t === 1.00) return { ...kf, pos: [140, 0, -26] }
            if (kf.t === 1.10) return { ...kf, fov: 90, pos: [140, 2, -80], look: [140, -1, -110] }
            return kf
        })
    }, [isPortrait, heroZ])

    useFrame((state, delta) => {
        let isIntroFinished = heroIntroState.phase === 'done'

        // Shared narrow compensation values (used by both intro end and scroll logic)
        const narrowFactor = Math.max(0, 1.6 - camera.aspect)
        const aspectBoost = narrowFactor * 45
        const narrowZPullback = narrowFactor * 4

        let targetFov = 70
        let targetRoll = 0

        if (!isIntroFinished) {
            // ─── 1) HERO INTRO SEQUENCE ───────────────────────────────────────
            const isLoaded = progress > 99.9 && !loadingActive && heroIntroState.hasEntered
            if (!isLoaded) {
                // Pin to start while loading
                _targetPos.set(...HERO_INTRO_START.pos)
                _targetLook.set(...HERO_INTRO_START.look)
                targetFov = HERO_INTRO_START.fov
                // Skip lerping during load
                camera.position.copy(_targetPos)
                lookAtTarget.current.copy(_targetLook)
                camera.fov = targetFov
                camera.lookAt(lookAtTarget.current)
                camera.updateProjectionMatrix()
                return
            }

            if (heroIntroState.phase === 'loading') {
                heroIntroState.phase = 'pullback'
            }

            // Linger phase
            if (delayRef.current > 0) {
                delayRef.current -= delta
                _targetPos.set(...HERO_INTRO_START.pos)
                _targetLook.set(...HERO_INTRO_START.look)
                targetFov = HERO_INTRO_START.fov
                camera.position.copy(_targetPos)
                lookAtTarget.current.copy(_targetLook)
                camera.fov = targetFov
                camera.lookAt(lookAtTarget.current)
                camera.updateProjectionMatrix()
                return
            }

            // Advance intro animation
            animTimeRef.current += delta
            const rawProgress = Math.min(animTimeRef.current / HERO_ANIMATION_DURATION, 1)

            // Cubic ease-in-out
            let easedProgress = rawProgress < 0.5
                ? 4 * Math.pow(rawProgress, 3)
                : 1 - Math.pow(-2 * rawProgress + 2, 3) / 2

            // Calculate current intro targets
            const targetZ = (isPortrait ? HERO_INTRO_END.pos[2] : 22) + narrowZPullback
            const endFov = HERO_INTRO_END.fov + aspectBoost

            _targetPos.set(
                THREE.MathUtils.lerp(HERO_INTRO_START.pos[0], HERO_INTRO_END.pos[0], easedProgress),
                THREE.MathUtils.lerp(HERO_INTRO_START.pos[1], HERO_INTRO_END.pos[1], easedProgress),
                THREE.MathUtils.lerp(HERO_INTRO_START.pos[2], targetZ, easedProgress)
            )

            _targetLook.set(
                THREE.MathUtils.lerp(HERO_INTRO_START.look[0], HERO_INTRO_END.look[0], easedProgress),
                THREE.MathUtils.lerp(HERO_INTRO_START.look[1], HERO_INTRO_END.look[1], easedProgress),
                THREE.MathUtils.lerp(HERO_INTRO_START.look[2], HERO_INTRO_END.look[2], easedProgress)
            )

            targetFov = THREE.MathUtils.lerp(HERO_INTRO_START.fov, endFov, easedProgress)
            heroIntroState.morphProgress = 1 - easedProgress
            heroIntroState.bloomOverride = THREE.MathUtils.lerp(2.5, 1.6, easedProgress)
            // Ramp CA down from 0.004 at start to 0.001 at end so it matches the scroll-phase value
            const caStr = THREE.MathUtils.lerp(0.004, 0.001, easedProgress)
            warpOffset.set(caStr, caStr)

            if (rawProgress >= 1) {
                isIntroFinished = true
                heroIntroState.phase = 'done'
                heroIntroState.bloomOverride = null
                // Reset scroll to 0 in case user scrolled during intro
                scrollRef.current = 0
                prevScroll.current = 0
            }

            // Directly apply targets during intro to prevent drift
            camera.position.copy(_targetPos)
            lookAtTarget.current.copy(_targetLook)
            camera.fov = targetFov
            camera.lookAt(lookAtTarget.current)
            camera.updateProjectionMatrix()
            return
        }

        // ─── 2) SCROLL NAVIGATION SEQUENCE ────────────────────────────────
        const t = scrollRef.current || 0
        const rawVelocity = Math.abs(t - prevScroll.current) / Math.max(delta, 0.001)
        prevScroll.current = t

        // Higher multiplier = spikes faster; higher damping factor = decays faster → sharper jerk
        velocityRef.current = dampValue(velocityRef.current, clamp(rawVelocity * 40, 0, 1), 14, delta)

        let startIndex = 0
        for (let i = 0; i < activeCameraPath.length - 1; i++) {
            if (t >= activeCameraPath[i].t && t <= activeCameraPath[i + 1].t) { startIndex = i; break }
        }
        if (t >= activeCameraPath[activeCameraPath.length - 1].t) startIndex = activeCameraPath.length - 2

        const start = activeCameraPath[startIndex]
        const end = activeCameraPath[startIndex + 1]
        const localT = end.t > start.t ? (t - start.t) / (end.t - start.t) : 1
        const easeT = smoothstep(clamp(localT, 0, 1))

        _startPos.set(...start.pos); _endPos.set(...end.pos)
        _startLook.set(...start.look); _endLook.set(...end.look)
        _targetPos.lerpVectors(_startPos, _endPos, easeT)
        _targetLook.lerpVectors(_startLook, _endLook, easeT)

        const baseFov = THREE.MathUtils.lerp(start.fov, end.fov, easeT)
        _targetPos.z += narrowZPullback
        targetFov = baseFov + velocityRef.current * 12 + aspectBoost

        // Exaggerate path roll during scroll for a thrown-through-space feel
        const pathRoll = THREE.MathUtils.lerp(start.roll, end.roll, easeT) * (Math.PI / 180)
        targetRoll = pathRoll * (1 + velocityRef.current * 3.5)

        // ── Mouse parallax nudge: active only in project card section ────────
        // Blend weight — project cards AND bio/resume section
        // ramp in: 0.38-0.44, full: 0.44-0.70, ramp in again: 0.86-0.93, full: 0.93-1.10
        const projBlend = clamp(
            t < 0.38 ? 0 :
                t < 0.44 ? (t - 0.38) / 0.06 :
                    t <= 0.70 ? 1 - (Math.max(0, t - 0.62) / 0.08) :
                        t < 0.86 ? 0 :
                            t < 0.93 ? (t - 0.86) / 0.07 :
                                t < 1.00 ? 1 :
                                    t < 1.06 ? 1 - (t - 1.00) / 0.06 : 0,
            0, 1
        )
        const mx = uiHoveredRef.current ? 0 : clamp(state.pointer.x, -1, 1)
        const my = uiHoveredRef.current ? 0 : clamp(state.pointer.y, -1, 1)

        // Damp toward the nudge target, then bake it into the PATH target
        // before the lerp — this way the lerp smooths toward the nudged
        // destination instead of the nudge accumulating post-lerp each frame.
        nudgeXRef.current = dampValue(nudgeXRef.current, mx * PROJ_NUDGE_X * projBlend, 2.5, delta)
        nudgeYRef.current = dampValue(nudgeYRef.current, my * PROJ_NUDGE_Y * projBlend, 2.5, delta)
        _targetPos.x += nudgeXRef.current
        _targetPos.y += nudgeYRef.current

        // Only lerp during the scroll phase (intro sets exact values and returns early above)
        const lerpFactor = 1 - Math.exp(-6 * delta)
        camera.position.lerp(_targetPos, lerpFactor)
        lookAtTarget.current.lerp(_targetLook, lerpFactor)
        camera.fov = dampValue(camera.fov, targetFov, 6, delta)

        // Use applied roll instead of raw assignment for smoother mouse tracking
        const applyRoll = dampValue(camera.rotation.z, targetRoll, 6, delta)

        camera.lookAt(lookAtTarget.current)
        camera.updateProjectionMatrix()
        camera.rotation.z = applyRoll

        const chromaticStr = 0.001 + velocityRef.current * 0.045
        warpOffset.set(chromaticStr, chromaticStr)
    })
    return null
}

function CursorFX() {
    const orbRef = useRef()
    const illumRef = useRef()
    const rimRef = useRef()

    const _dir = useMemo(() => new THREE.Vector3(), [])
    const _orbPos = useMemo(() => new THREE.Vector3(), [])
    const _illumPos = useMemo(() => new THREE.Vector3(), [])

    useFrame((state, delta) => {
        _dir.set(state.pointer.x, state.pointer.y, 0.5).unproject(state.camera)
        _dir.sub(state.camera.position).normalize()

        _orbPos.copy(state.camera.position).addScaledVector(_dir, 5)
        if (orbRef.current) orbRef.current.position.lerp(_orbPos, 0.12)

        if (rimRef.current) {
            rimRef.current.position.lerp(_orbPos, 0.08)
            rimRef.current.rotation.z += delta * 0.9
            rimRef.current.rotation.x += delta * 0.4
        }

        _illumPos.copy(state.camera.position).addScaledVector(_dir, 14)
        if (illumRef.current) illumRef.current.position.lerp(_illumPos, 0.10)

        const overUI = uiHoveredRef.current
        if (orbRef.current) orbRef.current.visible = !overUI
        if (rimRef.current) rimRef.current.visible = !overUI
        if (illumRef.current) illumRef.current.visible = !overUI

        const breathe = 1 + Math.sin(state.clock.elapsedTime * 2.2) * 0.04
        if (orbRef.current) orbRef.current.scale.setScalar(breathe * 0.65)
    })

    return (
        <>
            <group ref={orbRef}>
                {/* BackSide pass — darkened inner shell gives depth/curvature illusion */}
                <mesh renderOrder={98}>
                    <sphereGeometry args={[0.22, 32, 32]} />
                    <meshStandardMaterial
                        color="#0a1a44"
                        emissive="#112266"
                        emissiveIntensity={0.6}
                        roughness={0.0}
                        metalness={0.95}
                        transparent
                        opacity={0.55}
                        toneMapped={false}
                        side={THREE.BackSide}
                        depthTest={false}
                    />
                </mesh>
                {/* FrontSide glass shell — high metalness for specular highlight */}
                <mesh renderOrder={100}>
                    <sphereGeometry args={[0.22, 32, 32]} />
                    <meshStandardMaterial
                        color="#ff00ff"
                        emissive="#ff00ff"
                        emissiveIntensity={0.8}
                        roughness={0.0}
                        metalness={0.85}
                        envMapIntensity={4.0}
                        transparent
                        opacity={0.5}
                        toneMapped={false}
                        side={THREE.FrontSide}
                        depthTest={false}
                    />
                </mesh>
                {/* Inner glow core */}
                <mesh scale={0.52} renderOrder={101}>
                    <sphereGeometry args={[0.22, 16, 16]} />
                    <meshBasicMaterial color="#ff00ff" transparent opacity={0.7} toneMapped={false} depthTest={false} />
                </mesh>
                {/* Hot nucleus for bloom */}
                <mesh scale={0.20} renderOrder={102}>
                    <sphereGeometry args={[0.22, 16, 16]} />
                    <meshBasicMaterial color="#ffffff" transparent opacity={1.0} toneMapped={false} depthTest={false} />
                </mesh>
                {/* Inner light — illuminates the glass shell from inside */}
                <pointLight intensity={32} color="#ff00ff" distance={2.5} decay={2} />
            </group>

            <group ref={rimRef}>
                {/* Spike left — hot magenta */}
                <mesh position={[-0.36, 0, 0]} rotation={[0, 0, Math.PI / 2]} renderOrder={100}>
                    <coneGeometry args={[0.026, 0.18, 6]} />
                    <meshStandardMaterial
                        color="#ff00ff" emissive="#ff00ff" emissiveIntensity={1.6}
                        roughness={0} metalness={0.3}
                        transparent opacity={0.9} toneMapped={false} depthTest={false}
                    />
                </mesh>
                {/* Spike right — hot cyan */}
                <mesh position={[0.36, 0, 0]} rotation={[0, 0, -Math.PI / 2]} renderOrder={100}>
                    <coneGeometry args={[0.026, 0.18, 6]} />
                    <meshStandardMaterial
                        color="#00ffff" emissive="#00ffff" emissiveIntensity={1.6}
                        roughness={0} metalness={0.3}
                        transparent opacity={0.9} toneMapped={false} depthTest={false}
                    />
                </mesh>
            </group>

            <group ref={illumRef}>
                <pointLight intensity={24} color="#ff00ff" distance={30} decay={1.5} />
            </group>
        </>
    )
}

function InteractiveParticleField({ count = 300 }) {
    const ref = useRef()
    const [basePositions, currentPositions, velocities] = useMemo(() => {
        const base = new Float32Array(count * 3)
        const current = new Float32Array(count * 3)
        const vel = new Float32Array(count * 3)
        for (let i = 0; i < count; i++) {
            base[i * 3] = current[i * 3] = Math.random() * 220 - 10
            base[i * 3 + 1] = current[i * 3 + 1] = (Math.random() - 0.5) * 30
            base[i * 3 + 2] = current[i * 3 + 2] = (Math.random() - 0.5) * 40
        }
        return [base, current, vel]
    }, [count])

    const mouse3D = useMemo(() => new THREE.Vector3(), [])

    useFrame((state, delta) => {
        if (!ref.current) return
        mouse3D.set(state.pointer.x, state.pointer.y, 0.5).unproject(state.camera)
        mouse3D.sub(state.camera.position).normalize().multiplyScalar(5).add(state.camera.position)

        const positions = ref.current.geometry.attributes.position.array
        for (let i = 0; i < count; i++) {
            const ix = i * 3, iy = i * 3 + 1, iz = i * 3 + 2
            basePositions[iy] -= delta * 0.3
            if (basePositions[iy] < -15) basePositions[iy] = 15

            const dx = positions[ix] - mouse3D.x, dy = positions[iy] - mouse3D.y, dz = positions[iz] - mouse3D.z
            const dist2 = dx * dx + dy * dy + dz * dz

            if (dist2 < 16) {
                const dist = Math.sqrt(dist2)
                const force = (4 - dist) / 4
                velocities[ix] += (dx / dist) * force * 0.15
                velocities[iy] += (dy / dist) * force * 0.15
                velocities[iz] += (dz / dist) * force * 0.15
            }

            velocities[ix] += (basePositions[ix] - positions[ix]) * 0.03
            velocities[iy] += (basePositions[iy] - positions[iy]) * 0.03
            velocities[iz] += (basePositions[iz] - positions[iz]) * 0.03
            velocities[ix] *= 0.92; velocities[iy] *= 0.92; velocities[iz] *= 0.92

            positions[ix] += velocities[ix]; positions[iy] += velocities[iy]; positions[iz] += velocities[iz]
        }
        ref.current.geometry.attributes.position.needsUpdate = true
    })

    return (
        <points ref={ref}>
            <bufferGeometry>
                <bufferAttribute attach="attributes-position" count={count} array={currentPositions} itemSize={3} />
            </bufferGeometry>
            <pointsMaterial size={0.04} color="#8899cc" transparent opacity={0.4} depthWrite={false} />
        </points>
    )
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. SIGIL CORRIDOR
// ═════════════════════════════════════════════════════════════════════════════

function makePoly(sides, r) {
    const v = []
    for (let i = 0; i <= sides; i++) {
        const a = (i / sides) * Math.PI * 2 - Math.PI / 2
        v.push(Math.cos(a) * r, Math.sin(a) * r, 0)
    }
    return new Float32Array(v)
}

function makeStar(n, outer, inner) {
    const v = []
    for (let i = 0; i <= n * 2; i++) {
        const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2
        const r = i % 2 === 0 ? outer : inner
        v.push(Math.cos(a) * r, Math.sin(a) * r, 0)
    }
    return new Float32Array(v)
}

function makeTri(r, flip = false) {
    const v = []
    for (let i = 0; i <= 3; i++) {
        const a = (i / 3) * Math.PI * 2 + (flip ? 0 : Math.PI)
        v.push(Math.cos(a) * r, Math.sin(a) * r, 0)
    }
    return new Float32Array(v)
}

const SIGIL_VARIANTS = [
    () => [makePoly(64, 1.3), makeTri(1.0), makeTri(1.0, true)],                          // hexagram + ring
    () => [makePoly(64, 1.3), makeStar(5, 1.0, 0.38)],                                    // pentagram + ring
    () => [makePoly(64, 1.3), makeStar(4, 0.95, 0.38), makePoly(4, 0.5)],                 // octagram + square + ring
    () => [makePoly(64, 1.3), makePoly(6, 0.85), new Float32Array([-1.1, 0, 0, 1.1, 0, 0]), new Float32Array([0, -1.1, 0, 0, 1.1, 0])], // hexagon + cross + ring
    () => [makePoly(64, 1.3), makeTri(0.9), makeTri(0.9, true), makePoly(4, 0.45)],       // hexagram + inner square + ring
]

function Sigil({ variant = 0, position, scale = 1, rotSpeeds = [0.1, 0.15, 0.08], color = '#3366ff' }) {
    const groupRef = useRef()
    const strokes = useMemo(() => SIGIL_VARIANTS[variant % SIGIL_VARIANTS.length](), [variant])

    useFrame((_, delta) => {
        if (!groupRef.current) return
        groupRef.current.rotation.x += rotSpeeds[0] * delta
        groupRef.current.rotation.y += rotSpeeds[1] * delta
        groupRef.current.rotation.z += rotSpeeds[2] * delta
    })

    return (
        <group ref={groupRef} position={position} scale={scale}>
            {strokes.map((pts, i) => (
                <line key={i}>
                    <bufferGeometry>
                        <bufferAttribute attach="attributes-position" args={[pts, 3]} />
                    </bufferGeometry>
                    <lineBasicMaterial color={color} transparent opacity={0.75} toneMapped={false} />
                </line>
            ))}
        </group>
    )
}

// 8 sigils, equal spacing, starting just behind the hero text, receding into fog
const CORRIDOR_COUNT = 8
const CORRIDOR_ZSTART = -8
const CORRIDOR_ZSTEP = 16
// Staggered X/Y for depth impact — equal spacing on Z is the constant
const CORRIDOR_X = [0, -4, 4, -2, 2, -4, 4, 0]
const CORRIDOR_Y = [0, 1, -1, 1.5, -0.5, 0.5, -1.2, 0]
const CORRIDOR_COLORS = ['#4477ff', '#5544ff', '#3366ee', '#6644ff', '#2255dd', '#5566ff', '#4433ee', '#3355ff']

function SigilCorridor() {
    return (
        <group>
            {Array.from({ length: CORRIDOR_COUNT }, (_, i) => (
                <Sigil
                    key={i}
                    variant={i % SIGIL_VARIANTS.length}
                    position={[CORRIDOR_X[i], CORRIDOR_Y[i], CORRIDOR_ZSTART - i * CORRIDOR_ZSTEP]}
                    scale={1.3 - i * 0.04}
                    rotSpeeds={[
                        (0.08 + i * 0.01) * (i % 2 === 0 ? 1 : -1),
                        0.12 + i * 0.01,
                        (0.06 + i * 0.01) * (i % 3 === 0 ? 1 : -1),
                    ]}
                    color={CORRIDOR_COLORS[i]}
                />
            ))}
        </group>
    )
}

// ═════════════════════════════════════════════════════════════════════════════
// 5. COMPONENTS & SECTIONS
// ═════════════════════════════════════════════════════════════════════════════

// ─── Case Study Object — wireframe that solidifies on hover ──────────────────
// ─── Holographic GLB helpers ──────────────────────────────────────────────────

// Recursively mirrors the scene hierarchy but replaces every Mesh with
// LineSegments built from EdgesGeometry — only feature edges, no triangle noise.
function buildEdgesGroup(node, color, mats) {
    const g = new THREE.Group()
    g.matrix.copy(node.matrix)
    g.matrixAutoUpdate = false
    if (node.isMesh) {
        const edges = new THREE.EdgesGeometry(node.geometry, 20)
        const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, toneMapped: false, depthWrite: false })
        g.add(new THREE.LineSegments(edges, mat))
        mats.push(mat)
    }
    for (const child of node.children) g.add(buildEdgesGroup(child, color, mats))
    return g
}

function makeHologramClones(scene, color, targetSize) {
    const box = new THREE.Box3().setFromObject(scene)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const s = targetSize / Math.max(size.x, size.y, size.z, 0.001)

    // Clean edge lines — no triangle mesh noise
    const wireMats = []
    const wire = buildEdgesGroup(scene, color, wireMats)
    wire.scale.setScalar(s)
    wire.position.set(-center.x * s, -center.y * s, -center.z * s)

    // Translucent solid fill shown on hover
    const solid = scene.clone(true)
    solid.scale.setScalar(s)
    solid.position.set(-center.x * s, -center.y * s, -center.z * s)
    const solidMats = []
    solid.traverse(c => {
        if (!c.isMesh) return
        const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4, transparent: true, opacity: 0, roughness: 0.05, metalness: 0.8, side: THREE.DoubleSide, toneMapped: false, depthWrite: false })
        c.material = m; solidMats.push(m)
    })
    return { wire, solid, wireMats, solidMats }
}

// Preserves original GLB textures, adds holographic emissive tint + transparency.
function makeTexturedHologramClone(scene, accentColor, targetSize) {
    const box = new THREE.Box3().setFromObject(scene)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const s = targetSize / Math.max(size.x, size.y, size.z, 0.001)

    const clone = scene.clone(true)
    clone.scale.setScalar(s)
    clone.position.set(-center.x * s, -center.y * s, -center.z * s)

    const mats = []
    clone.traverse(c => {
        if (!c.isMesh || !c.material) return
        const orig = Array.isArray(c.material) ? c.material[0] : c.material
        const m = new THREE.MeshStandardMaterial({
            map: orig.map ?? null,
            normalMap: orig.normalMap ?? null,
            roughnessMap: orig.roughnessMap ?? null,
            metalnessMap: orig.metalnessMap ?? null,
            emissiveMap: orig.map ?? null,
            roughness: orig.roughness ?? 0.6,
            metalness: orig.metalness ?? 0.4,
            emissive: new THREE.Color(accentColor),
            emissiveIntensity: 0.1, // 💡 Reduced glare
            transparent: true,
            opacity: 0,
            toneMapped: false,
        })
        c.material = m
        c.raycast = () => null // 💡 Disable expensive high-poly raycasting
        mats.push(m)
    })
    return { clone, mats }
}

// WiFi arc waves expanding from immobilizer, fading before reaching truck
const _wifiTarget = new THREE.Vector3()
function WifiWaves({ origin, toward, color = '#aa66ff', visible = true }) {
    const COUNT = 4
    const groupRef = useRef()
    const waveRefs = useRef([])
    const phases = useMemo(() => Array.from({ length: COUNT }, (_, i) => i / COUNT), [])

    const mats = useMemo(() => Array.from({ length: COUNT }, () => new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0, side: THREE.DoubleSide, toneMapped: false,
    })), [])

    useFrame((state) => {
        phases.forEach((phase, i) => {
            const mesh = waveRefs.current[i]
            if (!mesh) return
            const p = (state.clock.elapsedTime * 0.35 + phase) % 1
            // Travel from origin toward truck, fade out before arriving
            const fade = p < 0.65 ? Math.sin((p / 0.65) * Math.PI) : 0
            mats[i].opacity = visible ? fade * 0.9 : 0
            // Lerp position along origin→toward
            mesh.position.set(
                origin[0] + (toward[0] - origin[0]) * p,
                origin[1] + (toward[1] - origin[1]) * p,
                origin[2] + (toward[2] - origin[2]) * p,
            )
            const s = visible ? 0.04 + fade * 0.06 : 0
            mesh.scale.setScalar(s)
        })
    })

    return (
        <group>
            {phases.map((_, i) => (
                <mesh key={i} ref={el => waveRefs.current[i] = el} material={mats[i]}>
                    <sphereGeometry args={[1, 8, 8]} />
                </mesh>
            ))}
        </group>
    )
}

function TruckImmobilizerScene({ appeared, cardIndex, onOpen }) {
    const { scene: truckScene } = useGLTF('/Truck.glb')
    const { scene: immScene } = useGLTF('/Engine Immobilizer.glb')

    const truckGroupRef = useRef()
    const immGroupRef = useRef()
    const truckOpRef = useRef(0)
    const immOpRef = useRef(0)
    const autoRotY = useRef(0)

    const { clone: truckClone, mats: truckMats } =
        useMemo(() => makeTexturedHologramClone(truckScene, '#00aaff', 2.2), [truckScene])

    const { clone: immClone, mats: immMats } =
        useMemo(() => makeTexturedHologramClone(immScene, '#aa66ff', 1.0), [immScene])

    useFrame((state, delta) => {
        truckOpRef.current = dampValue(truckOpRef.current, appeared ? 0.5 : 0, 5, delta)
        truckMats.forEach(m => { m.opacity = truckOpRef.current })

        immOpRef.current = dampValue(immOpRef.current, appeared ? 0.9 : 0, 5, delta)
        eiVideoOpRef.current = immOpRef.current
        immMats.forEach(m => { m.opacity = immOpRef.current })

        if (truckGroupRef.current) {
            if (!dragRotState.isDragging || dragRotState.cardIndex !== cardIndex)
                autoRotY.current += delta * 0.22
            truckGroupRef.current.rotation.y = autoRotY.current + dragRotState.rotY[cardIndex]
            truckGroupRef.current.rotation.x = dragRotState.rotX[cardIndex]
        }
        if (immGroupRef.current) immGroupRef.current.lookAt(state.camera.position)
    })

    return (
        <group onClick={e => { e.stopPropagation(); onOpen?.() }}>
            {/* Truck — textured hologram, center-left */}
            <group ref={truckGroupRef} position={[0, -0.3, 0.9]}>
                <primitive object={truckClone} />
            </group>

            {/* Engine Immobilizer — textured hologram, upper-right */}
            <group ref={immGroupRef} position={[1.6, 0.9, 0.3]}>
                <primitive object={immClone} />
                <pointLight color="#aa66ff" intensity={appeared ? 2.5 : 0} distance={4} decay={2} />
            </group>

            {/* WiFi waves — signal radiating from immobilizer toward truck */}
            <WifiWaves
                origin={[1.6, 0.9, 0.3]}
                toward={[0, -0.3, 0.9]}
                color="#aa66ff"
                visible={appeared}
            />
            {/* Simple Box Hitbox for entire scene optimization */}
            <mesh visible={false}>
                <boxGeometry args={[4.5, 3.5, 4.5]} />
            </mesh>
        </group>
    )
}


// Module-level refs so VideoScreen can be lifted outside <Select enabled>
// and WorkflowsScene can still drive its opacity.
const wfVideoOpRef = { current: 0 }
const eiVideoOpRef = { current: 0 }

function VideoScreen({
    src = "/demos/wf-noborder.mp4",
    opRef = wfVideoOpRef,
    buildText = "2023",
    buildUrl = "https://github.com/moosefroggo/portfolio-2026/commit/7bf4176",
    cornerLabel = "SIG 4/5",
    footerLabel = "$1M Customer Acquired",
    colorHex = "#44ff88",
    colorRgb = "68,255,136",
    onOpen = null,
}) {
    const containerRef = useRef()
    const videoRef = useRef()

    useFrame(() => {
        if (containerRef.current && opRef) containerRef.current.style.opacity = opRef.current
    })

    // Defer video loading: only set src once opacity becomes non-zero
    const videoLoadedRef = useRef(false)
    useFrame(() => {
        if (videoLoadedRef.current || !videoRef.current || !opRef) return
        if (opRef.current > 0.01) {
            videoRef.current.src = src
            videoRef.current.load()
            videoRef.current.play().catch(() => { })
            videoLoadedRef.current = true
        }
    })

    return (
        <group position={[3.4, 0.15, 0.9]} rotation={[0, -0.42, 0]}>
            <Html transform occlude={false} style={{ pointerEvents: onOpen ? 'auto' : 'none' }} distanceFactor={3.5}>
                <div ref={containerRef} onClick={onOpen ?? undefined} style={{ opacity: 0, fontFamily: "'Space Mono', monospace", userSelect: 'none', width: '262px', cursor: onOpen ? 'pointer' : 'default' }}>
                    <style>{`
                        @keyframes hud-blink { 0%,100%{opacity:1} 50%{opacity:0} }
                        @keyframes hud-scan  { 0%{top:-15%} 100%{top:115%} }
                        .hud-dot  { animation: hud-blink 1.1s step-end infinite }
                        .hud-scan { position:absolute;left:0;right:0;height:20%;
                            animation:hud-scan 2.8s linear infinite;pointer-events:none }
                    `}</style>

                    {/* ── Header ── */}
                    <div style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '5px 9px',
                        background: `rgba(${colorRgb},0.07)`,
                        border: `1px solid rgba(${colorRgb},0.35)`,
                        borderBottom: 'none',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 8, letterSpacing: '0.15em', color: colorHex }}>
                            <span className="hud-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: colorHex, display: 'inline-block' }} />
                            CASE STUDY
                        </div>
                        <a href={buildUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 8, color: `rgba(${colorRgb},0.55)`, letterSpacing: '0.1em', textDecoration: 'none', cursor: 'pointer' }} onMouseOver={e => e.target.style.color = colorHex} onMouseOut={e => e.target.style.color = `rgba(${colorRgb},0.55)`}>{buildText}</a>
                    </div>

                    {/* ── Video feed ── */}
                    <div style={{
                        position: 'relative', lineHeight: 0, overflow: 'hidden',
                        border: `1px solid rgba(${colorRgb},0.35)`, borderTop: 'none', borderBottom: 'none'
                    }}>
                        <video ref={videoRef} loop muted playsInline
                            style={{
                                width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block',
                                filter: 'contrast(1.05) brightness(0.88)'
                            }} />

                        {/* Scanlines */}
                        <div style={{
                            position: 'absolute', inset: 0, pointerEvents: 'none',
                            background: 'repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.13) 2px,rgba(0,0,0,0.13) 3px)'
                        }} />
                        {/* Moving sweep */}
                        <div className="hud-scan" style={{ background: `linear-gradient(to bottom,transparent,rgba(${colorRgb},0.05),transparent)` }} />

                        {/* Corner brackets */}
                        {[
                            { top: 6, left: 6, borderTop: `2px solid ${colorHex}`, borderLeft: `2px solid ${colorHex}` },
                            { top: 6, right: 6, borderTop: `2px solid ${colorHex}`, borderRight: `2px solid ${colorHex}` },
                            { bottom: 6, left: 6, borderBottom: `2px solid ${colorHex}`, borderLeft: `2px solid ${colorHex}` },
                            { bottom: 6, right: 6, borderBottom: `2px solid ${colorHex}`, borderRight: `2px solid ${colorHex}` },
                        ].map((s, i) => (
                            <div key={i} style={{ position: 'absolute', width: 12, height: 12, pointerEvents: 'none', ...s }} />
                        ))}

                        {/* Top-right label */}
                        <div style={{
                            position: 'absolute', top: 9, right: 22, fontSize: 7,
                            color: `rgba(${colorRgb},0.65)`, letterSpacing: '0.12em'
                        }}>{cornerLabel}</div>
                    </div>

                    {/* ── Footer ── */}
                    <div style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '4px 9px',
                        background: `rgba(${colorRgb},0.04)`,
                        border: `1px solid rgba(${colorRgb},0.35)`,
                        borderTop: 'none',
                    }}>
                        <span style={{ fontSize: 7, color: `rgba(${colorRgb},0.5)`, letterSpacing: '0.1em' }}>{footerLabel}</span>
                        <span className="hud-dot" style={{ fontSize: 7, color: `rgba(${colorRgb},0.65)`, letterSpacing: '0.1em' }}>● REC</span>
                    </div>
                </div>
            </Html>
        </group>
    )
}

// ─── Brain hologram sub-components ──────────────────────────────────────────

function BrainPlatform({ opRef }) {
    const { boxMat, hexMat, edgeMat, traceMat } = useMemo(() => ({
        boxMat: new THREE.MeshStandardMaterial({
            color: '#c2d4e6', metalness: 0.92, roughness: 0.06, transparent: true, opacity: 0,
        }),
        hexMat: new THREE.MeshStandardMaterial({
            color: '#001133', emissive: new THREE.Color('#00ccff'), emissiveIntensity: 2.8,
            metalness: 0.8, roughness: 0.1, transparent: true, opacity: 0, toneMapped: false,
        }),
        edgeMat: new THREE.LineBasicMaterial({ color: new THREE.Color(0, 0.8, 1.0), transparent: true, opacity: 0 }),
        traceMat: new THREE.LineBasicMaterial({ color: new THREE.Color(0, 0.55, 0.85), transparent: true, opacity: 0 }),
    }), [])

    useFrame(() => {
        const op = opRef.current
        boxMat.opacity = op; hexMat.opacity = op; edgeMat.opacity = op; traceMat.opacity = op
    })

    const { boxGeo, edgeGeo, hexGeo, traceGeo } = useMemo(() => {
        const box = new THREE.BoxGeometry(3.2, 0.3, 3.2)
        const pts = new Float32Array([
            -1.1, 0.152, 0.35, -0.55, 0.152, 0.35,
            -0.55, 0.152, 0.35, -0.55, 0.152, 0.0,
            1.1, 0.152, -0.35, 0.55, 0.152, -0.35,
            0.55, 0.152, -0.35, 0.55, 0.152, 0.0,
            -0.3, 0.152, 1.1, -0.3, 0.152, 0.5,
            -0.3, 0.152, 0.5, 0.3, 0.152, 0.5,
            0.3, 0.152, 0.5, 0.3, 0.152, 1.1,
            -0.55, 0.152, 0.31, -0.55, 0.152, 0.39,
            0.55, 0.152, -0.31, 0.55, 0.152, -0.39,
        ])
        const traceGeo = new THREE.BufferGeometry()
        traceGeo.setAttribute('position', new THREE.BufferAttribute(pts, 3))
        return { boxGeo: box, edgeGeo: new THREE.EdgesGeometry(box), hexGeo: new THREE.CylinderGeometry(0.17, 0.17, 0.1, 6), traceGeo }
    }, [])

    return (
        <group>
            <mesh geometry={boxGeo} material={boxMat} />
            <lineSegments geometry={edgeGeo} material={edgeMat} />
            <lineSegments geometry={traceGeo} material={traceMat} />
            {[[1.1, 0.2, 1.1], [-1.1, 0.2, 1.1], [1.1, 0.2, -1.1], [-1.1, 0.2, -1.1]].map((pos, i) => (
                <mesh key={i} geometry={hexGeo} material={hexMat} position={pos} />
            ))}
        </group>
    )
}

// per-wire pulse params: [speed, phase, baseIntensity, amplitude]
const WIRE_PULSE = [
    [1.1, 0.0, 3.2, 1.4],  // center — bright, steady
    [1.7, 0.8, 1.6, 2.2],  // front-right — fast flicker
    [1.3, 2.1, 2.4, 1.6],  // front-left  — medium
    [0.9, 1.4, 1.0, 2.8],  // back-right  — slow deep pulse
    [2.2, 3.0, 1.8, 1.2],  // back-left   — fastest, subtle
    [0.7, 0.5, 0.8, 1.8],  // trailing 1  — dim, slow fade
    [1.9, 1.8, 0.6, 2.4],  // trailing 2  — erratic flicker
    [1.2, 3.5, 1.1, 1.5],  // trailing 3  — medium dim
    [0.5, 2.2, 0.5, 1.0],  // trailing 4  — barely alive
]

function BrainWires({ opRef }) {
    const { tubes, mats } = useMemo(() => {
        const wireDefs = [
            // center — slight lazy droop
            [new THREE.Vector3(0, 1.82, 0.0), new THREE.Vector3(0.12, 0.95, 0.12), new THREE.Vector3(0, 0.25, 0.0)],
            // front-right — heavy droop, midpoint close to center
            [new THREE.Vector3(1.1, 0.26, 1.1), new THREE.Vector3(0.18, 0.55, 0.18), new THREE.Vector3(0.18, 1.72, 0.18)],
            // front-left — medium droop
            [new THREE.Vector3(-1.1, 0.26, 1.1), new THREE.Vector3(-0.35, 0.70, 0.35), new THREE.Vector3(-0.18, 1.72, 0.18)],
            // back-right — light droop, stays fairly taut
            [new THREE.Vector3(1.1, 0.26, -1.1), new THREE.Vector3(0.60, 0.88, -0.60), new THREE.Vector3(0.18, 1.72, -0.18)],
            // back-left — very heavy droop, almost touches platform midway
            [new THREE.Vector3(-1.1, 0.26, -1.1), new THREE.Vector3(-0.10, 0.38, -0.10), new THREE.Vector3(-0.18, 1.72, -0.18)],
            // trailing wires — arc over platform edges and dangle below
            [new THREE.Vector3(0.10, 1.65, 0.05), new THREE.Vector3(1.0, 0.5, 0.05), new THREE.Vector3(1.9, 0.05, 0.1), new THREE.Vector3(2.4, -1.2, 0.3)],
            [new THREE.Vector3(-0.05, 1.60, 0.15), new THREE.Vector3(-0.1, 0.5, 1.0), new THREE.Vector3(0.1, 0.05, 2.1), new THREE.Vector3(-0.2, -1.4, 2.4)],
            [new THREE.Vector3(0.15, 1.58, -0.10), new THREE.Vector3(0.1, 0.5, -1.0), new THREE.Vector3(-0.1, 0.05, -2.1), new THREE.Vector3(0.3, -1.6, -2.4)],
            [new THREE.Vector3(-0.08, 1.70, -0.05), new THREE.Vector3(-1.0, 0.5, -0.05), new THREE.Vector3(-2.1, 0.05, -0.1), new THREE.Vector3(-2.4, -1.0, -0.4)],
        ]
        const mats = wireDefs.map(() => new THREE.MeshStandardMaterial({
            color: '#001133', emissive: new THREE.Color('#00aaff'), emissiveIntensity: 2.2,
            metalness: 0.5, roughness: 0.3, transparent: true, opacity: 0, toneMapped: false,
        }))
        return { mats, tubes: wireDefs.map(p => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(p), 12, 0.022, 5, false)) }
    }, [])

    useFrame((state) => {
        if (!inProjects()) return
        const t = state.clock.elapsedTime
        mats.forEach((m, i) => {
            const [speed, phase, base, amp] = WIRE_PULSE[i]
            m.opacity = 0.88
            m.emissiveIntensity = base + Math.sin(t * speed + phase) * amp
        })
    })

    return (
        <group>
            {tubes.map((geo, i) => <mesh key={i} geometry={geo} material={mats[i]} />)}
        </group>
    )
}

// ─── Workflows card 3D scene ─────────────────────────────────────────────────

function WorkflowsScene({ hovered, appeared, cardIndex, onOpen }) {
    const { scene: brainScene } = useGLTF('/brain_hologram.glb')
    const groupRef = useRef()
    const opRef = useRef(0)
    const autoRotY = useRef(0)

    const { clone: brainClone, mats: brainMats } =
        useMemo(() => makeTexturedHologramClone(brainScene, '#00ccff', 2.2), [brainScene])

    useFrame((state, delta) => {
        opRef.current = dampValue(opRef.current, appeared ? 0.88 : 0, 5, delta)
        wfVideoOpRef.current = opRef.current
        const op = opRef.current
        const pulse = 0.14 + Math.sin(state.clock.elapsedTime * 1.8) * 0.07
        brainMats.forEach(m => { m.opacity = op; m.emissiveIntensity = pulse })
        if (groupRef.current) {
            if (!dragRotState.isDragging || dragRotState.cardIndex !== cardIndex)
                autoRotY.current += delta * 0.18
            groupRef.current.rotation.y = autoRotY.current + dragRotState.rotY[cardIndex]
            groupRef.current.rotation.x = dragRotState.rotX[cardIndex]
        }
    })

    return (
        <group onClick={e => { e.stopPropagation(); onOpen?.() }}>
            <group ref={groupRef} position={[0, -1, -0.5]} scale={0.55}>
                <BrainPlatform opRef={opRef} />
                <BrainWires opRef={opRef} />
                <group position={[0, 1.85, 0]}>
                    <primitive object={brainClone} />
                </group>
                <pointLight color="#00ccff" intensity={appeared ? 1.8 : 0} distance={7} decay={2} position={[0, 1.5, 0]} />
                <pointLight color="#ffffff" intensity={appeared ? 0.6 : 0} distance={5} decay={2} position={[0, 2.5, 2]} />
                {/* Simple Box Hitbox for Brain assembly optimization */}
                <mesh visible={false} position={[0, 1.8, 0]}>
                    <boxGeometry args={[4, 4, 4]} />
                </mesh>
            </group>
        </group>
    )
}


function CaseStudyObject({ objectType, color, hovered, appeared, cardIndex, onOpen }) {
    const meshRef = useRef()
    const wireRef = useRef()
    const pulseRef = useRef()
    const solidOpacityRef = useRef(0)
    const wireOpacityRef = useRef(0)
    const autoRotX = useRef(0)
    const autoRotY = useRef(0)

    const geometry = useMemo(() => {
        switch (objectType) {
            case 'octahedron': return new THREE.OctahedronGeometry(1.4, 0)
            case 'torus': return new THREE.TorusGeometry(1.1, 0.38, 16, 48)
            case 'icosahedron': return new THREE.IcosahedronGeometry(1.3, 1)
            default: return new THREE.OctahedronGeometry(1.4, 0)
        }
    }, [objectType])

    useFrame((_, delta) => {
        if (!meshRef.current || !wireRef.current) return
        const speed = hovered ? 2.2 : 1.0
        if (!dragRotState.isDragging || dragRotState.cardIndex !== cardIndex) {
            autoRotX.current += delta * 0.003 * speed
            autoRotY.current += delta * 0.007 * speed
        }
        const finalX = autoRotX.current + dragRotState.rotX[cardIndex]
        const finalY = autoRotY.current + dragRotState.rotY[cardIndex]
        meshRef.current.rotation.x = finalX
        meshRef.current.rotation.y = finalY
        wireRef.current.rotation.x = finalX
        wireRef.current.rotation.y = finalY

        solidOpacityRef.current = dampValue(solidOpacityRef.current, hovered ? 0.72 : 0.0, 5, delta)
        wireOpacityRef.current = dampValue(wireOpacityRef.current, hovered ? 0.25 : (appeared ? 0.85 : 0.0), 5, delta)

        meshRef.current.material.opacity = solidOpacityRef.current
        meshRef.current.visible = solidOpacityRef.current > 0.01
        wireRef.current.material.opacity = wireOpacityRef.current

        if (pulseRef.current) {
            pulseRef.current.rotation.x += delta * 1.1
            pulseRef.current.rotation.z += delta * 0.7
            pulseRef.current.material.opacity = dampValue(pulseRef.current.material.opacity, hovered ? 0.6 : 0.0, 6, delta)
        }
    })

    if (objectType === 'truck_immobilizer') {
        return <TruckImmobilizerScene hovered={hovered} appeared={appeared} cardIndex={cardIndex} onOpen={onOpen} />
    }
    if (objectType === 'workflows') {
        return <WorkflowsScene hovered={hovered} appeared={appeared} cardIndex={cardIndex} onOpen={onOpen} />
    }

    return (
        <group onClick={e => { e.stopPropagation(); onOpen?.() }}>
            <mesh ref={wireRef} geometry={geometry}>
                <meshBasicMaterial color={color} wireframe transparent opacity={0} toneMapped={false} />
            </mesh>
            <mesh ref={meshRef} geometry={geometry} visible={false}>
                <meshStandardMaterial color={color} transparent opacity={0} roughness={0.1} metalness={0.9} emissive={color} emissiveIntensity={0.3} toneMapped={false} side={THREE.DoubleSide} />
            </mesh>
            <mesh ref={pulseRef}>
                <torusGeometry args={[1.9, 0.015, 8, 64]} />
                <meshBasicMaterial color={color} transparent opacity={0} toneMapped={false} />
            </mesh>
            <pointLight color={color} intensity={appeared ? 3 : 0} distance={8} decay={2} />
        </group>
    )
}

// ─── HUD data panel — diegetic readout floating in 3D ────────────────────────
function HudLine({ x1, y1, z1, x2, y2, z2, color, opacity = 1 }) {
    return (
        <Line points={[[x1, y1, z1], [x2, y2, z2]]} color={color} lineWidth={0.8} transparent opacity={opacity} toneMapped={false} />
    )
}

function HudPanel({ stats, tech, color, appeared, side = 'left' }) {
    const groupRef = useRef()
    const opacityRef = useRef(0)
    const matsRef = useRef([])

    useFrame((_, delta) => {
        if (!groupRef.current) return
        if (matsRef.current.length === 0)
            groupRef.current.traverse(child => { if (child.material) matsRef.current.push(child.material) })
        opacityRef.current = dampValue(opacityRef.current, appeared ? 1 : 0, 4, delta)
        const op = opacityRef.current
        matsRef.current.forEach(m => { m.opacity = op })
    })

    const xPos = (side === 'left' ? -1 : 1) * 4
    const anchor = side === 'left' ? 'left' : 'right'

    return (
        <group ref={groupRef} position={[xPos, 0, 0.1]}>
            <Text position={[0, 0.65, 0]} font="/fonts/Rocket%20Command/rocketcommandexpand.ttf" fontSize={0.09} color="#4466aa" anchorX={anchor} letterSpacing={0.12} material-toneMapped={false} material-transparent={true} material-opacity={0}>ROLE ──────────────────</Text>
            <Text position={[0, 0.48, 0]} font="/fonts/Rocket%20Command/rocketcommandexpand.ttf" fontSize={0.14} color={color} anchorX={anchor} letterSpacing={0.08} material-toneMapped={false} material-transparent={true} material-opacity={0}>{stats.role}</Text>
            <Text position={[0, 0.18, 0]} font="/fonts/Rocket%20Command/rocketcommandexpand.ttf" fontSize={0.09} color="#4466aa" anchorX={anchor} letterSpacing={0.12} material-toneMapped={false} material-transparent={true} material-opacity={0}>YEAR ──────────────────</Text>
            <Text position={[0, 0.02, 0]} font="/fonts/Rocket%20Command/rocketcommandexpand.ttf" fontSize={0.14} color={color} anchorX={anchor} letterSpacing={0.08} material-toneMapped={false} material-transparent={true} material-opacity={0}>{stats.year}</Text>
            <Text position={[0, -0.28, 0]} font="/fonts/Rocket%20Command/rocketcommandexpand.ttf" fontSize={0.09} color="#4466aa" anchorX={anchor} letterSpacing={0.12} material-toneMapped={false} material-transparent={true} material-opacity={0}>Company ─────────────────</Text>
            <Text position={[0, -0.44, 0]} font="/fonts/Rocket%20Command/rocketcommandexpand.ttf" fontSize={0.14} color={color} anchorX={anchor} letterSpacing={0.08} material-toneMapped={false} material-transparent={true} material-opacity={0}>{stats.company}</Text>
            <Text position={[0, -0.74, 0]} font="/fonts/Rocket%20Command/rocketcommandexpand.ttf" fontSize={0.085} color="#334466" anchorX={anchor} letterSpacing={0.1} material-toneMapped={false} material-transparent={true} material-opacity={0}>{tech.join('  ·  ')}</Text>
        </group>
    )
}

// ─── Targeting reticle — L-brackets that lock in on hover ────────────────────
function LBracket({ position, flipX, flipY, color }) {
    const sx = flipX ? -1 : 1
    const sy = flipY ? -1 : 1
    return (
        <group position={position}>
            <HudLine x1={0} y1={0} z1={0} x2={sx * 0.35} y2={0} z2={0} color={color} />
            <HudLine x1={0} y1={0} z1={0} x2={0} y2={sy * 0.35} z2={0} color={color} />
        </group>
    )
}

function TargetingReticle({ hovered, appeared, color, radius = 2.0 }) {
    const groupRef = useRef()
    const scaleRef = useRef(1.6)
    const opacityRef = useRef(0)
    const matsRef = useRef([])

    useFrame((_, delta) => {
        if (!groupRef.current) return
        if (matsRef.current.length === 0)
            groupRef.current.traverse(child => { if (child.material) matsRef.current.push(child.material) })
        scaleRef.current = dampValue(scaleRef.current, hovered ? 1.0 : 1.6, 7, delta)
        opacityRef.current = dampValue(opacityRef.current, appeared ? (hovered ? 1.0 : 0.35) : 0.0, 5, delta)
        groupRef.current.scale.setScalar(scaleRef.current)
        const op = opacityRef.current
        matsRef.current.forEach(m => { m.opacity = op })
    })

    const r = radius
    return (
        <group ref={groupRef}>
            <LBracket position={[-r, r, 0.1]} flipX={false} flipY={false} color={color} />
            <LBracket position={[r, r, 0.1]} flipX={true} flipY={false} color={color} />
            <LBracket position={[-r, -r, 0.1]} flipX={false} flipY={true} color={color} />
            <LBracket position={[r, -r, 0.1]} flipX={true} flipY={true} color={color} />
            <HudLine x1={-0.08} y1={0} z1={0.1} x2={-0.02} y2={0} z2={0.1} color={color} />
            <HudLine x1={0.02} y1={0} z1={0.1} x2={0.08} y2={0} z2={0.1} color={color} />
            <HudLine x1={0} y1={-0.08} z1={0.1} x2={0} y2={-0.02} z2={0.1} color={color} />
            <HudLine x1={0} y1={0.02} z1={0.1} x2={0} y2={0.08} z2={0.1} color={color} />
        </group>
    )
}

// ─── Scan line reveal ─────────────────────────────────────────────────────────
function ScanReveal({ color, active, onComplete }) {
    const meshRef = useRef()
    const progressRef = useRef(-2.5)
    const doneRef = useRef(false)

    useFrame((_, delta) => {
        if (!meshRef.current || doneRef.current || !active) return
        progressRef.current += delta * 4.5
        meshRef.current.position.y = progressRef.current
        const opacity = progressRef.current > 2.2 ? Math.max(0, 1 - (progressRef.current - 2.2) * 6) : 1.0
        meshRef.current.material.opacity = opacity * 0.55
        if (progressRef.current > 2.8) {
            doneRef.current = true
            meshRef.current.visible = false
            onComplete?.()
        }
    })

    return (
        <mesh ref={meshRef} position={[0, -2.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[12, 0.04]} />
            <meshBasicMaterial color={color} transparent opacity={0} toneMapped={false} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
    )
}

// ─── Project zone grid — fills void behind cards ──────────────────────────────
function NexusHubCore({ scrollRef }) {
    const groupRef = useRef()
    const coreRef = useRef()
    const ringsRef = useRef([])

    useFrame((state, delta) => {
        if (!groupRef.current) return
        const t = scrollRef.current ?? 0
        const active = t >= 0.32 && t <= 0.88
        groupRef.current.visible = active

        if (active) {
            coreRef.current.rotation.y += delta * 0.4
            coreRef.current.rotation.z += delta * 0.2

            ringsRef.current.forEach((ring, i) => {
                if (!ring) return
                ring.rotation.x += delta * (0.15 * (i + 1))
                ring.rotation.y += delta * (0.1 * (i + 1))
            })
        }
    })

    return (
        <group ref={groupRef} position={[170, 5.5, -195]}>
            <mesh ref={coreRef}>
                <sphereGeometry args={[4, 32, 32]} />
                <meshStandardMaterial color="#00aaff" emissive="#00aaff" emissiveIntensity={4} wireframe transparent opacity={0.4} />
            </mesh>
            {[5.5, 7.5, 10].map((radius, i) => (
                <mesh key={i} ref={el => ringsRef.current[i] = el}>
                    <torusGeometry args={[radius, 0.04, 16, 100]} />
                    <meshStandardMaterial color="#44ff88" emissive="#44ff88" emissiveIntensity={1.5} transparent opacity={0.2} />
                </mesh>
            ))}
            <pointLight intensity={40} color="#00aaff" distance={30} decay={2} />
        </group>
    )
}

function NexusDataStreams({ scrollRef }) {
    const count = 50 // 📉 Lower density
    const meshRef = useRef()
    const dummy = useMemo(() => new THREE.Object3D(), [])
    const particles = useMemo(() => {
        return Array.from({ length: 50 }, () => ({
            pos: new THREE.Vector3(
                90 + Math.random() * 60,
                -15 + Math.random() * 30,
                -15 + Math.random() * 25
            ),
            speed: 0.02 + Math.random() * 0.04,
            scale: 0.01 + Math.random() * 0.02 // 🤏 5x smaller
        }))
    }, [])

    useFrame((state, delta) => {
        if (!meshRef.current) return
        const t = scrollRef.current ?? 0
        const isVisible = t >= 0.32 && t <= 0.88
        meshRef.current.visible = isVisible

        if (isVisible) {
            particles.forEach((p, i) => {
                p.pos.y += p.speed
                if (p.pos.y > 15) p.pos.y = -15

                dummy.position.copy(p.pos)
                dummy.scale.setScalar(p.scale * (1 + Math.sin(state.clock.elapsedTime * 2 + i) * 0.3))
                dummy.updateMatrix()
                meshRef.current.setMatrixAt(i, dummy.matrix)
            })
            meshRef.current.instanceMatrix.needsUpdate = true
        }
    })

    return (
        <instancedMesh ref={meshRef} args={[null, null, count]}>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial color="#44ff88" emissive="#44ff88" emissiveIntensity={3} transparent opacity={0.4} />
        </instancedMesh>
    )
}

function ProjectPedestal({ color, appeared }) {
    return (
        <group position={[0, -1, 0]} scale={appeared ? 1 : 0}>
            <mesh rotation-x={-Math.PI / 2}>
                <cylinderGeometry args={[2.8, 2.8, 0.15, 32]} />
                <meshStandardMaterial color={color} transparent opacity={0.08} metalness={1} roughness={0.1} />
            </mesh>
            {/* Inner glowing ring */}
            <mesh rotation-x={-Math.PI / 2} position={[0, 0.08, 0]}>
                <ringGeometry args={[2.7, 2.8, 64]} />
                <meshStandardMaterial color={color} emissive={color} emissiveIntensity={5} transparent opacity={0.6} toneMapped={false} />
            </mesh>
            {/* Subtle base glow */}
            <pointLight position={[0, 0.5, 0]} intensity={8} color={color} distance={4} decay={2} />
        </group>
    )
}

function NexusDataThreads({ scrollRef }) {
    const groupRef = useRef()
    const threads = useMemo(() => [
        { start: [100, 0, 0], end: [120, 1.5, -32] },
        { start: [120, -0.5, 0], end: [120, 1.5, -32] }
    ], [])

    useFrame((_, delta) => {
        if (!groupRef.current) return
        const t = scrollRef.current ?? 0
        groupRef.current.visible = t >= 0.32 && t <= 0.88
    })

    return (
        <group ref={groupRef}>
            {threads.map((p, i) => (
                <Line key={i} points={[p.start, p.end]} color="#00aaff" lineWidth={0.15} transparent opacity={0.15} toneMapped={false} />
            ))}
        </group>
    )
}

function ProjectZoneGrid({ scrollRef }) {
    const groupRef = useRef()
    const opacityRef = useRef(0)
    const matsRef = useRef([]) // [{mat, dim}]

    const lines = useMemo(() => {
        const pts = []
        const xMin = 88, xMax = 155, zMin = -7, zMax = 7
        for (const y of [-3.5, 3.5]) {
            for (let z = zMin; z <= zMax; z += 4) pts.push({ p1: [xMin, y, z], p2: [xMax, y, z], dim: true })
            for (let x = xMin; x <= xMax; x += 8) pts.push({ p1: [x, y, zMin], p2: [x, y, zMax], dim: false })
        }
        for (const x of [100, 120, 140]) {
            for (const z of [zMin, zMax]) pts.push({ p1: [x, -3.5, z], p2: [x, 3.5, z], dim: false })
        }
        return pts
    }, [])

    useFrame((state, delta) => {
        if (!groupRef.current) return
        if (matsRef.current.length === 0)
            groupRef.current.traverse(child => { if (child.material) matsRef.current.push({ mat: child.material, dim: !!child.userData.dim }) })
        const t = scrollRef.current ?? 0
        opacityRef.current = dampValue(opacityRef.current, (t >= 0.32 && t <= 0.88) ? 1 : 0, 3, delta)
        const op = opacityRef.current

        // Scan pulse effect
        const pulse = Math.sin(state.clock.elapsedTime * 0.8) * 0.5 + 0.5
        matsRef.current.forEach(({ mat, dim }) => {
            mat.opacity = op * (dim ? 0.03 : 0.08) + (pulse * 0.05 * op)
        })
    })

    return (
        <group ref={groupRef}>
            {lines.map((l, i) => (
                <Line key={i} points={[l.p1, l.p2]} color="#00aaff" lineWidth={0.3} transparent opacity={0} toneMapped={false} userData={{ dim: l.dim }} />
            ))}
            {/* Haze shifted down to the floor level (was accidentally at Y=0) */}
            <mesh position={[120, -3.4, -5]} rotation-x={-Math.PI / 2}>
                <planeGeometry args={[70, 20]} />
                <meshStandardMaterial color="#001144" transparent opacity={0.1 * opacityRef.current} />
            </mesh>
        </group>
    )
}

// ─── Project card — full assembly ─────────────────────────────────────────────
function ProjectCard({ config, scrollRef, cardIndex, onOpen }) {
    const isMobile = typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches
    const [hovered, setHovered] = useState(false)
    const [appeared, setAppeared] = useState(false)
    const [scanActive, setScanActive] = useState(false)
    const scanFiredRef = useRef(false)

    const groupRef = useRef()
    useFrame((state, delta) => {
        if (!inProjects()) return
        const t = scrollRef?.current ?? 0
        if (!scanFiredRef.current && t >= config.appear - 0.015) {
            scanFiredRef.current = true
            setScanActive(true)
        }
        if (groupRef.current) {
            // Base scale 1.0, but when hovered add a subtle 1.0 -> 1.04 sine pulse
            const targetScale = hovered ? 1.02 + Math.sin(state.clock.elapsedTime * 4) * 0.02 : 1.0
            groupRef.current.scale.setScalar(dampValue(groupRef.current.scale.x, targetScale, 4, delta))
        }
    })

    return (
        <group
            ref={groupRef}
            position={config.pos}
            rotation={config.rot}
            onPointerOver={e => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer'; sfx.piano() }}
            onPointerOut={() => { setHovered(false); document.body.style.cursor = 'auto' }}
            onClick={e => { e.stopPropagation(); onOpen?.() }}
        >
            <ProjectPedestal color={config.color} appeared={appeared} />
            <CaseStudyObject objectType={config.objectType} color={config.color} hovered={hovered} appeared={appeared} cardIndex={cardIndex} onOpen={onOpen} />
            <TargetingReticle hovered={hovered} appeared={appeared} color={config.color} radius={2.0} />
            <ScanReveal color={config.color} active={scanActive} onComplete={() => setAppeared(true)} />
            {!isMobile && <HudPanel stats={config.stats} tech={config.tech} color={config.color} appeared={appeared} side="left" />}

            {!isMobile && <Text position={[0, 2.15, 0.1]} font="/fonts/Rocket%20Command/rocketcommandexpand.ttf" fontSize={0.45} anchorX="center" anchorY="middle" letterSpacing={0.05} color={config.color} material-toneMapped={false} material-transparent={true} material-opacity={appeared ? 1 : 0}>{config.title}</Text>}
            {!isMobile && <Text position={[0, 1.75, 0.1]} font="/fonts/Space_Mono/SpaceMono-Regular.ttf" fontSize={0.1} color="#8899dd" anchorX="center" anchorY="middle" letterSpacing={0.05} textAlign="center" material-toneMapped={false} material-transparent={true} material-opacity={appeared ? 1 : 0} maxWidth={4.5} lineHeight={1.5}>{config.subtitle}</Text>}

            {!isMobile && appeared && <HudLine x1={-2.2} y1={-2.55} z1={0} x2={2.2} y2={-2.55} z2={0} color={config.color} opacity={0.3} />}
        </group>
    )
}

// Scratch objects — module-level so they're shared (useFrame runs sequentially, never in parallel)
const _wslMorphPos = new THREE.Vector3()
const _wslFlat = new THREE.Vector3()
const _wslFallback = new THREE.Vector3()
const _wslCamQuat = new THREE.Quaternion()
const _wslFwdQuat = new THREE.Quaternion()

function WritingSpineLetter({ points, sourceGeometry, material, position = [0, 0, 0], delay = 0, cogScale = 0.72, isHighlighted = false, highlightRotation = 0 }) {
    const instancedRef = useRef()
    const offsetRef = useRef(0)
    const drawProgressRef = useRef(1)  // Cogs visible from the start (for macro shot)
    const dummyMatrix = useMemo(() => new THREE.Object3D(), [])
    const hovInstRef = useRef(-1)
    const spreadOffsetsRef = useRef([])
    const frameCountRef = useRef(0)
    const lastEnterFrameRef = useRef(-100)
    const prevHovInstRef = useRef(-1)
    const rotationAxesRef = useRef([])  // Random axes per cog
    const CACHE_STEPS = 128

    const { count, posCache, tanCache, centerP } = useMemo(() => {
        if (!sourceGeometry) return { count: 0, posCache: [], tanCache: [], centerP: new THREE.Vector3() }
        const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5)

        sourceGeometry.computeBoundingBox()
        const size = new THREE.Vector3()
        sourceGeometry.boundingBox.getSize(size)
        const linkLength = Math.max(size.x, size.y, size.z)
        const c = Math.ceil(curve.getLength() / (linkLength + 0.05))

        const pc = []
        const tc = []
        const bMin = new THREE.Vector3(Infinity, Infinity, Infinity)
        const bMax = new THREE.Vector3(-Infinity, -Infinity, -Infinity)

        for (let i = 0; i <= CACHE_STEPS; i++) {
            const t = i / CACHE_STEPS
            const pt = curve.getPointAt(t)
            pc.push(pt)
            tc.push(curve.getTangentAt(t))
            bMin.min(pt)
            bMax.max(pt)
        }

        // Calculate centerP using the bounding box of the points, not the curve midpoint
        const cp = new THREE.Vector3().addVectors(bMin, bMax).multiplyScalar(0.5)

        return { count: c, posCache: pc, tanCache: tc, centerP: cp }
    }, [points, sourceGeometry])

    const { progress, active: loadingActive } = useProgress()

    useFrame((state, delta) => {
        if (!inHero()) return
        const instanced = instancedRef.current
        if (!instanced || count === 0) return

        // Clear hover if no instance reported pointer-over in the last 2 frames
        frameCountRef.current++
        if (frameCountRef.current - lastEnterFrameRef.current > 2) hovInstRef.current = -1

        // Read morph progress directly from camera — always in sync
        const morphProgress = heroIntroState.morphProgress || 0
        const isMorphing = morphProgress > 0.001

        // Let the cogs continuously flow along the spine - DISABLED per user request
        // offsetRef.current += delta * 0.15

        const SPREAD_RADIUS = 8
        const SPREAD_STRENGTH = 0.85
        const hovIdx = hovInstRef.current

        const spacing = 1 / count
        for (let i = 0; i < count; i++) {
            // Initialize random rotation axes if needed
            if (!rotationAxesRef.current[i]) {
                const axis = new THREE.Vector3(
                    Math.random() - 0.5,
                    Math.random() - 0.5,
                    Math.random() - 0.5
                ).normalize()
                rotationAxesRef.current[i] = axis
            }
            const axis = rotationAxesRef.current[i]

            // Path calculation (no longer uses offsetRef, so they stay in place)
            const t = (i * spacing) % 1
            const raw = t * CACHE_STEPS
            const idx0 = Math.floor(raw)
            const frac = raw - idx0
            const p0 = posCache[idx0], p1 = posCache[Math.min(idx0 + 1, CACHE_STEPS)]
            const tan0 = tanCache[idx0], tan1 = tanCache[Math.min(idx0 + 1, CACHE_STEPS)]

            const px = p0.x + (p1.x - p0.x) * frac
            const py = p0.y + (p1.y - p0.y) * frac
            const pz = p0.z + (p1.z - p0.z) * frac
            const tx = tan0.x + (tan1.x - tan0.x) * frac
            const ty = tan0.y + (tan1.y - tan0.y) * frac
            const tz = tan0.z + (tan1.z - tan0.z) * frac

            // Soft-selection spread — disabled when character is highlighted to show rotation clearly
            if (!spreadOffsetsRef.current[i]) spreadOffsetsRef.current[i] = 0
            let targetSpread = 0
            if (!isHighlighted && hovIdx >= 0) {
                // Only apply spread effect if character is NOT highlighted
                const dist = Math.abs(i - hovIdx)
                const falloff = dist < SPREAD_RADIUS ? Math.pow(1 - dist / SPREAD_RADIUS, 2) : 0
                targetSpread = SPREAD_STRENGTH * falloff
            }
            spreadOffsetsRef.current[i] = dampValue(spreadOffsetsRef.current[i], targetSpread, 3.5, delta)
            const spr = spreadOffsetsRef.current[i]

            // Apply morphing - scatter cogs dramatically, then gather into formation
            _wslMorphPos.set(px, py + spr, pz)
            if (isMorphing) {
                // Scatter only in XY plane — zeroing Z prevents cogs from flying into the camera near-plane
                const spreadDist = morphProgress * 6.5
                _wslFlat.set(axis.x, axis.y, 0)
                const flatLen = _wslFlat.length()
                if (flatLen > 0.001) {
                    _wslMorphPos.add(_wslFlat.divideScalar(flatLen).multiplyScalar(spreadDist))
                } else {
                    // Fallback: scatter using index to ensure unique direction
                    _wslFallback.set(Math.cos(i * 2.4), Math.sin(i * 2.4), 0).multiplyScalar(spreadDist)
                    _wslMorphPos.add(_wslFallback)
                }
            }

            dummyMatrix.position.copy(_wslMorphPos)

            // Calculate the two target orientations
            dummyMatrix.lookAt(state.camera.position)
            _wslCamQuat.copy(dummyMatrix.quaternion)

            dummyMatrix.lookAt(_wslMorphPos.x, _wslMorphPos.y, _wslMorphPos.z + 10)
            _wslFwdQuat.copy(dummyMatrix.quaternion)

            // Smoothly transition from tracking camera to facing forward over the last 15% of the morph
            if (heroIntroState.phase !== 'done') {
                if (morphProgress < 0.15) {
                    // map 0.15 -> 0 to 0 -> 1 for the slerp amount
                    const lookAlpha = 1 - (morphProgress / 0.15)
                    dummyMatrix.quaternion.copy(_wslCamQuat).slerp(_wslFwdQuat, lookAlpha)
                } else {
                    dummyMatrix.quaternion.copy(_wslCamQuat)
                }
            } else {
                dummyMatrix.quaternion.copy(_wslFwdQuat)
            }

            // Apply highlight rotation (around Z axis of the character)
            if (isHighlighted && highlightRotation > 0) {
                // Find true geometric center of character path
                const rx = _wslMorphPos.x - centerP.x
                const ry = _wslMorphPos.y - centerP.y
                const distFromCenter = Math.sqrt(rx * rx + ry * ry)
                if (distFromCenter > 0.001) {
                    const angle = Math.atan2(ry, rx) + highlightRotation
                    dummyMatrix.position.x = centerP.x + Math.cos(angle) * distFromCenter
                    dummyMatrix.position.y = centerP.y + Math.sin(angle) * distFromCenter
                }
            }

            // Rotate around random axis
            dummyMatrix.rotateOnWorldAxis(axis, state.clock.elapsedTime * 0.5)

            if (t > drawProgressRef.current) {
                dummyMatrix.scale.set(0, 0, 0)
            } else {
                // Smoothly lerp scale from 0.7 (scattered) to 1.0 (formed) using morphProgress
                const scaleMultiplier = 0.7 + 0.3 * (1 - Math.min(morphProgress, 1))
                dummyMatrix.scale.set(cogScale * scaleMultiplier, cogScale * scaleMultiplier, cogScale * scaleMultiplier)
            }

            dummyMatrix.updateMatrix()
            instanced.setMatrixAt(i, dummyMatrix.matrix)
        }
        instanced.instanceMatrix.needsUpdate = true
        if (!instanced.visible) instanced.visible = true
    })

    return (
        <group position={position}>
            <instancedMesh
                ref={instancedRef}
                args={[sourceGeometry, material, count]}
                visible={false}
                frustumCulled={false}
                onPointerOver={e => {
                    const id = e.instanceId ?? -1
                    hovInstRef.current = id
                    lastEnterFrameRef.current = frameCountRef.current
                    if (id !== prevHovInstRef.current && id !== -1) {
                        prevHovInstRef.current = id
                        sfx.piano()
                    }
                }}
                onPointerMove={e => { hovInstRef.current = e.instanceId ?? -1; lastEnterFrameRef.current = frameCountRef.current }}
            />
        </group>
    )
}

// ─── Letter paths for MUSTAFA — extracted from ReliefSingleLineSVG-Regular ───
//  Coordinate space normalised to font cap height 675 → world height ±2.
//  A subtle z sine-wave is added so spines have depth as they flow along the glyph.
const v3 = (x, y, z = 0) => new THREE.Vector3(x, y, z)

// Helper: add z-depth wave along a point list so the spines twist in 3-D
function withZ(pts, amp = 0.35) {
    return pts.map((p, i) => new THREE.Vector3(p.x, p.y, Math.sin((i / Math.max(pts.length - 1, 1)) * Math.PI * 2) * amp))
}

const RAW_M = [v3(1.7244, -2), v3(1.7244, 2), v3(0, -1.8222), v3(-1.7244, 2), v3(-1.7244, -3)]
const RAW_U = [v3(-1.2978, 2.0296), v3(-1.2978, -0.5481), v3(-1.2044, -1.17), v3(-0.9415, -1.6252), v3(-0.5353, -1.9048), v3(0, -2), v3(0.5353, -1.9048), v3(0.9415, -1.6252), v3(1.2044, -1.17), v3(1.2978, -0.5481), v3(1.2978, 2.0296), v3(1.45, 3.0296)]
const RAW_S = [v3(-1.1141, -1.3541), v3(-0.9448, -1.62), v3(-0.6933, -1.8237), v3(-0.3707, -1.9541), v3(0.0119, -2), v3(0.4862, -1.9232), v3(0.8422, -1.7148), v3(1.066, -1.4075), v3(1.1437, -1.0341), v3(0.8039, -0.3555), v3(0.0563, 0.0615), v3(-0.6913, 0.4684), v3(-1.0311, 1.117), v3(-0.9624, 1.4571), v3(-0.757, 1.7489), v3(-0.4161, 1.9529), v3(0.0593, 2.0296), v3(0.4052, 1.9896), v3(0.68, 1.8785), v3(0.8859, 1.7096), v3(1.0252, 2.4963)]
const RAW_T0 = [v3(0, -2), v3(0, 1.9704)]
const RAW_T1 = [v3(-1.6, 1.9704), v3(1.9, 1.9704)]
const RAW_A0 = [v3(-1.09, -0.7378), v3(2.09, -0.7378)]
const RAW_A1 = [v3(1.6, -2), v3(0.8, 0), v3(0, 2), v3(-0.8, 0), v3(-1.6, -3)]
const RAW_F0 = [v3(-0.8, -2), v3(-0.8, 2), v3(2.5, 2)]
const RAW_F1 = [v3(-0.8, 0.1), v3(1.5, 0.1)]

const LETTER_M = withZ(RAW_M, 0.30)
const LETTER_U = withZ(RAW_U, 0.28)
const LETTER_S = withZ(RAW_S, 0.22)
const LETTER_T_0 = withZ(RAW_T0, 0.35)
const LETTER_T_1 = withZ(RAW_T1, 0.20)
const LETTER_A_0 = withZ(RAW_A0, 0.18)
const LETTER_A_1 = withZ(RAW_A1, 0.30)
const LETTER_F_0 = withZ(RAW_F0, 0.30)
const LETTER_F_1 = withZ(RAW_F1, 0.18)

// Multi-stroke letters use an array of paths rendered as separate SpinePaths
const MUSTAFA_LETTERS = {
    M: [LETTER_M],
    U: [LETTER_U],
    S: [LETTER_S],
    T: [LETTER_T_0, LETTER_T_1],
    A: [LETTER_A_0, LETTER_A_1],
    F: [LETTER_F_0, LETTER_F_1],
}

// WritingSpineLetter already handles a single path — wrap it for multi-stroke support
function SpineLetter2({ char, sourceGeometry, material, position = [0, 0, 0], scale = 1, delay = 0, cogScale = 0.72, isHighlighted = false, highlightRotation = 0 }) {
    const paths = MUSTAFA_LETTERS[char] || [LETTER_M]
    return (
        <group position={position} scale={scale}>
            {paths.map((pts, idx) => (
                <WritingSpineLetter
                    key={idx}
                    points={pts}
                    sourceGeometry={sourceGeometry}
                    material={material}
                    delay={delay + idx * 0.4}
                    cogScale={cogScale}
                    isHighlighted={isHighlighted}
                    highlightRotation={highlightRotation}
                />
            ))}
        </group>
    )
}

// ─── Animated spotlight that sweeps left-right ────────────────────────────────
function AnimatedSpotLight() {
    const spotRef = useRef()
    const startTimeRef = useRef(null)

    useFrame((state) => {
        if (!spotRef.current) return

        // Start sweeping once intro is done
        if (heroIntroState.phase !== 'done') return

        if (startTimeRef.current === null) startTimeRef.current = state.clock.elapsedTime

        const t = state.clock.elapsedTime - startTimeRef.current
        const sweep = Math.sin(t * 0.8) * 20
        spotRef.current.position.x = sweep
    })

    return (
        <spotLight
            ref={spotRef}
            position={[0, 12, 8]}
            angle={0.6}
            penumbra={0.3}
            intensity={150}
            color="#ffffff"
            castShadow
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
            decay={1}
        />
    )
}

// ─── Star field — slowly emerges after hero loads ─────────────────────────────
const STAR_COUNT = 220
const STARS_PER_SEC = 30      // how many stars start fading in per second
const STAR_FADE = 0.5    // seconds each star takes to fully appear
const STAR_DELAY = 0    // seconds after mount before first star appears

function StarField() {
    const pointsRef = useRef()
    const groupRef = useRef()
    const startTimeRef = useRef(null)

    const { positions, targets, colors, delays } = useMemo(() => {
        const positions = new Float32Array(STAR_COUNT * 3)
        const targets = new Float32Array(STAR_COUNT * 3)
        const colors = new Float32Array(STAR_COUNT * 3) // starts black
        const delays = new Float32Array(STAR_COUNT)

        // Shuffle so stars don't appear in a predictable spatial order
        const order = Array.from({ length: STAR_COUNT }, (_, i) => i)
        for (let i = order.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [order[i], order[j]] = [order[j], order[i]]
        }

        for (let i = 0; i < STAR_COUNT; i++) {
            const theta = Math.random() * Math.PI * 2
            const phi = Math.acos(2 * Math.random() - 1)
            const r = 20 + Math.random() * 35

            positions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
            positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.55
            positions[i * 3 + 2] = r * Math.cos(phi)

            const b = 0.55 + Math.random() * 0.45
            targets[i * 3] = b * (Math.random() > 0.6 ? 0.78 : 1.0)
            targets[i * 3 + 1] = b * 0.88
            targets[i * 3 + 2] = b

            delays[order[i]] = STAR_DELAY + i / STARS_PER_SEC
        }

        return { positions, targets, colors, delays }
    }, [])

    useFrame((state) => {
        if (!pointsRef.current) return

        // Stars fade in once pullback starts (ambient background element)
        if (heroIntroState.phase === 'loading') return

        if (startTimeRef.current === null) startTimeRef.current = state.clock.elapsedTime

        // Keep stars centered on camera so they appear everywhere
        if (groupRef.current) groupRef.current.position.copy(state.camera.position)
        const t = state.clock.elapsedTime - startTimeRef.current
        let dirty = false

        for (let i = 0; i < STAR_COUNT; i++) {
            const elapsed = t - delays[i]
            if (elapsed <= 0) continue
            const p = Math.min(elapsed / STAR_FADE, 1)
            const ci = i * 3
            const nr = targets[ci] * p
            const ng = targets[ci + 1] * p
            const nb = targets[ci + 2] * p
            if (Math.abs(colors[ci] - nr) > 0.002) {
                colors[ci] = nr
                colors[ci + 1] = ng
                colors[ci + 2] = nb
                dirty = true
            }
        }

        if (dirty) pointsRef.current.geometry.attributes.color.needsUpdate = true
    })

    return (
        <group ref={groupRef}>
            <points ref={pointsRef}>
                <bufferGeometry>
                    <bufferAttribute attach="attributes-position" array={positions} count={STAR_COUNT} itemSize={3} />
                    <bufferAttribute attach="attributes-color" array={colors} count={STAR_COUNT} itemSize={3} />
                </bufferGeometry>
                <pointsMaterial vertexColors size={1.4} sizeAttenuation={false} toneMapped={false} />
            </points>
        </group>
    )
}


function SpineHeroSection() {
    const { size } = useThree()
    const { scene: spineScene } = useGLTF('/spine.glb')
    const highlightedCharRef = useRef(0)
    const highlightRotationRef = useRef(0)
    const rotationSpeedRef = useRef(5 + Math.random() * 6) // 5-11 rad/s for more visible rotation

    const spineGeometry = useMemo(() => {
        let mesh = null
        spineScene.traverse(child => { if (child.isMesh && !mesh) mesh = child })
        return mesh?.geometry ?? null
    }, [spineScene])

    const material = useMemo(() => new THREE.MeshPhysicalMaterial({
        color: '#ffffff',
        metalness: 1.0,
        roughness: 0.02,
        clearcoat: 1.0,
        clearcoatRoughness: 0.0,
        emissive: '#a1a1a1ff',
        emissiveIntensity: 10,
    }), [])

    // Responsive scale: fit MUSTAFA into targetFraction of the viewport width.
    // Camera starts at Z=16, FOV=70 — compute world-space width visible at Z=0.
    const { letterScale, actualSpacing } = useMemo(() => {
        const cfg = HERO_CONFIG
        const fovRad = (70 * Math.PI) / 180
        const visH = 2 * Math.tan(fovRad / 2) * 16          // ~22.4 world units tall
        const visW = visH * (size.width / size.height)       // depends on aspect ratio
        const totalSpan = (cfg.letters.length - 1) * cfg.spacing
        // On portrait mobile, fill more width so text stays readable
        const isPortrait = size.width < size.height
        const fraction = isPortrait ? Math.min(cfg.targetFraction * 1.5, 0.98) : Math.min(cfg.targetFraction * 1.15, 0.88)
        const scale = (visW * fraction) / totalSpan
        return { letterScale: scale, actualSpacing: cfg.spacing * scale }
    }, [size.width, size.height])

    const { progress, active: loadingActive } = useProgress()
    const subtitleOpRef = useRef(0)
    const timeSinceDoneRef = useRef(0)

    useFrame((state, delta) => {
        // Gate behind hero intro completion
        if (heroIntroState.phase !== 'done') return

        // Smooth ease-in for the rotation acceleration to avoid harsh visual jerks on the first frame
        timeSinceDoneRef.current += delta
        const speedMultiplier = Math.min(timeSinceDoneRef.current / 0.5, 1)

        highlightRotationRef.current += delta * rotationSpeedRef.current * speedMultiplier

        // When rotation completes one full cycle (2π), pick a new character
        if (highlightRotationRef.current >= Math.PI * 2) {
            highlightedCharRef.current = Math.floor(Math.random() * HERO_CONFIG.letters.length)
            highlightRotationRef.current = 0
            rotationSpeedRef.current = 3 + Math.random() * 5 // Generate speed for next character
            timeSinceDoneRef.current = 0 // Reset acceleration ease-in
        }

        // Fade in subtitle after MUSTAFA letters start swarming (slight delay)
        subtitleOpRef.current = dampValue(subtitleOpRef.current, 1, 2, delta)
    })

    if (!spineGeometry) return null

    const cfg = HERO_CONFIG
    const startX = -((cfg.letters.length - 1) / 2) * actualSpacing

    return (
        <group position={[0.15 * letterScale, cfg.groupY, 0]}>
            {cfg.letters.map((letterCfg, i) => (
                <SpineLetter2
                    key={i}
                    char={letterCfg.char}
                    sourceGeometry={spineGeometry}
                    material={material}
                    position={[
                        startX + i * actualSpacing + (letterCfg.xOffset ?? 0) * letterScale,
                        letterCfg.yOffset * letterScale,
                        letterCfg.zOffset,
                    ]}
                    scale={letterScale}
                    delay={0.3 + i * 0.6}
                    isHighlighted={i === highlightedCharRef.current}
                    highlightRotation={highlightRotationRef.current}
                />
            ))}

        </group>
    )
}

useGLTF.preload('/spine.glb')
useGLTF.preload('/Truck.glb')
useGLTF.preload('/sigil.glb')

// ═════════════════════════════════════════════════════════════════════════════
// ETHOS SECTION — Scroll-driven timeline + rotating busts
// ═════════════════════════════════════════════════════════════════════════════

const ETHOS_ENTER = 0.08   // scroll fraction: ethos begins
const ETHOS_EXIT = 0.32   // scroll fraction: ethos ends
const DOSSIER_SECTION_INDEX = 5  // final section index
const ETHOS_SECTION_INDEX = 1    // ethos section index

// ─── Audio tracks for section transitions ────────────────────────────────────
let _malletPlayed = false
let _ambientPianoAudio = null

// Pre-load sounds for instant playback
let _itemPick1Audio = null
function getItemPick1Audio() {
    if (!_itemPick1Audio) {
        _itemPick1Audio = new Audio('/sounds/itempick1.m4a')
        _itemPick1Audio.volume = 0.5
    }
    return _itemPick1Audio
}

let _itemBackAudio = null
function getItemBackAudio() {
    if (!_itemBackAudio) {
        _itemBackAudio = new Audio('/sounds/itemback.m4a')
        _itemBackAudio.volume = 0.5
    }
    return _itemBackAudio
}

let _digitalClickAudio = null
function getDigitalClickAudio() {
    if (!_digitalClickAudio) {
        _digitalClickAudio = new Audio('/sounds/digital-click.mp3')
        _digitalClickAudio.volume = 0.7
    }
    return _digitalClickAudio
}

let _boinXAudio = null
function getBoinXAudio() {
    if (!_boinXAudio) {
        _boinXAudio = new Audio('/sounds/boing_x.m4a')
        _boinXAudio.volume = 0.6
    }
    return _boinXAudio
}

function playMalletWithFX() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)()
        fetch('/sounds/MalletAtmospheresE1.m4a')
            .then(r => r.arrayBuffer())
            .then(buf => ctx.decodeAudioData(buf))
            .then(decoded => {
                const src = ctx.createBufferSource()
                src.buffer = decoded

                // Gain
                const gain = ctx.createGain()
                gain.gain.value = 0.4

                // Short delay
                const delay = ctx.createDelay(0.5)
                delay.delayTime.value = 0.18
                const delayFeedback = ctx.createGain()
                delayFeedback.gain.value = 0.35
                const delayWet = ctx.createGain()
                delayWet.gain.value = 0.45

                // Convolver reverb (synthetic impulse)
                const convolver = ctx.createConvolver()
                const irLen = ctx.sampleRate * 1.8
                const ir = ctx.createBuffer(2, irLen, ctx.sampleRate)
                for (let c = 0; c < 2; c++) {
                    const ch = ir.getChannelData(c)
                    for (let i = 0; i < irLen; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 2.5)
                }
                convolver.buffer = ir
                const reverbWet = ctx.createGain()
                reverbWet.gain.value = 0.4

                // Routing: src → gain → destination (dry)
                //                   → delay loop → delayWet → destination
                //                   → convolver  → reverbWet → destination
                src.connect(gain)
                gain.connect(ctx.destination)

                gain.connect(delay)
                delay.connect(delayFeedback)
                delayFeedback.connect(delay)
                delay.connect(delayWet)
                delayWet.connect(ctx.destination)

                gain.connect(convolver)
                convolver.connect(reverbWet)
                reverbWet.connect(ctx.destination)

                src.start()
                src.onended = () => setTimeout(() => ctx.close(), 4000)
            }).catch(() => {})
    } catch (e) {}
}

const ETHOS_CHECKPOINTS = [
    {
        label: 'CRAFT',
        text: 'Combined dev, design, and motion to build experiences that feel alive.',
    },
    {
        label: 'SYSTEMS',
        text: 'Leading a team of 10 designers taught me that products fail without structure.',
    },
    {
        label: 'VISION',
        text: 'A tech optimist who went from filtering AI slopcode to agentic development.',
    },
]

// ─── Single checkpoint row ────────────────────────────────────────────────────
function EthosCheckpoint({ checkpoint, active }) {
    return (
        <div className={`ethos-checkpoint ${active ? 'active' : ''}`}>
            <div className="ethos-bullet-wrap">
                <div className={`ethos-bullet ${active ? 'active' : ''}`}>
                    <div className="ethos-bullet-inner" />
                </div>
            </div>
            <div className="ethos-checkpoint-content">
                <div className={`ethos-label ${active ? 'active' : ''}`}>
                    {checkpoint.label.split('').map((char, i) => (
                        <span
                            key={i}
                            className="ethos-label-char"
                            style={{
                                animationDelay: active ? `${i * 0.04}s` : '0s',
                                opacity: active ? undefined : 0,
                            }}
                        >
                            {char}
                        </span>
                    ))}
                </div>
                <p className="ethos-text">{checkpoint.text}</p>
            </div>
        </div>
    )
}

// ─── Ethos Overlay (fixed HTML outside Canvas) ───────────────────────────────
// Bullet 1 fires on scroll entry. Bullets 2 & 3 auto-sequence via timers.
function EthosOverlay({ scrollRef }) {
    const wrapperRef = useRef()
    const lineRef = useRef()
    const [activeCount, setActiveCount] = useState(0)
    const activeRef = useRef(0)   // ref mirror so RAF sees latest value
    const timersRef = useRef([])
    const scheduledRef = useRef(false)

    useEffect(() => {
        let rafId

        const clearTimers = () => {
            timersRef.current.forEach(clearTimeout)
            timersRef.current = []
            scheduledRef.current = false
        }

        const bump = (n) => {
            activeRef.current = n
            setActiveCount(n)
            // Grow line to match active count
            if (lineRef.current)
                lineRef.current.style.height = `${(n / ETHOS_CHECKPOINTS.length) * 100}%`
        }

        const tick = () => {
            const t = scrollRef.current ?? 0

            // Fade panel in/out at section edges
            const fadeIn = Math.min(1, Math.max(0, (t - ETHOS_ENTER) / 0.025))
            const fadeOut = Math.min(1, Math.max(0, (ETHOS_EXIT - t) / 0.025))
            if (wrapperRef.current) wrapperRef.current.style.opacity = Math.min(fadeIn, fadeOut)

            const raw = (t - ETHOS_ENTER) / (ETHOS_EXIT - ETHOS_ENTER)
            const progress = Math.max(0, Math.min(1, raw))
            const inSection = progress >= 0.12

            if (!inSection) {
                // User scrolled away — reset for next visit
                if (activeRef.current > 0) {
                    clearTimers()
                    bump(0)
                }
            } else if (activeRef.current === 0) {
                // Just entered — fire bullet 1 immediately, schedule 2 & 3 in sequence
                bump(1)
                if (!scheduledRef.current) {
                    scheduledRef.current = true
                    timersRef.current[0] = setTimeout(() => bump(2), 1100)
                    timersRef.current[1] = setTimeout(() => bump(3), 2200)
                }
            }

            rafId = requestAnimationFrame(tick)
        }

        rafId = requestAnimationFrame(tick)
        return () => {
            cancelAnimationFrame(rafId)
            clearTimers()
        }
    }, [scrollRef])

    return (
        <div ref={wrapperRef} className="ethos-overlay" style={{ opacity: 0 }}>
            <div className="ethos-panel">
                <div className="ethos-panel-header">
                    <span className="ethos-eyebrow">ADAPTATION</span>
                    <h2 className="ethos-title">How i work</h2>
                </div>

                <div className="ethos-timeline-side">
                    <div className="ethos-line-track">
                        <div ref={lineRef} className="ethos-line" style={{ height: '0%' }} />
                    </div>
                    <div className="ethos-checkpoints">
                        {ETHOS_CHECKPOINTS.map((cp, i) => (
                            <EthosCheckpoint
                                key={i}
                                checkpoint={cp}
                                active={i < activeCount}
                                index={i}
                            />
                        ))}
                    </div>
                </div>
            </div>
        </div>
    )
}

// ─── Rotating busts ───────────────────────────────────────────────────────────
function RotatingBust({ url, position, tiltAxis, rotSpeed = 0.3, scale = 1, activeCheck }) {
    const { scene } = useGLTF(url)
    const groupRef = useRef()
    const cloned = useMemo(() => scene.clone(true), [scene])

    useFrame((_, delta) => {
        if (activeCheck && !activeCheck()) return
        if (!groupRef.current) return
        groupRef.current.rotation.y += delta * rotSpeed
    })

    return (
        <group position={position} rotation={tiltAxis}>
            <group ref={groupRef} scale={scale}>
                <primitive object={cloned} />
            </group>
        </group>
    )
}



// ─── Pillar with bust on top ───────────────────────────────────────────────────
function Pillar({ position, bustUrl, bustRotSpeed = 0.05, bustScale = 3 }) {
    const MAT = { color: '#080812', emissive: '#1a2d55', emissiveIntensity: 0.5, metalness: 0.85, roughness: 0.25, toneMapped: false }
    return (
        <group position={position}>
            {/* Base slab */}
            <mesh position={[0, -2.0, 0]}>
                <boxGeometry args={[0.9, 0.18, 0.9]} />
                <meshStandardMaterial {...MAT} />
            </mesh>
            {/* Column */}
            <mesh>
                <cylinderGeometry args={[0.13, 0.16, 4, 8]} />
                <meshStandardMaterial {...MAT} />
            </mesh>
            {/* Top cap */}
            <mesh position={[0, 2.1, 0]}>
                <boxGeometry args={[0.8, 0.16, 0.8]} />
                <meshStandardMaterial {...MAT} emissive="#3355cc" emissiveIntensity={0.8} />
            </mesh>
            {/* Bust */}
            <RotatingBust
                url={bustUrl}
                position={[0, 2.6, 0]}
                tiltAxis={[0, 0, 0]}
                rotSpeed={bustRotSpeed}
                scale={bustScale}
            />
        </group>
    )
}


// ─── Main Ethos Section (3D) ──────────────────────────────────────────────────
const ETHOS_CENTER = [0, 0, 0]
const ETHOS_STACK_RADIUS = 3.5

function EthosSnakeSpine({ trigger }) {
    const { scene } = useGLTF('/spine.glb')
    const meshRef = useRef()
    const progressRef = useRef(0)
    // Extract geometry and material from the loaded scene
    const { geometry, material } = useMemo(() => {
        let g, m
        scene.traverse(child => {
            if (child.isMesh) {
                g = child.geometry
                m = child.material.clone()
                m.emissive?.set('#000000')
                m.emissiveIntensity = 0
                m.metalness = 1.0
                m.roughness = 0.05
                m.toneMapped = true
            }
        })
        return { geometry: g, material: m }
    }, [scene])

    const curve = useMemo(() => new THREE.CatmullRomCurve3([
        new THREE.Vector3(22, 25, -10),
        new THREE.Vector3(10, 12, -5),
        new THREE.Vector3(20, 2, 0),
        new THREE.Vector3(0, -3, 5),
        new THREE.Vector3(3, -12, 10),
        new THREE.Vector3(-10, -22, 15),
        new THREE.Vector3(-22, -12, -20),
        new THREE.Vector3(22, 22, -15),
        new THREE.Vector3(50, 40, -30) // 🏁 Exit Point (Fly away!)
    ], false), []) // ⬅️ Closed set to false

    const segments = 15
    const dummy = useMemo(() => new THREE.Object3D(), [])

    useFrame((state, delta) => {
        if (!inEthos()) return
        if (!meshRef.current) return

        // Only progress if trigger is true, but DON'T reset if false
        // This keeps the snake's position persistent so it doesn't "re-fly-in"
        if (trigger) {
            meshRef.current.visible = true
            progressRef.current += delta * 0.05
        } else {
            // Keep it visible if it has already started, or hide if it's the first pass
            meshRef.current.visible = progressRef.current > 0
        }

        const p = progressRef.current
        const curveLength = curve.getLength()
        // Space them by ~3.8 units for a shorter, less dense chain
        const stepU = 1.8 / curveLength

        // 🐍 One-shot traversal logic: stop when the tail clears the path (1.0)
        // Max progress needed is ~1.0 + (segments * stepU)
        const maxP = 1.0 + (segments * stepU)
        if (p > maxP) {
            meshRef.current.visible = false
            return
        }

        for (let i = 0; i < segments; i++) {
            const t = p - (i * stepU) // ⬅️ No modulo (%) here
            if (t < 0 || t > 1) {
                dummy.scale.setScalar(0)
            } else {
                const pos = curve.getPointAt(t)
                const tan = curve.getTangentAt(t)

                // Sync rotations to absolute time so they never "stop"
                const spin = state.clock.elapsedTime * 2.0 + (i * 0.1)

                dummy.position.copy(pos)
                dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tan.normalize())

                // Base orientation
                dummy.rotateX(Math.PI)
                dummy.rotateZ(spin)
                dummy.scale.setScalar(5)
            }
            dummy.updateMatrix()
            meshRef.current.setMatrixAt(i, dummy.matrix)
        }
        meshRef.current.instanceMatrix.needsUpdate = true
    })

    return (
        <instancedMesh ref={meshRef} args={[geometry, material, 15]} frustumCulled={false} />
    )
}

function EthosSection({ scrollRef }) {
    const groupRef = useRef()
    const [snakeTrigger, setSnakeTrigger] = useState(false)
    const hasRunRef = useRef(false) // 🛡️ Prevent re-running
    const entryTimeRef = useRef(0)

    useFrame((state) => {
        if (!groupRef.current) return
        const t = scrollRef.current ?? 0
        const isVisible = t >= ETHOS_ENTER - 0.03 && t <= ETHOS_EXIT + 0.03
        groupRef.current.visible = isVisible

        if (isVisible && t >= ETHOS_ENTER && t <= ETHOS_EXIT && !hasRunRef.current) {
            if (entryTimeRef.current === 0) entryTimeRef.current = state.clock.elapsedTime
            if (state.clock.elapsedTime - entryTimeRef.current > 1.0) {
                setSnakeTrigger(true)
                hasRunRef.current = true // Lock it in
            }
        } else if (!isVisible && !snakeTrigger) {
            // Only reset the timer if we haven't run yet
            entryTimeRef.current = 0
        }
    })

    return (
        <group ref={groupRef} position={ETHOS_POS}>
            <EthosSnakeSpine trigger={snakeTrigger} />
            {/* Bottom bust — human */}
            <RotatingBust
                url="/me.glb"
                position={[5, -3.5, -3]}
                tiltAxis={[0, -0.7, 0]}
                rotSpeed={-0.001}
                scale={12}
                activeCheck={inEthos}
            />

            {/* Top bust — robot me */}
            <RotatingBust
                url="/also-me.glb"
                position={[4.5, -4, 6]}
                tiltAxis={[0, -0.3, 0]}
                rotSpeed={0.001}
                scale={8}
                activeCheck={inEthos}
            />

            <pointLight position={[0, 2, 6]} intensity={200} color="#6699ff" distance={18} decay={2} />
            <pointLight position={[4, 1, 4]} intensity={60} color="#3355ff" distance={10} decay={2} />
            <pointLight position={[-4, 1, 4]} intensity={60} color="#3355ff" distance={10} decay={2} />
        </group>
    )
}

function ProjectsSection({ scrollRef, onOpenProject }) {
    return (
        <group>
            <NexusHubCore scrollRef={scrollRef} />
            <NexusDataStreams scrollRef={scrollRef} />
            <NexusDataThreads scrollRef={scrollRef} />
            <ProjectZoneGrid scrollRef={scrollRef} />
            {PROJECT_CARDS.map((config, i) => (
                <ProjectCard key={i} config={config} scrollRef={scrollRef} cardIndex={i} onOpen={() => onOpenProject?.(config)} />
            ))}
        </group>
    )
}

// ─── Bio constants ────────────────────────────────────────────────────────────
const BIO_ENTER = 0.86
const BIO_FULL = 0.93
const BIO_CENTER = [140, -3.2, -25]

const GRAY_1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const PLACEHOLDER_IMAGES = [GRAY_1x1, GRAY_1x1, GRAY_1x1]

const DEBRIS_PIECES = [
    { startPos: [-20, 2, 8], geo: 'oct', color: '#3366ff', speed: 2.8 },
    { startPos: [10, -3, 6], geo: 'ico', color: '#2244cc', speed: 3.2 },
    { startPos: [30, 1, -4], geo: 'box', color: '#1133aa', speed: 2.5 },
    { startPos: [70, 3, 10], geo: 'oct', color: '#4455ff', speed: 3.8 },
    { startPos: [75, -2, -6], geo: 'ico', color: '#3344ee', speed: 2.9 },
    { startPos: [100, 0, 4], geo: 'oct', color: '#00aaff', speed: 4.2 },
    { startPos: [120, -1, 3], geo: 'tor', color: '#ff3366', speed: 3.6 },
    { startPos: [140, 1, 5], geo: 'ico', color: '#44ff88', speed: 4.8 },
    { startPos: [50, 4, -8], geo: 'box', color: '#2255dd', speed: 3.1 },
    { startPos: [90, -4, 7], geo: 'oct', color: '#1144bb', speed: 3.4 },
    { startPos: [110, 2, -5], geo: 'ico', color: '#3355cc', speed: 2.7 },
    { startPos: [130, -3, 6], geo: 'tor', color: '#0099ee', speed: 3.9 },
]

function DebrisPiece({ piece, progress, exploded }) {
    const meshRef = useRef()
    const posRef = useRef(new THREE.Vector3(...piece.startPos))
    const scaleRef = useRef(0)

    const geometry = useMemo(() => {
        switch (piece.geo) {
            case 'oct': return new THREE.OctahedronGeometry(0.18, 0)
            case 'ico': return new THREE.IcosahedronGeometry(0.15, 0)
            case 'tor': return new THREE.TorusGeometry(0.14, 0.05, 6, 12)
            case 'box': return new THREE.BoxGeometry(0.22, 0.22, 0.22)
            default: return new THREE.OctahedronGeometry(0.18, 0)
        }
    }, [piece.geo])

    const target = useMemo(() => new THREE.Vector3(...BIO_CENTER), [])

    useFrame((_, delta) => {
        if (!meshRef.current) return
        if (exploded) {
            const away = posRef.current.clone().sub(target).normalize()
            posRef.current.addScaledVector(away, delta * piece.speed * 3)
            scaleRef.current = dampValue(scaleRef.current, 0, 8, delta)
        } else if (progress > 0) {
            posRef.current.lerp(target, delta * piece.speed * 0.6)
            scaleRef.current = dampValue(scaleRef.current, 0.8, 5, delta)
        }
        meshRef.current.position.copy(posRef.current)
        meshRef.current.scale.setScalar(scaleRef.current)
        meshRef.current.rotation.x += delta * 1.2
        meshRef.current.rotation.y += delta * 0.9
        meshRef.current.material.opacity = scaleRef.current * 0.7
    })

    return (
        <mesh ref={meshRef} geometry={geometry} position={piece.startPos}>
            <meshBasicMaterial color={piece.color} wireframe transparent opacity={0} toneMapped={false} />
        </mesh>
    )
}

function CollapseFlash({ active }) {
    const meshRef = useRef()
    const opacityRef = useRef(0)
    const firedRef = useRef(false)
    const { camera } = useThree()
    const _fwd = useMemo(() => new THREE.Vector3(), [])

    useFrame((_, delta) => {
        if (!meshRef.current) return
        if (active && !firedRef.current) { firedRef.current = true; opacityRef.current = 1.0 }
        if (opacityRef.current > 0) {
            opacityRef.current = dampValue(opacityRef.current, 0, 8, delta)
            meshRef.current.material.opacity = opacityRef.current
            meshRef.current.visible = opacityRef.current > 0.01
            _fwd.set(0, 0, -1).applyQuaternion(camera.quaternion)
            meshRef.current.position.copy(camera.position).addScaledVector(_fwd, 2)
            meshRef.current.quaternion.copy(camera.quaternion)
        }
    })

    return (
        <mesh ref={meshRef} visible={false}>
            <planeGeometry args={[80, 80]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0} toneMapped={false} depthWrite={false} depthTest={false} />
        </mesh>
    )
}

function GlassShard({ index, totalShards, uvOffset, uvSize, worldPos, worldSize, rotation, texture, exploded, appeared }) {
    const groupRef = useRef()
    const photoRef = useRef()
    const glassRef = useRef()

    const explodeOffset = useMemo(() => {
        const angle = (index / totalShards) * Math.PI * 2 + Math.random() * 0.8
        const radius = 2 + Math.random() * 3
        return new THREE.Vector3(
            Math.cos(angle) * radius,
            Math.sin(angle) * radius + (Math.random() - 0.5) * 2,
            (Math.random() - 0.5) * 4
        )
    }, [index, totalShards])

    const currentPos = useRef(new THREE.Vector3(...worldPos).add(explodeOffset))
    const targetPos = useMemo(() => new THREE.Vector3(...worldPos), [worldPos])
    const opacityRef = useRef(0)
    const scaleRef = useRef(0.3)

    // UV-remapped photo geometry
    const photoGeo = useMemo(() => {
        const geo = new THREE.PlaneGeometry(worldSize[0], worldSize[1])
        const uvAttr = geo.attributes.uv
        const [u0, v0] = uvOffset
        const [uw, uh] = uvSize
        const uvMap = [[u0, v0 + uh], [u0 + uw, v0 + uh], [u0, v0], [u0 + uw, v0]]
        for (let i = 0; i < 4; i++) uvAttr.setXY(i, uvMap[i][0], uvMap[i][1])
        uvAttr.needsUpdate = true
        return geo
    }, [worldSize, uvOffset, uvSize])

    // Glass slab — thin box so edges are visible, creating the depth illusion
    const glassGeo = useMemo(() => new THREE.BoxGeometry(worldSize[0], worldSize[1], 0.1), [worldSize])

    useFrame((_, delta) => {
        if (!groupRef.current) return
        if (appeared) {
            currentPos.current.lerp(targetPos, delta * 4.5)
            opacityRef.current = dampValue(opacityRef.current, 1.0, 5, delta)
            scaleRef.current = dampValue(scaleRef.current, 1.0, 5, delta)
        } else if (exploded) {
            currentPos.current.lerp(targetPos.clone().add(explodeOffset.clone().multiplyScalar(2)), delta * 6)
            opacityRef.current = dampValue(opacityRef.current, 0, 10, delta)
        }
        groupRef.current.position.copy(currentPos.current)
        groupRef.current.scale.setScalar(scaleRef.current)
        if (photoRef.current?.material) photoRef.current.material.opacity = opacityRef.current
        if (glassRef.current?.material) glassRef.current.material.opacity = opacityRef.current * 0.82
    })

    return (
        <group ref={groupRef} rotation={rotation}>
            {/* Photo plane — set back behind the glass slab */}
            <mesh ref={photoRef} geometry={photoGeo} position={[0, 0, -0.07]}>
                <meshStandardMaterial map={texture} transparent opacity={0} toneMapped={false} />
            </mesh>
            {/* Glass slab — clearcoat reflections, no transmission (perf) */}
            <mesh ref={glassRef} geometry={glassGeo}>
                <meshStandardMaterial
                    transparent opacity={0}
                    roughness={0.02} metalness={0.1}
                    envMapIntensity={2.5}
                    color="#cce8ff"
                    toneMapped={false}
                />
            </mesh>
        </group>
    )
}

function FragmentedPortrait({ appeared, exploded }) {
    const textures = useTexture(PLACEHOLDER_IMAGES)
    const COLS = 4, ROWS = 6, SHARD_W = 0.72, SHARD_H = 0.96, GAP = 0.045

    const shards = useMemo(() => {
        const result = []
        const totalW = COLS * (SHARD_W + GAP)
        const totalH = ROWS * (SHARD_H + GAP)
        for (let row = 0; row < ROWS; row++) {
            for (let col = 0; col < COLS; col++) {
                const index = row * COLS + col
                const texIndex = Math.floor(index / (COLS * ROWS / textures.length)) % textures.length
                result.push({
                    index, texIndex,
                    uvOffset: [col / COLS, 1 - (row + 1) / ROWS],
                    uvSize: [1 / COLS, 1 / ROWS],
                    worldPos: [(col + 0.5) * (SHARD_W + GAP) - totalW / 2, (ROWS - row - 0.5) * (SHARD_H + GAP) - totalH / 2, (Math.random() - 0.5) * 1.2],
                    worldSize: [SHARD_W, SHARD_H],
                    rotation: [(Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.06],
                })
            }
        }
        return result
    }, [textures.length])

    return (
        <group>
            {shards.map((s, i) => (
                <GlassShard key={i} index={i} totalShards={shards.length} uvOffset={s.uvOffset} uvSize={s.uvSize} worldPos={s.worldPos} worldSize={s.worldSize} rotation={s.rotation} texture={textures[s.texIndex]} appeared={appeared} exploded={exploded} />
            ))}
        </group>
    )
}

function RaveAfterglowLights({ active }) {
    const light1Ref = useRef(), light2Ref = useRef(), light3Ref = useRef()
    const hueRef = useRef(0.6)

    useFrame((state, delta) => {
        if (!active) return
        hueRef.current = (hueRef.current + delta * 0.012) % 1
        const h = hueRef.current
        const t = state.clock.elapsedTime
        if (light1Ref.current) { light1Ref.current.color.setHSL(h, 0.8, 0.5); light1Ref.current.intensity = 8 + Math.sin(t * 0.7) * 3 }
        if (light2Ref.current) { light2Ref.current.color.setHSL((h + 0.33) % 1, 0.7, 0.4); light2Ref.current.intensity = 6 + Math.sin(t * 0.5 + 1.2) * 2.5 }
        if (light3Ref.current) { light3Ref.current.color.setHSL((h + 0.66) % 1, 0.6, 0.35); light3Ref.current.intensity = 4 + Math.sin(t * 0.9 + 2.4) * 2 }
    })

    if (!active) return null
    return (
        <>
            <pointLight ref={light1Ref} position={[-4, 3, 3]} intensity={0} distance={14} decay={2} />
            <pointLight ref={light2Ref} position={[4, -2, 2]} intensity={0} distance={12} decay={2} />
            <pointLight ref={light3Ref} position={[0, 0, -4]} intensity={0} distance={10} decay={2} />
        </>
    )
}

function BioGrid({ active }) {
    const groupRef = useRef()
    const matsRef = useRef([])

    const lines = useMemo(() => {
        const pts = []
        const size = 12, step = 2
        for (let i = -size; i <= size; i += step) {
            pts.push({ p1: [i, -4, -size], p2: [i, -4, size] })
            pts.push({ p1: [-size, -4, i], p2: [size, -4, i] })
        }
        return pts
    }, [])

    useFrame((state) => {
        if (!groupRef.current || !active) return
        if (matsRef.current.length === 0)
            groupRef.current.traverse(child => { if (child.material) matsRef.current.push(child.material) })
        const baseOpacity = 0.08 + Math.sin(state.clock.elapsedTime * 0.8) * 0.03
        matsRef.current.forEach(m => { m.opacity = baseOpacity })
    })

    if (!active) return null
    return (
        <group ref={groupRef}>
            {lines.map((l, i) => <Line key={i} points={[l.p1, l.p2]} color="#2244aa" lineWidth={0.5} transparent opacity={0.08} toneMapped={false} />)}
        </group>
    )
}

// ScrollBar shows all sections except the last (DOSSIER lives outside the progress arc)
const SCROLLBAR_STOPS = SECTION_STOPS
const SCROLLBAR_LABELS = SECTION_LABELS
const SCROLLBAR_VISUAL_PERCENTS = [0, 17, 34, 53, 74, 100]
const SCROLLBAR_HIDE_T = SECTION_STOPS[SECTION_STOPS.length - 1] + 0.1

function ScrollBar({ scrollRef, currentSectionRef }) {
    const fillRef = useRef()
    const dotRefs = useRef([])
    const lblRefs = useRef([])
    const wrapRef = useRef()
    const opacityRef = useRef(1)

    useEffect(() => {
        let raf
        const ACCENT = '#3a6a99'
        const PAST = '#1e3a66'
        const IDLE = '#08111f'

        function loop() {
            const t = scrollRef.current ?? 0
            const active = currentSectionRef.current ?? 0

            // Fade out when entering dossier section
            const targetOp = t >= SCROLLBAR_HIDE_T ? 0 : 1
            opacityRef.current += (targetOp - opacityRef.current) * 0.08
            if (wrapRef.current) wrapRef.current.style.opacity = opacityRef.current

            const stops = SECTION_STOPS
            const maxT = stops[stops.length - 1]
            const currT = Math.min(t, maxT)

            // Find which segment we are in to interpolate the fill visually
            let visualP = 0
            for (let i = 0; i < stops.length - 1; i++) {
                if (currT >= stops[i] && currT <= stops[i + 1]) {
                    const localT = (currT - stops[i]) / (stops[i + 1] - stops[i])
                    visualP = SCROLLBAR_VISUAL_PERCENTS[i] + localT * (SCROLLBAR_VISUAL_PERCENTS[i + 1] - SCROLLBAR_VISUAL_PERCENTS[i])
                    break
                }
            }
            if (currT >= maxT) visualP = 100

            if (fillRef.current) fillRef.current.style.width = `${visualP}%`

            dotRefs.current.forEach((dot, i) => {
                if (!dot) return
                const isActive = i === active
                const isPast = SCROLLBAR_STOPS[i] < t + 0.01
                const isHome = i === 0
                dot.style.background = isActive ? ACCENT : isPast ? PAST : IDLE
                dot.style.borderColor = isActive ? ACCENT : isPast ? '#2a4a88' : '#182440'
                dot.style.boxShadow = isActive ? `0 0 10px ${ACCENT}, 0 0 22px ${ACCENT}55` : isPast ? `0 0 5px #1e3a6688` : 'none'
                const scale = isActive ? 1.6 : 1
                dot.style.transform = isHome
                    ? `scale(${scale})`
                    : `rotate(45deg) scale(${scale})`
            })

            raf = requestAnimationFrame(loop)
        }
        raf = requestAnimationFrame(loop)
        return () => cancelAnimationFrame(raf)
    }, [scrollRef, currentSectionRef])

    return (
        <div ref={wrapRef} style={{
            position: 'fixed', bottom: '28px',
            left: '50%', transform: 'translateX(-50%)',
            width: 'min(480px, calc(100vw - clamp(32px, 8vw, 80px) - 36px - 12px))',
            height: '36px',
            zIndex: 100, pointerEvents: 'none', transition: 'none',
            // Liquid Glass Container
            background: 'rgba(0, 0, 0, 0)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            borderRadius: '18px',
            padding: '0 32px 0 24px',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5), inset 0 0 0 1px rgba(255, 255, 255, 0.05)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center'
        }}>
            {/* Track */}
            <div style={{ position: 'relative', width: '100%', height: '2px', background: 'rgba(255, 255, 255, 0.1)', borderRadius: '1px' }}>
                {/* Glowing Liquid Fill */}
                <div ref={fillRef} style={{
                    position: 'absolute', top: 0, left: 0, height: '100%', width: '0%',
                    background: 'linear-gradient(90deg, #0066ff, #00e5ff, #fff)',
                    boxShadow: '0 0 15px #00aaff, 0 0 30px #00aaff44',
                    borderRadius: '1px',
                    transition: 'width 100ms cubic-bezier(0.23, 1, 0.32, 1)',
                }}>
                    {/* Shine reflection */}
                    <div style={{
                        position: 'absolute', top: 0, left: 0, right: 0, height: '50%',
                        background: 'rgba(255, 255, 255, 0.3)',
                        borderRadius: '1px'
                    }} />
                </div>

                {/* Checkpoints */}
                {SCROLLBAR_LABELS.map((_, i) => (
                    <div key={i} style={{
                        position: 'absolute', left: `${SCROLLBAR_VISUAL_PERCENTS[i]}%`, top: 0,
                        pointerEvents: 'auto', cursor: 'pointer',
                        padding: '16px 18px',
                        transform: 'translate(-50%, -50%)',
                        marginTop: '1px',
                    }}
                        onClick={() => {
                            const prev = currentSectionRef.current
                            currentSectionRef.current = i
                            if (!sfx.isMuted()) { const pick = getItemPick1Audio(); pick.currentTime = 0; pick.play().catch(() => {}) }
                            if (i === DOSSIER_SECTION_INDEX && !_ambientPianoAudio) {
                                _ambientPianoAudio = new Audio('/sounds/AmbientPianoLoop10-790BPM.m4a')
                                _ambientPianoAudio.loop = true
                                _ambientPianoAudio.volume = 0.35
                                _ambientPianoAudio.play().catch(() => {})
                            }
                            if (prev === DOSSIER_SECTION_INDEX && i !== DOSSIER_SECTION_INDEX && _ambientPianoAudio) {
                                _ambientPianoAudio.pause(); _ambientPianoAudio.currentTime = 0; _ambientPianoAudio = null
                            }
                        }}
                        onMouseEnter={() => {
                            const dot = dotRefs.current[i]
                            if (dot) { dot.style.borderColor = '#00aaff'; dot.style.boxShadow = '0 0 8px #00aaff88' }
                            sfx.piano()
                        }}
                        onMouseLeave={() => {
                            const dot = dotRefs.current[i]
                            if (dot) { dot.style.borderColor = ''; dot.style.boxShadow = '' }
                        }}>
                        {/* Diamond (circle for home) */}
                        <div ref={el => dotRefs.current[i] = el} style={{
                            width: '7px', height: '7px',
                            border: '1px solid #2a3a5a', background: '#08111f',
                            borderRadius: i === 0 ? '50%' : '0',
                            transform: i === 0 ? 'rotate(0deg)' : 'rotate(45deg)',
                            transition: 'background 0.25s, box-shadow 0.25s, transform 0.25s, border-color 0.25s',
                        }} />
                        {/* Home indicator */}
                        {i === 0 && (
                            <span className="nav-label" style={{
                                position: 'absolute', top: '20px', left: '50%',
                                transform: 'translateX(-50%)',
                                fontSize: '8px', color: '#3a5a90',
                                fontFamily: 'var(--font-mono)', userSelect: 'none',
                                letterSpacing: '1px', opacity: 0.7,
                            }}>⌂</span>
                        )}
                    </div>
                ))}
            </div>
        </div>
    )
}

// BioOverlay replaced by in-scene ModularResumePatch
export function BioOverlay() { return null }

// ─── Case Study Overlay — project case study panel, opened on project click ──
const CASE_STUDY_CSS = `
.cs-panel {
    position: fixed;
    inset: 0;
    z-index: 999;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    pointer-events: none;
}
@media (max-width: 768px) {
    .cs-panel {
        align-items: flex-end;
        justify-content: center;
    }
}
.cs-panel.open {
    pointer-events: auto;
}
.cs-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.3s ease;
}
.cs-panel.open .cs-backdrop {
    opacity: 1;
}
.cs-drawer {
    position: relative;
    width: min(640px, 52vw);
    height: 100vh;
    background: rgba(6, 7, 20, 0.82);
    backdrop-filter: blur(28px) saturate(1.4);
    border-left: 1px solid rgba(100, 130, 220, 0.18);
    display: flex;
    flex-direction: column;
    transform: translateX(100%);
    transition: transform 0.5s ease;
}
.cs-panel.open .cs-drawer {
    transform: translateX(0);
}
@media (max-width: 768px) {
    .cs-drawer {
        width: 100vw;
        height: 85vh;
        top: auto;
        bottom: 0;
        right: 0;
        border-radius: 16px 16px 0 0;
        transform: translateY(100%);
    }
    .cs-panel.open .cs-drawer {
        transform: translateY(0);
    }
}
.cs-header {
    padding: 20px 28px;
    border-bottom: 1px solid rgba(100, 130, 220, 0.12);
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
}
.cs-close-btn {
    background: none;
    border: 1px solid rgba(100, 130, 220, 0.25);
    color: #8899cc;
    width: 32px;
    height: 32px;
    min-width: 32px;
    min-height: 32px;
    padding: 0;
    border-radius: 4px;
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
}
.cs-close-btn:hover {
    background: rgba(100, 130, 220, 0.1);
    border-color: rgba(100, 130, 220, 0.4);
    color: #b8d6ff;
}
.cs-body {
    flex: 1;
    overflow-y: auto;
    padding: 32px 28px;
    scrollbar-width: thin;
    scrollbar-color: rgba(100, 130, 220, 0.2) transparent;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
.cs-body::-webkit-scrollbar {
    width: 6px;
}
.cs-body::-webkit-scrollbar-track {
    background: transparent;
}
.cs-body::-webkit-scrollbar-thumb {
    background: rgba(100, 130, 220, 0.2);
    border-radius: 3px;
}
.cs-body::-webkit-scrollbar-thumb:hover {
    background: rgba(100, 130, 220, 0.35);
}
.cs-meta-row {
    display: flex;
    gap: 32px;
    margin-bottom: 36px;
}
.cs-meta-item label {
    font-size: 9px;
    letter-spacing: 0.12em;
    color: #729bec;
    display: block;
    text-transform: uppercase;
}
.cs-meta-item span {
    font-size: 13px;
    color: #8899cc;
    margin-top: 6px;
}
.cs-section {
    margin-bottom: 36px;
}
.cs-section-label {
    font-size: 9px;
    letter-spacing: 0.14em;
    color: #729bec;
    margin-bottom: 8px;
    text-transform: uppercase;
}
.cs-section-title {
    font-size: 18px;
    color: #b8d6ff;
    margin-bottom: 12px;
    font-weight: 500;
}
.cs-section-body {
    font-size: 13px;
    color: #7788bb;
    line-height: 1.7;
}
.cs-quote {
    border-left: 2px solid rgba(100, 130, 220, 0.3);
    padding: 10px 16px;
    margin: 10px 0;
    font-size: 13px;
    color: #8899cc;
    font-style: italic;
    background: rgba(30, 40, 80, 0.2);
}
.cs-feature-grid {
    display: flex;
    flex-direction: column;
    gap: 12px;
}
.cs-feature-card {
    background: rgba(30, 40, 80, 0.4);
    border: 1px solid rgba(100, 130, 220, 0.12);
    border-radius: 4px;
    padding: 14px;
}
.cs-feature-name {
    font-size: 11px;
    letter-spacing: 0.1em;
    color: #00aaff;
    margin-bottom: 6px;
    text-transform: uppercase;
}
.cs-feature-desc {
    font-size: 12px;
    color: #7788bb;
    line-height: 1.5;
    margin-bottom: 8px;
}
.cs-feature-video {
    width: 100%;
    height: auto;
    border-radius: 4px;
    border: 1px solid rgba(100, 130, 220, 0.2);
    display: block;
}
.cs-cta {
    font-size: 13px;
    color: #7788bb;
    line-height: 1.7;
    padding: 16px;
    background: rgba(100, 130, 220, 0.05);
    border: 1px solid rgba(100, 130, 220, 0.1);
    border-radius: 4px;
    margin-bottom: 20px;
}
.cs-placeholder {
    padding: 40px 20px;
    color: #7788bb;
}
.cs-placeholder-title {
    font-size: 16px;
    color: #8899cc;
    margin-bottom: 12px;
}
.cs-img-full { width: 100%; border-radius: 4px; display: block; }
.cs-img-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.cs-img-pair img { width: 100%; border-radius: 4px; display: block; }
.cs-img-stack { display: flex; flex-direction: column; gap: 8px; }
.cs-img-stack img { width: 100%; border-radius: 4px; display: block; }
.cs-img-trio { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
.cs-img-trio img { width: 100%; border-radius: 4px; display: block; }
.cs-img-wrap { margin-bottom: 20px; }
.cs-img-caption { font-size: 11px; color: #7e8aa0; line-height: 1.5; margin-top: 7px; font-family: 'Space Mono', monospace; }
.cs-zoom-overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: rgba(0, 0, 0, 0.92);
    backdrop-filter: blur(20px);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    cursor: zoom-out;
    padding: 40px;
    opacity: 0;
    transition: opacity 0.3s ease;
    pointer-events: none;
}
.cs-zoom-overlay.open {
    opacity: 1;
    pointer-events: auto;
}
.cs-zoom-content {
    position: relative;
    max-width: 90vw;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
}
.cs-zoom-media {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: 8px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}
.cs-zoom-text {
    margin-top: 24px;
    text-align: center;
    max-width: 600px;
}
.cs-zoom-title {
    font-size: 18px;
    color: #b8d6ff;
    margin-bottom: 12px;
    font-weight: 500;
    font-family: 'Space Mono', monospace;
}
.cs-zoom-desc {
    font-size: 14px;
    color: #e8e8e8;
    line-height: 1.6;
    font-family: 'Space Mono', monospace;
}
.cs-zoom-close {
    position: absolute;
    top: 30px;
    right: 30px;
    background: none;
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: white;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    font-size: 24px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
}
.cs-zoom-close:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.4);
}
.cs-media-clickable {
    cursor: zoom-in;
    transition: transform 0.3s ease, filter 0.3s ease;
}
.cs-media-clickable:hover {
    transform: scale(1.02);
    filter: brightness(1.1);
}
@media (max-width: 768px) {
    .cs-zoom-overlay {
        padding: 20px;
    }
    .cs-zoom-close {
        top: 15px;
        right: 15px;
        width: 36px;
        height: 36px;
    }
    .cs-zoom-content {
        max-width: 100%;
        max-height: 90vh;
    }
}
@media (max-width: 480px) {
    .cs-body { padding: 20px 16px; }
    .cs-header { padding: 20px 16px 16px; }
}
`

// ─── Cyberpunk Neon Variant ──
const CASE_STUDY_CSS_NEON = `
@keyframes neon-glow {
    0%, 100% { background: linear-gradient(135deg, rgba(0, 20, 40, 0.9) 0%, rgba(0, 255, 255, 0.05) 50%, rgba(255, 0, 255, 0.03) 100%); }
    50% { background: linear-gradient(135deg, rgba(0, 30, 60, 0.95) 0%, rgba(0, 255, 255, 0.08) 50%, rgba(255, 0, 255, 0.06) 100%); }
}
.cs-panel-neon {
    position: fixed;
    inset: 0;
    z-index: 999;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.3s ease;
}
.cs-panel-neon.open {
    pointer-events: auto;
    opacity: 1;
}
.cs-backdrop-neon {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.8);
    cursor: pointer;
}
.cs-drawer-neon {
    position: relative;
    width: min(640px, 52vw);
    height: 100vh;
    background: linear-gradient(135deg, rgba(0, 20, 40, 0.9) 0%, rgba(0, 255, 255, 0.05) 50%, rgba(255, 0, 255, 0.03) 100%);
    animation: neon-glow 8s ease-in-out infinite;
    border-left: 2px solid #00ffff;
    box-shadow: inset -20px 0 40px rgba(0, 255, 255, 0.1), 0 0 30px rgba(0, 255, 255, 0.3);
    display: flex;
    flex-direction: column;
    transform: translateX(100%);
    transition: transform 0.45s cubic-bezier(0.16, 1, 0.3, 1);
    clip-path: polygon(0 0, calc(100% - 30px) 0, 100% 30px, 100% calc(100% - 20px), calc(100% - 20px) 100%, 0 100%);
}
.cs-panel-neon.open .cs-drawer-neon {
    transform: translateX(0);
}
.cs-header-neon {
    padding: 20px 28px;
    border-bottom: 1px solid rgba(0, 255, 255, 0.4);
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    background: linear-gradient(135deg, rgba(0, 255, 255, 0.05) 0%, transparent 100%);
    box-shadow: 0 4px 15px rgba(0, 255, 255, 0.15);
}
.cs-close-btn-neon {
    background: transparent;
    border: 1px solid rgba(0, 255, 255, 0.5);
    color: #00ffff;
    width: 32px;
    height: 32px;
    min-width: 32px;
    min-height: 32px;
    padding: 0;
    border-radius: 2px;
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    text-shadow: 0 0 8px rgba(0, 255, 255, 0.6);
}
.cs-close-btn-neon:hover {
    background: rgba(0, 255, 255, 0.1);
    border-color: rgba(0, 255, 255, 0.8);
    box-shadow: 0 0 15px rgba(0, 255, 255, 0.8);
}
.cs-body-neon {
    flex: 1;
    overflow-y: auto;
    padding: 32px 28px;
    scrollbar-width: thin;
    scrollbar-color: rgba(0, 255, 255, 0.3) transparent;
    font-family: 'Space Mono', monospace;
}
.cs-body-neon::-webkit-scrollbar {
    width: 6px;
}
.cs-body-neon::-webkit-scrollbar-thumb {
    background: rgba(0, 255, 255, 0.3);
    box-shadow: 0 0 8px rgba(0, 255, 255, 0.5);
}
.cs-meta-row-neon {
    display: flex;
    gap: 32px;
    margin-bottom: 36px;
    padding: 16px;
    background: rgba(0, 255, 255, 0.05);
    border: 1px solid rgba(0, 255, 255, 0.2);
    box-shadow: inset 0 0 20px rgba(0, 255, 255, 0.05);
}
.cs-meta-item-neon label {
    font-size: 9px;
    letter-spacing: 0.2em;
    color: #00ffff;
    display: block;
    text-transform: uppercase;
    text-shadow: 0 0 6px rgba(0, 255, 255, 0.6);
}
.cs-meta-item-neon span {
    font-size: 13px;
    color: #00ffff;
    margin-top: 6px;
    text-shadow: 0 0 8px rgba(0, 255, 255, 0.5);
}
.cs-section-neon {
    margin-bottom: 36px;
    padding: 16px;
    background: rgba(0, 255, 255, 0.03);
    border: 1px solid rgba(0, 255, 255, 0.2);
    border-left: 3px solid rgba(0, 255, 255, 0.6);
}
.cs-section-label-neon {
    font-size: 9px;
    letter-spacing: 0.2em;
    color: #00ffff;
    margin-bottom: 8px;
    text-transform: uppercase;
    text-shadow: 0 0 6px rgba(0, 255, 255, 0.6);
}
.cs-section-title-neon {
    font-size: 18px;
    color: #00ffff;
    margin-bottom: 12px;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    text-shadow: 0 0 10px rgba(0, 255, 255, 0.7);
}
.cs-section-body-neon {
    font-size: 12px;
    color: #00ff88;
    line-height: 1.7;
    text-shadow: 0 0 4px rgba(0, 255, 255, 0.3);
}
.cs-quote-neon {
    border-left: 3px solid #ff00ff;
    padding: 12px 16px;
    margin: 12px 0;
    font-size: 12px;
    color: #ff00ff;
    font-style: italic;
    background: rgba(255, 0, 255, 0.08);
    box-shadow: inset 0 0 15px rgba(255, 0, 255, 0.1), 0 0 10px rgba(255, 0, 255, 0.2);
    text-shadow: 0 0 8px rgba(255, 0, 255, 0.5);
}
.cs-feature-grid-neon {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-top: 12px;
}
.cs-feature-card-neon {
    background: rgba(0, 0, 0, 0.6);
    border: 1px solid rgba(0, 255, 255, 0.4);
    border-radius: 0;
    padding: 14px;
    box-shadow: inset 0 0 15px rgba(0, 255, 255, 0.05), 0 0 15px rgba(0, 255, 255, 0.15);
}
.cs-feature-name-neon {
    font-size: 9px;
    letter-spacing: 0.15em;
    color: #00ffff;
    margin-bottom: 6px;
    text-transform: uppercase;
    text-shadow: 0 0 6px rgba(0, 255, 255, 0.6);
}
.cs-feature-desc-neon {
    font-size: 11px;
    color: #00ff88;
    line-height: 1.5;
    margin-bottom: 8px;
}
.cs-feature-video-neon {
    width: 100%;
    height: auto;
    border: 1px solid rgba(0, 255, 255, 0.3);
    box-shadow: 0 0 10px rgba(0, 255, 255, 0.2);
    display: block;
}
.cs-cta-neon {
    font-size: 12px;
    color: #00ffff;
    line-height: 1.7;
    padding: 16px;
    background: rgba(0, 0, 0, 0.8);
    border: 1px solid rgba(0, 255, 255, 0.4);
    border-left: 3px solid #ff00ff;
    margin-bottom: 20px;
    box-shadow: inset 0 0 15px rgba(0, 255, 255, 0.05), 0 0 20px rgba(0, 255, 255, 0.15);
    text-shadow: 0 0 6px rgba(0, 255, 255, 0.5);
}
`

function CaseStudySection({ section, neon = false, onMediaClick }) {
    const prefix = neon ? '-neon' : ''

    if (section.type === 'intro' || section.type === 'role') {
        return (
            <div className={`cs-section${prefix}`}>
                <div className={`cs-section-label${prefix}`}>{section.label}</div>
                <div className={`cs-section-title${prefix}`}>{section.title}</div>
                <div className={`cs-section-body${prefix}`}>{section.body}</div>
            </div>
        )
    } else if (section.type === 'research') {
        return (
            <div className={`cs-section${prefix}`}>
                <div className={`cs-section-label${prefix}`}>{section.label}</div>
                <div className={`cs-section-title${prefix}`}>{section.title}</div>
                <div className={`cs-section-body${prefix}`}>{section.body}</div>
                {section.stat && <div style={{ marginTop: 12, fontSize: 12, color: neon ? '#00ffff' : '#00aaff', fontWeight: 500, textShadow: neon ? '0 0 6px rgba(0,255,255,0.6)' : 'none' }}>→ {section.stat}</div>}
            </div>
        )
    } else if (section.type === 'quotes') {
        return (
            <div className={`cs-section${prefix}`}>
                <div className={`cs-section-label${prefix}`}>{section.label}</div>
                <div style={{ marginTop: 12 }}>
                    {section.quotes.map((q, i) => (
                        <div key={i} className={`cs-quote${prefix}`}>{q}</div>
                    ))}
                </div>
            </div>
        )
    } else if (section.type === 'features') {
        return (
            <div className={`cs-section${prefix}`}>
                <div className={`cs-section-label${prefix}`}>{section.label}</div>
                <div className={`cs-feature-grid${prefix}`} style={{ marginTop: 12 }}>
                    {section.items.map((item, i) => (
                        <div key={i} className={`cs-feature-card${prefix}`}>
                            <div className={`cs-feature-name${prefix}`}>{item.name}</div>
                            <div className={`cs-feature-desc${prefix}`}>{item.desc}</div>
                            {item.video && (
                                <video
                                    className={`cs-feature-video${prefix} cs-media-clickable`}
                                    src={item.video}
                                    autoPlay
                                    muted
                                    loop
                                    playsInline
                                    onClick={(e) => { e.stopPropagation(); onMediaClick?.({ type: 'video', src: item.video, title: item.name, desc: item.desc }) }}
                                />
                            )}
                            {item.image && (
                                <img
                                    className={`cs-feature-video${prefix} cs-media-clickable`}
                                    src={item.image}
                                    alt=""
                                    onClick={(e) => { e.stopPropagation(); onMediaClick?.({ type: 'image', src: item.image, title: item.name, desc: item.desc }) }}
                                />
                            )}
                        </div>
                    ))}
                </div>
            </div>
        )
    } else if (section.type === 'cta') {
        return (
            <div className={`cs-cta${prefix}`}>
                {section.body}
            </div>
        )
    } else if (section.type === 'images') {
        const handleImgClick = (src) => {
            onMediaClick?.({ type: 'image', src, desc: section.caption })
        }
        return (
            <div className="cs-img-wrap">
                {section.layout === 'pair' ? (
                    <div className="cs-img-pair">
                        {section.images.map((src, i) => <img key={i} src={src} alt="" className="cs-media-clickable" onClick={(e) => { e.stopPropagation(); handleImgClick(src) }} />)}
                    </div>
                ) : section.layout === 'trio' ? (
                    <div className="cs-img-trio">
                        {section.images.map((src, i) => <img key={i} src={src} alt="" className="cs-media-clickable" onClick={(e) => { e.stopPropagation(); handleImgClick(src) }} />)}
                    </div>
                ) : section.layout === 'stack' ? (
                    <div className="cs-img-stack">
                        {section.images.map((src, i) => <img key={i} src={src} alt="" className="cs-media-clickable" onClick={(e) => { e.stopPropagation(); handleImgClick(src) }} />)}
                    </div>
                ) : (
                    <img className="cs-img-full cs-media-clickable" src={section.images[0]} alt="" onClick={(e) => { e.stopPropagation(); handleImgClick(section.images[0]) }} />
                )}
                {section.caption && <div className="cs-img-caption">{section.caption}</div>}
            </div>
        )
    }
    return null
}

function CaseStudyOverlay({ project, onClose }) {
    const [visible, setVisible] = useState(false)
    const [mounted, setMounted] = useState(false)
    const [zoomMedia, setZoomMedia] = useState(null)

    useEffect(() => {
        if (project) {
            setMounted(true)
            requestAnimationFrame(() => setVisible(true))
        } else {
            setVisible(false)
            const t = setTimeout(() => setMounted(false), 500)
            return () => clearTimeout(t)
        }
    }, [project])

    const cachedProjectRef = useRef(null)
    if (project) cachedProjectRef.current = project
    const displayProject = cachedProjectRef.current

    if (!mounted || !displayProject) return null

    const cs = displayProject.caseStudy
    const color = displayProject.color

    return (
        <>
            <style>{CASE_STUDY_CSS}</style>
            <div className={`cs-panel${visible ? ' open' : ''}`}>
                <div className="cs-backdrop" onClick={onClose} />
                <div className="cs-drawer">
                    {/* Header */}
                    <div className="cs-header">
                        <div>
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '16px', color, letterSpacing: '0.08em' }}>{displayProject.title}</div>
                            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '13px', letterSpacing: '0.08em', color: '#556688', marginTop: '6px', lineHeight: 1.5 }}>{displayProject.subtitle}</div>
                        </div>
                        <button className="cs-close-btn" onClick={onClose}>&times;</button>
                    </div>

                    {/* Scrollable body */}
                    <div className="cs-body">
                        {/* Video at the top */}
                        {displayProject.video && (
                            <div style={{ marginBottom: '28px', borderRadius: '4px', overflow: 'hidden', border: `1px solid ${color}22`, background: '#000' }}>
                                <video
                                    src={displayProject.video}
                                    autoPlay
                                    loop
                                    muted
                                    playsInline
                                    style={{ width: '100%', display: 'block' }}
                                />
                            </div>
                        )}

                        {/* Meta row */}
                        {cs?.meta && (
                            <div className="cs-meta-row">
                                {Object.entries(cs.meta).map(([key, val]) => (
                                    <div className="cs-meta-item" key={key}>
                                        <label>{key}</label>
                                        <span>{val}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Case study sections */}
                        {cs?.sections?.map((section, i) => (
                            <CaseStudySection key={i} section={section} onMediaClick={setZoomMedia} />
                        ))}

                        {/* Placeholder if no case study data */}
                        {!cs && (
                            <div className="cs-placeholder">
                                <div className="cs-placeholder-title">Case study coming soon</div>
                                <div style={{ fontSize: '13px', color: '#556688', lineHeight: 1.7 }}>
                                    {displayProject.desc}
                                </div>
                                <div style={{ marginTop: '20px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                    {displayProject.tech.map(t => (
                                        <span key={t} style={{ fontSize: '10px', letterSpacing: '0.1em', color: '#556688', padding: '3px 8px', border: '1px solid #1a2444', borderRadius: '2px', fontFamily: 'var(--font-mono)' }}>{t}</span>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* ZOOM OVERLAY */}
                <div className={`cs-zoom-overlay ${zoomMedia ? 'open' : ''}`} onClick={() => setZoomMedia(null)}>
                    <button className="cs-zoom-close" onClick={() => setZoomMedia(null)}>&times;</button>
                    {zoomMedia && (
                        <div className="cs-zoom-content">
                            {zoomMedia.type === 'video' ? (
                                <video src={zoomMedia.src} className="cs-zoom-media" autoPlay loop muted playsInline onClick={(e) => e.stopPropagation()} />
                            ) : (
                                <img src={zoomMedia.src} className="cs-zoom-media" alt="" onClick={(e) => e.stopPropagation()} />
                            )}
                            {(zoomMedia.title || zoomMedia.desc) && (
                                <div className="cs-zoom-text">
                                    {zoomMedia.title && <div className="cs-zoom-title">{zoomMedia.title}</div>}
                                    {zoomMedia.desc && <div className="cs-zoom-desc">{zoomMedia.desc}</div>}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </>
    )
}

// ─── About panel — right side, shown on final scroll stop ────────────────────
const MOBILE_RING_CSS = `
@keyframes marquee-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
.mobile-marquee {
    position: fixed;
    left: 0; right: 0;
    top: 9%;
    z-index: 5;
    pointer-events: none;
    overflow: hidden;
    padding: 12px 0;
    mask-image: linear-gradient(to right, transparent, black 8%, black 92%, transparent);
    -webkit-mask-image: linear-gradient(to right, transparent, black 8%, black 92%, transparent);
}
.mobile-marquee-track {
    display: flex;
    gap: 14px;
    width: max-content;
    animation: marquee-scroll 14s linear infinite;
    padding: 8px 0;
}
.mobile-marquee-item {
    position: relative;
    width: 180px;
    height: 210px;
    border-radius: 2px;
    overflow: visible;
    flex-shrink: 0;
}
.mobile-marquee-item video {
    width: 100%; height: 100%; object-fit: cover;
    border-radius: 10px;
    border: 1px solid rgba(80,120,255,0.45);
    box-shadow: 0 0 18px rgba(60,100,255,0.35), 0 4px 20px rgba(0,0,0,0.5);
    display: block;
    filter: saturate(0.1) brightness(0.85) contrast(1.1) hue-rotate(180deg);
}
.mobile-marquee-item::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 10px;
    background: repeating-linear-gradient(0deg, rgba(0,0,0,0.08) 0px, rgba(0,0,0,0.08) 1px, transparent 1px, transparent 2px);
    pointer-events: none;
}
@keyframes static-flicker { 0%,100%{opacity:0.18} 50%{opacity:0.22} 33%{opacity:0.14} }
.mobile-marquee-item::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 10px;
    background: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 150' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E");
    background-size: cover;
    mix-blend-mode: overlay;
    opacity: 0.18;
    animation: static-flicker 0.12s steps(1) infinite;
    pointer-events: none;
}
`

const ABOUT_CSS = `
@keyframes about-in {
    from { opacity: 0; transform: translateY(calc(-50% + 12px)); }
    to   { opacity: 1; transform: translateY(-50%); }
}
.about-panel {
    position: fixed;
    right: 80px; top: 50%;
    transform: translateY(-50%);
    width: min(360px, 32vw);
    background: transparent;
    z-index: 80;
    pointer-events: none;
    transition: opacity 0.5s ease;
}
.about-panel.hidden { opacity: 0; pointer-events: none; }
.about-contact-btn { pointer-events: auto; }
.about-panel:not(.hidden) { animation: about-in 0.55s cubic-bezier(0.16,1,0.3,1) both; }
@media (max-width: 768px) {
    .about-panel {
        right: 0;
        bottom: 0;
        top: auto;
        transform: none;
        width: 100vw;
        border-radius: 16px 16px 0 0;
        max-height: 80vh;
        overflow-y: auto;
        padding: 24px 20px calc(28px + 36px + 16px);
        background: rgba(6, 7, 20, 0.92);
        backdrop-filter: blur(20px);
    }
    @keyframes about-in {
        from { opacity: 0; transform: translateY(12px); }
        to   { opacity: 1; transform: translateY(0); }
    }
}
.about-label {
    font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.32em;
    color: rgba(136,160,255,0.4); text-transform: uppercase;
    display: flex; align-items: center; gap: 8px; margin-bottom: 14px;
}
.about-label::after {
    content: ''; flex: 1; height: 1px;
    background: linear-gradient(to right, rgba(100,130,220,0.25), transparent);
}
.about-dot {
    width: 4px; height: 4px; border-radius: 50%;
    background: #3366ff; box-shadow: 0 0 5px #3366ff;
    animation: about-blink 1.4s step-end infinite; flex-shrink: 0;
}
@keyframes about-blink { 0%,100%{opacity:1} 50%{opacity:0} }
.about-name {
    font-family: var(--font-mono); font-size: 18px; letter-spacing: 0.15em;
    color: #eef2ff; margin: 0 0 4px; font-weight: 400;
}
.about-role {
    font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.26em;
    color: rgba(136,160,255,0.45); margin: 0 0 18px; text-transform: uppercase;
}
.about-bio {
    font-family: 'Space Mono', monospace; font-size: 13px;
    color: rgba(180,200,240,0.65); line-height: 1.75; letter-spacing: 0.01em;
    margin: 0 0 18px;
}
.about-bio strong { color: rgba(200,220,255,0.85); font-weight: 400; }
.about-divider {
    height: 1px; background: linear-gradient(to right, rgba(100,130,220,0.2), transparent);
    margin: 0 0 16px;
}
.about-skills { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 18px; }
.about-skill {
    font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.12em;
    color: rgba(100,140,220,0.6); padding: 3px 7px;
    border: 1px solid rgba(80,110,200,0.18); border-radius: 2px;
    text-transform: uppercase;
}
.about-contact {
    display: flex; gap: 12px;
}
.about-contact-btn {
    font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.22em;
    color: rgba(180,210,255,0.9); text-transform: uppercase; text-decoration: none;
    padding: 10px 20px; border: 1px solid rgba(100,150,255,0.45); border-radius: 2px;
    background: rgba(40,70,180,0.12); cursor: pointer;
    box-shadow: 0 0 12px rgba(80,130,255,0.1), inset 0 0 8px rgba(80,130,255,0.06);
    transition: background 0.18s ease, color 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}
.about-contact-btn:hover { background: rgba(50,90,220,0.22); color: #fff; border-color: rgba(120,160,255,0.7); box-shadow: 0 0 20px rgba(80,130,255,0.25), inset 0 0 12px rgba(80,130,255,0.1); }
.about-contact-btn.copied { background: rgba(0,80,40,0.22); color: #00ff88; border-color: rgba(0,200,100,0.2); }
`

const CONTACT_EMAIL = 'hello@mstf.work'

function DossierOverlay({ scrollRef }) {
    const panelRef = useRef()
    const visRef = useRef(false)
    const [copied, setCopied] = useState(false)
    const [visible, setVisible] = useState(false)
    const isMobile = typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches

    const copyEmail = () => {
        navigator.clipboard.writeText(CONTACT_EMAIL)
        setCopied(true)
        setTimeout(() => setCopied(false), 1600)
    }

    useEffect(() => {
        let rafId
        const tick = () => {
            const t = scrollRef.current ?? 0
            const now = t >= DIPTYCH_ENTER
            if (now !== visRef.current) {
                visRef.current = now
                setVisible(now)
                if (panelRef.current)
                    panelRef.current.classList.toggle('hidden', !now)
            }
            rafId = requestAnimationFrame(tick)
        }
        rafId = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(rafId)
    }, [scrollRef])

    return (
        <>
            <style>{ABOUT_CSS}{MOBILE_RING_CSS}</style>
            {isMobile && <MobilePhotoRing visible={visible} />}
            <div ref={panelRef} className="about-panel hidden">
                <div className="about-label">
                    <span className="about-dot" />
                    About
                </div>

                <div className="about-name">MUSTAFA ALI AKBAR</div>
                <div className="about-role">Senior Product Designer</div>

                <p className="about-bio">
                    I design at the intersection of <strong>systems thinking</strong> and <strong>motion</strong> — building products that feel alive without getting in the way. Currently at <strong>Dell</strong>, previously <strong>Motive</strong> and <strong>CBRE</strong>.
                </p>
                <p className="about-bio">
                    I prototype in code and believe the gap between design and engineering is where the best work happens.
                </p>

                <div className="about-divider" />

                <div className="about-skills">
                    {['Figma', 'Blender', 'Three.js', 'React', 'Rive', 'Origami Studio', 'Motion Design', 'Systems Design', 'User Research', 'Prototyping'].map(s => (
                        <span key={s} className="about-skill">{s}</span>
                    ))}
                </div>

                <div className="about-contact">
                    <button onClick={copyEmail} onMouseEnter={() => sfx.piano()} className={`about-contact-btn${copied ? ' copied' : ''}`}>
                        {copied ? 'Copied ✓' : '@ Email'}
                    </button>
                    <a href="https://drive.google.com/file/d/1lFeiToMUnMRtD6pC40q_PyZW01hf9Kus/view?usp=sharing" target="_blank" rel="noopener noreferrer" className="about-contact-btn" onMouseEnter={() => sfx.piano()}>
                        ↓ Resume
                    </a>
                </div>
            </div>
        </>
    )
}

function MobilePhotoRing({ visible }) {
    const doubled = [...PHOTO_PATHS, ...PHOTO_PATHS]
    return (
        <div className="mobile-marquee" style={{ opacity: visible ? 1 : 0, transition: 'opacity 0.6s ease' }}>
            <div className="mobile-marquee-track">
                {doubled.map((p, i) => (
                    <div key={i} className="mobile-marquee-item">
                        <video src={p.src} autoPlay loop muted playsInline />
                    </div>
                ))}
            </div>
        </div>
    )
}

// ═════════════════════════════════════════════════════════════════════════════
// MODULAR RESUME PATCH BAY
// ═════════════════════════════════════════════════════════════════════════════

const COMPANY_NODES = [
    { id: 'dell', pos: [-5.5, 2.4, 0], title: 'DELL', desc: 'AI-based Data Center Alerts // 2026', color: '#0076CE' },
    { id: 'cbre', pos: [-5.5, 0.8, 0], title: 'CBRE', desc: 'VISUAL LANG // 2025\nINTERACTION DESIGN', color: '#003F2D' },
    { id: 'motive', pos: [-5.5, -0.8, 0], title: 'MOTIVE', desc: 'PRODUCT UX // 2024\nENTERPRISE SYSTEMS', color: '#FF6B00' },
    { id: 'educative', pos: [-5.5, -2.4, 0], title: 'EDUCATIVE', desc: 'UX DESIGN // 2023\nLEARNING SYSTEMS', color: '#5553FF' },
]
const HUB_POS = [0, 0, 0]
const CUBE_POS = [5.5, 0, 0]

const LOGO_TEXTURES = {
    'cbre': '/textures/logos/2/27/cbre.png',
    'motive': '/textures/logos/motive-logo.png',
    'educative': '/textures/logos/educative-logo.png',
    'dell': '/textures/logos/dell-log.png',
}

// Company card — holographic logo display, label to the left, data readout to the right
function SynthNode({ config, isActive, onClick, onHover, onHoverOut, visible, isMobile }) {
    const { gl } = useThree()
    const [texture, setTexture] = useState(null)
    useEffect(() => {
        const path = LOGO_TEXTURES[config.id]
        if (!path) return
        const loader = new THREE.TextureLoader()
        loader.load(path, (tex) => {
            tex.anisotropy = gl.capabilities.getMaxAnisotropy()
            tex.needsUpdate = true
            setTexture(tex)
        }, undefined, (err) => console.warn('Logo load failed:', config.id, err))
    }, [config.id, gl])
    const meshRef = useRef()
    const groupRef = useRef()
    const [hovered, setHovered] = useState(false)
    const hoveredRef = useRef(false)

    useEffect(() => {
        if (!visible && hoveredRef.current) {
            hoveredRef.current = false
            setHovered(false)
            onHoverOut?.()
        }
    }, [visible])

    useFrame(() => {
        if (groupRef.current) {
            groupRef.current.rotation.y = (hoveredRef.current ? 0.15 : 0.08) + Math.sin(Date.now() * 0.0003) * 0.05
            groupRef.current.rotation.x = (hoveredRef.current ? -0.1 : -0.05) + Math.cos(Date.now() * 0.0004) * 0.03
        }
        if (meshRef.current) {
            const targetScale = hoveredRef.current ? 1.15 : 1.0
            meshRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.15)
        }
    })

    return (
        <group position={config.pos} ref={groupRef}
            onClick={e => { e.stopPropagation(); onClick() }}
            onPointerOver={() => { if (!hoveredRef.current) { hoveredRef.current = true; setHovered(true); sfx.piano(); onHover?.() } }}
            onPointerOut={() => { hoveredRef.current = false; setHovered(false); onHoverOut?.() }}
        >
            {/* Bevelled cube body */}
            <RoundedBox
                ref={meshRef}
                args={[0.75, 0.75, 0.75]} radius={0.09} smoothness={4}
            >
                <meshStandardMaterial
                    color="#0a0a1a"
                    emissive={config.color}
                    emissiveIntensity={isActive ? 0.35 : (hovered ? 0.15 : 0.05)}
                    metalness={0.85} roughness={0.08}
                    transparent opacity={isActive ? 0.6 : (hovered ? 0.5 : 0.38)}
                    toneMapped={false}
                />
            </RoundedBox>

            {/* Point light inside the cube */}
            <pointLight
                color={config.color}
                intensity={isActive ? 2.2 : (hovered ? 1.1 : 0.5)}
                distance={2.5}
                decay={2}
            />

            {/* Logo planes on front and back — flat emissive so dark logos still glow */}
            {[0.38, -0.38].map((z, idx) => (
                <mesh key={idx} position={[0, 0, z]} rotation={[0, idx === 1 ? Math.PI : 0, 0]}>
                    <planeGeometry args={[0.45, 0.45]} />
                    <meshStandardMaterial
                        map={texture}
                        emissive={config.color}
                        emissiveIntensity={isActive ? 1.8 : (hovered ? 1.1 : 0.6)}
                        transparent alphaTest={0.05}
                        metalness={0.1} roughness={0.3}
                        toneMapped={false}
                    />
                </mesh>
            ))}

            {/* Wireframe box outline — sci-fi bevel edge highlight */}
            <mesh>
                <boxGeometry args={[0.84, 0.84, 0.84]} />
                <meshBasicMaterial
                    color={config.color}
                    wireframe
                    transparent
                    opacity={isActive ? 0.75 : (hovered ? 0.45 : 0.18)}
                    toneMapped={false}
                />
            </mesh>

            <pointLight color={config.color} intensity={isActive ? 1.8 : (hovered ? 0.8 : 0.3)} distance={3} />

            {/* Label — to the left of the jack */}
            {!isMobile && <Text
                position={[-0.7, 0, 0.5]}
                font="/fonts/Rocket%20Command/rocketcommandexpand.ttf"
                fontSize={0.2} letterSpacing={0.08} anchorX="right" anchorY="middle"
                color={hovered || isActive ? config.color : '#2a3d55'}
                material-toneMapped={false}
                material-depthTest={false}
                renderOrder={5}
            >{config.title}</Text>}

            {/* Active ring highlight */}
            {isActive && (
                <mesh rotation={[Math.PI / 2, 0, 0]}>
                    <ringGeometry args={[0.52, 0.58, 32]} />
                    <meshBasicMaterial color={config.color} transparent opacity={0.6} toneMapped={false} />
                </mesh>
            )}
        </group>
    )
}

// Central resume hub — glowing icosahedron with orbiting ring
function ResumeHub({ currentSectionRef }) {
    const meshRef = useRef()
    const ringRef = useRef()
    const [hovered, setHovered] = useState(false)
    useFrame((_, delta) => {
        if (meshRef.current) meshRef.current.rotation.y += delta * 0.4
        if (ringRef.current) ringRef.current.rotation.z -= delta * 0.6
    })
    const goToDossier = (e) => {
        e.stopPropagation()
        if (currentSectionRef) currentSectionRef.current = SECTION_STOPS.length - 1
        if (!sfx.isMuted()) {
            const pick = getItemPick1Audio(); pick.currentTime = 0; pick.play().catch(() => {})
        }
        sfx.snap()
        if (!sfx.isMuted() && !_ambientPianoAudio) {
            _ambientPianoAudio = new Audio('/sounds/AmbientPianoLoop10-790BPM.m4a')
            _ambientPianoAudio.loop = true
            _ambientPianoAudio.volume = 0.35
            _ambientPianoAudio.play().catch(() => {})
        }
    }
    return (
        <group position={HUB_POS}>
            <mesh ref={meshRef}
                onClick={goToDossier}
                onPointerEnter={e => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'crosshair'; sfx.piano() }}
                onPointerLeave={() => { setHovered(false); document.body.style.cursor = 'auto' }}
            >
                <icosahedronGeometry args={[0.7, 1]} />
                <meshStandardMaterial
                    color="#eef2ff" emissive="#3366ff" emissiveIntensity={hovered ? 1.2 : 0.6}
                    metalness={0.8} roughness={0.1} toneMapped={false}
                />
            </mesh>
            <mesh ref={ringRef}>
                <torusGeometry args={[1.1, 0.02, 8, 64]} />
                <meshBasicMaterial color="#3366ff" transparent opacity={0.45} toneMapped={false} />
            </mesh>
            <pointLight color="#3366ff" intensity={2.5} distance={7} />
        </group>
    )
}

// Locked cube — represents the next role
function LockedCube({ onHover, onHoverOut, onClick, visible }) {
    const meshRef = useRef()
    const wireRef = useRef()
    const [hovered, setHovered] = useState(false)
    const hoveredRef = useRef(false)

    useEffect(() => {
        if (!visible && hoveredRef.current) {
            hoveredRef.current = false
            setHovered(false)
            onHoverOut?.()
        }
    }, [visible])

    useFrame((_, delta) => {
        const speed = hoveredRef.current ? 1.2 : 0.35
        if (meshRef.current) {
            meshRef.current.rotation.y += delta * speed
            meshRef.current.rotation.x += delta * speed * 0.4
        }
        if (wireRef.current) {
            wireRef.current.rotation.copy(meshRef.current.rotation)
        }
    })

    return (
        <group
            onPointerOver={() => { if (!hoveredRef.current) { hoveredRef.current = true; setHovered(true); sfx.piano(); onHover?.() } }}
            onPointerOut={() => { hoveredRef.current = false; setHovered(false); onHoverOut?.() }}
            onClick={e => { e.stopPropagation(); onClick?.() }}
        >
            <mesh ref={meshRef}>
                <boxGeometry args={[1.1, 1.1, 1.1]} />
                <meshStandardMaterial
                    color="#0a0a1a"
                    emissive={hovered ? '#2244aa' : '#0a1a55'}
                    emissiveIntensity={hovered ? 1.2 : 0.7}
                    metalness={0.9} roughness={0.15} toneMapped={false}
                />
            </mesh>
            <mesh ref={wireRef}>
                <boxGeometry args={[1.16, 1.16, 1.16]} />
                <meshBasicMaterial
                    color={hovered ? '#6688cc' : '#3355aa'}
                    wireframe transparent
                    opacity={hovered ? 0.85 : 0.55}
                    toneMapped={false}
                />
            </mesh>

            {/* Label below */}
            <Text position={[0, -0.9, 0]}
                font="/fonts/Rocket%20Command/rocketcommandexpand.ttf"
                fontSize={0.22} letterSpacing={0.1} anchorX="center" anchorY="middle"
                color={hovered ? '#6688cc' : '#3355aa'}
                material-toneMapped={false}
            >{'???'}</Text>

            {/* Hover hint */}
            {hovered && (
                <group>
                    <Line points={[[0.55, 0, 0], [1.0, 0.5, 0], [1.5, 0.5, 0]]}
                        color="#3366ff" lineWidth={0.7} transparent opacity={0.5} />
                    <Text position={[1.6, 0.5, 0.5]}
                        font={SUBTITLE_FONT}
                        fontSize={0.14} lineHeight={1.5} anchorX="left" anchorY="middle"
                        color="#aabbcc" material-toneMapped={false} material-transparent={true}
                        material-depthTest={false} renderOrder={5}
                    >{'NEXT_ROLE.EXE\n???.???.????'}</Text>
                </group>
            )}
        </group>
    )
}

// Samples a quadratic bezier, orients each spine cog along the tangent
function SpineChain({ start, end, mid, color, active, interactive = true, segments = 20, rotationSpeed = 1.5, paused = false, targetSpeed = null, cogScale = 0.28 }) {
    const { scene } = useGLTF('/spine.glb')
    const _up = useMemo(() => new THREE.Vector3(0, 0, 1), [])
    const spinRefs = useRef([])
    const posRefs = useRef([])
    const hoveredIdxRef = useRef(-1)
    const prevHoveredIdxRef = useRef(-1)
    const spreadOffsets = useRef([])
    const frameCountRef = useRef(0)
    const lastEnterFrameRef = useRef(-100)
    const directions = useMemo(() => Array.from({ length: segments }, () => Math.random() < 0.5 ? 1 : -1), [segments])
    const speedRef = useRef(1)

    const transforms = useMemo(() => {
        const s = new THREE.Vector3(...start)
        const m = new THREE.Vector3(...mid)
        const e = new THREE.Vector3(...end)
        return Array.from({ length: segments }, (_, i) => {
            const t = i / segments
            const tm = (i + 0.5) / segments   // midpoint t for tangent
            const mt = 1 - t, mtm = 1 - tm
            const pos = new THREE.Vector3(
                mt * mt * s.x + 2 * mt * t * m.x + t * t * e.x,
                mt * mt * s.y + 2 * mt * t * m.y + t * t * e.y,
                mt * mt * s.z + 2 * mt * t * m.z + t * t * e.z,
            )
            // Quadratic bezier derivative (tangent)
            const tan = new THREE.Vector3(
                2 * mtm * (m.x - s.x) + 2 * tm * (e.x - m.x),
                2 * mtm * (m.y - s.y) + 2 * tm * (e.y - m.y),
                2 * mtm * (m.z - s.z) + 2 * tm * (e.z - m.z),
            ).normalize()
            const quat = new THREE.Quaternion().setFromUnitVectors(_up, tan)
            return { pos: pos.toArray(), quat }
        })
    }, [start, end, mid, segments, _up])

    const clones = useMemo(
        () => transforms.map(() => {
            const c = scene.clone(true)
            c.traverse(child => { if (child.isMesh) child.material = child.material.clone() })
            return c
        }),
        // only rebuild if segment count or base scene changes
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [scene, segments]
    )

    useEffect(() => {
        clones.forEach(c => c.traverse(child => {
            if (!child.isMesh) return
            child.material.emissive?.set(color)
            child.material.emissiveIntensity = active ? 0.9 : 0.08
            child.material.toneMapped = false
        }))
    }, [active, color, clones])

    useFrame((_, delta) => {
        // Clear hover if no cog refreshed the frame counter in the last 8 frames
        // (2 was too tight — edge-on cogs miss pointerOver intermittently, causing snapping)
        frameCountRef.current++
        if (frameCountRef.current - lastEnterFrameRef.current > 8) hoveredIdxRef.current = -1

        // Spin each cog — smoothly decelerates/accelerates on pause/resume
        // targetSpeed takes precedence: use it if provided, otherwise use paused flag
        const target = targetSpeed !== null ? targetSpeed : (paused ? 0 : 1)
        speedRef.current = dampValue(speedRef.current, target, 5, delta)
        spinRefs.current.forEach((ref, i) => {
            if (ref) ref.rotation.z += delta * rotationSpeed * directions[i] * speedRef.current
        })

        // Soft-selection spread — Blender proportional edit style
        const SPREAD_RADIUS = 7   // influence in index units
        const SPREAD_STRENGTH = 0.85  // world-unit max lift
        const hovIdx = hoveredIdxRef.current
        transforms.forEach((t, i) => {
            const posRef = posRefs.current[i]
            if (!posRef) return
            if (!spreadOffsets.current[i]) spreadOffsets.current[i] = 0
            const dist = hovIdx >= 0 ? Math.abs(i - hovIdx) : SPREAD_RADIUS
            const falloff = dist < SPREAD_RADIUS ? Math.pow(1 - dist / SPREAD_RADIUS, 2) : 0
            spreadOffsets.current[i] = dampValue(spreadOffsets.current[i], SPREAD_STRENGTH * falloff, 3.5, delta)
            posRef.position.set(t.pos[0], t.pos[1] + spreadOffsets.current[i], t.pos[2])
        })
    })

    return (
        <group>
            {transforms.map((t, i) => (
                // outer group: orient cog along bezier tangent; inner group: spin
                <group key={i}
                    ref={el => { if (el) posRefs.current[i] = el }}
                    position={t.pos}
                    quaternion={t.quat}
                    onPointerOver={interactive ? (e => { e.stopPropagation(); hoveredIdxRef.current = i; lastEnterFrameRef.current = frameCountRef.current; if (i !== prevHoveredIdxRef.current) { prevHoveredIdxRef.current = i; sfx.piano() } }) : undefined}
                    onPointerMove={interactive ? (e => { e.stopPropagation(); hoveredIdxRef.current = i; lastEnterFrameRef.current = frameCountRef.current }) : undefined}>
                    <group ref={el => { if (el) { if (!spinRefs.current[i]) el.rotation.z = i * 0.22; spinRefs.current[i] = el } }}>
                        <primitive object={clones[i]} scale={cogScale} rotation={[Math.PI, 0, 0]} />
                    </group>
                </group>
            ))}
        </group>
    )
}

// Straight-line chain — cogs positioned along a lerp instead of bezier
function StraightChain({ start = [0, 0, 0], end = [5, 0, 0], color = '#3366ff', active = false, interactive = false, segments = 20, rotationSpeed = 1.5, paused = false, targetSpeed = null, cogScale = 0.28 }) {
    const { scene } = useGLTF('/spine.glb')
    const _up = useMemo(() => new THREE.Vector3(0, 0, 1), [])
    const spinRefs = useRef([])
    const posRefs = useRef([])
    const hoveredIdxRef = useRef(-1)
    const prevHoveredIdxRef = useRef(-1)
    const spreadOffsets = useRef([])
    const frameCountRef = useRef(0)
    const lastEnterFrameRef = useRef(-100)
    const directions = useMemo(() => Array.from({ length: segments }, () => Math.random() < 0.5 ? 1 : -1), [segments])
    const speedRef = useRef(1)

    const transforms = useMemo(() => {
        const s = new THREE.Vector3(...start)
        const e = new THREE.Vector3(...end)
        const tan = new THREE.Vector3().subVectors(e, s).normalize()
        const quat = new THREE.Quaternion().setFromUnitVectors(_up, tan)
        return Array.from({ length: segments }, (_, i) => {
            const t = i / (segments - 1)
            const pos = new THREE.Vector3().lerpVectors(s, e, t)
            return { pos: pos.toArray(), quat }
        })
    }, [start, end, segments, _up])

    const clones = useMemo(
        () => transforms.map(() => {
            const c = scene.clone(true)
            c.traverse(child => { if (child.isMesh) child.material = child.material.clone() })
            return c
        }),
        // only rebuild if segment count or base scene changes
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [scene, segments]
    )

    useEffect(() => {
        clones.forEach(c => c.traverse(child => {
            if (!child.isMesh) return
            child.material.emissive?.set(color)
            child.material.emissiveIntensity = active ? 0.9 : 0.08
            child.material.toneMapped = false
        }))
    }, [active, color, clones])

    useFrame((_, delta) => {
        frameCountRef.current++
        if (frameCountRef.current - lastEnterFrameRef.current > 8) hoveredIdxRef.current = -1

        // targetSpeed takes precedence: use it if provided, otherwise use paused flag
        const target = targetSpeed !== null ? targetSpeed : (paused ? 0 : 1)
        speedRef.current = dampValue(speedRef.current, target, 5, delta)
        spinRefs.current.forEach((ref, i) => {
            if (ref) ref.rotation.z += delta * rotationSpeed * directions[i] * speedRef.current
        })

        const SPREAD_RADIUS = 7
        const SPREAD_STRENGTH = 0.85
        const hovIdx = hoveredIdxRef.current
        transforms.forEach((t, i) => {
            const posRef = posRefs.current[i]
            if (!posRef) return
            if (!spreadOffsets.current[i]) spreadOffsets.current[i] = 0
            const dist = hovIdx >= 0 ? Math.abs(i - hovIdx) : SPREAD_RADIUS
            const falloff = dist < SPREAD_RADIUS ? Math.pow(1 - dist / SPREAD_RADIUS, 2) : 0
            spreadOffsets.current[i] = dampValue(spreadOffsets.current[i], SPREAD_STRENGTH * falloff, 3.5, delta)
            posRef.position.set(t.pos[0], t.pos[1] + spreadOffsets.current[i], t.pos[2])
        })
    })

    return (
        <group>
            {transforms.map((t, i) => (
                <group key={i}
                    ref={el => { if (el) posRefs.current[i] = el }}
                    position={t.pos}
                    quaternion={t.quat}
                    onPointerOver={interactive ? (e => {
                        e.stopPropagation();
                        hoveredIdxRef.current = i;
                        lastEnterFrameRef.current = frameCountRef.current;
                        if (i !== prevHoveredIdxRef.current) {
                            prevHoveredIdxRef.current = i;
                            sfx.piano();
                        }
                    }) : undefined}
                    onPointerMove={interactive ? (e => { e.stopPropagation(); hoveredIdxRef.current = i; lastEnterFrameRef.current = frameCountRef.current }) : undefined}>
                    <group ref={el => { if (el) { if (!spinRefs.current[i]) el.rotation.z = i * 0.22; spinRefs.current[i] = el } }}>
                        <primitive object={clones[i]} scale={cogScale} rotation={[Math.PI, 0, 0]} />
                    </group>
                </group>
            ))}
        </group>
    )
}

function ModularResumePatch({ visible, currentSectionRef }) {
    const { size } = useThree()
    const isPortrait = size.width < size.height
    const companyNodes = isPortrait
        ? COMPANY_NODES.map((n, i) => ({ ...n, pos: [-2.4 + i * 1.6, 2.5, 0] }))
        : COMPANY_NODES
    const hubPos = isPortrait ? [0, 0, 0] : HUB_POS
    const cubePos = isPortrait ? [0, -2.5, 0] : CUBE_POS

    const groupRef = useRef()
    const [activeId, setActiveId] = useState(null)
    const [cubeActive, setCubeActive] = useState(false)
    const [hoveredNodeId, setHoveredNodeId] = useState(null)
    const [cubeHovered, setCubeHovered] = useState(false)
    const [companyPaused, setCompanyPaused] = useState(() => COMPANY_NODES.map(() => false))
    const staggerTimers = useRef([])

    // When cube is hovered or company is selected, adjust pause states
    useEffect(() => {
        staggerTimers.current.forEach(clearTimeout)
        staggerTimers.current = []
        if (cubeHovered) {
            // Cube hovered: pause all companies
            setCompanyPaused(COMPANY_NODES.map(() => true))
        } else if (activeId) {
            // Company selected: pause all except selected
            setCompanyPaused(COMPANY_NODES.map(node => node.id !== activeId))
        } else {
            // No interaction: resume all
            setCompanyPaused(COMPANY_NODES.map(() => false))
        }
        return () => staggerTimers.current.forEach(clearTimeout)
    }, [cubeHovered, activeId])

    // Initialize off-screen so the slide-in plays correctly (never reset by re-renders)
    const groupInitRef = useRef(false)
    useEffect(() => {
        if (!groupInitRef.current && groupRef.current) {
            groupRef.current.position.y = 10
            groupInitRef.current = true
        }
    }, [])

    useFrame((_, delta) => {
        if (!groupRef.current) return
        groupRef.current.position.y = dampValue(groupRef.current.position.y, visible ? 0 : 10, 4, delta)
    })

    // Clear active company when clicking empty space
    const onBackgroundClick = useCallback((e) => {
        // Only if the click wasn't on a SynthNode (they stopPropagation)
        setActiveId(null)
        setCubeActive(false)
    }, [])

    return (
        <group ref={groupRef} visible={visible} onClick={onBackgroundClick}>
            {/* Company → Resume spine chains */}
            {companyNodes.map((node, i) => {
                let targetSpeed = 1.0
                if (cubeHovered) {
                    targetSpeed = 0
                } else if (activeId === node.id) {
                    targetSpeed = 0.4
                } else if (activeId) {
                    targetSpeed = 0
                }
                return (
                    <SpineChain
                        key={node.id}
                        start={node.pos} end={hubPos}
                        mid={[(node.pos[0] + hubPos[0]) / 2, node.pos[1] - 1.8, 0]}
                        color={node.color}
                        active={activeId === node.id}
                        targetSpeed={targetSpeed}
                        interactive={false}
                    />
                )
            })}

            {/* Resume → Cube spine chain */}
            {(() => {
                let cubeTargetSpeed = 1.0
                if (cubeHovered) cubeTargetSpeed = 0.4
                else if (activeId) cubeTargetSpeed = 0
                return (
                    <SpineChain
                        start={hubPos} end={cubePos}
                        mid={[(hubPos[0] + cubePos[0]) / 2, (hubPos[1] + cubePos[1]) / 2 - 2, 0]}
                        color="#3366ff"
                        active={false}
                        targetSpeed={cubeTargetSpeed}
                        interactive={false}
                    />
                )
            })()}

            {companyNodes.map(node => (
                <SynthNode
                    key={node.id} config={node}
                    isActive={activeId === node.id}
                    onClick={() => setActiveId(id => id === node.id ? null : node.id)}
                    onHover={() => setHoveredNodeId(node.id)}
                    onHoverOut={() => setHoveredNodeId(null)}
                    visible={visible}
                    isMobile={isPortrait}
                />
            ))}

            <group position={hubPos}>
                <ResumeHub currentSectionRef={currentSectionRef} />
            </group>
            <group position={cubePos}>
                <LockedCube
                    onHover={() => setCubeHovered(true)}
                    onHoverOut={() => setCubeHovered(false)}
                    onClick={() => { setActiveId(null); setCubeActive(a => !a) }}
                    visible={visible}
                />
            </group>

            {/* Centered DOM popup — shown above the card row when a node or cube is active */}
            {(activeId || cubeActive) && (() => {
                const node = companyNodes.find(n => n.id === activeId)
                const color = node ? node.color : '#3355aa'
                const text = node ? node.desc : 'NEXT_ROLE.EXE\n???.???.????\n\nOpen to new opportunities.'
                return (
                    <Html
                        position={[0, 0, 0]}
                        style={{ pointerEvents: 'none' }}
                        zIndexRange={[100, 0]}
                    >
                        <div style={{
                            position: 'fixed',
                            left: '50%',
                            top: '12%',
                            transform: 'translateX(-50%)',
                            background: 'rgba(5,8,20,0.88)',
                            border: `1px solid ${color}44`,
                            borderLeft: `2px solid ${color}`,
                            padding: '10px 18px',
                            borderRadius: '4px',
                            color: '#aabbcc',
                            fontFamily: 'var(--font-mono)',
                            fontSize: '12px',
                            lineHeight: '1.6',
                            letterSpacing: '0.5px',
                            whiteSpace: 'pre-line',
                            textAlign: 'left',
                            maxWidth: 'min(420px, calc(100vw - 32px))',
                            boxShadow: `0 0 18px ${color}22`,
                        }}>{text}</div>
                    </Html>
                )
            })()}
        </group>
    )
}

// ─── Glitch bust — me flickers into robot-hologram every few seconds ──────────
function GlitchBust({ position = [0, 0, 0], scale = 4, rotSpeed = 0.06, dimmed = false }) {
    const { scene: humanScene } = useGLTF('/me.glb')
    const { scene: robotScene } = useGLTF('/also-me.glb')

    const humanClone = useMemo(() => humanScene.clone(true), [humanScene])
    const robotClone = useMemo(() => {
        const c = robotScene.clone(true)
        c.traverse(child => {
            if (!child.isMesh || !child.material) return
            const orig = Array.isArray(child.material) ? child.material[0] : child.material
            // Copy original material and enhance with chrome properties
            child.material = orig.clone()
            child.material.roughness = 0.18
            child.material.metalness = 0.85
            child.material.transparent = true
            child.material.opacity = 0.85
            child.material.side = THREE.DoubleSide
        })
        return c
    }, [robotScene])

    const spinRef = useRef()
    const humanRef = useRef()
    const robotRef = useRef()
    const jitterRef = useRef()
    const dimFactorRef = useRef(1)

    // Pre-collect meshes and set transparency to avoid per-frame traversal and ensure opacity works
    const meshCache = useMemo(() => {
        const meshes = []
        const prep = (obj) => {
            obj.traverse(c => {
                if (c.isMesh && c.material) {
                    const materials = Array.isArray(c.material) ? c.material : [c.material]
                    materials.forEach(m => {
                        m.transparent = true
                        m.needsUpdate = true
                    })
                    meshes.push({ mesh: c, originalOpacity: c.material.opacity ?? 1 })
                }
            })
        }
        prep(humanClone)
        prep(robotClone)
        return meshes
    }, [humanClone, robotClone])
    const g = useRef({ phase: 'human', timer: 0, ft: 0, next: 6 + Math.random() * 6 })

    const wander = useRef({ target: 0, timer: 0, next: 2 + Math.random() * 3 })

    useFrame((state, delta) => {
        const w = wander.current
        w.timer += delta
        if (w.timer >= w.next) {
            w.target = (Math.random() - 0.5) * 0.55
            w.timer = 0
            w.next = 2.5 + Math.random() * 4.0
        }
        if (spinRef.current)
            spinRef.current.rotation.y = dampValue(spinRef.current.rotation.y, w.target, 0.6, delta)

        const s = g.current
        s.timer += delta

        // Handle dimming
        dimFactorRef.current = dampValue(dimFactorRef.current, dimmed ? 0.15 : 1, 6, delta)
        meshCache.forEach(({ mesh, originalOpacity }) => {
            mesh.material.opacity = originalOpacity * dimFactorRef.current
        })

        if (s.phase === 'human') {
            if (s.timer > s.next) { s.phase = 'to_robot'; s.ft = 0; s.timer = 0 }

        } else if (s.phase === 'to_robot' || s.phase === 'to_human') {
            s.ft += delta
            const show = Math.floor(s.ft * 80) % 2 === 0
            if (humanRef.current) humanRef.current.visible = s.phase === 'to_robot' ? show : !show
            if (robotRef.current) robotRef.current.visible = s.phase === 'to_robot' ? !show : show
            if (jitterRef.current) {
                jitterRef.current.position.x = (Math.random() - 0.5) * 0.09
                jitterRef.current.position.y = (Math.random() - 0.5) * 0.06
            }
            if (s.ft > 0.28) {
                const landing = s.phase === 'to_robot' ? 'to_human' : 'human'
                s.phase = landing; s.timer = 0
                if (landing === 'human') {
                    if (humanRef.current) humanRef.current.visible = true
                    if (robotRef.current) robotRef.current.visible = false
                    s.next = 6 + Math.random() * 6
                }
                if (jitterRef.current) { jitterRef.current.position.x = 0; jitterRef.current.position.y = 0 }
            }
        }
    })

    return (
        <group position={position} scale={scale}>
            <group ref={jitterRef}>
                <group ref={spinRef}>
                    <group ref={humanRef}><primitive object={humanClone} /></group>
                    <group ref={robotRef} visible={false}><primitive object={robotClone} /></group>
                </group>
            </group>
        </group>
    )
}

// ─── Diptych — bust + resume side-by-side revealed on final scroll ────────────
const DIPTYCH_ENTER = 1.06   // appears as camera approaches dossier stop
const DOSSIER_SWAY_AMP = -0.12
const DOSSIER_SWAY_FREQ = 1.0
const DOSSIER_RING_ROTATION = [-0.15, 0.5, -0.15]

const RESUME_CSS = `
.dossier { width:240px; background:#f7f6f2; color:#111; font-family:'Georgia',serif;
           padding:28px 24px; box-shadow:0 44px 32px rgba(0,0,0,0.22); user-select:none }
.dossier h1 { font-size:17px; font-weight:700; letter-spacing:0.06em; margin:0 0 3px }
.dossier .role { font-size:8.5px; letter-spacing:0.22em; color:#555; margin:0 0 16px; font-family:'Courier New',monospace }
.dossier hr { border:none; border-top:1px solid #ccc; margin:0 0 14px }
.dossier .section { font-size:7.5px; letter-spacing:0.2em; color:#888; margin:0 0 6px; font-family:'Courier New',monospace }
.dossier .entry { font-size:10px; line-height:1.7; margin:0 0 10px; color:#222 }
.dossier .entry strong { display:block; font-size:10px; font-weight:700 }
.dossier .entry span { font-size:9px; color:#666 }
.dossier .skills { font-size:9px; color:#444; line-height:2; letter-spacing:0.04em }
`

// ─── Photo Ring train intro ────────────────────────────────────────────────────
// Track: straight from off-screen bottom-left → joint → one full ring orbit.
// All coords in PhotoRing LOCAL space (ring center=[0,0,0], ring in XZ plane, r=70).
//
// Joint = photo 8's ring position so the rear bogey detaches first as it enters.
// Circle goes CCW (increasing angle); photos encountered in order 8,0,1,2,3,4,5,6,7.
// Train order engine→rear: engine, photo0, photo1, …, photo8.
// Detach order rear→front: photo8 first, photo0 last.
const TRAIN_N_STR = 50, TRAIN_N_CIR = 120, TRAIN_N_TOT = 170
const TRAIN_JOINT_ANGLE = (8 / 9) * Math.PI * 2          // ≈ 320° — photo 8's ring pos

const TRAIN_PATH = (() => {
    const pts = new Float32Array(TRAIN_N_TOT * 3)
    const jx = Math.cos(TRAIN_JOINT_ANGLE) * 70
    const jz = Math.sin(TRAIN_JOINT_ANGLE) * 70
    // Tangent direction at joint angle (CCW circle tangent = perpendicular to radius)
    const tx = -Math.sin(TRAIN_JOINT_ANGLE)
    const tz = Math.cos(TRAIN_JOINT_ANGLE)
    // Straight approach: arrive tangentially from just outside the ring edge, no big sweep
    for (let i = 0; i < TRAIN_N_STR; i++) {
        const t = i / (TRAIN_N_STR - 1)
        // ease-in so first appearance is slow
        const ease = t * t
        pts[i * 3] = THREE.MathUtils.lerp(jx - tx * 55, jx, ease)
        pts[i * 3 + 1] = THREE.MathUtils.lerp(-18, 0, ease)
        pts[i * 3 + 2] = THREE.MathUtils.lerp(jz - tz * 55, jz, ease)
    }
    for (let i = 0; i < TRAIN_N_CIR; i++) {
        const a = TRAIN_JOINT_ANGLE + (i / TRAIN_N_CIR) * Math.PI * 2
        pts[(TRAIN_N_STR + i) * 3] = Math.cos(a) * 70
        pts[(TRAIN_N_STR + i) * 3 + 1] = 0
        pts[(TRAIN_N_STR + i) * 3 + 2] = Math.sin(a) * 70
    }
    return pts
})()

const BOGEY_SPACING = 0.014  // tighter — cards stay close together, less card-deck spread
const TRAIN_RATE = 0.13   // slower — smooth, unhurried entrance
const DETACH_START = 0.70   // trainHead when photo 8 (rear bogey) detaches
const DETACH_STEP = 0.07   // trainHead increment between successive detachments
const SPINE_FADE_HEAD = DETACH_START + 8 * DETACH_STEP   // ≈ 1.26
const TRAIN_DONE_SEC = (SPINE_FADE_HEAD + 0.5) / TRAIN_RATE + 0.5

const _spineWaveBuf = new Float32Array(TRAIN_N_TOT * 3)

function WavySpine({ introTRef }) {
    const lineRef = useRef()

    useFrame((state) => {
        if (!lineRef.current) return
        const t = state.clock.elapsedTime
        const th = introTRef.current * TRAIN_RATE

        const headIdx = Math.min(Math.floor(clamp(th, 0, 1) * (TRAIN_N_TOT - 1)), TRAIN_N_TOT - 1)
        const tailIdx = Math.max(Math.floor(clamp(th - 9 * BOGEY_SPACING, 0, 1) * (TRAIN_N_TOT - 1)), 0)

        for (let i = 0; i < TRAIN_N_TOT; i++) {
            const px = TRAIN_PATH[i * 3], py = TRAIN_PATH[i * 3 + 1], pz = TRAIN_PATH[i * 3 + 2]
            if (i < tailIdx || i > headIdx) {
                _spineWaveBuf[i * 3] = px; _spineWaveBuf[i * 3 + 1] = py; _spineWaveBuf[i * 3 + 2] = pz
                continue
            }
            const frac = i / (TRAIN_N_TOT - 1)
            const amp = i < TRAIN_N_STR ? 12 * (frac / (TRAIN_N_STR / TRAIN_N_TOT)) : 5
            _spineWaveBuf[i * 3] = px + Math.cos(frac * 11 - t * 3) * amp * 0.5
            _spineWaveBuf[i * 3 + 1] = py + Math.sin(frac * 16 - t * 5) * amp
            _spineWaveBuf[i * 3 + 2] = pz
        }
        lineRef.current.geometry.attributes.position.needsUpdate = true

        const opacity = th < 0.05 ? 0
            : th < SPINE_FADE_HEAD ? 1
                : Math.max(0, 1 - (th - SPINE_FADE_HEAD) / 0.4)
        lineRef.current.material.opacity = opacity
    })

    return (
        <line ref={lineRef}>
            <bufferGeometry>
                <bufferAttribute attach="attributes-position" array={_spineWaveBuf} count={TRAIN_N_TOT} itemSize={3} />
            </bufferGeometry>
            <lineBasicMaterial color="#00eeff" transparent opacity={0} toneMapped={false} />
        </line>
    )
}

// ─── Photo Ring — circular gallery of images for the Dossier section ──────────
const PHOTO_PATHS = [
    { type: 'video', src: '/photos/guitar-vid.webm', label: '2024-08-14  19:32' },
    { type: 'video', src: '/photos/co-highway.webm', label: '2023-11-03  07:14' },
    { type: 'video', src: '/photos/currents.webm', label: '2024-06-21  16:48' },
    { type: 'video', src: '/photos/desert.webm', label: '2023-04-09  12:05' },
    { type: 'video', src: '/photos/lake.webm', label: '2024-09-30  08:22' },
    { type: 'video', src: '/photos/quandary.webm', label: '2022-07-17  14:57' },
]

function useVideoTexture(src) {
    const [tex, setTex] = useState(null)
    useEffect(() => {
        const vid = document.createElement('video')
        vid.src = src
        vid.loop = true
        vid.muted = true
        vid.playsInline = true
        vid.autoplay = true
        vid.play().catch(() => { })
        const t = new THREE.VideoTexture(vid)
        t.colorSpace = THREE.SRGBColorSpace
        setTex(t)
        return () => { vid.pause(); t.dispose() }
    }, [src])
    return tex
}

function SinglePhotoImage({ path, ...rest }) {
    const src = typeof path === 'string' ? path : path.src
    const label = (path && typeof path === 'object') ? path.label : ''
    const tex = useTexture(src)
    return <SinglePhotoInner tex={tex} isVideo={false} label={label} {...rest} />
}

function SinglePhotoVideo({ path, ...rest }) {
    const src = typeof path === 'string' ? path : path.src
    const label = (path && typeof path === 'object') ? path.label : ''
    const tex = useVideoTexture(src)
    if (!tex) return null
    return <SinglePhotoInner tex={tex} isVideo={true} label={label} {...rest} />
}

function SinglePhoto({ path, ...rest }) {
    if (path && typeof path === 'object' && path.type === 'video') {
        return <SinglePhotoVideo path={path} {...rest} />
    }
    return <SinglePhotoImage path={path} {...rest} />
}

function SinglePhotoInner({ tex, isVideo, angle, radius, hoveredIdx, setHoveredIdx, index, appeared, label }) {
    const meshRef = useRef()
    const textRef = useRef()
    const textShaderRef = useRef()
    const opRef = useRef(0)
    const scaleRef = useRef(1.8)
    const posRef = useRef({ x: 0, y: 0, z: 0 })
    const outlineRef = useRef()
    const outlineOpRef = useRef(0)

    const shaderRef = useRef()
    const mat = useMemo(() => {
        const m = new THREE.MeshStandardMaterial({
            map: tex,
            ...(isVideo ? {} : { emissiveMap: tex, emissive: new THREE.Color('#aaccff') }),
            transparent: true, opacity: 0, side: THREE.DoubleSide,
            toneMapped: false, depthWrite: false,
        })
        m.onBeforeCompile = (shader) => {
            shader.uniforms.uBendRadius = { value: radius }
            shader.uniforms.uTime = { value: 0 }
            shader.uniforms.uClothAmp = { value: 0.18 }
            shader.uniforms.uHoverUV = { value: new THREE.Vector2(0.5, 0.5) }
            shader.uniforms.uHoverStrength = { value: 0.0 }
            shaderRef.current = shader
            shader.vertexShader = 'uniform float uBendRadius;\nuniform float uTime;\nuniform float uClothAmp;\nuniform vec2 uHoverUV;\nuniform float uHoverStrength;\n' + shader.vertexShader
            shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                `vec3 transformed = vec3(position);

                // Cloth weight: top edge pinned, bottom sways freely
                float hang = (0.5 - uv.y);

                // Multi-frequency waves for organic cloth ripple
                float w1 = sin(position.x * 1.8 + uTime * 1.4) * 0.9;
                float w2 = sin(position.x * 3.5 - uTime * 2.1 + position.y * 0.8) * 0.4;
                float w3 = cos(position.y * 2.2 + uTime * 1.0) * 0.5;
                float cloth = (w1 + w2 + w3) * uClothAmp * hang;

                // Lateral sway
                float sway = sin(position.y * 1.2 + uTime * 0.7) * uClothAmp * 0.4 * hang;

                // Hover pull — Gaussian attraction toward cursor UV
                vec2 uvDiff = uv - uHoverUV;
                float pullDist = length(uvDiff);
                float pull = exp(-pullDist * pullDist * 6.0) * uHoverStrength;

                // Apply bend + cloth + hover pull
                float theta = transformed.x / uBendRadius;
                transformed.x = sin(theta) * uBendRadius + sway;
                transformed.z = transformed.z - (uBendRadius - cos(theta) * uBendRadius) + cloth + pull;
                transformed.y += sin(position.x * 2.0 + uTime * 1.1) * uClothAmp * 0.2 * hang;`
            )
            shader.fragmentShader = 'uniform float uTime;\n' + shader.fragmentShader
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <map_fragment>',
                `
                #ifdef USE_MAP
                    // --- 1. TV Glitch / Jitter ---
                    float jitter = (fract(sin(uTime * 15.0) * 43758.5453) - 0.5) * step(0.98, fract(uTime * 1.2)) * 0.05;
                    vec2 glitchUv = vMapUv + vec2(jitter, 0.0);
                    vec4 sampledColor = texture2D( map, glitchUv );
                    
                    // --- 2. Paper Border ---
                    float borderX = step(0.04, vMapUv.x) * step(vMapUv.x, 0.96);
                    float borderY = step(0.03, vMapUv.y) * step(vMapUv.y, 0.97);
                    float border = borderX * borderY;
                    vec3 paperColor = vec3(0.95, 0.95, 1.0); // Neutral/Cool paper
                    sampledColor.rgb = mix(paperColor, sampledColor.rgb, border);

                    // --- 3. Cold Cinematic Tint ---
                    float gray = dot(sampledColor.rgb, vec3(0.299, 0.587, 0.114));
                    vec3 coldTint = vec3(gray) * vec3(0.9, 1.05, 1.2);
                    sampledColor.rgb = mix(sampledColor.rgb, coldTint, 0.45);

                    // --- 4. TV Static Noise (Bad Signal) ---
                    float staticNoise = fract(sin(dot(glitchUv + fract(uTime), vec2(12.9898, 78.233))) * 43758.5453);
                    sampledColor.rgb = mix(sampledColor.rgb, vec3(staticNoise), 0.28 * border);

                    // --- 5. Scanlines ---
                    float scanline = sin(vMapUv.y * 800.0 + uTime * 10.0) * 0.04;
                    sampledColor.rgb -= scanline * border;

                    // --- 6. Vignette ---
                    float vDist = distance(vMapUv, vec2(0.5));
                    float vignette = smoothstep(0.75, 0.3, vDist);
                    sampledColor.rgb *= (0.7 + 0.3 * vignette);

                    // --- 7. Black Point Fade & Flicker ---
                    float flicker = 1.0 + (fract(sin(uTime * 20.0) * 12345.67) - 0.5) * 0.03;
                    sampledColor.rgb = max(sampledColor.rgb * flicker, vec3(0.08, 0.07, 0.06));

                    diffuseColor *= sampledColor;
                #endif
                `
            )
        }
        return m
    }, [tex, radius, isVideo])

    const textMat = useMemo(() => {
        const m = new THREE.MeshStandardMaterial({
            color: '#ffffff',
            transparent: true,
            opacity: 0,
            toneMapped: false,
            depthTest: false,
        })
        m.onBeforeCompile = (shader) => {
            shader.uniforms.uTime = { value: 0 }
            textShaderRef.current = shader
            shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader
            shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                `
                float jitter = (fract(sin(uTime * 15.0) * 43758.5453) - 0.5) * step(0.98, fract(uTime * 1.2)) * 0.4;
                vec3 transformed = vec3(position);
                transformed.x += jitter;
                `
            )
            shader.fragmentShader = 'uniform float uTime;\n' + shader.fragmentShader
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <dithering_fragment>',
                `
                #include <dithering_fragment>
                float flicker = 1.0 + (fract(sin(uTime * 25.0) * 12345.67) - 0.5) * 0.3;
                gl_FragColor.rgb *= flicker;
                `
            )
        }
        return m
    }, [])

    useFrame((state, delta) => {
        if (!meshRef.current) return
        if (isVideo && tex) tex.needsUpdate = true

        const isHovered = hoveredIdx === index
        outlineOpRef.current = dampValue(outlineOpRef.current, isHovered ? 0.8 : 0, 10, delta)
        if (outlineRef.current) outlineRef.current.material.opacity = outlineOpRef.current

        const t = state.clock.elapsedTime
        let targetOp = appeared ? 1.0 : 0
        opRef.current = dampValue(opRef.current, targetOp, 12, delta)

        if (shaderRef.current) {
            shaderRef.current.uniforms.uTime.value = t
            shaderRef.current.uniforms.uHoverStrength.value = dampValue(
                shaderRef.current.uniforms.uHoverStrength.value, isHovered ? 1.2 : 0.0, 6, delta)
            shaderRef.current.uniforms.uClothAmp.value = dampValue(
                shaderRef.current.uniforms.uClothAmp.value, 0.18, 4, delta)
        }
        if (textShaderRef.current) textShaderRef.current.uniforms.uTime.value = t

        posRef.current.x = Math.cos(angle) * radius
        posRef.current.y = Math.sin(t * DOSSIER_SWAY_FREQ + index * 0.5) * DOSSIER_SWAY_AMP
        posRef.current.z = Math.sin(angle) * radius

        meshRef.current.position.set(posRef.current.x, posRef.current.y, posRef.current.z)
        meshRef.current.rotation.set(0, Math.PI / 2 - angle, 0)
        meshRef.current.scale.setScalar(1.8)
        meshRef.current.material.opacity = opRef.current
        meshRef.current.material.emissiveIntensity = 0.15 + (isHovered ? 0.35 : 0) + Math.sin(t * 4 + index) * 0.05

        if (textRef.current) {
            textRef.current.material.opacity = opRef.current * 0.7
            // bottom-left: offset along plane's local left axis (tangent to ring) and drop to bottom
            const leftX = -Math.sin(angle) * 40
            const leftZ = Math.cos(angle) * 40
            textRef.current.position.set(posRef.current.x + leftX, posRef.current.y - 22, posRef.current.z + leftZ)
            textRef.current.rotation.set(0, Math.PI / 2 - angle, 0)
        }
    })

    return (
        <group>
            {/* Hover highlight outline */}
            <mesh
                ref={outlineRef}
                position={[posRef.current.x, posRef.current.y, posRef.current.z - 0.05]}
                scale={1.8 * 1.08}
                onPointerOver={() => { }} // dummy to allow events to pass to main mesh
            >
                <planeGeometry args={[20.0, 28.56]} />
                <meshBasicMaterial color="#ffcc88" transparent opacity={0} wireframe />
            </mesh>

            <mesh
                ref={meshRef}
                material={mat}
                onPointerOver={e => { e.stopPropagation(); setHoveredIdx(index); sfx.piano(); document.body.style.cursor = 'pointer' }}
                onPointerMove={e => { if (shaderRef.current && e.uv) shaderRef.current.uniforms.uHoverUV.value.copy(e.uv) }}
                onPointerOut={() => { setHoveredIdx(-1); document.body.style.cursor = 'auto' }}
            >
                <planeGeometry args={[50, 28.28, 32, 32]} />
            </mesh>

            <Text
                ref={textRef}
                position={[posRef.current.x, posRef.current.y - 12, posRef.current.z]}
                rotation={[0, Math.PI / 2 - angle, 0]}
                font="/fonts/Rocket%20Command/rocketcommand.ttf"
                fontSize={2.8}
                anchorX="left"
                anchorY="bottom"
                material={textMat}
                renderOrder={10}
                maxWidth={46}
            >
                {label}
            </Text>
        </group>
    )
}

function PhotoRing({ appeared }) {
    const [hoveredIdx, setHoveredIdx] = useState(-1)
    const groupRef = useRef()
    const radius = 90
    const center = [-80, 9, -200]
    const introTRef = useRef(0)
    const prevAppearedRef = useRef(false)

    useFrame((_, delta) => {
        // Spin ring when not interacting
        if (groupRef.current && hoveredIdx === -1) {
            groupRef.current.rotation.y += delta * 0.1
        }
    })

    return (
        <group ref={groupRef} position={center} rotation={DOSSIER_RING_ROTATION}>
            {PHOTO_PATHS.map((path, i) => {
                const angle = (i / PHOTO_PATHS.length) * Math.PI * 2
                return (
                    <SinglePhoto
                        key={typeof path === 'string' ? path : path.src}
                        path={path}
                        angle={angle}
                        radius={radius}
                        hoveredIdx={hoveredIdx}
                        setHoveredIdx={setHoveredIdx}
                        index={i}
                        appeared={appeared}
                        introTRef={null}
                    />
                )
            })}
        </group>
    )
}


// ─── Procedural techno sigil — sharp star + rune strokes + segmented ring ─────
const RUNE_PATHS = [
    [[-1.6, 1.3, 0], [-0.5, 0.5, 0.35], [0.4, -0.4, 0], [1.5, -1.2, 0]],
    [[1.6, 1.3, 0], [0.5, 0.4, -0.3], [-0.3, -0.3, 0], [-1.5, -1.1, 0]],
    [[-1.9, 0.6, 0], [-0.7, 0.15, 0.4], [0, -0.25, 0], [0.8, 0.15, -0.4], [1.9, 0.5, 0]],
    [[0.25, 1.7, 0], [1.0, 0.9, 0.15], [1.2, 0.05, 0], [0.8, -0.65, 0]],
    [[-0.25, -1.7, 0], [-1.0, -0.9, -0.15], [-1.2, -0.05, 0], [-0.8, 0.65, 0]],
]

// Export sigil as SVG — Blender imports SVG as editable Bezier curves
// File > Import > Scalable Vector Graphics (.svg) in Blender
function exportSigilSVG() {
    const S = 100        // scale: 1 Three.js unit = 100 SVG px
    const CX = 500, CY = 500  // SVG center (Y is flipped)
    const tx = (x) => CX + x * S
    const ty = (y) => CY - y * S  // flip Y for SVG

    const paths = []

    // 1. Outer ring — 8 arcs
    const R = 2.2
    for (let i = 0; i < 8; i++) {
        const startRad = THREE.MathUtils.degToRad(i * 45 + 3.5)
        const endRad = THREE.MathUtils.degToRad(i * 45 + 41.5)
        const x1 = tx(Math.cos(startRad) * R), y1 = ty(Math.sin(startRad) * R)
        const x2 = tx(Math.cos(endRad) * R), y2 = ty(Math.sin(endRad) * R)
        const r = R * S
        paths.push(`<path d="M ${x1} ${y1} A ${r} ${r} 0 0 0 ${x2} ${y2}" stroke="#00aaff" stroke-width="4.5" fill="none"/>`)
    }

    // 2. Tick marks — 8 short lines at gap midpoints
    for (let i = 0; i < 8; i++) {
        const a = THREE.MathUtils.degToRad(i * 45)
        const r0 = 2.44, r1 = 2.66
        paths.push(`<line x1="${tx(Math.cos(a) * r0)}" y1="${ty(Math.sin(a) * r0)}" x2="${tx(Math.cos(a) * r1)}" y2="${ty(Math.sin(a) * r1)}" stroke="#00aaff" stroke-width="6"/>`)
    }

    // 3. 4-pointed star (quadratic bezier outline)
    const sd = `M ${tx(0)} ${ty(1.8)}
      Q ${tx(0.18)} ${ty(0.18)} ${tx(0.9)} ${ty(0)}
      Q ${tx(0.18)} ${ty(-0.18)} ${tx(0)} ${ty(-1.8)}
      Q ${tx(-0.18)} ${ty(-0.18)} ${tx(-0.9)} ${ty(0)}
      Q ${tx(-0.18)} ${ty(0.18)} ${tx(0)} ${ty(1.8)} Z`
    paths.push(`<path d="${sd}" stroke="#00aaff" stroke-width="3" fill="none"/>`)

    // 4. Rune strokes — CatmullRom sampled to polyline (30 pts each)
    RUNE_PATHS.forEach(pts => {
        const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)))
        const samples = curve.getPoints(30)
        const d = samples.map((p, j) => `${j === 0 ? 'M' : 'L'} ${tx(p.x).toFixed(1)} ${ty(p.y).toFixed(1)}`).join(' ')
        paths.push(`<path d="${d}" stroke="#00aaff" stroke-width="2.8" fill="none"/>`)
    })

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000" style="background:#000">
  <!-- TechnoSigil — import into Blender via File > Import > Scalable Vector Graphics -->
  ${paths.join('\n  ')}
</svg>`

    const blob = new Blob([svg], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'techno-sigil.svg'; a.click()
    URL.revokeObjectURL(url)
}


// ─── Procedural TechnoSigil — animated ring, star, rune strokes ──────────────

function TechnoSigil({ position = [0, 0, 0], scale = 1 }) {
    const groupRef = useRef()
    const outerRef = useRef()
    const innerRef = useRef()
    const strokesRef = useRef()

    // Shared base material
    const baseMat = useMemo(() => new THREE.MeshStandardMaterial({
        color: '#001122',
        emissive: '#00aaff',
        emissiveIntensity: 2.2,
        metalness: 0.9,
        roughness: 0.08,
        toneMapped: false,
        side: THREE.DoubleSide,
    }), [])

    // 1. Outer segmented ring — 8 arcs
    const arcGeos = useMemo(() => {
        const R = 2.2
        return Array.from({ length: 8 }, (_, i) => {
            const startRad = THREE.MathUtils.degToRad(i * 45 + 3.5)
            const endRad = THREE.MathUtils.degToRad(i * 45 + 41.5)
            const pts = Array.from({ length: 12 }, (_, j) => {
                const a = startRad + (endRad - startRad) * (j / 11)
                return new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R, 0)
            })
            const curve = new THREE.CatmullRomCurve3(pts)
            return new THREE.TubeGeometry(curve, 12, 0.045, 8, false)
        })
    }, [])

    // 2. Tick marks — 8 positions at gap midpoints
    const tickTransforms = useMemo(() =>
        Array.from({ length: 8 }, (_, i) => {
            const a = THREE.MathUtils.degToRad(i * 45)
            return { pos: [Math.cos(a) * 2.55, Math.sin(a) * 2.55, 0], rot: [0, 0, a] }
        }), [])

    // 3. Star shape
    const starGeo = useMemo(() => {
        const shape = new THREE.Shape()
        shape.moveTo(0, 1.8)
        shape.quadraticCurveTo(0.18, 0.18, 0.9, 0)
        shape.quadraticCurveTo(0.18, -0.18, 0, -1.8)
        shape.quadraticCurveTo(-0.18, -0.18, -0.9, 0)
        shape.quadraticCurveTo(-0.18, 0.18, 0, 1.8)
        return new THREE.ExtrudeGeometry(shape, { depth: 0.07, bevelEnabled: false })
    }, [])

    // 4. Rune stroke geometries
    const runeGeos = useMemo(() =>
        RUNE_PATHS.map(pts => {
            const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)))
            return new THREE.TubeGeometry(curve, 20, 0.028, 6, false)
        }), [])

    // 5. Rune materials (cloned so they can pulse independently)
    const runeMats = useMemo(() =>
        RUNE_PATHS.map(() => baseMat.clone()), [baseMat])

    useFrame((state) => {
        const delta = Math.min(state.clock.getDelta(), 0.05)
        const elapsed = state.clock.elapsedTime
        if (outerRef.current) outerRef.current.rotation.y += delta * 0.12
        if (innerRef.current) innerRef.current.rotation.y -= delta * 0.22
        // Rune pulse
        runeMats.forEach((m, i) => {
            m.emissiveIntensity = 2.0 + Math.sin(elapsed * 1.3 + i * 1.1) * 0.7
        })
        // Whole-group wobble
        if (groupRef.current) {
            groupRef.current.rotation.x = Math.sin(elapsed * 0.25) * 0.08
        }
    })

    return (
        <group ref={groupRef} position={position} scale={scale}>
            {/* Outer ring + ticks — rotate together */}
            <group ref={outerRef}>
                {arcGeos.map((geo, i) => (
                    <mesh key={`arc-${i}`} geometry={geo} material={baseMat} raycast={() => null} />
                ))}
                {tickTransforms.map((t, i) => (
                    <mesh key={`tick-${i}`} position={t.pos} rotation={t.rot} raycast={() => null}>
                        <boxGeometry args={[0.06, 0.22, 0.04]} />
                        <primitive object={baseMat} attach="material" />
                    </mesh>
                ))}
            </group>

            {/* Inner star + pip — counter-rotate */}
            <group ref={innerRef}>
                <mesh geometry={starGeo} material={baseMat} position={[0, 0, -0.035]} raycast={() => null} />
                <mesh raycast={() => null}>
                    <octahedronGeometry args={[0.2, 0]} />
                    <primitive object={baseMat} attach="material" />
                </mesh>
            </group>

            {/* Rune strokes — pulse independently */}
            <group ref={strokesRef}>
                {runeGeos.map((geo, i) => (
                    <mesh key={`rune-${i}`} geometry={geo} material={runeMats[i]} raycast={() => null} />
                ))}
            </group>
        </group>
    )
}

// ─── Sigil model (sigil.glb) ───────────────────────────────────────────────────
function SigilModel({ position = [0, 0, 0], scale = 1 }) {
    const { scene } = useGLTF('/sigil.glb')
    const sigilMat = useMemo(() => new THREE.MeshPhysicalMaterial({
        color: '#d8e8f8',
        metalness: 0.7,
        roughness: 0.2,
        clearcoat: 1.0,
        clearcoatRoughness: 0.05,
        side: THREE.DoubleSide,
    }), [])
    const cloned = useMemo(() => {
        const c = scene.clone(true)
        c.traverse(child => { if (child.isMesh) child.material = sigilMat })
        const box = new THREE.Box3().setFromObject(c)
        const center = new THREE.Vector3()
        box.getCenter(center)
        c.position.sub(center)
        return c
    }, [scene, sigilMat])
    const spinRef = useRef()
    const floatRef = useRef()
    const tiltRef = useRef()
    useFrame((state, delta) => {
        const t = state.clock.elapsedTime
        if (spinRef.current) spinRef.current.rotation.y = Math.sin(t * 0.1) * 0.2 - 0.25
        if (floatRef.current) floatRef.current.rotation.y = Math.sin(t * 0.4) * 0.3
        if (tiltRef.current) {
            const mx = clamp(state.pointer.x, -1, 1)
            const my = clamp(state.pointer.y, -1, 1)
            tiltRef.current.rotation.y = dampValue(tiltRef.current.rotation.y, mx * 0.28, 2.5, delta)
            tiltRef.current.rotation.x = dampValue(tiltRef.current.rotation.x, -my * 0.18, 2.5, delta)
        }
    })
    return (
        <group position={position} scale={scale}>
            <group ref={tiltRef}>
                <group ref={floatRef}>
                    <group rotation={[-0.4, 0.7, 0.9]}>
                        <group ref={spinRef}><primitive object={cloned} /></group>
                    </group>
                </group>
            </group>
        </group>
    )
}

// ─── Glass accent orbs for Dossier section ───────────────────────────────────
function DossierGlassAccents() {
    const glassMat = useMemo(() => new THREE.MeshPhysicalMaterial({
        color: '#aacfff',
        transmission: 0.93,
        roughness: 0.03,
        metalness: 0.05,
        ior: 1.5,
        thickness: 4.0,
        transparent: true,
        toneMapped: false,
    }), [])

    const accents = useMemo(() => [
        { type: 'sphere', pos: [-18, 12, -200], r: 5.5, phase: 0.0, speed: 0.48 },
        { type: 'sphere', pos: [-68, -8, -225], r: 4.0, phase: 1.7, speed: 0.52 },
        { type: 'sphere', pos: [-32, -38, -260], r: 3.5, phase: 3.1, speed: 0.44 },
        { type: 'torus', pos: [-45, 8, -215], r: 11, tube: 0.9, phase: 0.8, speed: 0.38 },
        { type: 'sphere', pos: [-55, 25, -240], r: 2.5, phase: 2.4, speed: 0.60 },
    ], [])

    const refsArr = useRef([])
    useFrame((state) => {
        const t = state.clock.elapsedTime
        refsArr.current.forEach((ref, i) => {
            if (!ref) return
            const a = accents[i]
            ref.position.y = a.pos[1] + Math.sin(t * a.speed + a.phase) * 3
            ref.rotation.y = t * (0.08 + i * 0.025)
            ref.rotation.x = t * (0.05 + i * 0.015)
        })
    })

    return (
        <group>
            {accents.map((a, i) => (
                <mesh
                    key={i}
                    position={a.pos}
                    ref={el => { refsArr.current[i] = el }}
                    material={glassMat}
                    raycast={() => null}
                >
                    {a.type === 'sphere'
                        ? <sphereGeometry args={[a.r, 32, 32]} />
                        : <torusGeometry args={[a.r, a.tube, 16, 64]} />
                    }
                </mesh>
            ))}
        </group>
    )
}

function BustDiptych({ scrollRef }) {
    const opRef = useRef()
    const [appeared, setAppeared] = useState(false)
    const appearedRef = useRef(false)

    const k_x = -67, k_y = -5, k_z = -160, k_intensity = 2000, k_color = '#0079ff'
    const r_x = -62, r_y = -66, r_z = -222, r_intensity = 2000, r_color = '#6d50ff'
    const f_x = -110, f_y = 39, f_z = -191, f_intensity = 2000, f_color = '#a200ff'

    useFrame((_, delta) => {
        const t = scrollRef.current ?? 0
        const show = t >= DIPTYCH_ENTER
        if (appearedRef.current !== show) { appearedRef.current = show; setAppeared(show) }
        if (opRef.current) {
            const targetScale = show ? 1 : 0
            const s = dampValue(opRef.current.scale.x, targetScale, 4, delta)
            opRef.current.scale.setScalar(s)
            // No vertical jump, stays fixed at deepest Z
            opRef.current.position.y = 0
        }
    })

    return (
        <group ref={opRef} position={[0, 0, -100]} scale={0}>
            {/* Sigil lights — controlled via Leva 'Sigil Lights' panel */}
            <pointLight position={[k_x, k_y, k_z]} intensity={k_intensity} color={k_color} distance={120} decay={2} />
            <pointLight position={[r_x, r_y, r_z]} intensity={r_intensity} color={r_color} distance={100} decay={2} />
            <pointLight position={[f_x, f_y, f_z]} intensity={f_intensity} color={f_color} distance={90} decay={2} />
            <SigilModel position={[-40, -20, -250]} scale={9} />
            <PhotoRing appeared={appeared} />

        </group>
    )
}


function BioSection({ scrollRef, currentSectionRef }) {
    const { size } = useThree()
    const isPortrait = size.width < size.height
    const groupRef = useRef()
    const [phase, setPhase] = useState('idle')
    const phaseRef = useRef('idle')
    const timerRef = useRef(0)
    const tRef = useRef(0)
    const [premounted, setPremounted] = useState(false)
    const [inRange, setInRange] = useState(true)
    const inRangeRef = useRef(true)

    useFrame((_, delta) => {
        if (!groupRef.current) return
        const t = scrollRef.current ?? 0
        tRef.current = t
        groupRef.current.visible = t >= BIO_ENTER - 0.04

        const nowInRange = t < 1.04
        if (nowInRange !== inRangeRef.current) { inRangeRef.current = nowInRange; setInRange(nowInRange) }

        if (t >= BIO_ENTER - 0.12 && !premounted) setPremounted(true)

        if (t < BIO_ENTER - 0.04) {
            if (phaseRef.current !== 'idle') { phaseRef.current = 'idle'; setPhase('idle'); timerRef.current = 0 }
            return
        }

        timerRef.current += delta
        if (phaseRef.current === 'idle' && t >= BIO_ENTER) { phaseRef.current = 'debris'; setPhase('debris'); timerRef.current = 0 }
        if (phaseRef.current === 'debris' && timerRef.current > 1.4) { phaseRef.current = 'collapse'; setPhase('collapse'); timerRef.current = 0 }
        if (phaseRef.current === 'collapse' && timerRef.current > 0.4) { phaseRef.current = 'appeared'; setPhase('appeared'); timerRef.current = 0 }
        if (phaseRef.current === 'appeared' && timerRef.current > 0.6) { phaseRef.current = 'afterglow'; setPhase('afterglow') }
    })

    const flashActive = phase === 'collapse'
    const patchVisible = ['appeared', 'afterglow'].includes(phase) && inRange

    return (
        <group ref={groupRef} position={BIO_CENTER} visible={false}>
            <CollapseFlash active={flashActive} />
            <RaveAfterglowLights active={patchVisible} />
            <BioGrid active={patchVisible} />
            <group position={[0, 1.8, 0]}>
                {premounted && <ModularResumePatch visible={patchVisible} currentSectionRef={currentSectionRef} />}
            </group>
            {!isPortrait && <BustDiptych scrollRef={scrollRef} />}
        </group>
    )
}

// ═════════════════════════════════════════════════════════════════════════════
// 5. MAIN SCENE & APP EXPORT
// ═════════════════════════════════════════════════════════════════════════════

// Cards live at SECTION_STOPS indices 3, 4 → cardIndex 0, 1
function DragController({ currentSectionRef }) {
    const { gl } = useThree()

    useEffect(() => {
        const el = gl.domElement

        const onDown = (e) => {
            const ci = currentSectionRef.current - 2
            if (ci < 0 || ci > 2) return
            dragRotState.isDragging = true
            dragRotState.cardIndex = ci
            dragRotState.lastX = e.clientX
            dragRotState.lastY = e.clientY
            el.setPointerCapture(e.pointerId)
        }

        const onMove = (e) => {
            if (!dragRotState.isDragging) return
            const ci = dragRotState.cardIndex
            dragRotState.rotY[ci] += (e.clientX - dragRotState.lastX) * 0.009
            dragRotState.rotX[ci] += (e.clientY - dragRotState.lastY) * 0.009
            dragRotState.rotX[ci] = Math.max(-Math.PI * 0.55, Math.min(Math.PI * 0.55, dragRotState.rotX[ci]))
            dragRotState.lastX = e.clientX
            dragRotState.lastY = e.clientY
        }

        const onUp = (e) => {
            if (!dragRotState.isDragging) return
            dragRotState.isDragging = false
            try { el.releasePointerCapture(e.pointerId) } catch (_) { }
        }

        el.addEventListener('pointerdown', onDown)
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        return () => {
            el.removeEventListener('pointerdown', onDown)
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
        }
    }, [gl, currentSectionRef])

    return null
}

// ─── 3D Interactive Logo Component ────────────────────────────────────────
function Logo3D({ position = [-5, 3.5, 3] }) {
    const groupRef = useRef()
    const mouseRef = useRef({ x: 0, y: 0 })

    useEffect(() => {
        const handleMouseMove = (e) => {
            mouseRef.current.x = (e.clientX / window.innerWidth) * 2 - 1
            mouseRef.current.y = -(e.clientY / window.innerHeight) * 2 + 1
        }
        window.addEventListener('mousemove', handleMouseMove)
        return () => window.removeEventListener('mousemove', handleMouseMove)
    }, [])

    useFrame((state) => {
        if (!groupRef.current) return

        // Subtle rotation + mouse interaction
        groupRef.current.rotation.y += 0.003
        groupRef.current.rotation.x = mouseRef.current.y * 0.3
        groupRef.current.rotation.z = mouseRef.current.x * 0.2
    })

    return (
        <group ref={groupRef} position={position} scale={1.2}>
            {/* Geometric M made of simple shapes */}

            {/* Left vertical bar */}
            <mesh position={[-0.6, 0, 0]}>
                <boxGeometry args={[0.2, 1.2, 0.1]} />
                <meshPhysicalMaterial color="#b8d6ff" metalness={0.8} roughness={0.1} clearcoat={1.0} />
            </mesh>

            {/* Right vertical bar */}
            <mesh position={[0.6, 0, 0]}>
                <boxGeometry args={[0.2, 1.2, 0.1]} />
                <meshPhysicalMaterial color="#b8d6ff" metalness={0.8} roughness={0.1} clearcoat={1.0} />
            </mesh>

            {/* Left diagonal */}
            <mesh position={[-0.15, 0.3, 0]} rotation={[0, 0, Math.PI / 4.5]}>
                <boxGeometry args={[0.15, 0.8, 0.08]} />
                <meshPhysicalMaterial color="#b8d6ff" metalness={0.8} roughness={0.1} clearcoat={1.0} />
            </mesh>

            {/* Right diagonal */}
            <mesh position={[0.15, 0.3, 0]} rotation={[0, 0, -Math.PI / 4.5]}>
                <boxGeometry args={[0.15, 0.8, 0.08]} />
                <meshPhysicalMaterial color="#b8d6ff" metalness={0.8} roughness={0.1} clearcoat={1.0} />
            </mesh>

            {/* Glow effect */}
            <pointLight position={[0, 0, 0.5]} intensity={0.5} color="#b8d6ff" distance={2} />
        </group>
    )
}

// ─── Animated Grid Background with Wave Effect ────────────────────────────
function AnimatedGrid() {
    const meshRef = useRef()
    const mouseRef = useRef({ x: 0, y: 0 })
    const smoothBubbleRef = useRef({ x: 0, y: 0 })

    // Track mouse position
    useEffect(() => {
        const handleMouseMove = (e) => {
            // Convert screen coords to world coords (normalized -1 to 1)
            mouseRef.current.x = (e.clientX / window.innerWidth) * 2 - 1
            mouseRef.current.y = -(e.clientY / window.innerHeight) * 2 + 1
        }

        window.addEventListener('mousemove', handleMouseMove)
        return () => window.removeEventListener('mousemove', handleMouseMove)
    }, [])

    useFrame((state, delta) => {
        if (!meshRef.current) return

        const time = state.clock.elapsedTime
        const geometry = meshRef.current.geometry

        // Get position and color attributes
        if (geometry) {
            const positionAttribute = geometry.getAttribute('position')
            const colorAttribute = geometry.getAttribute('color') || null

            if (!positionAttribute.original) {
                // Store original positions and initialize colors
                positionAttribute.original = positionAttribute.array.slice()

                // Initialize color attribute if it doesn't exist
                if (!colorAttribute) {
                    const colors = new Float32Array(positionAttribute.array.length)
                    for (let i = 0; i < colors.length; i++) {
                        colors[i] = 0  // Base brightness (dark by default)
                    }
                    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
                }
            }

            const original = positionAttribute.original
            const posArray = positionAttribute.array
            const colorAttr = geometry.getAttribute('color')
            const colors = colorAttr.array

            // Convert mouse coords to world space (scale to grid size)
            const targetBubbleX = mouseRef.current.x * 30
            const targetBubbleY = mouseRef.current.y * 30

            // Smooth bubble movement with damping (lag effect)
            smoothBubbleRef.current.x = dampValue(smoothBubbleRef.current.x, targetBubbleX, 8, delta)
            smoothBubbleRef.current.y = dampValue(smoothBubbleRef.current.y, targetBubbleY, 8, delta)

            const bubbleX = smoothBubbleRef.current.x
            const bubbleY = smoothBubbleRef.current.y

            // Apply wave distortion + mouse-following bubble effect
            for (let i = 0; i < original.length; i += 3) {
                const x = original[i]
                const y = original[i + 1]

                // Base wave effect: sin waves moving along the grid
                const wave1 = Math.sin(x * 0.5 + time * 2) * 0.3
                const wave2 = Math.sin(y * 0.5 + time * 1.5) * 0.3

                // Mouse-following bubble effect
                const distToBubble = Math.sqrt((x - bubbleX) ** 2 + (y - bubbleY) ** 2)
                const bubble = Math.exp(-distToBubble * distToBubble / 15) * 1.5  // Gaussian bump

                posArray[i + 2] = original[i + 2] + wave1 + wave2 + bubble

                // Chromatic aberration effect in bubble area — each channel shifted
                const chromaOffset = 2.5
                const distToRed = Math.sqrt((x - bubbleX - chromaOffset) ** 2 + (y - bubbleY) ** 2)
                const distToGreen = Math.sqrt((x - bubbleX) ** 2 + (y - bubbleY) ** 2)
                const distToBlue = Math.sqrt((x - bubbleX + chromaOffset) ** 2 + (y - bubbleY) ** 2)

                const redBrightness = Math.exp(-distToRed * distToRed / 25) * 0.8
                const greenBrightness = Math.exp(-distToGreen * distToGreen / 25) * 0.8
                const blueBrightness = Math.exp(-distToBlue * distToBlue / 25) * 0.8

                colors[i] = redBrightness       // R channel
                colors[i + 1] = greenBrightness // G channel
                colors[i + 2] = blueBrightness  // B channel
            }

            positionAttribute.needsUpdate = true
            colorAttr.needsUpdate = true
        }
    })

    return (
        <mesh ref={meshRef} position={[0, 0, -5]} rotation={[0, 0, 0]}>
            <planeGeometry args={[60, 60, 25, 25]} />
            <meshBasicMaterial
                color="#ffffff"
                vertexColors
                wireframe
                transparent
                opacity={0.15}
                fog={false}
            />
        </mesh>
    )
}

// ─── Hardcoded Post-Processing Effects ────────────────────────────
const _isMobileDevice = typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches

function PostProcessingEffects() {
    useEffect(() => {
        warpOffset.set(0.004, 0.004)
    }, [])

    // Hero intro overrides — reads module-level state each render
    // Mobile: halve bloom intensity, skip chromatic aberration
    const effectiveBloom = (heroIntroState.bloomOverride ?? 1.6) * (_isMobileDevice ? 0.5 : 1.0)

    return (
        <EffectComposer disableNormalPass>
            <SelectiveBloom luminanceThreshold={0.4} intensity={effectiveBloom} levels={4} />
            {!_isMobileDevice && <ChromaticAberration offset={warpOffset} />}
        </EffectComposer>
    )
}

function Scene({ scrollRef, currentSectionRef, onOpenProject }) {
    const isMobile = typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches
    return (
        <group>
            <ScrollSmoother currentSectionRef={currentSectionRef} scrollRef={scrollRef} />
            <CameraController scrollRef={scrollRef} />
            <DragController currentSectionRef={currentSectionRef} />

            <ambientLight intensity={0.03} />
            <Environment preset="night" />

            <PostProcessingEffects />

            <color attach="background" args={['#000000']} />
            <fog attach="fog" args={['#0a0a0a', 8, 50]} />

            {/* Animated grid background */}
            <AnimatedGrid />

            <CursorFX />
            <InteractiveParticleField count={300} />
            <StarField />
            <SpineHeroSection />
            <EthosSection scrollRef={scrollRef} />
            <ProjectsSection scrollRef={scrollRef} onOpenProject={onOpenProject} />
            <BioSection scrollRef={scrollRef} currentSectionRef={currentSectionRef} />

            {/* VideoScreens rendered outside Select enabled — no bloom bleed */}
            {!isMobile && <group position={[100, -2, 0]} rotation={[0, 0, 0]}>
                <VideoScreen
                    src="/demos/ei-noborder.mp4"
                    opRef={eiVideoOpRef}
                    buildText=""
                    buildUrl="https://github.com/moosefroggo/portfolio-2026/commit/7bf4176"
                    cornerLabel="SIG 2/5"
                    footerLabel="5M+ Vehicles Secured"
                    colorHex="#00aaff"
                    colorRgb="0,170,255"
                    onOpen={() => onOpenProject?.(PROJECT_CARDS[0])}
                />
            </group>}
            {!isMobile && <group position={[120, -2, 0]} rotation={[0, 0.2, 0]}>
                <VideoScreen onOpen={() => onOpenProject?.(PROJECT_CARDS[1])} />
            </group>}
        </group>
    )
}

// EthosOverlay removed — ethos is now an in-scene 3D component (EthosSection)

// ═════════════════════════════════════════════════════════════════════════════
// PROJECT TERMINAL OVERLAY
// ═════════════════════════════════════════════════════════════════════════════

// ═════════════════════════════════════════════════════════════════════════════
// LOADING SCREEN
// ═════════════════════════════════════════════════════════════════════════════
function EliteLoader() {
    const { progress, active } = useProgress()
    const [isFading, setIsFading] = useState(false)
    const [isHidden, setIsHidden] = useState(false)
    const [canEnter, setCanEnter] = useState(false)
    const progressTargetRef = useRef(0)
    const displayProgressRef = useRef(0)
    const progressTextRef = useRef(null)

    // Keep target ref in sync with actual progress (no re-render)
    useEffect(() => {
        progressTargetRef.current = progress
    }, [progress])

    // Single persistent RAF — lerp toward target, write directly to DOM
    useEffect(() => {
        let rafId
        const tick = () => {
            const target = progressTargetRef.current
            const cur = displayProgressRef.current
            const diff = target - cur
            const next = Math.abs(diff) < 0.05 ? target : cur + diff * 0.08
            displayProgressRef.current = next
            if (progressTextRef.current) {
                const formatted = next < 10
                    ? `00${next.toFixed(2)}`
                    : next < 100
                        ? `0${next.toFixed(2)}`
                        : next.toFixed(2)
                progressTextRef.current.textContent = `${formatted} %`
            }
            rafId = requestAnimationFrame(tick)
        }
        rafId = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(rafId)
    }, [])

    // Handle completion state
    useEffect(() => {
        if (progress >= 100 && !active && !canEnter) {
            setCanEnter(true)
        }
    }, [progress, active, canEnter])

    const handleEnter = () => {
        const click = getDigitalClickAudio(); click.currentTime = 0; click.play().catch(() => {})
        setIsFading(true)
        heroIntroState.hasEntered = true
        setTimeout(() => {
            setIsHidden(true)
            loaderFullyHidden = true
        }, 1200)
    }

    if (isHidden) return null

    const letters = (canEnter ? "SUCCESS" : "LOADING").split('')

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
            backgroundColor: '#02040a', zIndex: 9999, overflow: 'hidden',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            opacity: isFading ? 0 : 1, transition: 'opacity 1s cubic-bezier(0.87, 0, 0.13, 1)',
            pointerEvents: (canEnter && !isFading) ? 'all' : 'none', fontFamily: 'var(--font-mono)', color: '#8899cc'
        }}>
            <style>{`
                @keyframes kinetic-wave {
                    0%, 100% { transform: translate3d(0, 0, 0); opacity: 0.35; }
                    50% { transform: translate3d(0, -10px, 0); opacity: 1; }
                }
                .kinetic-letter {
                    display: inline-block;
                    font-size: clamp(32px, 10vw, 64px);
                    font-weight: 200;
                    letter-spacing: 0.2em;
                    animation: kinetic-wave 2s ease-in-out infinite;
                    will-change: transform, opacity;
                    color: #8899cc;
                    transition: all 0.5s cubic-bezier(0.23, 1, 0.32, 1);
                }
                .loader-bg-grid {
                    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
                    background-image: 
                        linear-gradient(rgba(136, 153, 204, 0.05) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(136, 153, 204, 0.05) 1px, transparent 1px);
                    background-size: 40px 40px;
                    z-index: -2;
                }
                @keyframes sweep {
                    0% { transform: translate3d(0, -10vh, 0); }
                    100% { transform: translate3d(0, 110vh, 0); }
                }
                .loader-sweep {
                    position: absolute; top: 0; left: 0; width: 100%; height: 2px;
                    background: linear-gradient(90deg, transparent, rgba(255, 0, 255, 0.5), rgba(0, 170, 255, 0.5), transparent);
                    animation: sweep 4s linear infinite;
                    z-index: -1;
                    box-shadow: 0 0 20px rgba(0, 170, 255, 0.4);
                }
                .loader-orb {
                    position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
                    width: 300px; height: 300px; border-radius: 50%;
                    background: radial-gradient(circle, rgba(255, 0, 255, 0.08) 0%, transparent 70%);
                    z-index: -1;
                    filter: blur(20px);
                }
                .loader-corner-tl { position: absolute; top: clamp(20px, 4vw, 40px); left: clamp(20px, 4vw, 40px); width: 20px; height: 20px; border-top: 2px solid rgba(136, 153, 204, 0.3); border-left: 2px solid rgba(136, 153, 204, 0.3); }
                .loader-corner-tr { position: absolute; top: clamp(20px, 4vw, 40px); right: clamp(20px, 4vw, 40px); width: 20px; height: 20px; border-top: 2px solid rgba(136, 153, 204, 0.3); border-right: 2px solid rgba(136, 153, 204, 0.3); }
                .loader-corner-bl { position: absolute; bottom: clamp(20px, 4vw, 40px); left: clamp(20px, 4vw, 40px); width: 20px; height: 20px; border-bottom: 2px solid rgba(136, 153, 204, 0.3); border-left: 2px solid rgba(136, 153, 204, 0.3); }
                .loader-corner-br { position: absolute; bottom: clamp(20px, 4vw, 40px); right: clamp(20px, 4vw, 40px); width: 20px; height: 20px; border-bottom: 2px solid rgba(136, 153, 204, 0.3); border-right: 2px solid rgba(136, 153, 204, 0.3); }
            `}</style>

            <div className="loader-bg-grid" />
            <div className="loader-sweep" style={{ animationPlayState: canEnter ? 'paused' : 'running', opacity: canEnter ? 0 : 1, transition: 'opacity 0.6s' }} />
            <div className="loader-orb" />

            <div className="loader-corner-tl" />
            <div className="loader-corner-tr" />
            <div className="loader-corner-bl" />
            <div className="loader-corner-br" />

            <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
                {letters.map((char, i) => (
                    <span key={i} className="kinetic-letter" style={{ animationDelay: `${i * 0.15}s` }}>
                        {char}
                    </span>
                ))}
            </div>

            <div style={{
                fontSize: 'clamp(9px, 2vw, 11px)', letterSpacing: '0.3em', position: 'relative', zIndex: 1, transition: 'all 0.6s',
                opacity: canEnter ? 1 : 0.5,
                color: canEnter ? '#00e5ff' : '#8899cc',
                textShadow: canEnter ? '0 0 12px rgba(0, 229, 255, 0.8), 0 0 24px rgba(0, 229, 255, 0.4)' : 'none',
                textAlign: 'center', padding: '0 16px',
            }}>
                {canEnter ? 'SYS // SYSTEMS READY // AWAITING ENTRY' : 'SYS // INITIALIZING GRAPHICS'}
            </div>

            <div ref={progressTextRef} style={{ marginTop: '30px', color: '#ffffff', fontSize: '18px', fontWeight: 200, letterSpacing: '0.15em', opacity: canEnter ? 0 : 1, transition: 'opacity 0.5s' }}>
                00.00 %
            </div>

            <button
                    onClick={canEnter ? handleEnter : undefined}
                    onPointerOver={() => canEnter && sfx.piano()}
                    style={{
                        marginTop: '40px',
                        background: 'transparent',
                        border: '1px solid rgba(136, 153, 204, 0.4)',
                        color: '#ffffff',
                        padding: '12px 40px',
                        fontSize: '14px',
                        letterSpacing: '0.6em',
                        cursor: canEnter ? 'pointer' : 'default',
                        position: 'relative',
                        overflow: 'hidden',
                        transition: 'all 0.3s cubic-bezier(0.23, 1, 0.32, 1)',
                        outline: 'none',
                        textIndent: '0.6em',
                        opacity: canEnter ? 1 : 0,
                        pointerEvents: canEnter ? 'auto' : 'none',
                    }}
                    onMouseEnter={e => {
                        e.target.style.background = 'rgba(136, 153, 204, 0.1)'
                        e.target.style.borderColor = 'rgba(136, 153, 204, 0.8)'
                        e.target.style.boxShadow = '0 0 20px rgba(136, 153, 204, 0.2)'
                        e.target.style.transform = 'translateY(-2px)'
                    }}
                    onMouseLeave={e => {
                        e.target.style.background = 'transparent'
                        e.target.style.borderColor = 'rgba(136, 153, 204, 0.4)'
                        e.target.style.boxShadow = 'none'
                        e.target.style.transform = 'translateY(0)'
                    }}
                >
                    ENTER
                </button>
        </div>
    )
}


function CopyEmailHud() {
    const [copied, setCopied] = useState(false)
    const copy = () => {
        navigator.clipboard.writeText(CONTACT_EMAIL)
        setCopied(true)
        sfx.ping()
        setTimeout(() => setCopied(false), 1600)
    }
    return (
        <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
            onMouseEnter={() => sfx.hover()}>
            <span
                onClick={copy}
                className="glitch-link"
                data-text={copied ? 'EMAIL COPIED!' : CONTACT_EMAIL.toUpperCase()}
                style={{
                    cursor: 'pointer',
                    color: copied ? '#00ff88' : undefined,
                    transition: 'color 0.2s',
                    userSelect: 'none',
                }}
            >
                {copied ? 'EMAIL COPIED!' : CONTACT_EMAIL.toUpperCase()}
            </span>
        </div>
    )
}

const SCROLL_HINT_CSS = `
@keyframes scrollWheelDrop {
    0%   { transform: translateY(0); opacity: 1; }
    60%  { transform: translateY(8px); opacity: 0; }
    61%  { transform: translateY(0); opacity: 0; }
    100% { transform: translateY(0); opacity: 1; }
}
.scroll-hint {
    position: absolute; bottom: 72px; left: 50%; transform: translateX(-50%);
    display: flex; flex-direction: column; align-items: center; gap: 7px;
    pointer-events: none;
}
.scroll-hint-mouse {
    width: 20px; height: 32px;
    border: 1.5px solid rgba(136,153,204,0.45); border-radius: 10px;
    display: flex; justify-content: center; padding-top: 5px; box-sizing: border-box;
}
.scroll-hint-wheel {
    width: 2px; height: 6px;
    background: rgba(136,153,204,0.7); border-radius: 2px;
    animation: scrollWheelDrop 1.8s ease-in-out infinite;
}
.scroll-hint-label {
    font-size: 8px; letter-spacing: 0.3em; color: rgba(136,153,204,0.4);
    font-family: 'Space Mono', monospace; text-transform: uppercase;
}

@keyframes glitch-link-1 {
    0% { clip-path: inset(20% 0 10% 0); transform: translate(-1px, -1px); }
    20% { clip-path: inset(60% 0 40% 0); transform: translate(1px, 1px); }
    40% { clip-path: inset(10% 0 70% 0); transform: translate(-1px, 1px); }
    60% { clip-path: inset(40% 0 20% 0); transform: translate(1px, -1px); }
    80% { clip-path: inset(80% 0 5% 0); transform: translate(-1px, 1px); }
    100% { clip-path: inset(30% 0 40% 0); transform: translate(1px, -1px); }
}
@keyframes glitch-gradient-shimmer {
    0% { background-position: 0% 50%; }
    100% { background-position: 200% 50%; }
}
.glitch-link {
    position: relative;
    display: inline-block;
    background: linear-gradient(90deg, #8899cc 0%, #99aab5 25%, #ffffff 50%, #9ab4b4 75%, #8899cc 100%);
    background-size: 200% auto;
    background-clip: text;
    -webkit-background-clip: text;
    color: transparent !important;
    animation: glitch-gradient-shimmer 6s linear infinite;
    transition: opacity 0.2s;
    text-decoration: none;
}
.glitch-link:hover { 
    color: #fff !important; 
    background: none; 
    -webkit-text-fill-color: #fff;
}
.glitch-link::before,
.glitch-link::after {
    content: attr(data-text);
    position: absolute;
    top: 0; left: 0;
    width: 100%; height: 100%;
    background: #050510;
    display: none;
    -webkit-text-fill-color: initial;
}
.glitch-link:hover::before {
    display: block;
    left: 2px;
    text-shadow: -1px 0 #ff00c1;
    clip-path: inset(10% 0 70% 0);
    animation: glitch-link-1 0.4s infinite linear alternate-reverse;
}
.glitch-link:hover::after {
    display: block;
    left: -2px;
    text-shadow: 1px 0 #00fff9;
    clip-path: inset(70% 0 10% 0);
    animation: glitch-link-1 0.3s infinite linear alternate-reverse;
}
`

function ScrollHint({ scrollRef }) {
    const elRef = useRef(null)
    useEffect(() => {
        let raf
        const tick = () => {
            if (elRef.current) {
                const t = scrollRef.current
                const opacity = Math.max(0, 1 - t / 0.07)
                elRef.current.style.opacity = opacity
            }
            raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(raf)
    }, [scrollRef])
    return (
        <div ref={elRef} className="scroll-hint">
            <style>{SCROLL_HINT_CSS}</style>
        </div>
    )
}

function MuteButton() {
    const { muted, toggleMute } = useSFX()
    return (
        <button
            onClick={toggleMute}
            title={muted ? 'Unmute sound' : 'Mute sound'}
            style={{
                position: 'fixed', bottom: '28px', right: 'clamp(16px, 4vw, 40px)', zIndex: 200,
                background: 'rgba(10,12,30,0.45)', border: '1px solid rgba(100,140,220,0.2)',
                backdropFilter: 'blur(8px)', borderRadius: '50%',
                width: '36px', height: '36px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: muted ? 'rgba(136,153,204,0.35)' : 'rgba(136,153,204,0.85)',
                fontSize: '15px', transition: 'color 0.2s, border-color 0.2s',
                padding: 0,
            }}
        >
            {muted ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
                </svg>
            ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                </svg>
            )}
        </button>
    )
}

function GlitchLink({ href, children, ...props }) {
    return (
        <a href={href} className="glitch-link" data-text={children.toString().toUpperCase()} target="_blank" rel="noreferrer" {...props}>
            {children}
        </a>
    )
}

function CursorOrb() {
    const orbRef = useRef()
    const soulRef = useRef()
    const coreRef = useRef()
    const mouse = useRef({ x: 0, y: 0 })
    const hoveredRef = useRef(false)
    const isTouchDevice = typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches

    useEffect(() => {
        const onMove = (e) => {
            const x = e.clientX
            const y = e.clientY
            // Reject out-of-viewport coords (synthetic events from drei <Html transform>)
            if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return
            mouse.current.x = x
            mouse.current.y = y

            const cursor = window.getComputedStyle(e.target).cursor
            const isHover = cursor === 'pointer'
            if (isHover !== hoveredRef.current) {
                hoveredRef.current = isHover
                if (soulRef.current) {
                    const s = isHover ? '28px' : '14px'
                    soulRef.current.style.width = s
                    soulRef.current.style.height = s
                    soulRef.current.style.boxShadow = isHover
                        ? '0 0 18px #ff00ff, 0 0 32px #ff00ff'
                        : '0 0 5px #ff00ff, 0 0 10px #ff00ff'
                    soulRef.current.style.background = isHover
                        ? 'rgba(255, 0, 255, 0.35)'
                        : 'rgba(255, 0, 255, 0.18)'
                }
                if (coreRef.current) {
                    const c = isHover ? '5px' : '3px'
                    coreRef.current.style.width = c
                    coreRef.current.style.height = c
                }
            }
        }
        window.addEventListener('mousemove', onMove)

        let raf
        const update = () => {
            if (orbRef.current) {
                orbRef.current.style.transform = `translate3d(${mouse.current.x}px, ${mouse.current.y}px, 0)`
            }
            raf = requestAnimationFrame(update)
        }
        raf = requestAnimationFrame(update)

        return () => {
            window.removeEventListener('mousemove', onMove)
            cancelAnimationFrame(raf)
        }
    }, [])

    if (isTouchDevice) return null

    return (
        <div
            ref={orbRef}
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                width: 0,
                height: 0,
                pointerEvents: 'none',
                zIndex: 9999,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                mixBlendMode: 'screen'
            }}
        >
            <div ref={soulRef} style={{
                width: '14px',
                height: '14px',
                borderRadius: '50%',
                background: 'rgba(255, 0, 255, 0.18)',
                boxShadow: '0 0 5px #ff00ff, 0 0 10px #ff00ff',
                transition: 'width 0.3s ease, height 0.3s ease, box-shadow 0.3s ease',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
            }}>
                <div ref={coreRef} style={{
                    width: '4px',
                    height: '4px',
                    borderRadius: '50%',
                    background: '#fff',
                    boxShadow: '0 0 10px #fff',
                    transition: 'width 0.3s ease, height 0.3s ease'
                }} />
            </div>
        </div>
    )
}

/** 
 * A 3D Light that follows the mouse inside the Scene
 * This makes the Orb "real" to the metallic objects.
 */
function SceneCursorLight() {
    const lightRef = useRef()
    const _dir = useMemo(() => new THREE.Vector3(), [])

    useFrame((state) => {
        if (!lightRef.current) return
        // Unproject mouse into a ray from the camera, place light 18 units ahead
        // This works at any camera position/depth — hero, nexus, or dossier
        _dir.set(state.pointer.x, state.pointer.y, 0.5).unproject(state.camera)
        _dir.sub(state.camera.position).normalize()
        lightRef.current.position.copy(state.camera.position).addScaledVector(_dir, 18)
    })

    return <pointLight ref={lightRef} intensity={6} color="#ff00ff" distance={22} decay={2} />
}

// scroll ranges per card: [enter, exit]
const MOBILE_CARD_RANGES = [
    [0.38, 0.58],
    [0.58, 0.82],
]

function MobileProjectsOverlay({ scrollRef, onOpenProject }) {
    const isMobile = typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches
    const cardRefs = useRef([])

    useEffect(() => {
        if (!isMobile) return
        let raf
        const tick = () => {
            const t = scrollRef.current ?? 0
            MOBILE_CARD_RANGES.forEach(([enter, exit], i) => {
                const fadeIn = Math.min(1, Math.max(0, (t - enter) / 0.04))
                const fadeOut = Math.min(1, Math.max(0, (exit - t) / 0.04))
                const opacity = Math.min(fadeIn, fadeOut)
                const el = cardRefs.current[i]
                if (el) {
                    el.style.opacity = opacity
                    el.style.pointerEvents = opacity > 0.1 ? 'auto' : 'none'
                    el.style.transform = `translateY(${(1 - opacity) * 20}px)`
                }
            })
            raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(raf)
    }, [scrollRef, isMobile])

    if (!isMobile) return null

    return (
        <>
            {PROJECT_CARDS.map((config, i) => (
                <div key={i} ref={el => cardRefs.current[i] = el} style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    zIndex: 50, opacity: 0, pointerEvents: 'none',
                    display: 'flex', flexDirection: 'column',
                    padding: '60px clamp(16px, 4vw, 40px) 100px',
                }}>
                    {/* Top: video + title */}
                    <div>
                        {config.video && (
                            <video
                                src={config.video}
                                autoPlay loop muted playsInline
                                style={{
                                    width: '100%',
                                    maxHeight: '40vh',
                                    objectFit: 'cover',
                                    borderRadius: '8px',
                                    marginBottom: '20px',
                                    border: `1px solid ${config.color}44`,
                                    boxShadow: `0 0 30px ${config.color}33`,
                                    display: 'block',
                                }}
                            />
                        )}
                        <div style={{
                            fontFamily: "'RocketCommand', monospace",
                            fontSize: '22px',
                            color: config.color,
                            letterSpacing: '0.06em',
                            marginBottom: '8px',
                            textTransform: 'uppercase',
                            textShadow: `0 0 20px ${config.color}88`,
                        }}>{config.title}</div>
                        <div style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '11px',
                            color: '#8899cc',
                            lineHeight: 1.6,
                            letterSpacing: '0.04em',
                        }}>{config.subtitle}</div>
                    </div>

                    {/* Bottom: meta + CTA */}
                    <div style={{ marginTop: 'auto' }}>
                        <div style={{
                            display: 'flex', gap: '10px',
                            fontFamily: 'var(--font-mono)',
                            fontSize: '10px',
                            color: '#556688',
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                            marginBottom: '16px',
                        }}>
                            <span>{config.stats.company}</span>
                            <span>·</span>
                            <span>{config.stats.role}</span>
                            <span>·</span>
                            <span>{config.stats.year}</span>
                        </div>
                        <div
                            onClick={() => onOpenProject?.(config)}
                            style={{
                                fontFamily: 'var(--font-mono)',
                                fontSize: '12px',
                                color: config.color,
                                letterSpacing: '0.1em',
                                textTransform: 'uppercase',
                                cursor: 'pointer',
                                pointerEvents: 'auto',
                                borderTop: `1px solid ${config.color}33`,
                                paddingTop: '16px',
                            }}>View Case Study →</div>
                    </div>
                </div>
            ))}
        </>
    )
}

function HeroSubtextCard({ scrollRef }) {
    const [show, setShow] = useState(false)
    const [inHero, setInHero] = useState(true)
    const inHeroRef = useRef(true)

    useEffect(() => {
        const id = setInterval(() => {
            if (heroIntroState.phase === 'done' && loaderFullyHidden && heroIntroState.hasEntered) {
                setShow(true)
                clearInterval(id)
            }
        }, 100)
        return () => { clearInterval(id) }
    }, [])

    useEffect(() => {
        let rafId
        const tick = () => {
            const next = (scrollRef.current ?? 0) < 0.08
            if (next !== inHeroRef.current) { inHeroRef.current = next; setInHero(next) }
            rafId = requestAnimationFrame(tick)
        }
        rafId = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(rafId)
    }, [scrollRef])

    const visible = show && inHero

    return (
        <>
            {/* Roles — desktop only, above the 3D MUSTAFA text */}
            {window.innerWidth > 768 && (
                <div style={{
                    position: 'absolute',
                    top: 'clamp(12%, 18%, 22%)',
                    left: '50%',
                    transform: `translateX(-50%) translateY(${visible ? '0px' : '-20px'})`,
                    opacity: visible ? 1 : 0,
                    transition: 'opacity 1.2s cubic-bezier(0.16, 1, 0.3, 1) 0.3s, transform 1.4s cubic-bezier(0.16, 1, 0.3, 1) 0.3s',
                    display: 'flex', alignItems: 'center', gap: '24px',
                    fontFamily: "'Space Mono', monospace",
                    fontSize: 'clamp(13px, 1.2vw, 16px)',
                    letterSpacing: '0.22em',
                    color: 'rgba(160,180,230,0.55)',
                    textTransform: 'uppercase',
                    pointerEvents: 'none',
                    zIndex: 40,
                    whiteSpace: 'nowrap',
                }}>
                    <span>Product Designer @ Dell</span>
                    <span style={{ opacity: 0.35 }}>·</span>
                    <span>UX Engineer @ iSchool</span>
                </div>
            )}

            {/* Subtext card — below the 3D MUSTAFA text */}
            <div style={{
                position: 'absolute',
                bottom: 'clamp(12%, 20%, 24%)',
                ...(window.innerWidth <= 768
                    ? { left: 'clamp(16px, 4vw, 40px)' }
                    : { left: '50%', transform: `translateX(-50%) translateY(${visible ? '0px' : '60px'})` }),
                ...(window.innerWidth > 768 ? {} : { transform: `translateY(${visible ? '0px' : '60px'})` }),
                opacity: visible ? 1 : 0,
                transition: 'opacity 1.2s cubic-bezier(0.16, 1, 0.3, 1) 0.3s, transform 1.4s cubic-bezier(0.16, 1, 0.3, 1) 0.3s',
                display: 'flex',
                flexDirection: 'column',
                alignItems: window.innerWidth <= 768 ? 'flex-start' : 'center',
                pointerEvents: 'none',
                zIndex: 40,
                width: '90vw',
                maxWidth: window.innerWidth > 768 ? '860px' : '600px',
            }}>
                <div style={{
                    fontFamily: "'Space Mono', monospace",
                    fontSize: 'clamp(12pt, 1.4vw, 14px)',
                    letterSpacing: '0.08em',
                    lineHeight: 1.6,
                    color: '#99aacc',
                    textAlign: window.innerWidth <= 768 ? 'left' : 'center',
                }}>
                    Product Designer skilled in systems thinking and interactive 3D experiences. Previously designed SmartFM's visual language at CBRE, connectivity-based experiences at MOTIVE, and led a design team at EDUCATIVE.
                </div>
            </div>
        </>
    )
}

export default function Portfolio() {
    const scrollRef = useRef(0)
    const currentSectionRef = useRef(0)
    const [activeProject, setActiveProject] = useState(null)
    const activeProjectRef = useRef(null)
    useEffect(() => { activeProjectRef.current = activeProject }, [activeProject])

    // Wrapper to play sound when opening case study
    const handleOpenProject = (project) => {
        if (!sfx.isMuted()) {
            const boin = getBoinXAudio()
            boin.currentTime = 0
            boin.play().catch(() => { })
        }
        setActiveProject(project)
    }

    // Start background track on first user gesture (required by browser autoplay policy)
    useEffect(() => {
        let started = false
        const start = () => {
            if (started) return
            sfx.setMuted(false)
            const p = sfx.startBgTrack()
            if (p && typeof p.then === 'function') {
                p.then(() => { started = true }).catch(() => { })
            } else {
                started = true
            }
        }
        const events = ['click', 'wheel', 'keydown', 'mousemove', 'touchstart', 'scroll']
        events.forEach(e => window.addEventListener(e, start))
        return () => events.forEach(e => window.removeEventListener(e, start))
    }, [])

    // Global UI hover tracker
    useEffect(() => {
        const onMove = (e) => {
            const overUI = e.target.tagName !== 'CANVAS'
            uiHoveredRef.current = overUI
            document.body.classList.toggle('ui-hovered', overUI)
        }
        window.addEventListener('mousemove', onMove)
        return () => {
            window.removeEventListener('mousemove', onMove)
            document.body.classList.remove('ui-hovered')
        }
    }, [])

    // Wheel-to-section snapping — one section per gesture, locked until scroll idle
    useEffect(() => {
        let wheelAccum = 0
        let locked = false
        let unlockTimer = null

        const onWheel = (e) => {
            // Allow native scroll inside the case study drawer
            if (e.target.closest('.cs-drawer')) return
            // Don't allow scrolling until hero intro animation is complete
            if (heroIntroState.phase !== 'done') { e.preventDefault(); return }
            // Don't block scroll when a project drawer is open
            if (activeProjectRef.current) return
            e.preventDefault()

            if (unlockTimer) clearTimeout(unlockTimer)
            unlockTimer = setTimeout(() => { locked = false; wheelAccum = 0 }, 600)

            if (locked) return

            const normalized = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * 800 : e.deltaY
            wheelAccum += normalized

            if (wheelAccum >= WHEEL_THRESHOLD) {
                wheelAccum = 0
                locked = true
                const prevSection = currentSectionRef.current
                currentSectionRef.current = Math.min(currentSectionRef.current + 1, SECTION_STOPS.length - 1)
                const newSection = currentSectionRef.current

                // Play itempick1 on forward transition (pre-loaded for instant playback)
                if (!sfx.isMuted()) {
                    const pick = getItemPick1Audio()
                    pick.currentTime = 0
                    pick.play().catch(() => { })
                }

                // Play mallet when entering ethos section (only once per session)
                if (newSection === ETHOS_SECTION_INDEX && !_malletPlayed) {
                    _malletPlayed = true
                    playMalletWithFX()
                }

                // Play ambient piano when entering dossier section
                if (newSection === DOSSIER_SECTION_INDEX && !_ambientPianoAudio) {
                    _ambientPianoAudio = new Audio('/sounds/AmbientPianoLoop10-790BPM.m4a')
                    _ambientPianoAudio.loop = true
                    _ambientPianoAudio.volume = 0.35
                    _ambientPianoAudio.play().catch(() => { })
                }

                sfx.snap()
            } else if (wheelAccum <= -WHEEL_THRESHOLD) {
                wheelAccum = 0
                locked = true
                const prevSection = currentSectionRef.current
                currentSectionRef.current = Math.max(currentSectionRef.current - 1, 0)
                const newSection = currentSectionRef.current

                // Play itemback on backward transition (pre-loaded for instant playback)
                if (!sfx.isMuted()) {
                    const back = getItemBackAudio()
                    back.currentTime = 0
                    back.play().catch(() => { })
                }

                // Play mallet when entering ethos section (only once per session)
                if (newSection === ETHOS_SECTION_INDEX && !_malletPlayed) {
                    _malletPlayed = true
                    playMalletWithFX()
                }

                // Stop ambient piano when leaving dossier
                if (prevSection === DOSSIER_SECTION_INDEX && newSection !== DOSSIER_SECTION_INDEX && _ambientPianoAudio) {
                    _ambientPianoAudio.pause()
                    _ambientPianoAudio.currentTime = 0
                    _ambientPianoAudio = null
                }

                sfx.snap()
            }
        }

        window.addEventListener('wheel', onWheel, { passive: false })
        return () => { window.removeEventListener('wheel', onWheel); clearTimeout(unlockTimer) }
    }, [])

    return (
        <>
            <CursorOrb />
            <div style={{
                width: '100vw',
                height: '100vh',
                background: '#050510',
                overflow: 'hidden',
                cursor: window.matchMedia('(hover: none)').matches ? 'auto' : 'none'
            }}>
                <EliteLoader />

                {/* LINKS — top-left on mobile, bottom-left on desktop */}
                <div style={{
                    position: 'fixed',
                    ...(window.innerWidth <= 768
                        ? { top: '16px', left: 'clamp(16px, 4vw, 40px)' }
                        : { bottom: '28px', left: 'clamp(16px, 4vw, 40px)' }),
                    zIndex: 200, display: 'flex', alignItems: 'center', gap: '20px',
                    color: '#8899cc', fontSize: '13px', letterSpacing: '1px',
                    textTransform: 'uppercase', fontFamily: 'var(--font-mono)',
                    pointerEvents: 'auto', height: '36px'
                }}>
                    <a href="https://drive.google.com/file/d/1lFeiToMUnMRtD6pC40q_PyZW01hf9Kus/view?usp=sharing" target="_blank" rel="noreferrer" className="nav-link" onMouseEnter={() => sfx.hover()}>RESUME</a>
                    <a href="https://www.linkedin.com/in/mustafa-ali-akbar-a5195387/" target="_blank" rel="noreferrer" className="nav-link" onMouseEnter={() => sfx.hover()}>LINKEDIN</a>
                    <a href="https://github.com/moosefroggo" target="_blank" rel="noreferrer" className="nav-link" onMouseEnter={() => sfx.hover()}>GITHUB</a>
                    {window.innerWidth > 768 && <CopyEmailHud />}
                </div>

                {/* EMAIL — top-right on mobile only */}
                {window.innerWidth <= 768 && (
                    <div style={{ position: 'fixed', top: '16px', right: 'clamp(16px, 4vw, 40px)', zIndex: 200, display: 'flex', alignItems: 'center', pointerEvents: 'auto', height: '30px', color: '#8899cc', fontSize: '13px', letterSpacing: '1px', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>
                        <CopyEmailHud />
                    </div>
                )}

                <MuteButton />
                <HeroSubtextCard scrollRef={scrollRef} />
                <MobileProjectsOverlay scrollRef={scrollRef} onOpenProject={handleOpenProject} />
                <ScrollHint scrollRef={scrollRef} />
                <EthosOverlay scrollRef={scrollRef} />
                <BioOverlay scrollRef={scrollRef} />
                <DossierOverlay scrollRef={scrollRef} />
                <ScrollBar scrollRef={scrollRef} currentSectionRef={currentSectionRef} />

                <Canvas camera={{ position: [0, -4, 14], fov: 65 }} dpr={[1, 1.5]} style={{ zIndex: 1 }}>
                    <React.Suspense fallback={null}>
                        <SceneCursorLight />
                        <Scene scrollRef={scrollRef} currentSectionRef={currentSectionRef} onOpenProject={handleOpenProject} />
                    </React.Suspense>
                </Canvas>

                <CaseStudyOverlay project={activeProject} onClose={() => { if (!sfx.isMuted()) { const back = getItemBackAudio(); back.currentTime = 0; back.play().catch(() => {}) } setActiveProject(null) }} />
            </div>
        </>
    )
}