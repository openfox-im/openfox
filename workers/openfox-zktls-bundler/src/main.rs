use openfox_worker_contracts::{
    read_stdin_value, write_error, write_success, WorkerCliError, SCHEMA_VERSION,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

#[derive(Debug, Deserialize)]
struct ZkTlsBundleRequest {
    request: NewsFetchRequest,
    capture: CaptureResult,
    #[serde(default)]
    proof: Option<ZkTlsProofResult>,
    #[serde(default)]
    options: BundleOptions,
    #[serde(default)]
    context: BundleContext,
}

#[derive(Debug, Deserialize)]
struct ZkTlsProveRequest {
    request: NewsFetchRequest,
    #[serde(default)]
    capture: Option<CaptureResult>,
    #[serde(default)]
    options: BundleOptions,
    #[serde(default)]
    context: ProveContext,
}

#[derive(Debug, Deserialize)]
struct NewsFetchRequest {
    source_url: String,
    #[serde(default)]
    publisher_hint: Option<String>,
    #[serde(default)]
    headline_hint: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CaptureResult {
    canonical_url: String,
    http_status: u16,
    content_type: String,
    article_sha256: String,
    #[serde(default)]
    article_text: Option<String>,
    #[serde(default)]
    headline: Option<String>,
    #[serde(default)]
    publisher: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BundleOptions {
    #[serde(default)]
    source_policy_id: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BundleContext {
    #[serde(default)]
    fetched_at: Option<u64>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProveContext {
    #[serde(default)]
    fetched_at: Option<u64>,
    #[serde(default)]
    server_host: Option<String>,
    #[serde(default)]
    server_port: Option<u16>,
    #[serde(default)]
    method: Option<String>,
    #[serde(default)]
    path: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ZkTlsProofResult {
    attestation: String,
    attestation_sha256: String,
    server_name: String,
    sent_len: usize,
    recv_len: usize,
    #[serde(default)]
    backend: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ZkTlsBundleResult {
    format: String,
    bundle_sha256: String,
    bundle: Value,
    origin_claims: Value,
    verifier_material_references: Vec<Value>,
    integrity: Value,
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("0x{}", hex::encode(hasher.finalize()))
}

fn build_fake_attestation(request: &NewsFetchRequest, context: &ProveContext) -> Value {
    json!({
        "schema_version": "openfox.zktls.attestation.v0",
        "backend": "rust_fixture_zktls_v0",
        "source_url": request.source_url,
        "server_name": context.server_host.clone().unwrap_or_else(|| "unknown".into()),
        "server_port": context.server_port.unwrap_or(443),
        "method": context.method.clone().unwrap_or_else(|| "GET".into()),
        "path": context.path.clone().unwrap_or_else(|| "/".into()),
        "fetched_at": context.fetched_at.unwrap_or_default(),
    })
}

fn build_proof(request: ZkTlsProveRequest) -> Result<ZkTlsProofResult, WorkerCliError> {
    let attestation = build_fake_attestation(&request.request, &request.context);
    let encoded =
        serde_json::to_vec(&attestation).map_err(|error| WorkerCliError::Internal(error.to_string()))?;
    let attestation_sha256 = sha256_hex(&encoded);
    Ok(ZkTlsProofResult {
        attestation: String::from_utf8(encoded)
            .map_err(|error| WorkerCliError::Internal(error.to_string()))?,
        attestation_sha256,
        server_name: request
            .context
            .server_host
            .unwrap_or_else(|| "unknown".into()),
        sent_len: request.request.source_url.len(),
        recv_len: request
            .capture
            .and_then(|capture| capture.article_text)
            .map(|text| text.len())
            .unwrap_or_default(),
        backend: Some("rust_fixture_zktls_v0".into()),
    })
}

fn build_bundle(request: ZkTlsBundleRequest) -> Result<ZkTlsBundleResult, WorkerCliError> {
    let fetched_at = request.context.fetched_at.unwrap_or_default();
    let proof = request
        .proof
        .ok_or_else(|| WorkerCliError::InvalidEnvelope("missing proof".into()))?;
    let source_policy_id = request
        .options
        .source_policy_id
        .clone()
        .unwrap_or_else(|| "news.fetch".to_string());
    let bundle = json!({
        "version": 1,
        "backend": "rust_fixture_zktls_v0",
        "fetched_at": fetched_at,
        "source_url": request.request.source_url,
        "canonical_url": request.capture.canonical_url,
        "source_policy_id": source_policy_id,
        "publisher_hint": request.request.publisher_hint,
        "headline_hint": request.request.headline_hint,
        "http_status": request.capture.http_status,
        "content_type": request.capture.content_type,
        "article_sha256": request.capture.article_sha256,
        "headline": request.capture.headline,
        "publisher": request.capture.publisher,
        "article_preview": request.capture.article_text,
        "zktls_attestation_sha256": proof.attestation_sha256,
        "zktls_attestation": proof.attestation,
    });
    let encoded =
        serde_json::to_vec(&bundle).map_err(|error| WorkerCliError::Internal(error.to_string()))?;
    let bundle_sha256 = sha256_hex(&encoded);
    Ok(ZkTlsBundleResult {
        format: "zktls_bundle_v1".into(),
        bundle_sha256: bundle_sha256.clone(),
        origin_claims: json!({
            "canonicalUrl": request.capture.canonical_url,
            "sourcePolicyId": source_policy_id,
            "publisher": request.capture.publisher,
            "headline": request.capture.headline,
            "fetchedAt": fetched_at,
            "httpStatus": request.capture.http_status,
            "contentType": request.capture.content_type,
        }),
        verifier_material_references: vec![json!({
            "kind": "tlsnotary_attestation",
            "ref": "inline://zktls-attestation",
            "hash": proof.attestation_sha256,
            "metadata": {
                "serverName": proof.server_name,
                "backend": proof.backend,
            },
        })],
        integrity: json!({
            "bundleSha256": bundle_sha256,
            "articleSha256": request.capture.article_sha256,
            "sourceResponseSha256": request.capture.article_sha256,
        }),
        bundle,
    })
}

fn invalid_worker_error(worker: &str) -> WorkerCliError {
    WorkerCliError::InvalidEnvelope(format!("unsupported worker {worker}"))
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
        "zktls.prove" => match serde_json::from_value::<ZkTlsProveRequest>(value.clone())
            .map_err(|error| WorkerCliError::InvalidEnvelope(error.to_string()))
            .and_then(build_proof)
        {
            Ok(result) => write_success(worker, &result).map(|_| 0).unwrap_or(40),
            Err(error) => {
                let _ = write_error(worker, &error);
                error.exit_code()
            }
        },
        "zktls.bundle" => match serde_json::from_value::<ZkTlsBundleRequest>(value.clone())
            .map_err(|error| WorkerCliError::InvalidEnvelope(error.to_string()))
            .and_then(build_bundle)
        {
            Ok(result) => write_success(worker, &result).map(|_| 0).unwrap_or(40),
            Err(error) => {
                let _ = write_error(worker, &error);
                error.exit_code()
            }
        },
        other => {
            let error = invalid_worker_error(other);
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
    fn builds_deterministic_proof() {
        let result = build_proof(ZkTlsProveRequest {
            request: NewsFetchRequest {
                source_url: "https://news.example/story".into(),
                publisher_hint: None,
                headline_hint: None,
            },
            capture: None,
            options: BundleOptions::default(),
            context: ProveContext {
                fetched_at: Some(1772841600),
                server_host: Some("news.example".into()),
                server_port: Some(443),
                method: Some("GET".into()),
                path: Some("/story".into()),
            },
        })
        .unwrap();

        assert!(result.attestation.starts_with("{"));
        assert!(result.attestation_sha256.starts_with("0x"));
        assert_eq!(result.server_name, "news.example");
    }

    #[test]
    fn builds_deterministic_bundle_hash() {
        let result = build_bundle(ZkTlsBundleRequest {
            request: NewsFetchRequest {
                source_url: "https://news.example/story".into(),
                publisher_hint: Some("Example".into()),
                headline_hint: None,
            },
            capture: CaptureResult {
                canonical_url: "https://news.example/story".into(),
                http_status: 200,
                content_type: "text/html".into(),
                article_sha256: format!("0x{}", "a".repeat(64)),
                article_text: Some("hello".into()),
                headline: Some("Headline".into()),
                publisher: Some("Example".into()),
            },
            proof: Some(ZkTlsProofResult {
                attestation: "{\"server\":\"news.example\"}".into(),
                attestation_sha256: format!("0x{}", "b".repeat(64)),
                server_name: "news.example".into(),
                sent_len: 10,
                recv_len: 20,
                backend: Some("rust_fixture_zktls_v0".into()),
            }),
            options: BundleOptions {
                source_policy_id: Some("major-news-headline-v1".into()),
            },
            context: BundleContext {
                fetched_at: Some(1772841600),
            },
        })
        .unwrap();

        assert_eq!(result.format, "zktls_bundle_v1");
        assert!(result.bundle_sha256.starts_with("0x"));
        assert_eq!(
            result.bundle["source_policy_id"],
            Value::String("major-news-headline-v1".into())
        );
        assert_eq!(
            result.bundle["zktls_attestation_sha256"],
            Value::String(format!("0x{}", "b".repeat(64)))
        );
    }
}
