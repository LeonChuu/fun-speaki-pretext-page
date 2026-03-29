import {
  layoutNextLine,
  layoutWithLines,
  prepareWithSegments,
  walkLineRanges,
  type LayoutCursor,
} from '@chenglou/pretext'
import { images } from './assets/images.ts'

const BODY_FONT = '500 18px "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, serif'
const BODY_LINE_HEIGHT = 30
const HEADLINE_FONT_FAMILY = '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, serif'
const HEADLINE_TEXT = 'Speaki likes pumpkin!!'
const GUTTER = 48
const BOTTOM_GAP = 20
const MIN_SLOT_WIDTH = 50
const NARROW_BREAKPOINT = 760
const NARROW_GUTTER = 20

type Interval = {
  left: number
  right: number
}

type PositionedLine = {
  x: number
  y: number
  width: number
  text: string
}

type RectObstacle = {
  x: number
  y: number
  w: number
  h: number
}

type AlphaObstacle = {
  x: number
  y: number
  w: number
  h: number
  // Array of horizontal intervals (normalized 0-1) for each vertical row of the image
  scanlines: (Interval | null)[]
}

type HeadlineFit = {
  fontSize: number
  lines: PositionedLine[]
}

const BODY_TEXT = `Chowayo chowayo sundakotti chowayo. ueeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee~ Speaki! `.repeat(40) 

function getRequiredDiv(id: string): HTMLDivElement {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLDivElement)) throw new Error(`#${id} not found`)
  return element
}

function carveTextLineSlots(base: Interval, blocked: Interval[]): Interval[] {
  let slots = [base]
  for (let blockedIndex = 0; blockedIndex < blocked.length; blockedIndex++) {
    const interval = blocked[blockedIndex]!
    const next: Interval[] = []
    for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
      const slot = slots[slotIndex]!
      if (interval.right <= slot.left || interval.left >= slot.right) {
        next.push(slot)
        continue
      }
      if (interval.left > slot.left) next.push({ left: slot.left, right: interval.left })
      if (interval.right < slot.right) next.push({ left: interval.right, right: slot.right })
    }
    slots = next
  }
  return slots.filter(slot => slot.right - slot.left >= MIN_SLOT_WIDTH)
}

function getCircleSpanAtY(cx: number, cy: number, r: number, y: number): Interval | null {
  const dy = Math.abs(y - cy);
  if (dy >= r) return null;
  const dx = Math.sqrt(r * r - dy * dy);
  return { left: cx - dx, right: cx + dx };
}

async function extractAlphaScanlines(img: HTMLImageElement): Promise<(Interval | null)[]> {
  const canvas = document.createElement('canvas')
  // Use a fixed resolution for scanning to balance performance and accuracy
  const scanWidth = 100
  const scanHeight = 100
  canvas.width = scanWidth
  canvas.height = scanHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return []

  ctx.drawImage(img, 0, 0, scanWidth, scanHeight)
  const imageData = ctx.getImageData(0, 0, scanWidth, scanHeight)
  const data = imageData.data
  const scanlines: (Interval | null)[] = []

  for (let y = 0; y < scanHeight; y++) {
    let firstX = -1
    let lastX = -1
    for (let x = 0; x < scanWidth; x++) {
      const alpha = data[(y * scanWidth + x) * 4 + 3]!
      if (alpha > 50) { // Transparency threshold
        if (firstX === -1) firstX = x
        lastX = x
      }
    }
    if (firstX !== -1) {
      scanlines.push({ left: firstX / scanWidth, right: (lastX + 1) / scanWidth })
    } else {
      scanlines.push(null)
    }
  }
  return scanlines
}

const stage = getRequiredDiv('stage')
const speedSlider = document.getElementById('speed-slider') as HTMLInputElement

await document.fonts.ready

const preparedBody = prepareWithSegments(BODY_TEXT, BODY_FONT)

const linePool: HTMLDivElement[] = []
const headlinePool: HTMLDivElement[] = []
const domCache = {
  stage,
  bodyLines: linePool,
  headlineLines: headlinePool,
}

function syncPool(pool: HTMLDivElement[], count: number, className: string): void {
  while (pool.length < count) {
    const element = document.createElement('div')
    element.className = className
    stage.appendChild(element)
    pool.push(element)
  }
  for (let index = 0; index < pool.length; index++) {
    pool[index]!.style.display = index < count ? '' : 'none'
  }
}

let cachedHeadlineWidth = -1
let cachedHeadlineHeight = -1
let cachedHeadlineFontSize = 24
let cachedHeadlineLines: PositionedLine[] = []

