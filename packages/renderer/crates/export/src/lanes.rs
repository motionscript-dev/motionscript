//! Several NVENC sessions on one export. One ffmpeg moving raw frames into
//! NVENC tops out near 340 fps at 1080p (frame upload and demux run in series
//! with the encode), and two at once reach ~700 (measured, RTX 5070 Ti). So
//! whole GOPs alternate between `lanes` encoders: GOP `g` goes to lane
//! `g % lanes`. Each lane writes an Annex-B elementary stream with an access
//! unit delimiter on every frame and an IDR exactly every `gop` frames (no
//! scene-cut keyframes, no B-frames), so its output splits back into GOPs by
//! counting delimiters, and the GOPs are written in order to a muxing ffmpeg
//! that copies them into the MP4. Every lane runs the same settings, so their
//! parameter sets match and the joined stream decodes as one.

use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::thread::JoinHandle;

use crate::encode::{Codec, Settings};
use crate::readback::Frame;

struct Lane {
    child: Child,
    tx: Option<mpsc::Sender<Frame>>,
    writer: Option<JoinHandle<Result<(), String>>>,
    reader: Option<JoinHandle<Result<(), String>>>,
}

pub struct Lanes {
    lanes: Vec<Lane>,
    gop: u64,
    frame: u64,
    mux: Option<(Child, JoinHandle<Result<(), String>>)>,
}

/// Whether byte `b` (the first byte of a NAL header) is an access unit delimiter.
fn is_aud(codec: Codec, b: u8) -> bool {
    match codec {
        Codec::Hevc => (b >> 1) & 0x3f == 35,
        _ => b & 0x1f == 9,
    }
}

/// Splits an elementary stream into GOPs of `gop` access units, sending each
/// as it completes (and the remainder at the end).
fn split_gops(mut input: impl Read, codec: Codec, gop: u64, lane: usize, out: mpsc::Sender<(usize, u64, Vec<u8>)>) -> Result<(), String> {
    let mut buf: Vec<u8> = Vec::with_capacity(1 << 20);
    let mut chunk = vec![0u8; 1 << 16];
    // Start of the current GOP in `buf`, access units seen in it, how far `buf` was scanned.
    let (mut units, mut scanned, mut index) = (0u64, 0usize, 0u64);
    loop {
        let n = input.read(&mut chunk).map_err(|e| format!("lane {lane} output: {e}"))?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
        // A start code is 00 00 01 (a 4-byte one ends the same way) then the NAL header.
        let mut i = scanned;
        while i + 3 < buf.len() {
            if buf[i] == 0 && buf[i + 1] == 0 && buf[i + 2] == 1 && is_aud(codec, buf[i + 3]) {
                if units == gop {
                    // A 4-byte start code's leading zero belongs to the next GOP.
                    let cut = if i > 0 && buf[i - 1] == 0 { i - 1 } else { i };
                    let rest = buf.split_off(cut);
                    out.send((lane, index, std::mem::replace(&mut buf, rest))).map_err(|_| "muxer stopped")?;
                    index += 1;
                    units = 0;
                    i -= cut;
                }
                units += 1;
                i += 3;
            } else {
                i += 1;
            }
        }
        scanned = buf.len().saturating_sub(3);
    }
    if !buf.is_empty() {
        out.send((lane, index, buf)).map_err(|_| "muxer stopped")?;
    }
    Ok(())
}

