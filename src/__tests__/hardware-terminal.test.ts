/**
 * Hardware Terminal Adapters Tests
 *
 * Tests for mock hardware implementations (NFC, POS, Voice) and the
 * hardware-backed terminal adapters (Card, POS, Voice).
 */

import { describe, it, expect, beforeEach } from "vitest";

import { MockNFCReader } from "../terminal/hardware/nfc.js";
import type { NFCReaderConfig, CardTapEvent } from "../terminal/hardware/nfc.js";
import { MockPOSDevice } from "../terminal/hardware/pos-device.js";
import type { POSDeviceConfig } from "../terminal/hardware/pos-device.js";
import { MockVoiceIO } from "../terminal/hardware/voice-io.js";
import type { VoiceConfig, VoiceInput } from "../terminal/hardware/voice-io.js";
import { HardwareCardTerminal } from "../terminal/hardware/card-terminal.js";
import { HardwarePOSTerminal } from "../terminal/hardware/pos-terminal.js";
import { HardwareVoiceTerminal } from "../terminal/hardware/voice-terminal.js";
import type { TerminalRequest } from "../terminal/types.js";

// ── Helpers ──────────────────────────────────────────────────────

const NFC_CONFIG: NFCReaderConfig = {
  protocol: "nfc-a",
  timeout: 5000,
  maxRetries: 1,
};

const POS_CONFIG: POSDeviceConfig = {
  connectionType: "usb",
  address: "/dev/usb0",
  merchantId: "MERCH-001",
  terminalId: "TERM-001",
};

const VOICE_CONFIG: VoiceConfig = {
  language: "en-US",
  silenceTimeoutMs: 2000,
  maxListenMs: 10000,
};

function makeTapEvent(overrides?: Partial<CardTapEvent>): CardTapEvent {
  return {
    uid: "aabbccdd",
    protocol: "nfc-a",
    timestamp: Date.now(),
    terminalId: "nfc-terminal-1",
    ...overrides,
  };
}

function makeVoiceInput(overrides?: Partial<VoiceInput>): VoiceInput {
  return {
    transcript: "hello world",
    confidence: 0.95,
    language: "en-US",
    durationMs: 1200,
    ...overrides,
  };
}

// ── MockNFCReader ────────────────────────────────────────────────

describe("MockNFCReader", () => {
  let reader: MockNFCReader;

  beforeEach(() => {
    reader = new MockNFCReader();
  });

  it("connects and disconnects", async () => {
    expect(reader.isConnected()).toBe(false);
    const ok = await reader.connect(NFC_CONFIG);
    expect(ok).toBe(true);
    expect(reader.isConnected()).toBe(true);
    await reader.disconnect();
    expect(reader.isConnected()).toBe(false);
  });

  it("waitForTap returns null on timeout with no queued taps", async () => {
    await reader.connect(NFC_CONFIG);
    const result = await reader.waitForTap(50);
    expect(result).toBeNull();
  });

  it("waitForTap returns queued tap events in order", async () => {
    await reader.connect(NFC_CONFIG);
    const tap1 = makeTapEvent({ uid: "11111111" });
    const tap2 = makeTapEvent({ uid: "22222222" });
    reader.enqueueTap(tap1);
    reader.enqueueTap(tap2);

    const r1 = await reader.waitForTap(1000);
    const r2 = await reader.waitForTap(1000);
    expect(r1).toEqual(tap1);
    expect(r2).toEqual(tap2);
  });

  it("getDeviceInfo returns mock info", () => {
    const info = reader.getDeviceInfo();
    expect(info.vendor).toBe("MockVendor");
    expect(info.model).toBe("MockNFC-1000");
    expect(info.firmware).toBe("0.0.1-mock");
  });

  it("isConnected tracks state", async () => {
    expect(reader.isConnected()).toBe(false);
    await reader.connect(NFC_CONFIG);
    expect(reader.isConnected()).toBe(true);
    await reader.disconnect();
    expect(reader.isConnected()).toBe(false);
  });
});

// ── MockPOSDevice ────────────────────────────────────────────────

