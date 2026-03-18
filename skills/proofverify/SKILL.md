---
name: proofverify
description: "Proof verification pipeline — three backends: hash integrity (verify), TLSNotary attestation validation (verify-attestations), and M-of-N consensus checking (verify-consensus). OpenFox integration wrapper around openskills/proofverify."
provider-backends:
  verify:
    entry: scripts/verify.mjs
    description: "Verify bounded bundle and subject hashes with URL fetching and CLI worker support"
  verify-attestations:
    entry: scripts/verify-attestations.mjs
    description: "Validate TLSNotary attestation cryptographic structure — delegates to openskills native module"
  verify-consensus:
    entry: scripts/verify-consensus.mjs
    description: "Check M-of-N consensus across multiple agent attestation results (pure JS)"
---
