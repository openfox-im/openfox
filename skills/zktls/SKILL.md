---
name: zktls
description: "zk-TLS proof generation and verification — OpenFox integration wrapper around openskills/zktls"
provider-backends:
  prove:
    entry: scripts/prove.mjs
    description: "Generate a zk-TLS attestation via TLSNotary (delegates to openskills native module)"
  verify-attestation:
    entry: scripts/verify-attestation.mjs
    description: "Verify a zk-TLS attestation (delegates to openskills native module)"
  bundle:
    entry: scripts/bundle.mjs
    description: "Bundle bounded capture fields with CLI worker support"
---
