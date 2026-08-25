//! Content-addressed attachment object store.
//!
//! The key is the SHA-256 of the object bytes, so a name can only be handed out
//! once every byte behind it has been seen and hashed. An upload that dies
//! halfway leaves a discarded temporary, never a short object under a name a
//! reader would trust.
//!
//! Two adapters sit behind one port. Desktop and the LAN appliance keep the
//! local-disk layout next to the notebook,
//! `{db-dir}/attachments/objects/{hh}/{sha256}`. Hosted mode wraps that same
//! layout in a Cloud Storage adapter (see [`gcs`]) that treats the disk as a
//! staging area and a cache and keeps the durable copy in the bucket.
//!
//! Nothing here ever holds a whole object in memory: uploads are hashed and
//! written chunk by chunk, and [`ObjectReader`] is an [`AsyncRead`] the HTTP
//! layer streams straight into the response body.

mod gcs;

use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
    pin::Pin,
    sync::Arc,
    task::{Context, Poll},
};

use futures_util::{Stream, StreamExt};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncRead, AsyncWriteExt, ReadBuf};
use uuid::Uuid;

pub use gcs::CloudStorageSettings;

pub const MAX_OBJECT_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredObject {
    pub sha256: String,
    pub byte_length: u64,
}

#[derive(Debug, thiserror::Error)]
pub enum ObjectStoreError {
    #[error("attachment object is missing")]
    Missing,
    #[error("attachment content must be between 1 byte and 512 MiB")]
    InvalidSize,
    #[error("attachment store {action} failed: {message}")]
    Io {
        action: &'static str,
        message: String,
    },
}

impl ObjectStoreError {
    fn io(action: &'static str, error: impl std::fmt::Display) -> Self {
        Self::Io {
            action,
            message: error.to_string(),
        }
    }
}

/// What one replication pass did. Counts, not paths: the log line this becomes
/// is about whether the disk still holds bytes nothing else has.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct ReplicationReport {
    pub uploaded: u64,
    pub already_replicated: u64,
    pub failed: u64,
}

#[derive(Clone)]
pub struct ObjectStore {
    inner: Arc<Backend>,
}

enum Backend {
    LocalDisk(LocalDiskStore),
    CloudStorage(gcs::CloudStorageStore),
}

struct LocalDiskStore {
    root: PathBuf,
}

/// A handle on one object's bytes. Reading it pulls from the disk or from the
/// bucket a chunk at a time; the bytes are never gathered up first.
pub struct ObjectReader {
    sha256: String,
    byte_length: u64,
    source: ObjectSource,
}

enum ObjectSource {
    File(tokio::fs::File),
    Remote(Pin<Box<dyn AsyncRead + Send + Sync>>),
}

impl std::fmt::Debug for ObjectReader {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ObjectReader")
            .field("sha256", &self.sha256)
            .field("byte_length", &self.byte_length)
            .field(
                "source",
                match self.source {
                    ObjectSource::File(_) => &"disk",
                    ObjectSource::Remote(_) => &"bucket",
                },
            )
            .finish()
    }
}

impl ObjectReader {
    pub fn sha256(&self) -> &str {
        &self.sha256
    }

    pub fn byte_length(&self) -> u64 {
        self.byte_length
    }
}

impl AsyncRead for ObjectReader {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        match &mut self.source {
            ObjectSource::File(file) => Pin::new(file).poll_read(cx, buf),
            ObjectSource::Remote(body) => body.as_mut().poll_read(cx, buf),
        }
    }
}

impl ObjectStore {
    pub fn local_disk(root: impl AsRef<Path>) -> Result<Self, ObjectStoreError> {
        Ok(Self {
            inner: Arc::new(Backend::LocalDisk(LocalDiskStore::open(root)?)),
        })
    }

    /// Hosted mode: the durable copy lives in the bucket, and `root` on the VM
    /// disk stages uploads and caches what has already been written.
    pub fn cloud_storage(
        root: impl AsRef<Path>,
        settings: CloudStorageSettings,
    ) -> Result<Self, ObjectStoreError> {
        let disk = LocalDiskStore::open(root)?;
        Ok(Self {
            inner: Arc::new(Backend::CloudStorage(gcs::CloudStorageStore::open(
                disk, settings,
            )?)),
        })
    }