impl Lanes {
    pub fn start(s: &Settings, codec: Codec, count: usize) -> Result<Lanes, String> {
        let gop = ((s.fps_milli as f64 / 1000.0).round() as u64).max(1);
        let rate = if s.fps_milli % 1000 == 0 { format!("{}", s.fps_milli / 1000) } else { format!("{}/1000", s.fps_milli) };
        let (gop_tx, gop_rx) = mpsc::channel::<(usize, u64, Vec<u8>)>();
        let elementary = if codec == Codec::Hevc { "hevc" } else { "h264" };

        let mut lanes = Vec::with_capacity(count);
        for lane in 0..count {
            #[cfg(windows)]
            let pipe = crate::winpipe::Pipe::create(16 << 20).map_err(|e| format!("named pipe: {e}"))?;
            #[cfg(windows)]
            let input = pipe.name.clone();
            #[cfg(not(windows))]
            let input = "-".to_string();
            let mut args: Vec<String> = [
                "-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "nv12",
            ].map(String::from).to_vec();
            args.extend(["-s".into(), format!("{}x{}", s.width, s.height), "-r".into(), rate.clone(), "-i".into(), input]);
            args.extend(["-c:v".into(), s.encoder.clone(), "-b:v".into(), s.bitrate.to_string()]);
            args.extend(["-maxrate".into(), (s.bitrate as u64 * 2).to_string(), "-bufsize".into(), (s.bitrate as u64 * 2).to_string()]);
            args.extend(["-g".into(), gop.to_string()]);
            args.extend(
                ["-preset", s.preset.as_deref().unwrap_or("p4"), "-tune", "hq", "-rc", "vbr", "-bf", "0", "-forced-idr", "1", "-no-scenecut", "1", "-aud", "1"]
                    .map(String::from),
            );
            args.extend(["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv"].map(String::from));
            args.extend(["-f".into(), elementary.into(), "-".into()]);
            let mut child = Command::new(&s.ffmpeg)
                .args(&args)
                .stdin(if cfg!(windows) { Stdio::null() } else { Stdio::piped() })
                .stdout(Stdio::piped())
                .stderr(Stdio::inherit())
                .spawn()
                .map_err(|e| format!("could not start ffmpeg ({}): {e}", s.ffmpeg.display()))?;
            #[cfg(windows)]
            let mut sink = pipe;
            #[cfg(not(windows))]
            let mut sink = child.stdin.take().unwrap();
            let stdout = child.stdout.take().unwrap();
            // Unbounded: the readback slots bound what is in flight.
            let (tx, rx) = mpsc::channel::<Frame>();
            let writer = std::thread::spawn(move || -> Result<(), String> {
                #[cfg(windows)]
                sink.connect().map_err(|e| format!("ffmpeg did not open the frame pipe: {e}"))?;
                for frame in rx {
                    frame.write_to(&mut sink).map_err(|e| format!("lane {lane}: ffmpeg stopped taking frames: {e}"))?;
                }
                Ok(())
            });
            let out = gop_tx.clone();
            let reader = std::thread::spawn(move || split_gops(stdout, codec, gop, lane, out));
            lanes.push(Lane {
                child,
                tx: Some(tx),
                writer: Some(writer),
                reader: Some(reader),
            });
        }
        drop(gop_tx);

        // The muxer: GOPs in global order into one ffmpeg that copies them into the MP4.
        let mut mux = Command::new(&s.ffmpeg)
            .args(["-hide_banner", "-loglevel", "error", "-y", "-f", elementary, "-framerate", &rate, "-i", "-", "-c", "copy"])
            // Exact frame times: the raw stream's own drift by a tick, which pairs the wrong frames in a comparison.
            .args(["-bsf:v".to_string(), format!("setts=time_base=1000/{}:pts=N:dts=N", s.fps_milli), "-video_track_timescale".into(), s.fps_milli.to_string()])
            .args(["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv", "-movflags", "+faststart"])
            .arg(&s.out)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| format!("could not start the muxing ffmpeg: {e}"))?;
        let mut mux_in = mux.stdin.take().unwrap();
        let n = count as u64;
        let muxer = std::thread::spawn(move || -> Result<(), String> {
            let mut waiting: BTreeMap<u64, Vec<u8>> = BTreeMap::new();
            let mut next = 0u64;
            for (lane, local, bytes) in gop_rx {
                waiting.insert(local * n + lane as u64, bytes);
                while let Some(b) = waiting.remove(&next) {
                    mux_in.write_all(&b).map_err(|e| format!("muxer: {e}"))?;
                    next += 1;
                }
            }
            if !waiting.is_empty() {
                return Err(format!("muxer: GOP {next} never arrived ({} after it waiting)", waiting.len()));
            }
            Ok(())
        });
        Ok(Lanes { lanes, gop, frame: 0, mux: Some((mux, muxer)) })
    }

    pub fn push(&mut self, frame: Frame) -> Result<(), String> {
        let lane = ((self.frame / self.gop) % self.lanes.len() as u64) as usize;
        self.frame += 1;
        self.lanes[lane].tx.as_ref().unwrap().send(frame).map_err(|_| format!("lane {lane}'s writer stopped"))
    }

    pub fn finish(mut self) -> Result<(), String> {
        let mut first_err: Option<String> = None;
        let mut note = |r: Result<(), String>| {
            if let Err(e) = r {
                first_err.get_or_insert(e);
            }
        };
        for lane in &mut self.lanes {
            drop(lane.tx.take());
        }
        for lane in &mut self.lanes {
            note(lane.writer.take().unwrap().join().unwrap_or(Err("writer panicked".into())));
            let status = lane.child.wait().map_err(|e| e.to_string());
            note(status.and_then(|s| if s.success() { Ok(()) } else { Err(format!("an encoder lane's ffmpeg exited with {s}")) }));
            note(lane.reader.take().unwrap().join().unwrap_or(Err("reader panicked".into())));
        }
        let (mut mux, muxer) = self.mux.take().unwrap();
        note(muxer.join().unwrap_or(Err("muxer panicked".into())));
        let status = mux.wait().map_err(|e| e.to_string());
        note(status.and_then(|s| if s.success() { Ok(()) } else { Err(format!("the muxing ffmpeg exited with {s}")) }));
        match first_err {
            Some(e) => Err(e),
            None => Ok(()),
        }
    }
}