function fitHeadline(maxWidth: number, maxHeight: number, maxSize: number = 92): HeadlineFit {
  if (maxWidth === cachedHeadlineWidth && maxHeight === cachedHeadlineHeight) {
    return { fontSize: cachedHeadlineFontSize, lines: cachedHeadlineLines }
  }

  cachedHeadlineWidth = maxWidth
  cachedHeadlineHeight = maxHeight
  let lo = 20
  let hi = maxSize
  let best = lo
  let bestLines: PositionedLine[] = []

  while (lo <= hi) {
    const size = Math.floor((lo + hi) / 2)
    const font = `700 ${size}px ${HEADLINE_FONT_FAMILY}`
    const lineHeight = Math.round(size * 0.93)
    const prepared = prepareWithSegments(HEADLINE_TEXT, font)
    let breaksWord = false
    let lineCount = 0

    walkLineRanges(prepared, maxWidth, line => {
      lineCount++
      if (line.end.graphemeIndex !== 0) breaksWord = true
    })

    const totalHeight = lineCount * lineHeight
    if (!breaksWord && totalHeight <= maxHeight) {
      best = size
      const result = layoutWithLines(prepared, maxWidth, lineHeight)
      bestLines = result.lines.map((line, index) => ({
        x: 0,
        y: index * lineHeight,
        text: line.text,
        width: line.width,
      }))
      lo = size + 1
    } else {
      hi = size - 1
    }
  }

  cachedHeadlineFontSize = best
  cachedHeadlineLines = bestLines
  return { fontSize: best, lines: bestLines }
}

function layoutCircularBody(
  prepared: any,
  startCursor: LayoutCursor,
  cx: number,
  cy: number,
  r: number,
  lineHeight: number,
  alphaObstacles: AlphaObstacle[],
): { lines: PositionedLine[], cursor: LayoutCursor } {
  let cursor: LayoutCursor = startCursor
  let lineTop = cy - r
  const lines: PositionedLine[] = []
  let textExhausted = false

  while (lineTop + lineHeight <= cy + r && !textExhausted) {
    const bandTop = lineTop
    const bandBottom = lineTop + lineHeight
    
    const spanTop = getCircleSpanAtY(cx, cy, r, bandTop)
    const spanBottom = getCircleSpanAtY(cx, cy, r, bandBottom)
    
    if (!spanTop || !spanBottom) {
      lineTop += lineHeight
      continue
    }

    const baseInterval: Interval = {
      left: Math.max(spanTop.left, spanBottom.left),
      right: Math.min(spanTop.right, spanBottom.right)
    }

    if (baseInterval.right <= baseInterval.left + MIN_SLOT_WIDTH) {
      lineTop += lineHeight
      continue
    }

    const blocked: Interval[] = []

    for (let obsIndex = 0; obsIndex < alphaObstacles.length; obsIndex++) {
      const obs = alphaObstacles[obsIndex]!
      // Check if image intersects this vertical band
      if (bandBottom <= obs.y || bandTop >= obs.y + obs.h) continue

      // Find the range of scanlines that overlap this band
      const startIdx = Math.max(0, Math.floor(((bandTop - obs.y) / obs.h) * obs.scanlines.length))
      const endIdx = Math.min(obs.scanlines.length - 1, Math.floor(((bandBottom - obs.y) / obs.h) * obs.scanlines.length))

      let combinedLeft = 1.0
      let combinedRight = 0.0
      let foundOpaque = false

      for (let i = startIdx; i <= endIdx; i++) {
        const span = obs.scanlines[i]
        if (span) {
          combinedLeft = Math.min(combinedLeft, span.left)
          combinedRight = Math.max(combinedRight, span.right)
          foundOpaque = true
        }
      }

      if (foundOpaque) {
        // Map normalized coordinates back to screen pixels
        blocked.push({
          left: obs.x + combinedLeft * obs.w - 8, // padding
          right: obs.x + combinedRight * obs.w + 8
        })
      }
    }

    const slots = carveTextLineSlots(baseInterval, blocked)
    if (slots.length === 0) {
      lineTop += lineHeight
      continue
    }

    const orderedSlots = [...slots].sort((a, b) => a.left - b.left)

    for (let slotIndex = 0; slotIndex < orderedSlots.length; slotIndex++) {
      const slot = orderedSlots[slotIndex]!
      const slotWidth = slot.right - slot.left
      const line = layoutNextLine(prepared, cursor, slotWidth)
      if (line === null) {
        textExhausted = true
        break
      }
      lines.push({
        x: Math.round(slot.left),
        y: Math.round(lineTop),
        text: line.text,
        width: line.width,
      })
      cursor = line.end
    }

    lineTop += lineHeight
  }

  return { lines, cursor }
}

type AssetState = {
  el: HTMLImageElement
  x: number
  y: number
  vx: number
  vy: number
  baseSize: number
  w: number
  h: number
  scanlines: (Interval | null)[]
}

