import {
  layoutNextLine,
  layoutWithLines,
  prepareWithSegments,
  walkLineRanges,
  type LayoutCursor,
} from '@chenglou/pretext'
import { images } from './assets/images.ts'

const BODY_FONT = '18px "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, serif'
const BODY_LINE_HEIGHT = 30
const HEADLINE_FONT_FAMILY = '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, serif'
const HEADLINE_TEXT = 'THE FUTURE OF TEXT LAYOUT WITH PRETEXT'
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

type HeadlineFit = {
  fontSize: number
  lines: PositionedLine[]
}

const BODY_TEXT = `The web renders text through a pipeline that was designed thirty years ago for static documents. A browser loads a font, shapes the text into glyphs, measures their combined width, determines where lines break, and positions each line vertically. Every step depends on the previous one. Every step requires the rendering engine to consult its internal layout tree — a structure so expensive to maintain that browsers guard access to it behind synchronous reflow barriers that can freeze the main thread for tens of milliseconds at a time.

For a paragraph in a blog post, this pipeline is invisible. The browser loads, lays out, and paints before the reader’s eye has traveled from the address bar to the first word. But the web is no longer a collection of static documents. It is a platform for applications, and those applications need to know about text in ways the original pipeline never anticipated.

A messaging application needs to know the exact height of every message bubble before rendering a virtualized list. A masonry layout needs the height of every card to position them without overlap. An editorial page needs text to flow around images, advertisements, and interactive elements. A responsive dashboard needs to resize and reflow text in real time as the user drags a panel divider.

Every one of these operations requires text measurement. And every text measurement on the web today requires a synchronous layout reflow. The cost is devastating. Measuring the height of a single text block forces the browser to recalculate the position of every element on the page. When you measure five hundred text blocks in sequence, you trigger five hundred full layout passes. This pattern, known as layout thrashing, is the single largest source of jank on the modern web.`

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

const stage = getRequiredDiv('stage')

await document.fonts.ready

const preparedBody = prepareWithSegments(BODY_TEXT, BODY_FONT)
const DROP_CAP_SIZE = BODY_LINE_HEIGHT * DROP_CAP_LINES - 4
const DROP_CAP_FONT = `700 ${DROP_CAP_SIZE}px ${HEADLINE_FONT_FAMILY}`
const DROP_CAP_TEXT = BODY_TEXT[0]!
const preparedDropCap = prepareWithSegments(DROP_CAP_TEXT, DROP_CAP_FONT)

let dropCapWidth = 0
walkLineRanges(preparedDropCap, 9999, line => {
  dropCapWidth = line.width
})
const DROP_CAP_TOTAL_W = Math.ceil(dropCapWidth) + 10

const dropCapEl = document.createElement('div')
dropCapEl.className = 'drop-cap'
dropCapEl.textContent = DROP_CAP_TEXT
dropCapEl.style.font = DROP_CAP_FONT
dropCapEl.style.lineHeight = `${DROP_CAP_SIZE}px`
stage.appendChild(dropCapEl)

