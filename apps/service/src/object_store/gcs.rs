//! Cloud Storage adapter for the hosted notebook.
//!
//! Litestream already replicates `tan-studio.sqlite`; this replicates the bytes
//! the notebook only points at. The bucket holds the durable copy and the VM
//! disk in front of it is a staging area and a cache, never the record.
//!
//! # Why the disk stays in the path
//!
//! An object's name is the SHA-256 of its bytes, so the name cannot be known
//! until the last byte has arrived. Streaming a body of unknown length straight
//! at Cloud Storage therefore means uploading under a placeholder name and
//! renaming afterwards — a second remote object, a rewrite loop for anything
//! large, and a window where a half-written placeholder exists.
//!
//! Spooling through the local-disk adapter instead settles the digest *before*
//! anything is sent, so every upload is a single-shot `uploadType=media` POST of
//! an exactly-known length, straight to the object's final name. Memory stays
//! flat in both directions: the body is hashed and written chunk by chunk on the
//! way in, and re-read from the file as a stream on the way out. Nothing ever
//! holds the object.
//!
//! The invariant the ticket cares about survives at both layers. On disk the
//! temporary is renamed to `objects/{hh}/{sha256}` only after the digest is
//! computed. In the bucket, a single-shot upload carries a `Content-Length`, so
//! a connection that dies mid-body leaves no object at all — never a short one
//! under a name a reader would trust.

