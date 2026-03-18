// NFC / EMV card reader
export type {
  NFCReaderConfig,
  CardTapEvent,
  NFCDriver,
  NFCReader,
} from "./nfc.js";
export { MockNFCReader, HardwareNFCReader } from "./nfc.js";

// POS device
export type {
  POSDeviceConfig,
  POSDisplayContent,
  POSTransactionRequest,
  POSTransactionResult,
  POSDevice,
} from "./pos-device.js";
export { MockPOSDevice, NetworkPOSDevice } from "./pos-device.js";

// Voice I/O
export type {
  VoiceConfig,
  VoiceInput,
  VoiceIO,
} from "./voice-io.js";
export { MockVoiceIO } from "./voice-io.js";

// Hardware-backed terminal adapters
export { HardwareCardTerminal } from "./card-terminal.js";
export { HardwarePOSTerminal } from "./pos-terminal.js";
export type { VoiceIntent } from "./voice-terminal.js";
export { HardwareVoiceTerminal } from "./voice-terminal.js";