    pub async fn put<S, B, E>(
        &self,
        declared_length: Option<u64>,
        body: S,
    ) -> Result<StoredObject, ObjectStoreError>
    where
        S: Stream<Item = Result<B, E>> + Send,
        B: AsRef<[u8]>,
        E: std::fmt::Display,
    {
        if declared_length.is_some_and(|value| value == 0 || value > MAX_OBJECT_BYTES) {
            return Err(ObjectStoreError::InvalidSize);
        }
        match &*self.inner {
            Backend::LocalDisk(disk) => disk.put(body).await,
            Backend::CloudStorage(bucket) => bucket.put(body).await,
        }
    }

    pub async fn get(&self, sha256: &str) -> Result<ObjectReader, ObjectStoreError> {
        match &*self.inner {
            Backend::LocalDisk(disk) => disk.get(sha256).await,
            Backend::CloudStorage(bucket) => bucket.get(sha256).await,
        }
    }

    pub async fn delete(&self, sha256: &str) -> Result<(), ObjectStoreError> {
        match &*self.inner {
            Backend::LocalDisk(disk) => disk.delete(sha256).await,
            Backend::CloudStorage(bucket) => bucket.delete(sha256).await,
        }
    }

    /// Whether losing the disk would lose attachment bytes.
    pub fn is_replicated(&self) -> bool {
        matches!(&*self.inner, Backend::CloudStorage(_))
    }

    /// Copy every object already on the disk into the bucket. Objects written
    /// before hosted mode grew a bucket have no copy anywhere else, so this is
    /// what stops the cutover from silently orphaning them. Idempotent: an
    /// object the bucket already holds is counted and skipped.
    pub async fn replicate_local_objects(&self) -> ReplicationReport {
        match &*self.inner {
            Backend::LocalDisk(_) => ReplicationReport::default(),
            Backend::CloudStorage(bucket) => bucket.replicate_local_objects().await,
        }
    }
}

impl LocalDiskStore {
    fn open(root: impl AsRef<Path>) -> Result<Self, ObjectStoreError> {
        let root = root.as_ref().to_path_buf();
        std::fs::create_dir_all(root.join(".tmp"))
            .map_err(|error| ObjectStoreError::io("create", error))?;
        Ok(Self { root })
    }

    fn object_path(&self, sha256: &str) -> Option<PathBuf> {
        if sha256.len() < 2 {
            return None;
        }
        Some(self.root.join("objects").join(&sha256[..2]).join(sha256))
    }

    async fn put<S, B, E>(&self, body: S) -> Result<StoredObject, ObjectStoreError>
    where
        S: Stream<Item = Result<B, E>> + Send,
        B: AsRef<[u8]>,
        E: std::fmt::Display,
    {
        let temporary_path = self.root.join(".tmp").join(Uuid::now_v7().to_string());
        let mut file = tokio::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary_path)
            .await
            .map_err(|error| ObjectStoreError::io("create", error))?;
        let mut hasher = Sha256::new();
        let mut byte_length = 0_u64;
        let mut body = std::pin::pin!(body);
        let write_result: Result<(), ObjectStoreError> = async {
            while let Some(chunk) = body.next().await {
                let chunk = chunk.map_err(|error| ObjectStoreError::io("receive", error))?;
                let bytes = chunk.as_ref();
                byte_length = byte_length.saturating_add(bytes.len() as u64);
                if byte_length > MAX_OBJECT_BYTES {
                    return Err(ObjectStoreError::InvalidSize);
                }
                hasher.update(bytes);
                file.write_all(bytes)
                    .await
                    .map_err(|error| ObjectStoreError::io("write", error))?;
            }
            if byte_length == 0 {
                return Err(ObjectStoreError::InvalidSize);
            }
            file.sync_all()
                .await
                .map_err(|error| ObjectStoreError::io("flush", error))?;
            Ok(())
        }
        .await;
        drop(file);
        if let Err(error) = write_result {
            let _ = tokio::fs::remove_file(&temporary_path).await;
            return Err(error);
        }

        let sha256 = hex::encode(hasher.finalize());
        let object_directory = self.root.join("objects").join(&sha256[..2]);
        tokio::fs::create_dir_all(&object_directory)
            .await
            .map_err(|error| ObjectStoreError::io("create", error))?;
        let object_path = object_directory.join(&sha256);
        if tokio::fs::try_exists(&object_path)
            .await
            .map_err(|error| ObjectStoreError::io("inspect", error))?
        {
            tokio::fs::remove_file(&temporary_path)
                .await
                .map_err(|error| ObjectStoreError::io("deduplicate", error))?;
        } else {
            tokio::fs::rename(&temporary_path, &object_path)
                .await
                .map_err(|error| ObjectStoreError::io("commit", error))?;
        }

