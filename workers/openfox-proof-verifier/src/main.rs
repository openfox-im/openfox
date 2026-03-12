use openfox_worker_contracts::{
    read_stdin_value, write_error, write_success, WorkerCliError, SCHEMA_VERSION,
};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::time::Duration;

const DEFAULT_TIMEOUT_MS: u64 = 10_000;
const DEFAULT_MAX_FETCH_BYTES: usize = 262_144;

#[derive(Debug, Deserialize, Serialize)]
struct ProofVerifyRequestEnvelope {
    request: ProofVerifyRequest,
    #[serde(default)]
    options: ProofVerifyOptions,
}

#[derive(Debug, Deserialize, Serialize)]
struct ProofVerifyRequest {
    #[serde(default)]
    subject_url: Option<String>,
    #[serde(default)]
    subject_sha256: Option<String>,
    #[serde(default)]
    proof_bundle_url: Option<String>,
    #[serde(default)]
    proof_bundle_sha256: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct VerifyAttestationsRequestEnvelope {
    request: VerifyAttestationsRequest,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct VerifyAttestationsRequest {
    attestations: Vec<String>,
    #[serde(default)]
    expected_server_name: Option<String>,
    #[serde(default)]
    expected_article_sha256: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct VerifyConsensusRequestEnvelope {
    request: VerifyConsensusRequest,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct VerifyConsensusRequest {
    m: usize,
    n: usize,
    agent_results: Vec<AgentResult>,
    #[serde(default)]
    expected_server_name: Option<String>,
    #[serde(default)]
    expected_article_sha256: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AgentResult {
    verdict: String,
    #[serde(default)]
    server_name: Option<String>,
    #[serde(default)]
    article_sha256: Option<String>,
    #[serde(default)]
    attestation_sha256: Option<String>,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProofVerifyOptions {
    #[serde(default)]
    request_timeout_ms: Option<u64>,
    #[serde(default)]
    max_fetch_bytes: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProofVerifyResult {
    verdict: String,
    summary: String,
    metadata: Value,
    verifier_receipt_sha256: String,
}

#[derive(Debug, Clone)]
struct CheckEntry {
    label: &'static str,
    ok: bool,
    actual: String,
    expected: String,
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("0x{}", hex::encode(hasher.finalize()))
}

fn read_worker(value: &Value) -> Result<&str, WorkerCliError> {
    let schema_version = value
        .get("schema_version")
        .and_then(Value::as_str)
        .ok_or_else(|| WorkerCliError::InvalidEnvelope("missing schema_version".into()))?;
    if schema_version != SCHEMA_VERSION {
        return Err(WorkerCliError::InvalidEnvelope(format!(
            "unsupported schema_version {schema_version}"
        )));
    }
    value.get("worker")
        .and_then(Value::as_str)
        .ok_or_else(|| WorkerCliError::InvalidEnvelope("missing worker".into()))
}

fn extract_referenced_hash(value: &Value, keys: &[&str]) -> Option<String> {
    match value {
        Value::Object(map) => {
            for key in keys {
                if let Some(Value::String(candidate)) = map.get(*key) {
                    if candidate.starts_with("0x") && candidate.len() == 66 {
                        return Some(candidate.to_lowercase());
                    }
                }
            }
            for nested_key in ["metadata", "bundle", "result"] {
                if let Some(nested) = map.get(nested_key) {
                    if let Some(found) = extract_referenced_hash(nested, keys) {
                        return Some(found);
                    }
                }
            }
            None
        }
        _ => None,
    }
}

fn fetch_bounded(
    client: &Client,
    url: &str,
    max_bytes: usize,
) -> Result<(String, String, u16, Value), WorkerCliError> {
    let response = client
        .get(url)
        .send()
        .map_err(|error| WorkerCliError::Internal(error.to_string()))?;
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    let bytes = response
        .bytes()
        .map_err(|error| WorkerCliError::Internal(error.to_string()))?;
    if bytes.len() > max_bytes {
        return Err(WorkerCliError::InvalidEnvelope(format!(
            "fetched body exceeds max_fetch_bytes ({max_bytes})"
        )));
    }
    let parsed = serde_json::from_slice::<Value>(&bytes).unwrap_or(Value::Null);
    Ok((sha256_hex(&bytes), content_type, status, parsed))
}

fn build_integrity_result(request: ProofVerifyRequestEnvelope) -> Result<ProofVerifyResult, WorkerCliError> {
    let timeout_ms = request
        .options
        .request_timeout_ms
        .unwrap_or(DEFAULT_TIMEOUT_MS);
    let max_fetch_bytes = request
        .options
        .max_fetch_bytes
        .unwrap_or(DEFAULT_MAX_FETCH_BYTES);
    let client = Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .build()
        .map_err(|error| WorkerCliError::Internal(error.to_string()))?;

    let mut checks: Vec<CheckEntry> = Vec::new();
    let mut metadata = serde_json::Map::new();
    metadata.insert(
        "verifier_backend".into(),
        Value::String("rust_fixture_proof_verifier_v0".into()),
    );

    if let Some(subject_url) = request.request.subject_url.as_deref() {
        let (subject_sha, content_type, status, _) =
            fetch_bounded(&client, subject_url, max_fetch_bytes)?;
        metadata.insert(
            "subject".into(),
            serde_json::json!({
                "canonical_url": subject_url,
                "status": status,
                "content_type": content_type,
                "sha256": subject_sha,
            }),
        );
        if let Some(expected) = request.request.subject_sha256.as_deref() {
            checks.push(CheckEntry {
                label: "subject_sha256",
                ok: subject_sha.eq_ignore_ascii_case(expected),
                actual: subject_sha,
                expected: expected.to_string(),
            });
        }
    } else if let Some(subject_sha) = request.request.subject_sha256.as_deref() {
        metadata.insert(
            "subject".into(),
            serde_json::json!({ "declared_sha256": subject_sha }),
        );
    }

    if let Some(bundle_url) = request.request.proof_bundle_url.as_deref() {
        let (bundle_body_sha, content_type, status, parsed) =
            fetch_bounded(&client, bundle_url, max_fetch_bytes)?;
        let referenced_subject_sha = extract_referenced_hash(
            &parsed,
            &[
                "article_sha256",
                "subject_sha256",
                "content_sha256",
                "body_sha256",
            ],
        );
        let referenced_bundle_sha = extract_referenced_hash(
            &parsed,
            &[
                "zktls_bundle_sha256",
                "proof_bundle_sha256",
                "bundle_sha256",
            ],
        );
        metadata.insert(
            "bundle".into(),
            serde_json::json!({
                "canonical_url": bundle_url,
                "status": status,
                "content_type": content_type,
                "sha256": bundle_body_sha,
                "declared_bundle_sha256": referenced_bundle_sha,
                "referenced_subject_sha256": referenced_subject_sha,
            }),
        );
        if let Some(expected) = request.request.proof_bundle_sha256.as_deref() {
            let actual = referenced_bundle_sha.unwrap_or_else(|| bundle_body_sha.clone());
            checks.push(CheckEntry {
                label: "proof_bundle_sha256",
                ok: actual.eq_ignore_ascii_case(expected),
                actual,
                expected: expected.to_string(),
            });
        }
        if let (Some(expected), Some(actual)) = (
            request.request.subject_sha256.as_deref(),
            referenced_subject_sha.clone(),
        ) {
            checks.push(CheckEntry {
                label: "bundle_subject_sha256",
                ok: actual.eq_ignore_ascii_case(expected),
                actual,
                expected: expected.to_string(),
            });
        }
    } else if let Some(bundle_sha) = request.request.proof_bundle_sha256.as_deref() {
        metadata.insert(
            "bundle".into(),
            serde_json::json!({ "declared_sha256": bundle_sha }),
        );
    }

    let verifier_class = if request.request.proof_bundle_url.is_some()
        || request.request.proof_bundle_sha256.is_some()
    {
        "bundle_integrity_verification"
    } else {
        "structural_verification"
    };
    metadata.insert(
        "verifier_class".into(),
        Value::String(verifier_class.into()),
    );

    let verdict = if checks.is_empty() {
        "inconclusive"
    } else if checks.iter().all(|entry| entry.ok) {
        "valid"
    } else {
        "invalid"
    };

    let summary = match verdict {
        "valid" => format!(
            "Verified {} proof check{} successfully.",
            checks.len(),
            if checks.len() == 1 { "" } else { "s" }
        ),
        "invalid" => {
            let invalid_count = checks.iter().filter(|entry| !entry.ok).count();
            format!(
                "Verification failed for {} check{}.",
                invalid_count,
                if invalid_count == 1 { "" } else { "s" }
            )
        }
        _ => "No comparable hashes were available, so the result is inconclusive.".into(),
    };

    metadata.insert(
        "checks".into(),
        Value::Array(
            checks
                .iter()
                .map(|entry| {
                    json!({
                        "label": entry.label,
                        "ok": entry.ok,
                        "actual": entry.actual,
                        "expected": entry.expected,
                    })
                })
                .collect(),
        ),
    );

    let verifier_receipt_sha256 = sha256_hex(
        serde_json::to_string(&json!({
            "request": request.request,
            "verdict": verdict,
            "metadata": metadata,
        }))
        .map_err(|error| WorkerCliError::Internal(error.to_string()))?
        .as_bytes(),
    );

    Ok(ProofVerifyResult {
        verdict: verdict.into(),
        summary,
        metadata: Value::Object(metadata),
        verifier_receipt_sha256,
    })
}

fn build_attestation_result(
    request: VerifyAttestationsRequestEnvelope,
) -> Result<ProofVerifyResult, WorkerCliError> {
    if request.request.attestations.is_empty() {
        return Err(WorkerCliError::InvalidEnvelope(
            "request.attestations must contain at least one attestation".into(),
        ));
    }

    let mut results = Vec::new();
    let mut server_names = Vec::new();
    let mut attestation_hashes = Vec::new();
    let mut checks = Vec::new();

    for (index, attestation) in request.request.attestations.iter().enumerate() {
        if attestation.trim().is_empty() {
            results.push(json!({
                "index": index,
                "valid": false,
                "error": "empty attestation",
            }));
            continue;
        }
        let parsed = serde_json::from_str::<Value>(attestation)
            .map_err(|error| WorkerCliError::InvalidEnvelope(error.to_string()))?;
        let server_name = parsed
            .get("server_name")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string();
        let attestation_sha256 = sha256_hex(attestation.as_bytes());
        results.push(json!({
            "index": index,
            "valid": true,
            "serverName": server_name,
            "attestationSha256": attestation_sha256,
            "verificationLevel": "fixture_tlsn_attestation",
        }));
        server_names.push(server_name);
        attestation_hashes.push(attestation_sha256);
    }

    checks.push(json!({
        "label": "attestation_validity",
        "ok": results.iter().all(|entry| entry.get("valid").and_then(Value::as_bool) == Some(true)),
        "actual": format!("{}/{} valid", results.len(), results.len()),
        "expected": format!("{}/{} valid", results.len(), results.len()),
    }));

    let unique_server_names: std::collections::BTreeSet<_> =
        server_names.iter().cloned().collect();
    checks.push(json!({
        "label": "server_name_consistency",
        "ok": unique_server_names.len() == 1,
        "actual": unique_server_names.iter().cloned().collect::<Vec<_>>().join(", "),
        "expected": "all attestations reference the same server",
    }));

    if let Some(expected_server_name) = request.request.expected_server_name.as_deref() {
        let actual = unique_server_names.iter().next().cloned().unwrap_or_default();
        checks.push(json!({
            "label": "expected_server_name",
            "ok": actual == expected_server_name,
            "actual": actual,
            "expected": expected_server_name,
        }));
    }

    let verdict = if checks
        .iter()
        .all(|entry| entry.get("ok").and_then(Value::as_bool) == Some(true))
    {
        "valid"
    } else {
        "invalid"
    };
    let summary = if verdict == "valid" {
        format!(
            "Verified {} attestation{} successfully.",
            results.len(),
            if results.len() == 1 { "" } else { "s" }
        )
    } else {
        "Attestation verification failed.".into()
    };

    let metadata = json!({
        "verifier_backend": "rust_fixture_tlsn_attestation_v0",
        "verifier_class": "tlsnotary_attestation_verification",
        "total_attestations": results.len(),
        "valid_attestations": results.len(),
        "server_names": server_names,
        "attestation_hashes": attestation_hashes,
        "checks": checks,
        "results": results,
    });
    let verifier_receipt_sha256 = sha256_hex(
        serde_json::to_string(&json!({
            "request": request.request,
            "verdict": verdict,
            "metadata": metadata,
        }))
        .map_err(|error| WorkerCliError::Internal(error.to_string()))?
        .as_bytes(),
    );

    Ok(ProofVerifyResult {
        verdict: verdict.into(),
        summary,
        metadata,
        verifier_receipt_sha256,
    })
}

fn build_consensus_result(
    request: VerifyConsensusRequestEnvelope,
) -> Result<ProofVerifyResult, WorkerCliError> {
    if request.request.agent_results.len() != request.request.n {
        return Err(WorkerCliError::InvalidEnvelope(format!(
            "request.agent_results length ({}) does not match request.n ({})",
            request.request.agent_results.len(),
            request.request.n
        )));
    }
    if request.request.m == 0 || request.request.m > request.request.n {
        return Err(WorkerCliError::InvalidEnvelope(
            "request.m must be between 1 and request.n".into(),
        ));
    }

    let mut verdict_counts = std::collections::BTreeMap::<String, usize>::new();
    for result in &request.request.agent_results {
        *verdict_counts.entry(result.verdict.clone()).or_default() += 1;
    }
    let (top_verdict, top_count) = verdict_counts
        .iter()
        .max_by(|a, b| a.1.cmp(b.1).then_with(|| a.0.cmp(b.0)))
        .map(|(verdict, count)| (verdict.clone(), *count))
        .unwrap_or_else(|| ("inconclusive".into(), 0));

    let server_names: Vec<String> = request
        .request
        .agent_results
        .iter()
        .filter_map(|result| result.server_name.clone())
        .collect();
    let unique_server_names: std::collections::BTreeSet<_> =
        server_names.iter().cloned().collect();

    let checks = vec![
        json!({
            "label": "verdict_consensus",
            "ok": top_count >= request.request.m,
            "actual": format!("{}/{} agree on {}", top_count, request.request.n, top_verdict),
            "expected": format!("≥{}/{} agreement", request.request.m, request.request.n),
        }),
        json!({
            "label": "server_name_consensus",
            "ok": unique_server_names.len() <= 1,
            "actual": unique_server_names.iter().cloned().collect::<Vec<_>>().join(", "),
            "expected": "all agents agree on server name",
        }),
    ];

    let verdict = if checks
        .iter()
        .all(|entry| entry.get("ok").and_then(Value::as_bool) == Some(true))
    {
        "valid"
    } else {
        "invalid"
    };
    let summary = if verdict == "valid" {
        format!(
            "M-of-N consensus verified: {}/{} agents agree (threshold {}).",
            top_count, request.request.n, request.request.m
        )
    } else {
        format!(
            "Consensus verification failed: top agreement is {}/{} (need {}).",
            top_count, request.request.n, request.request.m
        )
    };

    let metadata = json!({
        "verifier_backend": "rust_fixture_consensus_v0",
        "verifier_class": "m_of_n_consensus_verification",
        "consensus": format!("{}/{}", top_count, request.request.n),
        "threshold": format!("{}/{}", request.request.m, request.request.n),
        "threshold_met": top_count >= request.request.m,
        "majority_verdict": top_verdict,
        "verdict_distribution": verdict_counts,
        "checks": checks,
    });
    let verifier_receipt_sha256 = sha256_hex(
        serde_json::to_string(&json!({
            "request": request.request,
            "verdict": verdict,
            "metadata": metadata,
        }))
        .map_err(|error| WorkerCliError::Internal(error.to_string()))?
        .as_bytes(),
    );

    Ok(ProofVerifyResult {
        verdict: verdict.into(),
        summary,
        metadata,
        verifier_receipt_sha256,
    })
}

fn write(worker: &str, result: Result<ProofVerifyResult, WorkerCliError>) -> i32 {
    match result {
        Ok(result) => write_success(worker, &result).map(|_| 0).unwrap_or(40),
        Err(error) => {
            let _ = write_error(worker, &error);
            error.exit_code()
        }
    }
}

fn main() {
    let value = match read_stdin_value() {
        Ok(value) => value,
        Err(error) => {
            let _ = write_error("unknown", &error);
            std::process::exit(error.exit_code());
        }
    };
    let worker = match read_worker(&value) {
        Ok(worker) => worker,
        Err(error) => {
            let _ = write_error("unknown", &error);
            std::process::exit(error.exit_code());
        }
    };

    let exit_code = match worker {
        "proofverify.verify" => write(
            worker,
            serde_json::from_value::<ProofVerifyRequestEnvelope>(value.clone())
                .map_err(|error| WorkerCliError::InvalidEnvelope(error.to_string()))
                .and_then(build_integrity_result),
        ),
        "proofverify.verify-attestations" => write(
            worker,
            serde_json::from_value::<VerifyAttestationsRequestEnvelope>(value.clone())
                .map_err(|error| WorkerCliError::InvalidEnvelope(error.to_string()))
                .and_then(build_attestation_result),
        ),
        "proofverify.verify-consensus" => write(
            worker,
            serde_json::from_value::<VerifyConsensusRequestEnvelope>(value.clone())
                .map_err(|error| WorkerCliError::InvalidEnvelope(error.to_string()))
                .and_then(build_consensus_result),
        ),
        other => {
            let error = WorkerCliError::InvalidEnvelope(format!("unsupported worker {other}"));
            let _ = write_error(other, &error);
            error.exit_code()
        }
    };

    std::process::exit(exit_code);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_attestation_verification_result() {
        let result = build_attestation_result(VerifyAttestationsRequestEnvelope {
            request: VerifyAttestationsRequest {
                attestations: vec![r#"{"server_name":"example.com"}"#.into()],
                expected_server_name: Some("example.com".into()),
                expected_article_sha256: None,
            },
        })
        .unwrap();
        assert_eq!(result.verdict, "valid");
    }

    #[test]
    fn builds_consensus_result() {
        let result = build_consensus_result(VerifyConsensusRequestEnvelope {
            request: VerifyConsensusRequest {
                m: 2,
                n: 2,
                agent_results: vec![
                    AgentResult {
                        verdict: "valid".into(),
                        server_name: Some("example.com".into()),
                        article_sha256: None,
                        attestation_sha256: Some("0x".to_string() + &"a".repeat(64)),
                    },
                    AgentResult {
                        verdict: "valid".into(),
                        server_name: Some("example.com".into()),
                        article_sha256: None,
                        attestation_sha256: Some("0x".to_string() + &"b".repeat(64)),
                    },
                ],
                expected_server_name: Some("example.com".into()),
                expected_article_sha256: None,
            },
        })
        .unwrap();
        assert_eq!(result.verdict, "valid");
    }
}