describe("MockPOSDevice", () => {
  let device: MockPOSDevice;

  beforeEach(() => {
    device = new MockPOSDevice();
  });

  it("connects and disconnects", async () => {
    expect(device.isConnected()).toBe(false);
    const ok = await device.connect(POS_CONFIG);
    expect(ok).toBe(true);
    expect(device.isConnected()).toBe(true);
    await device.disconnect();
    expect(device.isConnected()).toBe(false);
  });

  it("display updates lastDisplay", async () => {
    const content = { line1: "Total: $10", line2: "Tap card", showSpinner: false };
    await device.display(content);
    expect(device.lastDisplay).toEqual(content);
  });

  it("requestPayment returns approved by default", async () => {
    await device.connect(POS_CONFIG);
    const result = await device.requestPayment({
      amount: "10.00",
      currency: "TOS",
      merchantName: "Test",
      reference: "ref-1",
    });
    expect(result.approved).toBe(true);
    expect(result.reference).toBe("ref-1");
    expect(result.authCode).toBeDefined();
  });

  it("requestPayment returns declined when shouldDecline is true", async () => {
    await device.connect(POS_CONFIG);
    device.shouldDecline = true;
    const result = await device.requestPayment({
      amount: "10.00",
      currency: "TOS",
      merchantName: "Test",
      reference: "ref-2",
    });
    expect(result.approved).toBe(false);
    expect(result.reference).toBe("ref-2");
    expect(result.authCode).toBeUndefined();
  });

  it("printReceipt stores lines in lastReceipt", async () => {
    const lines = ["Line 1", "Line 2", "Line 3"];
    const ok = await device.printReceipt(lines);
    expect(ok).toBe(true);
    expect(device.lastReceipt).toEqual(lines);
  });

  it("beep records in beepHistory", async () => {
    await device.beep("success");
    await device.beep("error");
    await device.beep("attention");
    expect(device.beepHistory).toEqual(["success", "error", "attention"]);
  });
});

// ── MockVoiceIO ──────────────────────────────────────────────────

describe("MockVoiceIO", () => {
  let voice: MockVoiceIO;

  beforeEach(async () => {
    voice = new MockVoiceIO();
    await voice.configure(VOICE_CONFIG);
  });

  it("speak records spoken texts", async () => {
    await voice.speak("Hello");
    await voice.speak("World");
    expect(voice.spokenTexts).toEqual(["Hello", "World"]);
  });

  it("listen returns null on timeout with no queued inputs", async () => {
    const result = await voice.listen(50);
    expect(result).toBeNull();
  });

  it("listen returns queued inputs in order", async () => {
    const input1 = makeVoiceInput({ transcript: "first" });
    const input2 = makeVoiceInput({ transcript: "second" });
    voice.enqueueInput(input1);
    voice.enqueueInput(input2);

    const r1 = await voice.listen();
    const r2 = await voice.listen();
    expect(r1).toEqual(input1);
    expect(r2).toEqual(input2);
  });

  it("isListening tracks state", () => {
    // Before any listen call, should not be listening
    expect(voice.isListening()).toBe(false);
  });

  it("cancel interrupts listening", () => {
    voice.cancel();
    expect(voice.isListening()).toBe(false);
  });
});

// ── HardwareCardTerminal ─────────────────────────────────────────

describe("HardwareCardTerminal", () => {
  let reader: MockNFCReader;
  let terminal: HardwareCardTerminal;

  beforeEach(async () => {
    reader = new MockNFCReader();
    await reader.connect(NFC_CONFIG);
    terminal = new HardwareCardTerminal(reader);
  });

  it("has correct terminalClass and trustTier", () => {
    expect(terminal.terminalClass).toBe("card");
    expect(terminal.defaultTrustTier).toBe(1);
  });

  it("waitAndProcess returns session from tap event", async () => {
    const tap = makeTapEvent({ uid: "deadbeef" });
    reader.enqueueTap(tap);

    const result = await terminal.waitAndProcess(5000);
    expect(result).not.toBeNull();
    expect(result!.tapEvent).toEqual(tap);
    expect(result!.session.terminalClass).toBe("card");
    expect(result!.session.metadata["cardUid"]).toBe("deadbeef");
    expect(result!.session.metadata["protocol"]).toBe("nfc-a");
  });

  it("waitAndProcess returns null when no tap", async () => {
    const result = await terminal.waitAndProcess(50);
    expect(result).toBeNull();
  });

  it("handleRequest rejects non-transfer actions", async () => {
    const tap = makeTapEvent();
    reader.enqueueTap(tap);
    const result = await terminal.waitAndProcess(5000);
    const session = result!.session;

    const request: TerminalRequest = {
      sessionId: session.sessionId,
      terminalClass: "card",
      trustTier: 1,
      terminalId: session.terminalId,
      action: "subscribe",
      params: {},
      timestamp: Math.floor(Date.now() / 1000),
    };

    const response = await terminal.handleRequest(session, request);
    expect(response.status).toBe("rejected");
  });

  it("handleRequest accepts transfer actions", async () => {
    const tap = makeTapEvent();
    reader.enqueueTap(tap);
    const result = await terminal.waitAndProcess(5000);
    const session = result!.session;

    const request: TerminalRequest = {
      sessionId: session.sessionId,
      terminalClass: "card",
      trustTier: 1,
      terminalId: session.terminalId,
      action: "transfer",
      params: { amount: "100" },
      timestamp: Math.floor(Date.now() / 1000),
    };

    const response = await terminal.handleRequest(session, request);
    expect(response.status).toBe("accepted");
    expect(response.message).toBe("Card payment accepted");
  });

  it("session has correct short TTL (30s)", async () => {
    const tap = makeTapEvent();
    reader.enqueueTap(tap);
    const result = await terminal.waitAndProcess(5000);
    const session = result!.session;

    // expiresAt should be ~30s from connectedAt
    const ttl = session.expiresAt - session.connectedAt;
    expect(ttl).toBe(30);
  });
});

