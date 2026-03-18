/**
 * Hardware abstraction for NFC/EMV card readers.
 *
 * Provides a pluggable driver model so production code can inject a real
 * hardware driver while tests use the built-in MockNFCReader.
 */

// ---------------------------------------------------------------------------
// Configuration & event types
// ---------------------------------------------------------------------------

export interface NFCReaderConfig {
  /** Device path, e.g. "/dev/nfc0" or "usb:001:004" */
  devicePath?: string;
  protocol: "nfc-a" | "nfc-b" | "nfc-f" | "emv";
  /** Milliseconds to wait for a tap before timing out. */
  timeout: number;
  maxRetries: number;
}

export interface CardTapEvent {
  /** Card UID as a lowercase hex string. */
  uid: string;
  protocol: string;
  timestamp: number;
  /** Answer To Reset (hex), present for contact-based / EMV interactions. */
  atr?: string;
  terminalId: string;
}

// ---------------------------------------------------------------------------
// Low-level driver contract (injected by platform integrations)
// ---------------------------------------------------------------------------

export type NFCDriver = {
  open(devicePath: string): Promise<void>;
  close(): Promise<void>;
  poll(
    timeoutMs: number,
  ): Promise<{ uid: Uint8Array; protocol: string; atr?: Uint8Array } | null>;
};

// ---------------------------------------------------------------------------
// Reader interface
// ---------------------------------------------------------------------------

export interface NFCReader {
  connect(config: NFCReaderConfig): Promise<boolean>;
  disconnect(): Promise<void>;
  waitForTap(timeoutMs: number): Promise<CardTapEvent | null>;
  isConnected(): boolean;
  getDeviceInfo(): { vendor: string; model: string; firmware: string };
}

// ---------------------------------------------------------------------------
// Mock implementation – fully functional for testing
// ---------------------------------------------------------------------------

export class MockNFCReader implements NFCReader {
  private connected = false;
  private config: NFCReaderConfig | null = null;
  private pendingTaps: CardTapEvent[] = [];

  /** Queue a tap that will be returned on the next waitForTap call. */
  enqueueTap(event: CardTapEvent): void {
    this.pendingTaps.push(event);
  }

  async connect(config: NFCReaderConfig): Promise<boolean> {
    this.config = config;
    this.connected = true;
    return true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.config = null;
  }

  async waitForTap(timeoutMs: number): Promise<CardTapEvent | null> {
    if (!this.connected) return null;

    // If there is a queued tap, return it immediately.
    const next = this.pendingTaps.shift();
    if (next) return next;

    // Otherwise simulate waiting and returning nothing.
    await new Promise<void>((r) => setTimeout(r, Math.min(timeoutMs, 50)));
    return null;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getDeviceInfo(): { vendor: string; model: string; firmware: string } {
    return { vendor: "MockVendor", model: "MockNFC-1000", firmware: "0.0.1-mock" };
  }
}

// ---------------------------------------------------------------------------
// Hardware-backed implementation (delegates to an NFCDriver)
// ---------------------------------------------------------------------------

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export class HardwareNFCReader implements NFCReader {
  private connected = false;
  private config: NFCReaderConfig | null = null;
  private terminalId = "";

  constructor(private driver?: NFCDriver) {}

  async connect(config: NFCReaderConfig): Promise<boolean> {
    this.config = config;
    this.terminalId = config.devicePath ?? "nfc-default";

    if (this.driver) {
      try {
        await this.driver.open(config.devicePath ?? "/dev/nfc0");
        this.connected = true;
        return true;
      } catch {
        this.connected = false;
        return false;
      }
    }

    // No driver provided – fall back to a "virtual" connected state so callers
    // can still exercise the adapter without real hardware.
    this.connected = true;
    return true;
  }

  async disconnect(): Promise<void> {
    if (this.driver && this.connected) {
      await this.driver.close();
    }
    this.connected = false;
    this.config = null;
  }

  async waitForTap(timeoutMs: number): Promise<CardTapEvent | null> {
    if (!this.connected || !this.config) return null;

    if (!this.driver) {
      // No driver – just wait and return null (no hardware present).
      await new Promise<void>((r) => setTimeout(r, Math.min(timeoutMs, 100)));
      return null;
    }

    let retries = this.config.maxRetries;
    while (retries >= 0) {
      const result = await this.driver.poll(timeoutMs);
      if (result) {
        return {
          uid: toHex(result.uid),
          protocol: result.protocol,
          timestamp: Date.now(),
          atr: result.atr ? toHex(result.atr) : undefined,
          terminalId: this.terminalId,
        };
      }
      retries--;
    }
    return null;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getDeviceInfo(): { vendor: string; model: string; firmware: string } {
    return {
      vendor: this.driver ? "Hardware" : "Virtual",
      model: "NFC-Reader",
      firmware: "1.0.0",
    };
  }
}
