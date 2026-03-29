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
const HEADLINE_TEXT = 'Speaki likes pumpkin!'
const GUTTER = 48
const COL_GAP = 40
const BOTTOM_GAP = 20
const DROP_CAP_LINES = 3
const MIN_SLOT_WIDTH = 50
const NARROW_BREAKPOINT = 760
const NARROW_GUTTER = 20
const NARROW_COL_GAP = 20
const NARROW_BOTTOM_GAP = 16

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

type CircleObstacle = {
  cx: number
  cy: number
  r: number
  hPad: number
  vPad: number
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

function circleIntervalForBand(
  cx: number,
  cy: number,
  r: number,
  bandTop: number,
  bandBottom: number,
  hPad: number,
  vPad: number,
): Interval | null {
  const top = bandTop - vPad
  const bottom = bandBottom + vPad
  if (top >= cy + r || bottom <= cy - r) return null
  const minDy = cy >= top && cy <= bottom ? 0 : cy < top ? top - cy : cy - bottom
  if (minDy >= r) return null
  const maxDx = Math.sqrt(r * r - minDy * minDy)
  return { left: cx - maxDx - hPad, right: cx + maxDx + hPad }
}

function getCircleSpanAtY(cx: number, cy: number, r: number, y: number): Interval | null {
  const dy = Math.abs(y - cy);
  if (dy >= r) return null;
  const dx = Math.sqrt(r * r - dy * dy);
  return { left: cx - dx, right: cx + dx };
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
  rectObstacles: RectObstacle[],
  circleObstacles: CircleObstacle[],
): { lines: PositionedLine[], cursor: LayoutCursor } {
  let cursor: LayoutCursor = startCursor
  let lineTop = cy - r
  const lines: PositionedLine[] = []
  let textExhausted = false

  while (lineTop + lineHeight <= cy + r && !textExhausted) {
    const bandTop = lineTop
    const bandBottom = lineTop + lineHeight
    const midY = (bandTop + bandBottom) / 2
    
    // Check span at both top and bottom of line to stay inside the circle
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

    for (let rectIndex = 0; rectIndex < rectObstacles.length; rectIndex++) {
      const rect = rectObstacles[rectIndex]!
      if (bandBottom <= rect.y || bandTop >= rect.y + rect.h) continue
      blocked.push({ left: rect.x, right: rect.x + rect.w })
    }

    for (let circIndex = 0; circIndex < circleObstacles.length; circIndex++) {
      const circ = circleObstacles[circIndex]!
      const interval = circleIntervalForBand(circ.cx, circ.cy, circ.r, bandTop, bandBottom, circ.hPad, circ.vPad)
      if (interval) blocked.push(interval)
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
}

const assets: AssetState[] = images.map((src: string) => {
  const el = document.createElement('img')
  el.src = src
  el.className = 'asset-img'
  el.style.borderRadius = '50%' // Make images circular visually
  stage.appendChild(el)
  
  const baseSize = 150 + Math.random() * 100
  return {
    el,
    x: Math.random() * (window.innerWidth - baseSize),
    y: Math.random() * (window.innerHeight - baseSize),
    vx: (Math.random() - 0.5) * 200,
    vy: (Math.random() - 0.5) * 200,
    baseSize: baseSize,
    w: baseSize,
    h: baseSize,
  }
})

let lastTime = 0

function render(time: number): void {
  const dt = (time - lastTime) / 1000
  lastTime = time

  const speedMultiplier = speedSlider ? parseFloat(speedSlider.value) : 1

  const pageWidth = document.documentElement.clientWidth
  const pageHeight = document.documentElement.clientHeight
  const gutter = pageWidth < NARROW_BREAKPOINT ? NARROW_GUTTER : GUTTER

  // Calculate scale factor based on window width (reference width 1200px)
  const scale = Math.max(0.4, Math.min(1.5, pageWidth / 1200))

  const circleObstacles: CircleObstacle[] = []

  for (const asset of assets) {
    // Update size based on scale
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

    circleObstacles.push({
      cx: asset.x + asset.w / 2,
      cy: asset.y + asset.h / 2,
      r: asset.w / 2,
      hPad: 10,
      vPad: 2,
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
    [],
    circleObstacles
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

requestAnimationFrame(render)