const assets: AssetState[] = []

async function initAssets() {
  const promises = images.map(async (src: string) => {
    const el = document.createElement('img')
    el.src = src
    el.className = 'asset-img'
    stage.appendChild(el)
    
    // Wait for image to load to process alpha
    await new Promise((resolve) => {
      if (el.complete) resolve(null)
      else el.onload = () => resolve(null)
    })

    const scanlines = await extractAlphaScanlines(el)
    const baseSize = 150 + Math.random() * 100

    assets.push({
      el,
      x: Math.random() * (window.innerWidth - baseSize),
      y: Math.random() * (window.innerHeight - baseSize),
      vx: (Math.random() - 0.5) * 200,
      vy: (Math.random() - 0.5) * 200,
      baseSize,
      w: baseSize,
      h: baseSize,
      scanlines
    })
  })
  await Promise.all(promises)
}

let lastTime = 0

function render(time: number): void {
  const dt = (time - lastTime) / 1000
  lastTime = time

  const speedMultiplier = speedSlider ? parseFloat(speedSlider.value) : 1

  const pageWidth = document.documentElement.clientWidth
  const pageHeight = document.documentElement.clientHeight
  const gutter = pageWidth < NARROW_BREAKPOINT ? NARROW_GUTTER : GUTTER
  const scale = Math.max(0.4, Math.min(1.5, pageWidth / 1200))

  const alphaObstacles: AlphaObstacle[] = []

  for (const asset of assets) {
    asset.w = asset.baseSize * scale
    asset.h = asset.baseSize * scale

    asset.x += asset.vx * dt * speedMultiplier
    asset.y += asset.vy * dt * speedMultiplier

    if (asset.x < 0) {
      asset.x = 0
      asset.vx *= -1
    }
    if (asset.x + asset.w > pageWidth) {
      asset.x = pageWidth - asset.w
      asset.vx *= -1
    }
    if (asset.y < 0) {
      asset.y = 0
      asset.vy *= -1
    }
    if (asset.y + asset.h > pageHeight) {
      asset.y = pageHeight - asset.h
      asset.vy *= -1
    }

    asset.el.style.width = `${asset.w}px`
    asset.el.style.height = `${asset.h}px`
    asset.el.style.left = `${asset.x}px`
    asset.el.style.top = `${asset.y}px`

    alphaObstacles.push({
      x: asset.x,
      y: asset.y,
      w: asset.w,
      h: asset.h,
      scanlines: asset.scanlines
    })
  }

  const headlineWidth = Math.min(pageWidth - gutter * 2, 1000)
  const maxHeadlineHeight = Math.floor(pageHeight * 0.15)
  const { fontSize: headlineSize, lines: headlineLines } = fitHeadline(
    headlineWidth,
    maxHeadlineHeight,
    pageWidth < NARROW_BREAKPOINT ? 38 : 64,
  )
  const headlineLineHeight = Math.round(headlineSize * 0.93)
  const headlineFont = `700 ${headlineSize}px ${HEADLINE_FONT_FAMILY}`
  const headlineHeight = headlineLines.length * headlineLineHeight

  const bodyTop = gutter + headlineHeight + 40
  const bodyCenterX = pageWidth / 2
  const bodyCenterY = bodyTop + (pageHeight - bodyTop - BOTTOM_GAP) / 2
  const bodyRadius = Math.min(pageWidth - gutter * 2, pageHeight - bodyTop - BOTTOM_GAP) / 2

  const result = layoutCircularBody(
    preparedBody,
    { segmentIndex: 0, graphemeIndex: 0 },
    bodyCenterX,
    bodyCenterY,
    bodyRadius,
    BODY_LINE_HEIGHT,
    alphaObstacles
  )

  syncPool(domCache.headlineLines, headlineLines.length, 'headline-line')
  for (let index = 0; index < headlineLines.length; index++) {
    const element = domCache.headlineLines[index]!
    const line = headlineLines[index]!
    element.textContent = line.text
    element.style.left = `${(pageWidth - line.width) / 2}px`
    element.style.top = `${gutter + line.y}px`
    element.style.font = headlineFont
    element.style.lineHeight = `${headlineLineHeight}px`
  }

  syncPool(domCache.bodyLines, result.lines.length, 'line')
  for (let index = 0; index < result.lines.length; index++) {
    const element = domCache.bodyLines[index]!
    const line = result.lines[index]!
    element.textContent = line.text
    element.style.left = `${line.x}px`
    element.style.top = `${line.y}px`
    element.style.font = BODY_FONT
    element.style.lineHeight = `${BODY_LINE_HEIGHT}px`
  }

  requestAnimationFrame(render)
}

await initAssets()
requestAnimationFrame(render)
