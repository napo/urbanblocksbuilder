import type * as maplibregl from 'maplibre-gl'
import { TerraDraw, TerraDrawPolygonMode, TerraDrawRectangleMode, TerraDrawSelectMode } from 'terra-draw'
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter'

/**
 * Terra Draw is the preferred drawing library for MapLibre integrations
 * (see docs/algorithm.md / README "Drawing"): unlike mapbox-gl-draw, its
 * MapLibre adapter is built and tested specifically against MapLibre GL JS,
 * which avoids style-spec incompatibilities (mapbox-gl-draw's bundled
 * default styles use dasharray expressions MapLibre's stricter validator
 * rejects, silently breaking the draw layers).
 */
// Grey, deliberately not too light: this is the *selection* being drawn,
// and must read as visually distinct from the teal urban blocks the
// analysis eventually produces - matching the 'analysis-area' map layer.
const SELECTION_GREY = '#64748b'
const SELECTION_GREY_DARK = '#334155'

export function createTerraDraw(map: maplibregl.Map): TerraDraw {
  return new TerraDraw({
    adapter: new TerraDrawMapLibreGLAdapter({ map: map as never }),
    modes: [
      // 'click-move-or-drag' accepts both a classic click-drag-release (the
      // interaction most users expect from "draw a rectangle") and a
      // click-move-click sequence, instead of only the latter.
      new TerraDrawRectangleMode({
        drawInteraction: 'click-move-or-drag',
        styles: {
          fillColor: SELECTION_GREY,
          fillOpacity: 0.35,
          outlineColor: SELECTION_GREY_DARK,
          outlineOpacity: 1,
          outlineWidth: 2,
        },
      }),
      new TerraDrawPolygonMode({
        styles: {
          fillColor: SELECTION_GREY,
          fillOpacity: 0.35,
          outlineColor: SELECTION_GREY_DARK,
          outlineOpacity: 1,
          outlineWidth: 2,
          closingPointColor: SELECTION_GREY_DARK,
          closingPointOutlineColor: '#ffffff',
        },
      }),
      new TerraDrawSelectMode({
        flags: {
          rectangle: {
            feature: {
              draggable: true,
              coordinates: { draggable: true, deletable: true, resizable: 'opposite-fixed' },
            },
          },
          polygon: {
            feature: {
              draggable: true,
              coordinates: { draggable: true, deletable: true },
            },
          },
        },
        styles: {
          selectedPolygonColor: SELECTION_GREY,
          selectedPolygonFillOpacity: 0.35,
          selectedPolygonOutlineColor: SELECTION_GREY_DARK,
          selectedPolygonOutlineWidth: 2,
        },
      }),
    ],
  })
}

const TRASH_ICON_SVG = `
<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M3 6h18" />
  <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
  <path d="M10 11v6" />
  <path d="M14 11v6" />
</svg>
`

/**
 * A small on-map control, styled to match MapLibre's native control boxes,
 * that clears the in-progress or finished drawing. Terra Draw itself is
 * headless (it has no built-in toolbar UI), so this is the "integrated
 * standard widget" surface for the one drawing action that doesn't already
 * have a home in the area-selection step panel. Uses an inline SVG (not an
 * emoji glyph) so the icon renders identically everywhere, including Linux
 * desktops without a colour-emoji font installed.
 */
export class ClearDrawControl implements maplibregl.IControl {
  private container: HTMLDivElement | null = null
  private readonly onClear: () => void

  constructor(onClear: () => void) {
    this.onClear = onClear
  }

  onAdd(): HTMLElement {
    this.container = document.createElement('div')
    this.container.className = 'maplibregl-ctrl maplibregl-ctrl-group draw-clear-control'
    const button = document.createElement('button')
    button.type = 'button'
    button.title = 'Clear drawing'
    button.setAttribute('aria-label', 'Clear drawing')
    button.innerHTML = `${TRASH_ICON_SVG}<span>Clear</span>`
    button.style.display = 'flex'
    button.style.alignItems = 'center'
    button.style.gap = '0.3rem'
    button.style.width = 'auto'
    button.style.height = '29px'
    button.style.padding = '0 0.6rem'
    button.style.background = 'white'
    button.style.color = '#0f172a'
    button.style.border = '0'
    button.style.cursor = 'pointer'
    button.style.fontSize = '0.75rem'
    button.style.fontWeight = '600'
    button.style.whiteSpace = 'nowrap'
    button.addEventListener('click', () => this.onClear())
    this.container.appendChild(button)
    return this.container
  }

  onRemove(): void {
    this.container?.remove()
    this.container = null
  }
}