const linePool: HTMLDivElement[] = []
const headlinePool: HTMLDivElement[] = []
const domCache = {
  stage,
  dropCap: dropCapEl,
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

function layoutColumn(
  prepared: any,
  startCursor: LayoutCursor,
  regionX: number,
  regionY: number,
  regionW: number,
  regionH: number,
  lineHeight: number,
  rectObstacles: RectObstacle[],
): { lines: PositionedLine[], cursor: LayoutCursor } {
  let cursor: LayoutCursor = startCursor
  let lineTop = regionY
  const lines: PositionedLine[] = []
  let textExhausted = false

  while (lineTop + lineHeight <= regionY + regionH && !textExhausted) {
    const bandTop = lineTop
    const bandBottom = lineTop + lineHeight
    const blocked: Interval[] = []

    for (let rectIndex = 0; rectIndex < rectObstacles.length; rectIndex++) {
      const rect = rectObstacles[rectIndex]!
      if (bandBottom <= rect.y || bandTop >= rect.y + rect.h) continue
      blocked.push({ left: rect.x, right: rect.x + rect.w })
    }

    const slots = carveTextLineSlots({ left: regionX, right: regionX + regionW }, blocked)
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
  w: number
  h: number
}

// Initialize assets using the generated images file.
// Bun's bundler will now correctly resolve the URLs for each image.
const assets: AssetState[] = images.map((src: string) => {
  const el = document.createElement('img')
  el.src = src
  el.className = 'asset-img'
  stage.appendChild(el)
  
  const size = 150 + Math.random() * 100
  return {
    el,
    x: Math.random() * (window.innerWidth - size),
    y: Math.random() * (window.innerHeight - size),
    vx: (Math.random() - 0.5) * 200,
    vy: (Math.random() - 0.5) * 200,
    w: size,
    h: size,
  }
})

let lastTime = 0

function render(time: number): void {
  const dt = (time - lastTime) / 1000
  lastTime = time

  const pageWidth = document.documentElement.clientWidth
  const pageHeight = document.documentElement.clientHeight
  const isNarrow = pageWidth < NARROW_BREAKPOINT
  const gutter = isNarrow ? NARROW_GUTTER : GUTTER
  const colGap = isNarrow ? NARROW_COL_GAP : COL_GAP
  const bottomGap = isNarrow ? NARROW_BOTTOM_GAP : BOTTOM_GAP

  const rectObstacles: RectObstacle[] = []

  for (const asset of assets) {
    asset.x += asset.vx * dt
    asset.y += asset.vy * dt

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

    rectObstacles.push({
      x: asset.x - 10,
      y: asset.y - 10,
      w: asset.w + 20,
      h: asset.h + 20,
    })
  }

  const headlineWidth = Math.min(pageWidth - gutter * 2, 1000)
  const maxHeadlineHeight = Math.floor(pageHeight * 0.2)
  const { fontSize: headlineSize, lines: headlineLines } = fitHeadline(
    headlineWidth,
    maxHeadlineHeight,
    isNarrow ? 38 : 92,
  )
  const headlineLineHeight = Math.round(headlineSize * 0.93)
  const headlineFont = `700 ${headlineSize}px ${HEADLINE_FONT_FAMILY}`
  const headlineHeight = headlineLines.length * headlineLineHeight

  const bodyTop = gutter + headlineHeight + (isNarrow ? 14 : 20)
  const bodyHeight = pageHeight - bodyTop - bottomGap
  const columnCount = pageWidth > 1000 ? 3 : pageWidth > 640 ? 2 : 1
  const totalGutter = gutter * 2 + colGap * (columnCount - 1)
  const maxContentWidth = Math.min(pageWidth, 1500)
  const columnWidth = Math.floor((maxContentWidth - totalGutter) / columnCount)
  const contentLeft = Math.round((pageWidth - (columnCount * columnWidth + (columnCount - 1) * colGap)) / 2)
  const column0X = contentLeft

  const dropCapRect: RectObstacle = {
    x: column0X - 2,
    y: bodyTop - 2,
    w: DROP_CAP_TOTAL_W,
    h: DROP_CAP_LINES * BODY_LINE_HEIGHT + 2,
  }

  const allBodyLines: PositionedLine[] = []
  let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 1 }
  for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
    const columnX = contentLeft + columnIndex * (columnWidth + colGap)
    const rects: RectObstacle[] = [...rectObstacles]
    if (columnIndex === 0) rects.push(dropCapRect)

    const result = layoutColumn(
      preparedBody,
      cursor,
      columnX,
      bodyTop,
      columnWidth,
      bodyHeight,
      BODY_LINE_HEIGHT,
      rects,
    )
    allBodyLines.push(...result.lines)
    cursor = result.cursor
  }

  syncPool(domCache.headlineLines, headlineLines.length, 'headline-line')
  for (let index = 0; index < headlineLines.length; index++) {
    const element = domCache.headlineLines[index]!
    const line = headlineLines[index]!
    element.textContent = line.text
    element.style.left = `${gutter}px`
    element.style.top = `${gutter + line.y}px`
    element.style.font = headlineFont
    element.style.lineHeight = `${headlineLineHeight}px`
  }

  domCache.dropCap.style.left = `${column0X}px`
  domCache.dropCap.style.top = `${bodyTop}px`

  syncPool(domCache.bodyLines, allBodyLines.length, 'line')
  for (let index = 0; index < allBodyLines.length; index++) {
    const element = domCache.bodyLines[index]!
    const line = allBodyLines[index]!
    element.textContent = line.text
    element.style.left = `${line.x}px`
    element.style.top = `${line.y}px`
    element.style.font = BODY_FONT
    element.style.lineHeight = `${BODY_LINE_HEIGHT}px`
  }

  requestAnimationFrame(render)
}

requestAnimationFrame(render)
