/**
 * Hardware abstraction for voice input/output (microphone + speaker).
 *
 * Provides a unified interface for speech-to-text and text-to-speech so
 * terminal adapters can work with different voice backends.
 */

// ---------------------------------------------------------------------------
// Configuration & data types
// ---------------------------------------------------------------------------

export interface VoiceConfig {
  /** ALSA / PulseAudio / CoreAudio input device identifier. */
  inputDevice?: string;
  /** Output device identifier. */
  outputDevice?: string;
  /** BCP 47 language tag, e.g. "en-US", "zh-CN". */
  language: string;
  /** Optional wake word to trigger listening. */
  wakeWord?: string;
  /** Milliseconds of silence before ending recognition. */
  silenceTimeoutMs: number;
  /** Hard cap on listening duration in milliseconds. */
  maxListenMs: number;
}

export interface VoiceInput {
  transcript: string;
  /** Recognition confidence, 0..1. */
  confidence: number;
  language: string;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// VoiceIO interface
// ---------------------------------------------------------------------------

export interface VoiceIO {
  configure(config: VoiceConfig): Promise<void>;
  speak(text: string, options?: { rate?: number; pitch?: number }): Promise<void>;
  listen(timeoutMs?: number): Promise<VoiceInput | null>;
  isListening(): boolean;
  cancel(): void;
}

// ---------------------------------------------------------------------------
// Mock implementation – fully functional for testing
// ---------------------------------------------------------------------------

export class MockVoiceIO implements VoiceIO {
  private config: VoiceConfig | null = null;
  private listening = false;
  private cancelled = false;

  /** Queue of transcripts that will be returned by successive listen() calls. */
  private pendingInputs: VoiceInput[] = [];

  /** Record of text passed to speak(). */
  spokenTexts: string[] = [];

  /** Enqueue a VoiceInput that the next listen() will return. */
  enqueueInput(input: VoiceInput): void {
    this.pendingInputs.push(input);
  }

  async configure(config: VoiceConfig): Promise<void> {
    this.config = config;
  }

  async speak(text: string, _options?: { rate?: number; pitch?: number }): Promise<void> {
    this.spokenTexts.push(text);
  }

  async listen(timeoutMs?: number): Promise<VoiceInput | null> {
    if (!this.config) return null;
    this.listening = true;
    this.cancelled = false;

    const next = this.pendingInputs.shift();
    if (next) {
      this.listening = false;
      return next;
    }

    // Simulate waiting for speech that never comes.
    const wait = Math.min(timeoutMs ?? this.config.maxListenMs, 50);
    await new Promise<void>((r) => setTimeout(r, wait));
    this.listening = false;

    if (this.cancelled) return null;
    return null;
  }

  isListening(): boolean {
    return this.listening;
  }

  cancel(): void {
    this.cancelled = true;
    this.listening = false;
  }
}
