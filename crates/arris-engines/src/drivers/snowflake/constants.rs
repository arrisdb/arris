/// Gzip magic bytes. Result chunks arrive gzip-compressed even when the HTTP
/// layer does not advertise `Content-Encoding: gzip`, so we inflate by signature.
pub(super) const GZIP_MAGIC: [u8; 2] = [0x1f, 0x8b];
