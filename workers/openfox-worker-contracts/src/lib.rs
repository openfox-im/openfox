use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{json, Value};
use std::fmt::{Display, Formatter};
use std::io::{self, Read, Write};

pub const SCHEMA_VERSION: &str = "openfox.cli-worker.v1";

#[derive(Debug)]
pub enum WorkerCliError {
    Io(String),
    InvalidJson(String),
    InvalidEnvelope(String),
    NotImplemented(String),
    Internal(String),
}

impl WorkerCliError {
    pub fn code(&self) -> &'static str {
        match self {
            WorkerCliError::Io(_) => "io_error",
            WorkerCliError::InvalidJson(_) => "invalid_json",
            WorkerCliError::InvalidEnvelope(_) => "invalid_envelope",
            WorkerCliError::NotImplemented(_) => "not_implemented",
            WorkerCliError::Internal(_) => "internal_error",
        }
    }

    pub fn exit_code(&self) -> i32 {
        match self {
            WorkerCliError::Io(_) => 40,
            WorkerCliError::InvalidJson(_) => 10,
            WorkerCliError::InvalidEnvelope(_) => 10,
            WorkerCliError::NotImplemented(_) => 40,
            WorkerCliError::Internal(_) => 40,
        }
    }

    pub fn message(&self) -> &str {
        match self {
            WorkerCliError::Io(message) => message,
            WorkerCliError::InvalidJson(message) => message,
            WorkerCliError::InvalidEnvelope(message) => message,
            WorkerCliError::NotImplemented(message) => message,
            WorkerCliError::Internal(message) => message,
        }
    }
}

impl Display for WorkerCliError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code(), self.message())
    }
}

impl std::error::Error for WorkerCliError {}

pub fn read_stdin_value() -> Result<Value, WorkerCliError> {
    let mut raw = String::new();
    io::stdin()
        .read_to_string(&mut raw)
        .map_err(|error| WorkerCliError::Io(error.to_string()))?;
    serde_json::from_str::<Value>(&raw)
        .map_err(|error| WorkerCliError::InvalidJson(error.to_string()))
}

pub fn require_worker(value: &Value, expected_worker: &str) -> Result<(), WorkerCliError> {
    let schema_version = value
        .get("schema_version")
        .and_then(Value::as_str)
        .ok_or_else(|| WorkerCliError::InvalidEnvelope("missing schema_version".into()))?;
    if schema_version != SCHEMA_VERSION {
        return Err(WorkerCliError::InvalidEnvelope(format!(
            "unsupported schema_version {schema_version}"
        )));
    }
    let worker = value
        .get("worker")
        .and_then(Value::as_str)
        .ok_or_else(|| WorkerCliError::InvalidEnvelope("missing worker".into()))?;
    if worker != expected_worker {
        return Err(WorkerCliError::InvalidEnvelope(format!(
            "worker mismatch: expected {expected_worker}, got {worker}"
        )));
    }
    Ok(())
}

pub fn decode_request<T: DeserializeOwned>(expected_worker: &str) -> Result<T, WorkerCliError> {
    let value = read_stdin_value()?;
    require_worker(&value, expected_worker)?;
    serde_json::from_value::<T>(value)
        .map_err(|error| WorkerCliError::InvalidEnvelope(error.to_string()))
}

pub fn write_success<T: Serialize>(worker: &str, result: &T) -> Result<(), WorkerCliError> {
    let payload = json!({
        "schema_version": SCHEMA_VERSION,
        "worker": worker,
        "result": result,
    });
    let stdout = io::stdout();
    let mut handle = stdout.lock();
    serde_json::to_writer(&mut handle, &payload)
        .map_err(|error| WorkerCliError::Internal(error.to_string()))?;
    handle
        .write_all(b"\n")
        .map_err(|error| WorkerCliError::Io(error.to_string()))?;
    Ok(())
}

pub fn write_error(worker: &str, error: &WorkerCliError) -> Result<(), WorkerCliError> {
    let payload = json!({
        "schema_version": SCHEMA_VERSION,
        "worker": worker,
        "error": {
            "code": error.code(),
            "message": error.message(),
        },
    });
    let stdout = io::stdout();
    let mut handle = stdout.lock();
    serde_json::to_writer(&mut handle, &payload)
        .map_err(|inner| WorkerCliError::Internal(inner.to_string()))?;
    handle
        .write_all(b"\n")
        .map_err(|inner| WorkerCliError::Io(inner.to_string()))?;
    Ok(())
}

pub fn run_worker<TRequest, TResult, F>(worker: &str, handler: F) -> i32
where
    TRequest: DeserializeOwned,
    TResult: Serialize,
    F: FnOnce(TRequest) -> Result<TResult, WorkerCliError>,
{
    match decode_request::<TRequest>(worker).and_then(handler) {
        Ok(result) => match write_success(worker, &result) {
            Ok(()) => 0,
            Err(error) => error.exit_code(),
        },
        Err(error) => {
            let _ = write_error(worker, &error);
            error.exit_code()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_worker_envelope() {
        let value = json!({
            "schema_version": SCHEMA_VERSION,
            "worker": "zktls.bundle",
        });
        assert!(require_worker(&value, "zktls.bundle").is_ok());
        assert!(require_worker(&value, "proofverify.verify").is_err());
    }
}