use std::{
    path::PathBuf,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use futures_util::{Stream, StreamExt, TryStreamExt};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tokio_util::io::StreamReader;

use super::{
    valid_digest, LocalDiskStore, ObjectReader, ObjectSource, ObjectStoreError, ReplicationReport,
    StoredObject,
};

/// Read/write on objects, not on the bucket itself. The adapter never creates,
/// configures or lists buckets, and it must not be able to.
const TOKEN_SCOPE: &str = "https://www.googleapis.com/auth/devstorage.read_write";
const TOKEN_LIFETIME_SECONDS: u64 = 3600;
/// Retire a token this long before it expires, so an upload that takes minutes
/// does not start with a token that dies mid-flight.
const TOKEN_REFRESH_SKEW_SECONDS: u64 = 300;
const DEFAULT_ENDPOINT: &str = "https://storage.googleapis.com";
const DEFAULT_TOKEN_URI: &str = "https://oauth2.googleapis.com/token";
/// A 512 MiB transfer must not be cut off by a total-request deadline, so the
/// client bounds how long it will wait for *progress* instead.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const READ_TIMEOUT: Duration = Duration::from_secs(60);
/// How much of a Cloud Storage error body is worth putting in a log line.
const MAX_ERROR_DETAIL_BYTES: usize = 1024;

/// Everything the adapter needs to reach one bucket. Built either from a
/// service-account key on disk or, in tests, from a fixed access token.
pub struct CloudStorageSettings {
    bucket: String,
    prefix: String,
    endpoint: String,
    credential: Credential,
}

enum Credential {
    /// Never derives `Debug`, and never leaves this module.
    ServiceAccount(Box<ServiceAccountKey>),
    /// Only tests hand over a ready-made token; production always mints one
    /// from the key systemd loaded.
    #[cfg(test)]
    AccessToken(String),
}

#[derive(Deserialize)]
struct ServiceAccountKey {
    client_email: String,
    private_key: String,
    #[serde(default)]
    private_key_id: Option<String>,
    #[serde(default = "default_token_uri")]
    token_uri: String,
}

fn default_token_uri() -> String {
    DEFAULT_TOKEN_URI.to_owned()
}

impl CloudStorageSettings {
    /// Production. `credential_path` is the service-account key systemd handed
    /// over through `LoadCredential=`; it is read once, here, and the material
    /// stays in this process's memory.
    pub fn service_account(
        bucket: impl Into<String>,
        prefix: impl Into<String>,
        credential_path: impl Into<PathBuf>,
    ) -> Result<Self, ObjectStoreError> {
        let credential_path = credential_path.into();
        let key = std::fs::read(&credential_path).map_err(|error| {
            // The path is not secret; the contents are. Only the path is reported.
            ObjectStoreError::io(
                "read credential",
                format!("{}: {error}", credential_path.display()),
            )
        })?;
        let key: ServiceAccountKey = serde_json::from_slice(&key)
            .map_err(|error| ObjectStoreError::io("parse credential", error))?;
        if key.client_email.is_empty() || key.private_key.is_empty() {
            return Err(ObjectStoreError::io(
                "parse credential",
                "the service account key has no client_email or private_key",
            ));
        }
        Self::new(bucket, prefix, Credential::ServiceAccount(Box::new(key)))
    }

    #[cfg(test)]
    fn access_token(
        bucket: impl Into<String>,
        prefix: impl Into<String>,
        endpoint: impl Into<String>,
        token: impl Into<String>,
    ) -> Result<Self, ObjectStoreError> {
        let mut settings = Self::new(bucket, prefix, Credential::AccessToken(token.into()))?;
        settings.endpoint = endpoint.into();
        Ok(settings)
    }

    fn new(
        bucket: impl Into<String>,
        prefix: impl Into<String>,
        credential: Credential,
    ) -> Result<Self, ObjectStoreError> {
        let bucket = bucket.into();
        let prefix = prefix.into();
        if !valid_bucket(&bucket) {
            return Err(ObjectStoreError::io(
                "configure",
                format!("{bucket} is not a Cloud Storage bucket name"),
            ));
        }
        if !valid_prefix(&prefix) {
            return Err(ObjectStoreError::io(
                "configure",
                format!("{prefix} is not a usable object prefix"),
            ));
        }
        Ok(Self {
            bucket,
            prefix,
            endpoint: DEFAULT_ENDPOINT.to_owned(),
            credential,
        })
    }
}

pub(super) struct CloudStorageStore {
    disk: LocalDiskStore,
    http: reqwest::Client,
    bucket: String,
    prefix: String,
    endpoint: String,
    credential: Credential,
    cached_token: Mutex<Option<CachedToken>>,
}

#[derive(Clone)]
struct CachedToken {
    value: String,
    expires_at: u64,
}

impl CloudStorageStore {
    pub(super) fn open(
        disk: LocalDiskStore,
        settings: CloudStorageSettings,
    ) -> Result<Self, ObjectStoreError> {
        let http = reqwest::Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            // Deliberately a read timeout and not `timeout`: a whole-request
            // deadline would kill a large but perfectly healthy transfer.
            .read_timeout(READ_TIMEOUT)
            .build()
            .map_err(|error| ObjectStoreError::io("configure", error))?;
        Ok(Self {
            disk,
            http,
            bucket: settings.bucket,
            prefix: settings.prefix,
            endpoint: settings.endpoint,
            credential: settings.credential,
            cached_token: Mutex::new(None),
        })
    }

    pub(super) async fn put<S, B, E>(&self, body: S) -> Result<StoredObject, ObjectStoreError>
    where
        S: Stream<Item = Result<B, E>> + Send,
        B: AsRef<[u8]>,
        E: std::fmt::Display,
    {
        // Hashes and writes chunk by chunk, and only names the object once the
        // whole body has verified.
        let stored = self.disk.put(body).await?;
        // Deliberately not "best effort". Answering 200 to an upload whose bytes
        // reached nothing but this disk would be the exact silent data-loss gap
        // this adapter exists to close, so a bucket that will not take the
        // object fails the request and the operator retries onto the spool that
        // is already there.
        self.replicate(&stored.sha256).await?;
        Ok(stored)
    }

    pub(super) async fn get(&self, sha256: &str) -> Result<ObjectReader, ObjectStoreError> {
        // The disk is a cache, and content addressing makes it a coherent one:
        // a file under this name cannot hold anything but these bytes.
        match self.disk.get(sha256).await {
            Err(ObjectStoreError::Missing) => {}
            other => return other,
        }
        self.download(sha256).await
    }

    pub(super) async fn delete(&self, sha256: &str) -> Result<(), ObjectStoreError> {
        self.disk.delete(sha256).await?;
        let Some(name) = self.object_name(sha256) else {
            return Ok(());
        };
        let response = self
            .http
            .delete(self.object_url(&name))
            .bearer_auth(self.access_token().await?)
            .send()
            .await
            .map_err(|error| ObjectStoreError::io("delete", error))?;
        if response.status().is_success() || response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(());
        }
        Err(remote_error("delete", response).await)
    }

    pub(super) async fn replicate_local_objects(&self) -> ReplicationReport {
        let mut report = ReplicationReport::default();
        let digests = match self.disk.digests().await {
            Ok(digests) => digests,
            Err(error) => {
                tracing::error!(%error, "attachment_replication_scan_failed");
                report.failed = 1;
                return report;
            }
        };
        for digest in digests {
            match self.replicate(&digest).await {
                Ok(true) => report.uploaded += 1,
                Ok(false) => report.already_replicated += 1,
                Err(error) => {
                    // One unreadable object must not abandon the rest: the next
                    // pass retries it, and the counts say the disk still holds
                    // bytes nothing else has.
                    tracing::error!(%error, sha256 = %digest, "attachment_replication_failed");
                    report.failed += 1;
                }
            }
        }
        report
    }

    /// `true` when this call is what put the object in the bucket.
    async fn replicate(&self, sha256: &str) -> Result<bool, ObjectStoreError> {
        if self.exists(sha256).await? {
            return Ok(false);
        }
        self.upload(sha256).await?;
        Ok(true)
    }

    async fn exists(&self, sha256: &str) -> Result<bool, ObjectStoreError> {
        let name = self.object_name(sha256).ok_or(ObjectStoreError::Missing)?;
        let response = self
            .http
            .get(self.object_url(&name))
            .query(&[("fields", "name")])
            .bearer_auth(self.access_token().await?)
            .send()
            .await
            .map_err(|error| ObjectStoreError::io("inspect", error))?;
        match response.status() {
            status if status.is_success() => Ok(true),
            reqwest::StatusCode::NOT_FOUND => Ok(false),
            _ => Err(remote_error("inspect", response).await),
        }
    }

    async fn upload(&self, sha256: &str) -> Result<(), ObjectStoreError> {
        let name = self.object_name(sha256).ok_or(ObjectStoreError::Missing)?;
        let path = self
            .disk
            .object_path(sha256)
            .ok_or(ObjectStoreError::Missing)?;
        let file = tokio::fs::File::open(&path).await.map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                ObjectStoreError::Missing
            } else {
                ObjectStoreError::io("open", error)
            }
        })?;
        let byte_length = file
            .metadata()
            .await
            .map_err(|error| ObjectStoreError::io("inspect", error))?
            .len();

        let url = format!(
            "{}/upload/storage/v1/b/{}/o?uploadType=media&name={}",
            self.endpoint,
            self.bucket,
            percent_encoded(&name)
        );
        let response = self
            .http
            .post(url)
            .bearer_auth(self.access_token().await?)
            .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
            // The length is known because the object has already been hashed and
            // measured, so the body streams from the file with no chunked
            // framing and no buffering: an interrupted upload is a short body
            // against a declared length, which Cloud Storage discards whole.
            .header(reqwest::header::CONTENT_LENGTH, byte_length)
            .body(reqwest::Body::from(file))
            .send()
            .await
            .map_err(|error| ObjectStoreError::io("upload", error))?;
        if !response.status().is_success() {
            return Err(remote_error("upload", response).await);
        }
        Ok(())
    }

    async fn download(&self, sha256: &str) -> Result<ObjectReader, ObjectStoreError> {
        let name = self.object_name(sha256).ok_or(ObjectStoreError::Missing)?;
        let response = self
            .http
            .get(self.object_url(&name))
            .query(&[("alt", "media")])
            .bearer_auth(self.access_token().await?)
            .send()
            .await
            .map_err(|error| ObjectStoreError::io("download", error))?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Err(ObjectStoreError::Missing);
        }
        if !response.status().is_success() {
            return Err(remote_error("download", response).await);
        }
        let byte_length = response.content_length().unwrap_or(0);
        // `bytes_stream` hands over chunks as they land, so the response body
        // starts flowing to the operator before the bucket has finished sending.
        let body = response.bytes_stream().map_err(std::io::Error::other);
        Ok(ObjectReader {
            sha256: sha256.to_owned(),
            byte_length,
            source: ObjectSource::Remote(Box::pin(StreamReader::new(body))),
        })
    }

    /// `None` for anything that is not a SHA-256, which keeps a caller-supplied
    /// string from ever reaching a URL.
    fn object_name(&self, sha256: &str) -> Option<String> {
        valid_digest(sha256).then(|| format!("{}/objects/{}/{}", self.prefix, &sha256[..2], sha256))
    }

    fn object_url(&self, name: &str) -> String {
        format!(
            "{}/storage/v1/b/{}/o/{}",
            self.endpoint,
            self.bucket,
            percent_encoded(name)
        )
    }

    // One arm outside tests, by design: production has exactly one way to get a
    // token, and that is to mint it from the key systemd loaded.
    #[cfg_attr(not(test), allow(clippy::infallible_destructuring_match))]
    async fn access_token(&self) -> Result<String, ObjectStoreError> {
        let key = match &self.credential {
            #[cfg(test)]
            Credential::AccessToken(token) => return Ok(token.clone()),
            Credential::ServiceAccount(key) => key,
        };
        let now = unix_seconds();
        if let Some(cached) = self.cached_token.lock().clone() {
            if cached.expires_at > now + TOKEN_REFRESH_SKEW_SECONDS {
                return Ok(cached.value);
            }
        }
        let assertion = sign_assertion(key, now)?;
        let response = self
            .http
            .post(&key.token_uri)
            .form(&[
                ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
                ("assertion", assertion.as_str()),
            ])
            .send()
            .await
            .map_err(|error| ObjectStoreError::io("authorize", error))?;
        if !response.status().is_success() {
            return Err(remote_error("authorize", response).await);
        }
        let minted: MintedToken = response
            .json()
            .await
            .map_err(|error| ObjectStoreError::io("authorize", error))?;
        *self.cached_token.lock() = Some(CachedToken {
            value: minted.access_token.clone(),
            expires_at: now + minted.expires_in.min(TOKEN_LIFETIME_SECONDS),
        });
        Ok(minted.access_token)
    }
}

