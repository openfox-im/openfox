/**
 * Hardware abstraction for POS (Point of Sale) payment devices.
 *
 * Supports USB, Bluetooth, and network-connected terminals with display,
 * payment processing, receipt printing, and audible feedback.
 */

// ---------------------------------------------------------------------------
// Configuration & data types
// ---------------------------------------------------------------------------

export interface POSDeviceConfig {
  connectionType: "usb" | "bluetooth" | "network";
  /** Device address: USB path, BT MAC, or IP:port. */
  address: string;
  merchantId: string;
  terminalId: string;
}

export interface POSDisplayContent {
  /** Top display line (typically the amount). */
  line1: string;
  /** Bottom display line (status / instructions). */
  line2: string;
  showSpinner: boolean;
}

export interface POSTransactionRequest {
  /** Formatted amount string, e.g. "12.50". */
  amount: string;
  /** ISO 4217 currency code. */
  currency: string;
  merchantName: string;
  /** Unique reference for this transaction. */
  reference: string;
}

export interface POSTransactionResult {
  approved: boolean;
  reference: string;
  authCode?: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Device interface
// ---------------------------------------------------------------------------

export interface POSDevice {
  connect(config: POSDeviceConfig): Promise<boolean>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  display(content: POSDisplayContent): Promise<void>;
  requestPayment(request: POSTransactionRequest): Promise<POSTransactionResult>;
  printReceipt(lines: string[]): Promise<boolean>;
  beep(type: "success" | "error" | "attention"): Promise<void>;
}

// ---------------------------------------------------------------------------
// Mock implementation – fully functional for testing
// ---------------------------------------------------------------------------

export class MockPOSDevice implements POSDevice {
  private connected = false;
  private config: POSDeviceConfig | null = null;

  /** Inspect the last content sent to display. */
  lastDisplay: POSDisplayContent | null = null;
  /** Inspect the last receipt printed. */
  lastReceipt: string[] | null = null;
  /** Inspect beep history. */
  beepHistory: Array<"success" | "error" | "attention"> = [];

  /** When true the next requestPayment call will be declined. */
  shouldDecline = false;

  async connect(config: POSDeviceConfig): Promise<boolean> {
    this.config = config;
    this.connected = true;
    return true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.config = null;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async display(content: POSDisplayContent): Promise<void> {
    this.lastDisplay = content;
  }

  async requestPayment(
    request: POSTransactionRequest,
  ): Promise<POSTransactionResult> {
    if (this.shouldDecline) {
      return {
        approved: false,
        reference: request.reference,
        timestamp: Date.now(),
      };
    }
    return {
      approved: true,
      reference: request.reference,
      authCode: `AUTH-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      timestamp: Date.now(),
    };
  }

  async printReceipt(lines: string[]): Promise<boolean> {
    this.lastReceipt = lines;
    return true;
  }

  async beep(type: "success" | "error" | "attention"): Promise<void> {
    this.beepHistory.push(type);
  }
}

// ---------------------------------------------------------------------------
// Network POS device – communicates over TCP/HTTP
// ---------------------------------------------------------------------------

export class NetworkPOSDevice implements POSDevice {
  private connected = false;
  private config: POSDeviceConfig | null = null;

  async connect(config: POSDeviceConfig): Promise<boolean> {
    if (config.connectionType !== "network") {
      return false;
    }
    this.config = config;
    // In a real implementation this would open a TCP socket or establish
    // an HTTP session to `config.address`.
    this.connected = true;
    return true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.config = null;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async display(content: POSDisplayContent): Promise<void> {
    if (!this.connected || !this.config) {
      throw new Error("POS device not connected");
    }
    // Placeholder – a real driver would POST to http://<address>/display
    void content;
  }

  async requestPayment(
    request: POSTransactionRequest,
  ): Promise<POSTransactionResult> {
    if (!this.connected || !this.config) {
      return { approved: false, reference: request.reference, timestamp: Date.now() };
    }

    // Placeholder – a real driver would POST to http://<address>/payment
    // and wait for the terminal to resolve the transaction.
    return {
      approved: true,
      reference: request.reference,
      authCode: `NET-${Date.now().toString(36).toUpperCase()}`,
      timestamp: Date.now(),
    };
  }

  async printReceipt(lines: string[]): Promise<boolean> {
    if (!this.connected) return false;
    // Placeholder – would send to http://<address>/print
    void lines;
    return true;
  }

  async beep(type: "success" | "error" | "attention"): Promise<void> {
    if (!this.connected) return;
    // Placeholder – would send to http://<address>/beep
    void type;
  }
}
