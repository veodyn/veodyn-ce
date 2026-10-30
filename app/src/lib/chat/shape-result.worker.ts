import { shapeResult } from './shape-result'
import type { ShapeRequest } from './shape-result-off-thread'

addEventListener('message', (event: MessageEvent<ShapeRequest>) => {
  postMessage(shapeResult(event.data.data, event.data.dataSourceId))
})