#[derive(Deserialize)]
struct MintedToken {
    access_token: String,
    #[serde(default)]
    expires_in: u64,
}

#[derive(Serialize)]
struct AssertionClaims<'a> {
    iss: &'a str,
    scope: &'a str,
    aud: &'a str,
    iat: u64,
    exp: u64,
}

fn sign_assertion(key: &ServiceAccountKey, now: u64) -> Result<String, ObjectStoreError> {
    let mut header = jsonwebtoken::Header::new(jsonwebtoken::Algorithm::RS256);
    header.kid = key.private_key_id.clone();
    let claims = AssertionClaims {
        iss: &key.client_email,
        scope: TOKEN_SCOPE,
        aud: &key.token_uri,
        iat: now,
        exp: now + TOKEN_LIFETIME_SECONDS,
    };
    let signing_key = jsonwebtoken::EncodingKey::from_rsa_pem(key.private_key.as_bytes())
        .map_err(|error| ObjectStoreError::io("authorize", error))?;
    jsonwebtoken::encode(&header, &claims, &signing_key)
        .map_err(|error| ObjectStoreError::io("authorize", error))
}

/// Cloud Storage object names go in a single path segment, so every `/` in the
/// prefix has to be escaped. `valid_prefix` and `valid_digest` already confine
/// the name to characters that need no other escaping.
fn percent_encoded(name: &str) -> String {
    name.replace('/', "%2F")
}

