import {
  TanBridgeSetupGetStatusResponseSchema,
  TanBridgeSetupConfigureResponseSchema,
  TanBridgeSetupMaxLineBytes,
  TanBridgeSetupScanWifiResponseSchema,
  type TanBridgeSetupError,
  type TanBridgeSetupStatus,
  type TanBridgeWifiScan,
} from "@tan-studio/api-contract"

interface SerialOpenOptions {
  baudRate: number
  dataBits: 8
  stopBits: 1
  parity: "none"
  flowControl: "none"
}

interface SerialPortSignals {
  dataTerminalReady?: boolean
  requestToSend?: boolean
}

export interface TanBridgeSerialPort {
  readonly readable: ReadableStream<Uint8Array> | null
  readonly writable: WritableStream<Uint8Array> | null
  open(options: SerialOpenOptions): Promise<void>
  close(): Promise<void>
  setSignals(signals: SerialPortSignals): Promise<void>
}

export interface TanBridgeSerial {
  requestPort(): Promise<TanBridgeSerialPort>
}

interface NavigatorWithSerial extends Navigator {
  serial?: TanBridgeSerial
}

export class TanBridgeSetupProtocolError extends Error {
  readonly code: TanBridgeSetupError["code"]
  readonly retryable: boolean

  constructor(error: TanBridgeSetupError) {
    super(error.message)
    this.name = "TanBridgeSetupProtocolError"
    this.code = error.code
    this.retryable = error.retryable
  }
}

export class TanBridgeSetupClient {
  private readonly port: TanBridgeSerialPort
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>
  private readonly writer: WritableStreamDefaultWriter<Uint8Array>
  private readonly decoder = new TextDecoder("utf-8", { fatal: true })
  private readonly encoder = new TextEncoder()
  private bufferedBytes = new Uint8Array()
  private operationTail: Promise<void> = Promise.resolve()
  private closed = false

  private constructor(
    port: TanBridgeSerialPort,
    reader: ReadableStreamDefaultReader<Uint8Array>,
    writer: WritableStreamDefaultWriter<Uint8Array>
  ) {
    this.port = port
    this.reader = reader
    this.writer = writer
  }

  static async connect(serial: TanBridgeSerial): Promise<TanBridgeSetupClient> {
    const port = await serial.requestPort()
    await port.open({
      baudRate: 115_200,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "none",
    })
    try {
      await port.setSignals({ dataTerminalReady: true, requestToSend: false })
      if (port.readable === null || port.writable === null) {
        throw new Error(
          "The selected serial port did not expose readable USB CDC streams."
        )
      }
      return new TanBridgeSetupClient(
        port,
        port.readable.getReader(),
        port.writable.getWriter()
      )
    } catch (error) {
      await port.close()
      throw error
    }
  }

  getStatus(): Promise<TanBridgeSetupStatus> {
    return this.exclusive(async () => {
      const response = TanBridgeSetupGetStatusResponseSchema.parse(
        await this.exchange("setup.getStatus")
      )
      if ("error" in response) {
        throw new TanBridgeSetupProtocolError(response.error)
      }
      return response.result
    })
  }

  scanWifi(): Promise<TanBridgeWifiScan> {
    return this.exclusive(async () => {
      const response = TanBridgeSetupScanWifiResponseSchema.parse(
        await this.exchange("setup.scanWifi")
      )
      if ("error" in response) {
        throw new TanBridgeSetupProtocolError(response.error)
      }
      return response.result
    })
  }

  configure(input: {
    ssid: string
    credential: string
    claimToken: string
  }): Promise<{ accepted: true; configurationGeneration: number }> {
    return this.exclusive(async () => {
      const response = TanBridgeSetupConfigureResponseSchema.parse(
        await this.exchange("setup.configure", input)
      )
      if ("error" in response) {
        throw new TanBridgeSetupProtocolError(response.error)
      }
      return response.result
    })
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.reader.cancel().catch(() => undefined)
    await this.operationTail.catch(() => undefined)
    this.reader.releaseLock()
    this.writer.releaseLock()
    await this.port.close()
  }

  private exclusive<TResult>(
    operation: () => Promise<TResult>
  ): Promise<TResult> {
    const result = this.operationTail.then(operation, operation)
    this.operationTail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  private async exchange(
    type: "setup.getStatus" | "setup.scanWifi" | "setup.configure",
    payload: Record<string, unknown> = {}
  ): Promise<unknown> {
    if (this.closed) {
      throw new Error("The Tan Bridge setup connection is closed.")
    }
    const requestId = crypto.randomUUID()
    const encoded = this.encoder.encode(
      `${JSON.stringify({
        schemaVersion: 1,
        requestId,
        type,
        payload,
      })}\n`
    )
    if (encoded.byteLength > TanBridgeSetupMaxLineBytes) {
      throw new Error("The Tan Bridge setup request exceeded 4096 bytes.")
    }
    await this.writer.write(encoded)
    const response = await this.readLine()
    const parsed: unknown = JSON.parse(response)
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("requestId" in parsed) ||
      parsed.requestId !== requestId
    ) {
      throw new Error("The Tan Bridge returned an uncorrelated setup response.")
    }
    return parsed
  }

  private async readLine(): Promise<string> {
    while (true) {
      const newline = this.bufferedBytes.indexOf(0x0a)
      if (newline >= 0) {
        let line = this.bufferedBytes.slice(0, newline)
        this.bufferedBytes = this.bufferedBytes.slice(newline + 1)
        if (line.at(-1) === 0x0d) line = line.slice(0, -1)
        return this.decoder.decode(line)
      }
      if (this.bufferedBytes.byteLength >= TanBridgeSetupMaxLineBytes) {
        throw new Error(
          "The Tan Bridge returned a setup line larger than 4096 bytes."
        )
      }
      const { done, value } = await this.reader.read()
      if (done || value === undefined) {
        throw new Error("The Tan Bridge closed the setup connection.")
      }
      const combined = new Uint8Array(
        this.bufferedBytes.byteLength + value.byteLength
      )
      combined.set(this.bufferedBytes)
      combined.set(value, this.bufferedBytes.byteLength)
      this.bufferedBytes = combined
    }
  }
}

export function browserSerial(): TanBridgeSerial | undefined {
  if (typeof navigator === "undefined") return undefined
  return (navigator as NavigatorWithSerial).serial
}
