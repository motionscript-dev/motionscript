//! Replaying an export stream (feature `native`): a host page's renderer
//! calls, recorded in order by `web/src/native/recorder.ts`, applied to a
//! [`NativeRenderer`]. [`Replay::feed`] performs every renderer call itself
//! and hands back only what the stream asks of whoever is exporting it:
//! begin, draw a frame, the mixed audio, end. Drawing and encoding a frame are
//! the host's: it renders with [`NativeRenderer::render_into`].
//!
//! Little-endian. A stream starts with [`MAGIC`] and [`VERSION`], then records
//! of `[op: u32][payload bytes: u32][payload, padded to 4 bytes]`. The op
//! numbers are `NATIVE_RECORD` in `recorder.ts`; change both together and bump
//! [`VERSION`].

use std::io::{self, Read};
use std::time::Instant;

use crate::native::NativeRenderer;

pub const MAGIC: u32 = 0x3158_534d; // "MSX1"
pub const VERSION: u32 = 1;

pub mod op {
    /// out w, out h, fps × 1000, total frames, bits per second, codec (0 avc, 1 hevc, 2 av1), flags
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
    /// frame index: the scene as it stands is the next frame
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
            return Err(format!("export stream version {version}; this renderer reads {VERSION}"));
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

/// What the export asks for, from a `BEGIN` record.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Begin {
    /// The video's size; the renderer's own size is this times the supersampling.
    pub width: u32,
    pub height: u32,
    pub fps_milli: u32,
    pub frames: u32,
    pub bitrate: u32,
    /// 0 avc, 1 hevc, 2 av1.
    pub codec: u32,
    pub flags: u32,
}

#[derive(Debug, PartialEq)]
pub enum Event {
    Begin(Begin),
    /// The scene as it stands is the next frame.
    Frame,
    Audio { sample_rate: u32, channels: u32, pcm: Vec<u8> },
    End,
}

#[derive(Default)]
pub struct Replay {
    renderer: Option<NativeRenderer>,
    pub apply_ms: f64,
    pub upload_ms: f64,
}

impl Replay {
    pub fn new() -> Self {
        Self::default()
    }

    /// None until the stream's `CREATE`.
    pub fn renderer(&self) -> Option<&NativeRenderer> {
        self.renderer.as_ref()
    }

    pub fn renderer_mut(&mut self) -> Option<&mut NativeRenderer> {
        self.renderer.as_mut()
    }

    pub fn into_renderer(self) -> Option<NativeRenderer> {
        self.renderer
    }

    /// Applies a renderer call, or returns the export event a record is.
    pub fn feed(&mut self, rec: &Record) -> Result<Option<Event>, String> {
        match rec.op {
            op::BEGIN => {
                rec.need(7)?;
                return Ok(Some(Event::Begin(Begin {
                    width: rec.u32(0),
                    height: rec.u32(1),
                    fps_milli: rec.u32(2),
                    frames: rec.u32(3),
                    bitrate: rec.u32(4),
                    codec: rec.u32(5),
                    flags: rec.u32(6),
                })));
            }
            op::FRAME => return Ok(Some(Event::Frame)),
            op::AUDIO => {
                rec.need(2)?;
                return Ok(Some(Event::Audio { sample_rate: rec.u32(0), channels: rec.u32(1), pcm: rec.bytes(2).to_vec() }));
            }
            op::END => return Ok(Some(Event::End)),
            op::CREATE => {
                rec.need(2)?;
                self.renderer = Some(pollster::block_on(NativeRenderer::new(rec.u32(0), rec.u32(1)))?);
                return Ok(None);
            }
            _ => {}
        }
        let r = self.renderer.as_mut().ok_or("a renderer call came before CREATE")?;
        match rec.op {
            op::APPLY => {
                let t0 = Instant::now();
                r.apply(&rec.words(0))?;
                self.apply_ms += t0.elapsed().as_secs_f64() * 1000.0;
            }
            op::FONT => {
                rec.need(1)?;
                let n = rec.u32(0) as usize;
                let family = std::str::from_utf8(&rec.data[4..4 + n]).map_err(|e| e.to_string())?;
                let at = 4 + n.div_ceil(4) * 4;
                r.register_font(&rec.data[at..], family);
            }
            op::IMAGE => {
                rec.need(4)?;
                let t0 = Instant::now();
                let (id, w, h, flags) = (rec.u32(0), rec.u32(1), rec.u32(2), rec.u32(3));
                let mut px = rec.bytes(4).to_vec();
                if flags & 2 == 0 {
                    premultiply(&mut px);
                }
                r.upload_rgba(id, w, h, &px, flags & 1 != 0)?;
                self.upload_ms += t0.elapsed().as_secs_f64() * 1000.0;
            }
            op::SURFACE => {
                rec.need(4)?;
                r.set_surface(rec.u32(0), rec.u32(1), rec.u32(2), rec.u32(3));
            }
            op::SCENE3D => {
                rec.need(3)?;
                r.set_scene3d(rec.u32(0), rec.u32(1), rec.u32(2), &rec.words(3))?;
            }
            op::SCENE3D_BIND => {
                rec.need(4)?;
                r.scene3d_bind(rec.u32(0), rec.u32(1), rec.u32(2), rec.u32(3) != 0);
            }
            op::SCENE3D_PIXELS => {
                rec.need(5)?;
                r.scene3d_pixels(rec.u32(0), rec.u32(1), rec.bytes(5), rec.u32(2), rec.u32(3), rec.u32(4) != 0);
            }
            op::FREE_IMAGE => {
                rec.need(1)?;
                r.free_image(rec.u32(0));
            }
            op::SHADER_ADD => {
                rec.need(2)?;
                let source = std::str::from_utf8(rec.bytes(2)).map_err(|e| e.to_string())?;
                r.shader_add(rec.u32(0), rec.u32(1), source);
            }
            op::SHADER_BUILD => {
                rec.need(1)?;
                r.shader_build(rec.u32(0));
            }
            op::SHADER_REMOVE => {
                rec.need(1)?;
                r.shader_remove(rec.u32(0));
            }
            op::OPTIONS => {
                rec.need(2)?;
                r.set_options(rec.u32(0) != 0, rec.u32(1) != 0);
            }
            op::RESIZE => {
                rec.need(2)?;
                r.resize(rec.u32(0), rec.u32(1));
            }
            op::INVALIDATE => r.invalidate(),
            other => return Err(format!("unknown record {other}")),
        }
        Ok(None)
    }
}