fn valid_bucket(bucket: &str) -> bool {
    !bucket.is_empty()
        && bucket.len() <= 222
        && bucket
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

fn valid_prefix(prefix: &str) -> bool {
    !prefix.is_empty()
        && prefix.len() <= 512
        && !prefix.starts_with('/')
        && !prefix.ends_with('/')
        && !prefix.contains("//")
        // Object names are flat strings, so `..` is not traversal in the bucket
        // — but a prefix that reads like an escape is a misconfiguration, and
        // the notebook prefix is one sibling away.
        && !prefix.split('/').any(|segment| segment == "..")
        && prefix
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'/'))
}

fn unix_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or_default()
}

/// Turn a refused Cloud Storage response into an error, reading only enough of
/// the body to say why. The body is read a chunk at a time and capped, so a
/// large or hostile error page cannot be pulled into memory whole.
async fn remote_error(action: &'static str, response: reqwest::Response) -> ObjectStoreError {
    let status = response.status();
    let mut detail = Vec::new();
    let mut body = response.bytes_stream();
    while let Some(Ok(chunk)) = body.next().await {
        let remaining = MAX_ERROR_DETAIL_BYTES.saturating_sub(detail.len());
        if remaining == 0 {
            break;
        }
        detail.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
    }
    ObjectStoreError::io(
        action,
        format!(
            "Cloud Storage answered {status}: {}",
            String::from_utf8_lossy(&detail)
        ),
    )
}