        Ok(StoredObject {
            sha256,
            byte_length,
        })
    }

    async fn get(&self, sha256: &str) -> Result<ObjectReader, ObjectStoreError> {
        let Some(path) = self.object_path(sha256) else {
            return Err(ObjectStoreError::Missing);
        };
        let file = tokio::fs::File::open(path).await.map_err(|error| {
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
        Ok(ObjectReader {
            sha256: sha256.to_owned(),
            byte_length,
            source: ObjectSource::File(file),
        })
    }

    async fn delete(&self, sha256: &str) -> Result<(), ObjectStoreError> {
        let Some(path) = self.object_path(sha256) else {
            return Ok(());
        };
        match tokio::fs::remove_file(path).await {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(ObjectStoreError::io("delete", error)),
        }
    }

    /// Every object currently on the disk, by digest. What the Cloud Storage
    /// adapter walks to find bytes that predate the bucket. Anything that is not
    /// a digest is not an object and is skipped.
    async fn digests(&self) -> Result<BTreeSet<String>, ObjectStoreError> {
        let mut digests = BTreeSet::new();
        let mut shards = match tokio::fs::read_dir(self.root.join("objects")).await {
            Ok(shards) => shards,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(digests),
            Err(error) => return Err(ObjectStoreError::io("scan", error)),
        };
        while let Some(shard) = shards
            .next_entry()
            .await
            .map_err(|error| ObjectStoreError::io("scan", error))?
        {
            let Ok(mut entries) = tokio::fs::read_dir(shard.path()).await else {
                continue;
            };
            while let Some(entry) = entries
                .next_entry()
                .await
                .map_err(|error| ObjectStoreError::io("scan", error))?
            {
                if let Some(name) = entry.file_name().to_str() {
                    if valid_digest(name) {
                        digests.insert(name.to_owned());
                    }
                }
            }
        }
        Ok(digests)
    }
}

/// The one shape a key may have. Nothing else can name an object, on the disk or
/// in the bucket.
fn valid_digest(sha256: &str) -> bool {
    sha256.len() == 64
        && sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::stream;
    use tokio::io::AsyncReadExt;

    const PHOTO: &[u8] = b"finished-beans-photo";
    const PHOTO_SHA256: &str = "a02d6ebe93f45e2a2923ca5bbc9a9e6098c50727f855974e6198e9363ce915de";

    async fn put_bytes(
        store: &ObjectStore,
        bytes: &[u8],
        declared_length: Option<u64>,
    ) -> Result<StoredObject, ObjectStoreError> {
        store
            .put(
                declared_length,
                stream::iter([Ok::<_, std::io::Error>(bytes.to_vec())]),
            )
            .await
    }

    #[tokio::test]
    async fn put_then_get_round_trips_the_same_bytes_and_hash() {
        let directory = tempfile::tempdir().unwrap();
        let store = ObjectStore::local_disk(directory.path()).unwrap();

        let stored = put_bytes(&store, PHOTO, Some(PHOTO.len() as u64))
            .await
            .unwrap();
        assert_eq!(stored.sha256, PHOTO_SHA256);
        assert_eq!(stored.byte_length, 20);

        let mut reader = store.get(PHOTO_SHA256).await.unwrap();
        assert_eq!(reader.sha256(), PHOTO_SHA256);
        assert_eq!(reader.byte_length(), 20);
        let mut got = Vec::new();
        reader.read_to_end(&mut got).await.unwrap();
        assert_eq!(got, PHOTO);
    }

    #[tokio::test]
    async fn getting_a_missing_object_is_pending_and_can_be_retried() {
        let directory = tempfile::tempdir().unwrap();
        let store = ObjectStore::local_disk(directory.path()).unwrap();

        let error = store.get(PHOTO_SHA256).await.unwrap_err();
        assert!(matches!(error, ObjectStoreError::Missing));

        let stored = put_bytes(&store, PHOTO, None).await.unwrap();
        assert_eq!(stored.sha256, PHOTO_SHA256);
        let mut reader = store.get(PHOTO_SHA256).await.unwrap();
        let mut got = Vec::new();
        reader.read_to_end(&mut got).await.unwrap();
        assert_eq!(got, PHOTO);
    }

    #[tokio::test]
    async fn an_incomplete_put_leaves_no_object_and_can_be_retried() {
        let directory = tempfile::tempdir().unwrap();
        let store = ObjectStore::local_disk(directory.path()).unwrap();
        let truncated = stream::iter([
            Ok(PHOTO[..10].to_vec()),
            Err(std::io::Error::other("connection reset")),
        ]);

        let error = store.put(None, truncated).await.unwrap_err();
        assert!(matches!(
            error,
            ObjectStoreError::Io {
                action: "receive",
                ..
            }
        ));
        assert!(matches!(
            store.get(PHOTO_SHA256).await.unwrap_err(),
            ObjectStoreError::Missing
        ));

        let stored = put_bytes(&store, PHOTO, None).await.unwrap();
        assert_eq!(stored.sha256, PHOTO_SHA256);
        let mut reader = store.get(PHOTO_SHA256).await.unwrap();
        let mut got = Vec::new();
        reader.read_to_end(&mut got).await.unwrap();
        assert_eq!(got, PHOTO);
    }

    #[tokio::test]
    async fn put_rejects_more_than_512_mib_without_storing_an_object() {
        let directory = tempfile::tempdir().unwrap();
        let store = ObjectStore::local_disk(directory.path()).unwrap();
        let empty = stream::iter(Vec::<Result<Vec<u8>, std::io::Error>>::new());

        let error = store.put(Some(536_870_913), empty).await.unwrap_err();
        assert!(matches!(error, ObjectStoreError::InvalidSize));
        assert!(directory
            .path()
            .join("objects")
            .read_dir()
            .ok()
            .is_none_or(|entries| entries.count() == 0));
    }

    #[tokio::test]
    async fn put_rejects_empty_content() {
        let directory = tempfile::tempdir().unwrap();
        let store = ObjectStore::local_disk(directory.path()).unwrap();
        let empty = stream::iter(Vec::<Result<Vec<u8>, std::io::Error>>::new());

        let error = store.put(Some(0), empty).await.unwrap_err();
        assert!(matches!(error, ObjectStoreError::InvalidSize));
    }

    #[tokio::test]
    async fn local_disk_adapter_stores_objects_next_to_the_notebook() {
        let directory = tempfile::tempdir().unwrap();
        let store = ObjectStore::local_disk(directory.path()).unwrap();
        put_bytes(&store, PHOTO, None).await.unwrap();

        let path = directory
            .path()
            .join("objects")
            .join("a0")
            .join(PHOTO_SHA256);
        assert_eq!(std::fs::read(path).unwrap(), PHOTO);
    }

    /// Proof the upload does not buffer: the body is asked for a chunk at a
    /// time, and earlier chunks are already on the disk before the next one is
    /// produced. A 512 MiB attachment on a 1 GB VM depends on this.
    #[tokio::test]
    async fn put_spools_each_chunk_before_asking_the_body_for_the_next() {
        const CHUNK: usize = 256 * 1024;
        let directory = tempfile::tempdir().unwrap();
        let store = ObjectStore::local_disk(directory.path()).unwrap();
        let temporary = directory.path().join(".tmp");
        let spooled = Arc::new(std::sync::Mutex::new(Vec::new()));

        let observer = spooled.clone();
        let body = stream::unfold(0_usize, move |index| {
            let temporary = temporary.clone();
            let observer = observer.clone();
            async move {
                if index == 4 {
                    return None;
                }
                observer.lock().unwrap().push(spooled_bytes(&temporary));
                Some((Ok::<_, std::io::Error>(vec![b'x'; CHUNK]), index + 1))
            }
        });
        let stored = store.put(None, body).await.unwrap();
        assert_eq!(stored.byte_length, (4 * CHUNK) as u64);

        let spooled = spooled.lock().unwrap().clone();
        assert_eq!(spooled.len(), 4);
        assert_eq!(
            spooled[0], 0,
            "nothing can be on the disk before the first chunk exists"
        );
        assert!(
            spooled[3] >= (2 * CHUNK) as u64,
            "earlier chunks must already be spooled before the last one is produced, saw {spooled:?}"
        );
    }

    fn spooled_bytes(temporary: &Path) -> u64 {
        std::fs::read_dir(temporary)
            .into_iter()
            .flatten()
            .filter_map(Result::ok)
            .filter_map(|entry| entry.metadata().ok())
            .map(|metadata| metadata.len())
            .sum()
    }

    #[tokio::test]
    async fn delete_removes_an_object_and_is_idempotent() {
        let directory = tempfile::tempdir().unwrap();
        let store = ObjectStore::local_disk(directory.path()).unwrap();
        put_bytes(&store, PHOTO, None).await.unwrap();

        store.delete(PHOTO_SHA256).await.unwrap();
        assert!(matches!(
            store.get(PHOTO_SHA256).await.unwrap_err(),
            ObjectStoreError::Missing
        ));
        store.delete(PHOTO_SHA256).await.unwrap();
    }
}
