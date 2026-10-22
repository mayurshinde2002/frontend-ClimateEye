import { useEffect } from 'react'
import L from 'leaflet'

/**
 * Keep wheel / touch / drag events on overlay UI from zooming or panning the map.
 */
export const useLeafletSafeOverlay = (ref, enabled = true) => {
  useEffect(() => {
    if (!enabled) return undefined
    const node = ref?.current
    if (!node) return undefined

    L.DomEvent.disableClickPropagation(node)
    L.DomEvent.disableScrollPropagation(node)

    const stop = (event) => {
      event.stopPropagation()
    }

    node.addEventListener('wheel', stop, { passive: true })
    node.addEventListener('mousewheel', stop, { passive: true })
    node.addEventListener('DOMMouseScroll', stop, { passive: true })
    node.addEventListener('touchmove', stop, { passive: true })
    node.addEventListener('pointerdown', stop)
    node.addEventListener('mousedown', stop)
    node.addEventListener('dblclick', stop)

    return () => {
      node.removeEventListener('wheel', stop)
      node.removeEventListener('mousewheel', stop)
      node.removeEventListener('DOMMouseScroll', stop)
      node.removeEventListener('touchmove', stop)
      node.removeEventListener('pointerdown', stop)
      node.removeEventListener('mousedown', stop)
      node.removeEventListener('dblclick', stop)
    }
  }, [ref, enabled])
}