#[cfg(test)]
mod tests {
    use std::{
        collections::HashMap,
        net::{Ipv4Addr, SocketAddr},
        sync::Arc,
    };

    use axum::{
        body::{Body, Bytes},
        extract::{Path as AxumPath, Query, State},
        http::{HeaderMap, StatusCode},
        response::{IntoResponse, Response},
        routing::{get, post},
        Router,
    };
    use futures_util::stream;
    use tokio::{io::AsyncReadExt, sync::mpsc};

    use super::*;
    use crate::object_store::ObjectStore;

    const BUCKET: &str = "tan-coffee-backups";
    const PREFIX: &str = "tan-studio/attachments";
    const NOTEBOOK_PREFIX: &str = "tan-studio/notebook";
    const PHOTO: &[u8] = b"finished-beans-photo";
    const PHOTO_SHA256: &str = "a02d6ebe93f45e2a2923ca5bbc9a9e6098c50727f855974e6198e9363ce915de";
    const PHOTO_OBJECT: &str =
        "tan-studio/attachments/objects/a0/a02d6ebe93f45e2a2923ca5bbc9a9e6098c50727f855974e6198e9363ce915de";
    const TOKEN: &str = "test-access-token";

    #[derive(Default)]
    struct FakeBucket {
        objects: Mutex<HashMap<String, Vec<u8>>>,
        uploads: Mutex<Vec<Upload>>,
        authorizations: Mutex<Vec<String>>,
        /// How many upload attempts to refuse before accepting one.
        refuse_uploads: Mutex<u32>,
        /// A body served one chunk at a time, so a test can hold the second
        /// chunk back and watch the first one arrive anyway.
        stalled_body: Mutex<Option<mpsc::Receiver<Bytes>>>,
    }

    #[derive(Clone, Debug)]
    struct Upload {
        name: String,
        content_length: Option<String>,
        transfer_encoding: Option<String>,
        byte_length: usize,
    }

