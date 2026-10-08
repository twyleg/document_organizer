import { createMatchingHandler, type MatchingRequest } from '../shared/archiveMatching'
const handle = createMatchingHandler()
self.onmessage = (event: MessageEvent<MatchingRequest>) => self.postMessage(handle(event.data))
