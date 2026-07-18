export type SerialCandidate = {
  candidateId: string
  vendorId: number | null
  productId: number | null
  kind: "usb" | "pci" | "bluetooth" | "unknown"
}

export type SerialCandidateList = {
  generation: number
  candidates: readonly SerialCandidate[]
}

export type SerialDataEvent = {
  sessionId: string
  seq: number
  bytes: Uint8Array
}

export type SerialDisconnectEvent = {
  sessionId: string
  seq: number
  reason: string
}

export interface SerialTransport {
  start(): Promise<void>
  list(): Promise<SerialCandidateList>
  open(candidateId: string, generation: number): Promise<string>
  write(sessionId: string, payload: Uint8Array): Promise<void>
  close(sessionId: string): Promise<void>
  stop(): Promise<void>
  onData(listener: (event: SerialDataEvent) => void): () => void
  onDisconnect(listener: (event: SerialDisconnectEvent) => void): () => void
}