    async fn start_fake_bucket(bucket: Arc<FakeBucket>) -> String {
        let app = Router::new()
            .route("/upload/storage/v1/b/{bucket}/o", post(upload))
            .route(
                "/storage/v1/b/{bucket}/o/{object}",
                get(read).delete(remove),
            )
            .with_state(bucket);
        let listener = tokio::net::TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))
            .await
            .unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        format!("http://{address}")
    }

    fn record_authorization(bucket: &FakeBucket, headers: &HeaderMap) {
        if let Some(value) = headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
        {
            bucket.authorizations.lock().push(value.to_owned());
        }
    }

    async fn upload(
        State(bucket): State<Arc<FakeBucket>>,
        Query(query): Query<HashMap<String, String>>,
        headers: HeaderMap,
        body: Bytes,
    ) -> Response {
        record_authorization(&bucket, &headers);
        let header = |name: axum::http::HeaderName| {
            headers
                .get(name)
                .and_then(|value| value.to_str().ok())
                .map(ToOwned::to_owned)
        };
        let name = query.get("name").cloned().unwrap_or_default();
        bucket.uploads.lock().push(Upload {
            name: name.clone(),
            content_length: header(axum::http::header::CONTENT_LENGTH),
            transfer_encoding: header(axum::http::header::TRANSFER_ENCODING),
            byte_length: body.len(),
        });
        {
            let mut refusals = bucket.refuse_uploads.lock();
            if *refusals > 0 {
                *refusals -= 1;
                return (StatusCode::SERVICE_UNAVAILABLE, "backend error").into_response();
            }
        }
        bucket.objects.lock().insert(name, body.to_vec());
        (StatusCode::OK, "{}").into_response()
    }

    async fn read(
        State(bucket): State<Arc<FakeBucket>>,
        AxumPath((_, object)): AxumPath<(String, String)>,
        Query(query): Query<HashMap<String, String>>,
        headers: HeaderMap,
    ) -> Response {
        record_authorization(&bucket, &headers);
        let stored = bucket.objects.lock().get(&object).cloned();
        let Some(stored) = stored else {
            return (StatusCode::NOT_FOUND, "no such object").into_response();
        };
        if query.get("alt").map(String::as_str) != Some("media") {
            return (StatusCode::OK, "{}").into_response();
        }
        if let Some(receiver) = bucket.stalled_body.lock().take() {
            let chunks = stream::unfold(receiver, |mut receiver| async move {
                receiver
                    .recv()
                    .await
                    .map(|chunk| (Ok::<_, std::io::Error>(chunk), receiver))
            });
            return Response::new(Body::from_stream(chunks));
        }
        (StatusCode::OK, stored).into_response()
    }

    async fn remove(
        State(bucket): State<Arc<FakeBucket>>,
        AxumPath((_, object)): AxumPath<(String, String)>,
    ) -> Response {
        if bucket.objects.lock().remove(&object).is_none() {
            return (StatusCode::NOT_FOUND, "no such object").into_response();
        }
        StatusCode::NO_CONTENT.into_response()
    }

    async fn cloud_store(
        directory: &std::path::Path,
        bucket: Arc<FakeBucket>,
    ) -> Result<ObjectStore, ObjectStoreError> {
        let endpoint = start_fake_bucket(bucket).await;
        let settings = CloudStorageSettings::access_token(BUCKET, PREFIX, endpoint, TOKEN)?;
        ObjectStore::cloud_storage(directory, settings)
    }

    async fn put_bytes(
        store: &ObjectStore,
        bytes: &[u8],
    ) -> Result<StoredObject, ObjectStoreError> {
        store
            .put(
                Some(bytes.len() as u64),
                stream::iter([Ok::<_, std::io::Error>(bytes.to_vec())]),
            )
            .await
    }

    async fn read_all(store: &ObjectStore, sha256: &str) -> Vec<u8> {
        let mut reader = store.get(sha256).await.unwrap();
        let mut bytes = Vec::new();
        reader.read_to_end(&mut bytes).await.unwrap();
        bytes
    }

    #[tokio::test]
    async fn an_uploaded_object_survives_the_loss_of_the_disk() {
        let directory = tempfile::tempdir().unwrap();
        let bucket = Arc::new(FakeBucket::default());
        let store = cloud_store(directory.path(), bucket.clone()).await.unwrap();

        let stored = put_bytes(&store, PHOTO).await.unwrap();
        assert_eq!(stored.sha256, PHOTO_SHA256);
        assert_eq!(
            bucket.objects.lock().get(PHOTO_OBJECT).cloned(),
            Some(PHOTO.to_vec())
        );

        // Everything the VM disk held is gone; the bytes must still read back.
        std::fs::remove_dir_all(directory.path().join("objects")).unwrap();
        assert_eq!(read_all(&store, PHOTO_SHA256).await, PHOTO);
    }

    /// The attachment prefix must not collide with the notebook prefix Litestream
    /// replicates into the same bucket.
    #[tokio::test]
    async fn objects_land_under_the_attachment_prefix_and_not_the_notebook_prefix() {
        let directory = tempfile::tempdir().unwrap();
        let bucket = Arc::new(FakeBucket::default());
        let store = cloud_store(directory.path(), bucket.clone()).await.unwrap();
        put_bytes(&store, PHOTO).await.unwrap();

        let uploads = bucket.uploads.lock().clone();
        assert_eq!(uploads.len(), 1);
        assert_eq!(uploads[0].name, PHOTO_OBJECT);
        assert!(
            !uploads[0].name.starts_with(NOTEBOOK_PREFIX),
            "attachments must not be written under Litestream's prefix"
        );
        assert!(bucket
            .authorizations
            .lock()
            .iter()
            .all(|value| value == &format!("Bearer {TOKEN}")));
    }

    /// A declared length is what makes a half-sent upload discardable: Cloud
    /// Storage never materialises an object whose body stopped short. Chunked
    /// framing would instead let a truncated body look like a complete one.
    #[tokio::test]
    async fn an_upload_declares_its_exact_length_instead_of_chunking() {
        let directory = tempfile::tempdir().unwrap();
        let bucket = Arc::new(FakeBucket::default());
        let store = cloud_store(directory.path(), bucket.clone()).await.unwrap();
        put_bytes(&store, PHOTO).await.unwrap();

        let uploads = bucket.uploads.lock().clone();
        assert_eq!(
            uploads[0].content_length.as_deref(),
            Some(PHOTO.len().to_string().as_str())
        );
        assert_eq!(uploads[0].transfer_encoding, None);
        assert_eq!(uploads[0].byte_length, PHOTO.len());
    }

    /// A refused upload must not leave the notebook believing the bytes are safe.
    #[tokio::test]
    async fn an_upload_the_bucket_refuses_fails_the_put() {
        let directory = tempfile::tempdir().unwrap();
        let bucket = Arc::new(FakeBucket::default());
        *bucket.refuse_uploads.lock() = 1;
        let store = cloud_store(directory.path(), bucket.clone()).await.unwrap();

        let error = put_bytes(&store, PHOTO).await.unwrap_err();
        assert!(
            matches!(
                error,
                ObjectStoreError::Io {
                    action: "upload",
                    ..
                }
            ),
            "{error}"
        );
        assert!(bucket.objects.lock().is_empty());

        // The spool is already on the disk, so the retry is what finishes the job.
        let stored = put_bytes(&store, PHOTO).await.unwrap();
        assert_eq!(stored.sha256, PHOTO_SHA256);
        assert!(bucket.objects.lock().contains_key(PHOTO_OBJECT));
    }

    #[tokio::test]
    async fn an_object_the_bucket_already_holds_is_not_uploaded_again() {
        let directory = tempfile::tempdir().unwrap();
        let bucket = Arc::new(FakeBucket::default());
        bucket
            .objects
            .lock()
            .insert(PHOTO_OBJECT.to_owned(), PHOTO.to_vec());
        let store = cloud_store(directory.path(), bucket.clone()).await.unwrap();

        put_bytes(&store, PHOTO).await.unwrap();
        assert!(bucket.uploads.lock().is_empty());
    }

    /// The reason this adapter exists: bytes written before the bucket did.
    #[tokio::test]
    async fn attachments_already_on_the_disk_are_replicated_up() {
        let directory = tempfile::tempdir().unwrap();
        let already_there = ObjectStore::local_disk(directory.path()).unwrap();
        put_bytes(&already_there, PHOTO).await.unwrap();
        let second = put_bytes(&already_there, b"roast-log-export")
            .await
            .unwrap();

        let bucket = Arc::new(FakeBucket::default());
        let store = cloud_store(directory.path(), bucket.clone()).await.unwrap();
        let report = store.replicate_local_objects().await;

        assert_eq!(report.uploaded, 2);
        assert_eq!(report.already_replicated, 0);
        assert_eq!(report.failed, 0);
        assert!(bucket.objects.lock().contains_key(PHOTO_OBJECT));
        assert_eq!(bucket.objects.lock().len(), 2);

        // A second pass finds nothing left to do.
        let report = store.replicate_local_objects().await;
        assert_eq!(report.uploaded, 0);
        assert_eq!(report.already_replicated, 2);
        assert_eq!(read_all(&store, &second.sha256).await, b"roast-log-export");
    }

    /// Proof the download does not buffer: the bucket sends one chunk and then
    /// stops, and the reader still hands that chunk over.
    #[tokio::test]
    async fn a_download_yields_bytes_before_the_whole_object_has_arrived() {
        let directory = tempfile::tempdir().unwrap();
        let bucket = Arc::new(FakeBucket::default());
        let (sender, receiver) = mpsc::channel(1);
        bucket
            .objects
            .lock()
            .insert(PHOTO_OBJECT.to_owned(), PHOTO.to_vec());
        *bucket.stalled_body.lock() = Some(receiver);
        let store = cloud_store(directory.path(), bucket.clone()).await.unwrap();

        sender.send(Bytes::from_static(b"finished-")).await.unwrap();
        let mut reader = store.get(PHOTO_SHA256).await.unwrap();
        let mut head = [0_u8; 9];
        reader.read_exact(&mut head).await.unwrap();
        assert_eq!(&head, b"finished-");

        // Only now does the rest of the object exist anywhere.
        sender
            .send(Bytes::from_static(b"beans-photo"))
            .await
            .unwrap();
        drop(sender);
        let mut rest = Vec::new();
        reader.read_to_end(&mut rest).await.unwrap();
        assert_eq!(rest, b"beans-photo");
    }

    #[tokio::test]
    async fn a_missing_object_reads_as_missing_rather_than_as_a_store_failure() {
        let directory = tempfile::tempdir().unwrap();
        let bucket = Arc::new(FakeBucket::default());
        let store = cloud_store(directory.path(), bucket).await.unwrap();

        assert!(matches!(
            store.get(PHOTO_SHA256).await.unwrap_err(),
            ObjectStoreError::Missing
        ));
    }

    #[tokio::test]
    async fn delete_removes_the_object_from_the_bucket_and_the_disk() {
        let directory = tempfile::tempdir().unwrap();
        let bucket = Arc::new(FakeBucket::default());
        let store = cloud_store(directory.path(), bucket.clone()).await.unwrap();
        put_bytes(&store, PHOTO).await.unwrap();

        store.delete(PHOTO_SHA256).await.unwrap();
        assert!(bucket.objects.lock().is_empty());
        assert!(matches!(
            store.get(PHOTO_SHA256).await.unwrap_err(),
            ObjectStoreError::Missing
        ));
        // Deleting what is already gone is not an error.
        store.delete(PHOTO_SHA256).await.unwrap();
    }

    #[test]
    fn a_prefix_or_bucket_that_could_reshape_a_url_is_refused() {
        for prefix in [
            "",
            "/tan-studio/attachments",
            "tan-studio/attachments/",
            "tan-studio//attachments",
            "tan-studio/attach ments",
            "tan-studio/../notebook",
        ] {
            assert!(!valid_prefix(prefix), "{prefix} should be refused");
        }
        assert!(valid_prefix(PREFIX));
        assert!(valid_bucket(BUCKET));
        assert!(!valid_bucket("Tan-Coffee-Backups"));
        assert!(!valid_bucket("tan/coffee"));
    }

    #[test]
    fn only_a_sha256_can_become_an_object_name() {
        assert!(valid_digest(PHOTO_SHA256));
        assert!(!valid_digest("../../notebook"));
        assert!(!valid_digest(&PHOTO_SHA256.to_uppercase()));
        assert!(!valid_digest(&PHOTO_SHA256[..63]));
    }

    #[test]
    fn a_service_account_key_without_a_private_key_is_refused() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("key.json");
        std::fs::write(&path, br#"{"client_email":"a@b.iam.gserviceaccount.com"}"#).unwrap();
        let Err(error) = CloudStorageSettings::service_account(BUCKET, PREFIX, &path) else {
            panic!("a key with no private_key must be refused");
        };
        assert!(matches!(error, ObjectStoreError::Io { .. }), "{error}");
    }
}