/// Straight → premultiplied alpha on sRGB-encoded bytes, as the browser's
/// image copy does.
fn premultiply(px: &mut [u8]) {
    for p in px.chunks_exact_mut(4) {
        let a = p[3] as u32;
        if a == 255 {
            continue;
        }
        for c in &mut p[..3] {
            *c = ((*c as u32 * a + 127) / 255) as u8;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stream(records: &[(u32, Vec<u8>)]) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&MAGIC.to_le_bytes());
        out.extend_from_slice(&VERSION.to_le_bytes());
        for (op, data) in records {
            out.extend_from_slice(&op.to_le_bytes());
            out.extend_from_slice(&(data.len() as u32).to_le_bytes());
            out.extend_from_slice(data);
            out.resize(out.len().div_ceil(4) * 4, 0);
        }
        out
    }

    fn words(w: &[u32]) -> Vec<u8> {
        w.iter().flat_map(|w| w.to_le_bytes()).collect()
    }

    #[test]
    fn reads_padded_records_and_the_export_events() {
        let mut audio = words(&[48_000, 2]);
        audio.extend_from_slice(&[1, 2, 3]);
        let bytes = stream(&[(op::BEGIN, words(&[1920, 1080, 60_000, 120, 8_000_000, 1, 0])), (op::AUDIO, audio), (op::FRAME, words(&[0])), (op::END, vec![])]);
        let mut reader = Reader::new(bytes.as_slice()).unwrap();
        let mut replay = Replay::new();
        let mut events = Vec::new();
        while let Some(rec) = reader.next().unwrap() {
            events.extend(replay.feed(&rec).unwrap());
        }
        assert_eq!(
            events,
            [
                Event::Begin(Begin { width: 1920, height: 1080, fps_milli: 60_000, frames: 120, bitrate: 8_000_000, codec: 1, flags: 0 }),
                Event::Audio { sample_rate: 48_000, channels: 2, pcm: vec![1, 2, 3] },
                Event::Frame,
                Event::End,
            ]
        );
        assert_eq!(reader.bytes_read, bytes.len() as u64);
    }

    #[test]
    fn refuses_another_stream_or_version() {
        let mut bytes = stream(&[]);
        bytes[4] = 2;
        assert!(Reader::new(bytes.as_slice()).err().unwrap().contains("version 2"));
        bytes[0] = 0;
        assert!(Reader::new(bytes.as_slice()).err().unwrap().contains("bad magic"));
    }

    #[test]
    fn a_renderer_call_needs_create_first() {
        let rec = Record { op: op::APPLY, data: vec![] };
        assert!(Replay::new().feed(&rec).unwrap_err().contains("before CREATE"));
    }

    #[test]
    fn premultiplies_straight_alpha() {
        let mut px = [200, 100, 0, 128, 10, 20, 30, 255];
        premultiply(&mut px);
        assert_eq!(px, [100, 50, 0, 128, 10, 20, 30, 255]);
    }
    #[test]
    fn op_numbers_match_the_recorder() {
        let ts = include_str!("../../../web/src/native/recorder.ts");
        let table = &ts[ts.find("export const REC = {").unwrap()..];
        let table = &table[..table.find("}").unwrap()];
        let ours = [
            ("BEGIN", op::BEGIN), ("APPLY", op::APPLY), ("FONT", op::FONT), ("IMAGE", op::IMAGE), ("SURFACE", op::SURFACE),
            ("SCENE3D", op::SCENE3D), ("SCENE3D_BIND", op::SCENE3D_BIND), ("SCENE3D_PIXELS", op::SCENE3D_PIXELS),
            ("FREE_IMAGE", op::FREE_IMAGE), ("SHADER_ADD", op::SHADER_ADD), ("SHADER_BUILD", op::SHADER_BUILD),
            ("SHADER_REMOVE", op::SHADER_REMOVE), ("OPTIONS", op::OPTIONS), ("RESIZE", op::RESIZE), ("FRAME", op::FRAME),
            ("AUDIO", op::AUDIO), ("END", op::END), ("INVALIDATE", op::INVALIDATE), ("CREATE", op::CREATE),
        ];
        let theirs: Vec<(&str, u32)> = table
            .split(|c: char| c == ',' || c == '{')
            .filter_map(|e| e.split_once(':'))
            .map(|(k, v)| (k.trim(), v.trim().parse().unwrap()))
            .collect();
        assert_eq!(theirs.len(), ours.len());
        for (name, n) in ours {
            assert!(theirs.contains(&(name, n)), "{name} = {n} differs from recorder.ts");
        }
        assert!(ts.contains(&format!("STREAM_VERSION = {VERSION};")));
    }
}
