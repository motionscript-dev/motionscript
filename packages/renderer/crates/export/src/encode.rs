//! ffmpeg as the encoder: raw NV12 frames into its stdin, from a writer thread
//! so a full pipe never stalls the GPU loop. `h264_nvenc`/`hevc_nvenc`/
//! `av1_nvenc` where the GPU and driver have NVENC, else libx264/libx265.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::thread::JoinHandle;

use crate::readback::Frame;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Codec {
    Avc,
    Hevc,
    Av1,
}

impl Codec {
    pub fn from_index(i: u32) -> Codec {
        match i {
            1 => Codec::Hevc,
            2 => Codec::Av1,
            _ => Codec::Avc,
        }
    }
    pub fn nvenc(self) -> &'static str {
        match self {
            Codec::Avc => "h264_nvenc",
            Codec::Hevc => "hevc_nvenc",
            Codec::Av1 => "av1_nvenc",
        }
    }
    pub fn software(self) -> &'static str {
        match self {
            Codec::Avc => "libx264",
            Codec::Hevc => "libx265",
            Codec::Av1 => "libsvtav1",
        }
    }
}

/// Whether `encoder` actually opens on this machine: ffmpeg lists NVENC
/// encoders in builds that have them whether or not the GPU does.
pub fn encoder_works(ffmpeg: &Path, encoder: &str) -> bool {
    Command::new(ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=256x256:d=0.1", "-frames:v", "2", "-c:v", encoder, "-f", "null", "-"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

pub struct Settings {
    pub ffmpeg: PathBuf,
    pub encoder: String,
    pub width: u32,
    pub height: u32,
    /// Frames per second × 1000.
    pub fps_milli: u32,
    pub bitrate: u32,
    pub preset: Option<String>,
    pub out: PathBuf,
}

pub struct Encoder {
    child: Child,
    /// The named pipe frames go through (Windows), to unblock its connect if ffmpeg dies first.
    pipe_name: Option<String>,
    tx: Option<mpsc::Sender<Frame>>,
    writer: Option<JoinHandle<Result<(), String>>>,
}

/// The frame pipe's buffer: a few frames of 1080p NV12.
#[cfg(windows)]
const PIPE_BUFFER: u32 = 16 << 20;

fn rate(fps_milli: u32) -> String {
    if fps_milli % 1000 == 0 { format!("{}", fps_milli / 1000) } else { format!("{fps_milli}/1000") }
}

impl Encoder {
    pub fn start(s: &Settings) -> Result<Encoder, String> {
        let fps = rate(s.fps_milli);
        let gop = (s.fps_milli as f64 / 1000.0).round().max(1.0) as u32;
        let mut args: Vec<String> = vec![
            "-hide_banner".into(), "-loglevel".into(), "error".into(), "-y".into(),
            "-f".into(), "rawvideo".into(), "-pix_fmt".into(), "nv12".into(),
            "-s".into(), format!("{}x{}", s.width, s.height), "-r".into(), fps.clone(),
            "-thread_queue_size".into(), "64".into(),
        ];
        #[cfg(windows)]
        let pipe = crate::winpipe::Pipe::create(PIPE_BUFFER).map_err(|e| format!("named pipe: {e}"))?;
        #[cfg(windows)]
        args.extend(["-i".into(), pipe.name.clone()]);
        #[cfg(not(windows))]
        args.extend(["-i".into(), "-".into()]);
        if s.encoder == "null" {
            // Diagnostics: how fast frames reach ffmpeg, with no encoder.
            args.extend(["-f", "null", "-"].map(String::from));
        } else {
            args.extend(["-c:v".into(), s.encoder.clone(), "-b:v".into(), s.bitrate.to_string(), "-g".into(), gop.to_string()]);
        }
        if s.encoder == "null" {
        } else if s.encoder.contains("nvenc") {
            args.extend(["-preset", s.preset.as_deref().unwrap_or("p4"), "-tune", "hq", "-rc", "vbr", "-bf", "0"].map(String::from));
            args.extend(["-maxrate".into(), (s.bitrate as u64 * 2).to_string(), "-bufsize".into(), (s.bitrate as u64 * 2).to_string()]);
        } else {
            args.extend(["-preset", s.preset.as_deref().unwrap_or("veryfast"), "-pix_fmt", "yuv420p"].map(String::from));
        }
        if s.encoder != "null" {
        args.extend(
            ["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv", "-movflags", "+faststart"]
                .map(String::from),
        );
        args.push(s.out.to_string_lossy().into_owned());
        }
        #[cfg_attr(windows, allow(unused_mut))]
        let mut child = Command::new(&s.ffmpeg)
            .args(&args)
            .stdin(if cfg!(windows) { Stdio::null() } else { Stdio::piped() })
            .stdout(Stdio::null())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| format!("could not start ffmpeg ({}): {e}", s.ffmpeg.display()))?;
        #[cfg(windows)]
        let pipe_name = Some(pipe.name.clone());
        #[cfg(not(windows))]
        let pipe_name = None;
        #[cfg(windows)]
        let mut stdin = pipe;
        #[cfg(not(windows))]
        let mut stdin = child.stdin.take().unwrap();
        // Unbounded: the readback slots bound what is in flight.
        let (tx, rx) = mpsc::channel::<Frame>();
        let writer = std::thread::spawn(move || -> Result<(), String> {
            #[cfg(windows)]
            stdin.connect().map_err(|e| format!("ffmpeg did not open the frame pipe: {e}"))?;
            for frame in rx {
                frame.write_to(&mut stdin).map_err(|e| format!("ffmpeg stopped taking frames: {e}"))?;
            }
            stdin.flush().map_err(|e| e.to_string())?;
            Ok(())
        });
        Ok(Encoder { child, pipe_name, tx: Some(tx), writer: Some(writer) })
    }

    pub fn push(&self, frame: Frame) -> Result<(), String> {
        self.tx.as_ref().unwrap().send(frame).map_err(|_| "the ffmpeg writer stopped".to_string())
    }

    pub fn finish(mut self) -> Result<(), String> {
        drop(self.tx.take());
        #[cfg(windows)]
        if let (Some(name), Ok(Some(_))) = (&self.pipe_name, self.child.try_wait()) {
            crate::winpipe::Pipe::unblock(name);
        }
        let _ = &self.pipe_name;
        let written = self.writer.take().unwrap().join().map_err(|_| "writer panicked".to_string())?;
        let status = self.child.wait().map_err(|e| e.to_string())?;
        written?;
        if !status.success() {
            return Err(format!("ffmpeg exited with {status}"));
        }
        Ok(())
    }
}

/// Writes 32-bit float interleaved PCM as a WAV file.
pub fn write_wav(path: &Path, rate: u32, channels: u32, samples: &[u8]) -> Result<(), String> {
    let mut f = std::fs::File::create(path).map_err(|e| e.to_string())?;
    let data = samples.len() as u32;
    let mut h = Vec::with_capacity(44);
    h.extend_from_slice(b"RIFF");
    h.extend_from_slice(&(36 + data).to_le_bytes());
    h.extend_from_slice(b"WAVEfmt ");
    h.extend_from_slice(&16u32.to_le_bytes());
    h.extend_from_slice(&3u16.to_le_bytes()); // IEEE float
    h.extend_from_slice(&(channels as u16).to_le_bytes());
    h.extend_from_slice(&rate.to_le_bytes());
    h.extend_from_slice(&(rate * channels * 4).to_le_bytes());
    h.extend_from_slice(&((channels * 4) as u16).to_le_bytes());
    h.extend_from_slice(&32u16.to_le_bytes());
    h.extend_from_slice(b"data");
    h.extend_from_slice(&data.to_le_bytes());
    f.write_all(&h).and_then(|_| f.write_all(samples)).map_err(|e| e.to_string())
}

/// Muxes `audio` (WAV) into `video` as AAC, copying the video stream.
pub fn mux_audio(ffmpeg: &Path, video: &Path, audio: &Path, out: &Path) -> Result<(), String> {
    let status = Command::new(ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
        .arg(video)
        .arg("-i")
        .arg(audio)
        .args(["-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart"])
        .arg(out)
        .stdin(Stdio::null())
        .status()
        .map_err(|e| e.to_string())?;
    if status.success() { Ok(()) } else { Err(format!("audio mux: ffmpeg exited with {status}")) }
}

/// No encoder (`--no-encode`): frames are waited for and dropped on a thread
/// of their own, so the loop's speed is the render's.
pub struct Discard {
    tx: Option<mpsc::Sender<Frame>>,
    writer: Option<JoinHandle<Result<(), String>>>,
}

impl Discard {
    pub fn start() -> Discard {
        let (tx, rx) = mpsc::channel::<Frame>();
        let writer = std::thread::spawn(move || -> Result<(), String> {
            for frame in rx {
                frame.write_to(&mut std::io::sink()).map_err(|e| e.to_string())?;
            }
            Ok(())
        });
        Discard { tx: Some(tx), writer: Some(writer) }
    }

    pub fn push(&self, frame: Frame) -> Result<(), String> {
        self.tx.as_ref().unwrap().send(frame).map_err(|_| "the discard thread stopped".to_string())
    }

    pub fn finish(mut self) -> Result<(), String> {
        drop(self.tx.take());
        self.writer.take().unwrap().join().map_err(|_| "discard panicked".to_string())?
    }
}