// ── HardwarePOSTerminal ─────────────────────────────────────────

describe("HardwarePOSTerminal", () => {
  let device: MockPOSDevice;
  let terminal: HardwarePOSTerminal;

  beforeEach(async () => {
    device = new MockPOSDevice();
    await device.connect(POS_CONFIG);
    terminal = new HardwarePOSTerminal(device);
  });

  it("has correct terminalClass and trustTier", () => {
    expect(terminal.terminalClass).toBe("pos");
    expect(terminal.defaultTrustTier).toBe(2);
  });

  it("handleRequest processes payment through POS device", async () => {
    const session = terminal.createSession("pos-terminal-1", {
      merchantName: "TestMerchant",
    });

    const request: TerminalRequest = {
      sessionId: session.sessionId,
      terminalClass: "pos",
      trustTier: 2,
      terminalId: "pos-terminal-1",
      action: "transfer",
      params: { amount: "50.00", currency: "TOS" },
      timestamp: Math.floor(Date.now() / 1000),
    };

    const response = await terminal.handleRequest(session, request);
    expect(response.status).toBe("accepted");
    expect(response.message).toBe("POS transaction approved");
    expect(response.data?.authCode).toBeDefined();

    // The device should have displayed content and beeped
    expect(device.lastDisplay).not.toBeNull();
    expect(device.beepHistory).toContain("success");
    expect(device.lastReceipt).not.toBeNull();
    expect(device.lastReceipt!.length).toBeGreaterThan(0);
  });

  it("handleRequest handles declined payment", async () => {
    device.shouldDecline = true;

    const session = terminal.createSession("pos-terminal-1");

    const request: TerminalRequest = {
      sessionId: session.sessionId,
      terminalClass: "pos",
      trustTier: 2,
      terminalId: "pos-terminal-1",
      action: "transfer",
      params: { amount: "50.00", currency: "TOS" },
      timestamp: Math.floor(Date.now() / 1000),
    };

    const response = await terminal.handleRequest(session, request);
    expect(response.status).toBe("rejected");
    expect(response.message).toBe("Payment declined");
    expect(device.beepHistory).toContain("error");
  });

  it("session has correct TTL (300s)", () => {
    const session = terminal.createSession("pos-terminal-1");
    const ttl = session.expiresAt - session.connectedAt;
    expect(ttl).toBe(300);
  });
});

// ── HardwareVoiceTerminal ────────────────────────────────────────

describe("HardwareVoiceTerminal", () => {
  let voice: MockVoiceIO;
  let terminal: HardwareVoiceTerminal;

  beforeEach(async () => {
    voice = new MockVoiceIO();
    await voice.configure(VOICE_CONFIG);
    terminal = new HardwareVoiceTerminal(voice);
  });

  it("has correct terminalClass and trustTier", () => {
    expect(terminal.terminalClass).toBe("voice");
    expect(terminal.defaultTrustTier).toBe(1);
  });

  it("handleRequest speaks response", async () => {
    const session = terminal.createSession("voice-terminal-1");

    // Enqueue "yes" for the confirmation prompt
    voice.enqueueInput(makeVoiceInput({ transcript: "yes" }));

    const request: TerminalRequest = {
      sessionId: session.sessionId,
      terminalClass: "voice",
      trustTier: 1,
      terminalId: "voice-terminal-1",
      action: "transfer",
      params: { amount: "10", to: "alice" },
      timestamp: Math.floor(Date.now() / 1000),
    };

    const response = await terminal.handleRequest(session, request);
    expect(response.status).toBe("accepted");
    expect(response.message).toBe("Voice transfer accepted");
    // Voice terminal should have spoken the confirmation prompt and result
    expect(voice.spokenTexts.length).toBeGreaterThan(0);
  });

  it("handleRequest rejects when user declines", async () => {
    const session = terminal.createSession("voice-terminal-1");

    // Enqueue "no" for the confirmation prompt
    voice.enqueueInput(makeVoiceInput({ transcript: "no" }));

    const request: TerminalRequest = {
      sessionId: session.sessionId,
      terminalClass: "voice",
      trustTier: 1,
      terminalId: "voice-terminal-1",
      action: "transfer",
      params: { amount: "10", to: "alice" },
      timestamp: Math.floor(Date.now() / 1000),
    };

    const response = await terminal.handleRequest(session, request);
    expect(response.status).toBe("rejected");
    expect(response.message).toBe("User declined via voice");
  });

  it("session has correct short TTL (120s)", () => {
    const session = terminal.createSession("voice-terminal-1");
    const ttl = session.expiresAt - session.connectedAt;
    expect(ttl).toBe(120);
  });
});
