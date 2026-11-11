//! The export stream: a host's renderer calls, recorded in order
//! (`web/src/native/recorder.ts` writes it). Little-endian. A stream starts
//! with `MAGIC` and the protocol version, then records of
//! `[op: u32][payload bytes: u32][payload, padded to 4 bytes]`.

use std::io::{self, Read};

pub const MAGIC: u32 = 0x3158_534d; // "MSX1"
pub const VERSION: u32 = 1;

pub mod op {
    /// render w, render h, out w, out h, fps × 1000, total frames, bits per second, codec (0 avc, 1 hevc, 2 av1), flags
    pub const BEGIN: u32 = 1;
    /// delta words (protocol.rs)
    pub const APPLY: u32 = 2;
    /// family byte length, family (padded), font bytes
    pub const FONT: u32 = 3;
    /// id, w, h, flags (1 mipmaps, 2 premultiplied), RGBA8 rows
    pub const IMAGE: u32 = 4;
    /// id, root, w, h
    pub const SURFACE: u32 = 5;
    /// id, w, h, words
    pub const SCENE3D: u32 = 6;
    /// scene, tex, image, srgb
    pub const SCENE3D_BIND: u32 = 7;
    /// scene, tex, w, h, srgb, RGBA8 rows
    pub const SCENE3D_PIXELS: u32 = 8;
    /// id
    pub const FREE_IMAGE: u32 = 9;
    /// id, kind, WGSL source
    pub const SHADER_ADD: u32 = 10;
    pub const SHADER_BUILD: u32 = 11;
    pub const SHADER_REMOVE: u32 = 12;
    /// linear, dither
    pub const OPTIONS: u32 = 13;
    /// w, h
    pub const RESIZE: u32 = 14;
    /// frame index: encode the scene as it stands
    pub const FRAME: u32 = 15;
    /// sample rate, channels, f32 interleaved samples
    pub const AUDIO: u32 = 16;
    pub const END: u32 = 17;
    pub const INVALIDATE: u32 = 18;
    /// render w, render h: creates the renderer (the host surface mounting)
    pub const CREATE: u32 = 19;
}

pub struct Record {
    pub op: u32,
    pub data: Vec<u8>,
}

impl Record {
    pub fn u32(&self, i: usize) -> u32 {
        u32::from_le_bytes(self.data[i * 4..i * 4 + 4].try_into().unwrap())
    }

    pub fn words(&self, from: usize) -> Vec<u32> {
        bytemuck::pod_collect_to_vec(&self.data[from * 4..])
    }

    pub fn bytes(&self, from_word: usize) -> &[u8] {
        &self.data[from_word * 4..]
    }

    pub fn need(&self, words: usize) -> Result<(), String> {
        if self.data.len() < words * 4 {
            Err(format!("record {} has {} bytes, needs {}", self.op, self.data.len(), words * 4))
        } else {
            Ok(())
        }
    }
}

pub struct Reader<R: Read> {
    inner: R,
    pub bytes_read: u64,
}

impl<R: Read> Reader<R> {
    pub fn new(mut inner: R) -> Result<Self, String> {
        let mut head = [0u8; 8];
        inner.read_exact(&mut head).map_err(|e| format!("stream header: {e}"))?;
        let magic = u32::from_le_bytes(head[0..4].try_into().unwrap());
        let version = u32::from_le_bytes(head[4..8].try_into().unwrap());
        if magic != MAGIC {
            return Err("not an export stream (bad magic)".into());
        }
        if version != VERSION {
            return Err(format!("export stream version {version}; this sidecar reads {VERSION}"));
        }
        Ok(Reader { inner, bytes_read: 8 })
    }

    /// The next record, or None at a clean end of input.
    pub fn next(&mut self) -> Result<Option<Record>, String> {
        let mut head = [0u8; 8];
        match self.inner.read_exact(&mut head) {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
            Err(e) => return Err(format!("read: {e}")),
        }
        let op = u32::from_le_bytes(head[0..4].try_into().unwrap());
        let len = u32::from_le_bytes(head[4..8].try_into().unwrap()) as usize;
        let padded = len.div_ceil(4) * 4;
        let mut data = vec![0u8; padded];
        self.inner.read_exact(&mut data).map_err(|e| format!("record {op} body: {e}"))?;
        data.truncate(len);
        self.bytes_read += 8 + padded as u64;
        Ok(Some(Record { op, data }))
    }
}
