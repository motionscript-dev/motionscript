//! `ms-export`: the native export sidecar (see `../DESIGN.md`).
//!
//!   ms-export info [--ffmpeg PATH]
//!       One JSON line: protocol version, built-in effect names (in the
//!       renderer's index order), the GPU adapter, and which encoders open.
//!   ms-export encode --out FILE.mp4 [--input FILE|-] [--ffmpeg PATH]
//!       [--encoder auto|nvenc|software|<ffmpeg encoder>] [--preset P]
//!       [--no-encode] [--tee FILE]
//!       Replays an export stream (stdin by default) and writes the MP4.
//!       Reports JSON lines on stdout: start, progress, done or error.

mod convert;
mod encode;
mod lanes;
mod readback;
mod stream;
#[cfg(windows)]
mod winpipe;

use std::fs::File;
use std::io::{self, BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

use ms_renderer::native::NativeRenderer;
use stream::op;

fn arg(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1).cloned())
}

fn json_str(s: &str) -> String {
    let mut o = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            c if (c as u32) < 0x20 => o.push_str(&format!("\\u{:04x}", c as u32)),
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

fn emit(line: String) {
    let mut out = io::stdout().lock();
    let _ = writeln!(out, "{line}");
    let _ = out.flush();
}

fn default_ffmpeg() -> PathBuf {
    // Beside the sidecar first (how a host bundles it), else PATH.
    if let Ok(exe) = std::env::current_exe() {
        let name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
        let local = exe.with_file_name(name);
        if local.exists() {
            return local;
        }
    }
    PathBuf::from("ffmpeg")
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let ffmpeg = arg(&args, "--ffmpeg").map(PathBuf::from).unwrap_or_else(default_ffmpeg);
    let result = match args.first().map(String::as_str) {
        Some("info") => info(&ffmpeg),
        Some("encode") => encode(&args, &ffmpeg),
        _ => Err("usage: ms-export info | ms-export encode --out FILE.mp4 [--input FILE|-]".into()),
    };
    ms_renderer::native::release_device();
    if let Err(e) = result {
        emit(format!("{{\"event\":\"error\",\"message\":{}}}", json_str(&e)));
        std::process::exit(1);
    }
}

fn info(ffmpeg: &Path) -> Result<(), String> {
    let t0 = Instant::now();
    let r = pollster::block_on(NativeRenderer::new(16, 16))?;
    let adapter = r.adapter_info().to_string();
    drop(r);
    let device_ms = t0.elapsed().as_secs_f64() * 1000.0;
    let effects: Vec<String> = NativeRenderer::effect_names().iter().map(|n| json_str(n)).collect();
    let encoders: Vec<String> = ["h264_nvenc", "hevc_nvenc", "av1_nvenc", "libx264", "libx265"]
        .iter()
        .map(|e| format!("{}:{}", json_str(e), encode::encoder_works(ffmpeg, e)))
        .collect();
    emit(format!(
        "{{\"event\":\"info\",\"protocol\":{},\"adapter\":{},\"deviceMs\":{device_ms:.1},\"effects\":[{}],\"encoders\":{{{}}}}}",
        stream::VERSION,
        json_str(&adapter),
        effects.join(","),
        encoders.join(",")
    ));
    Ok(())
}

/// Tees everything read into a file, for replaying a live export later.
struct Tee<R: Read> {
    inner: R,
    copy: Option<BufWriter<File>>,
}

impl<R: Read> Read for Tee<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let n = self.inner.read(buf)?;
        if let Some(c) = &mut self.copy {
            c.write_all(&buf[..n])?;
        }
        Ok(n)
    }
}

enum Sink {
    One(encode::Encoder),
    Lanes(lanes::Lanes),
    Discard(encode::Discard),
}

impl Sink {
    fn push(&mut self, frame: readback::Frame) -> Result<(), String> {
        match self {
            Sink::One(e) => e.push(frame),
            Sink::Lanes(l) => l.push(frame),
            Sink::Discard(d) => d.push(frame),
        }
    }
    fn finish(self) -> Result<(), String> {
        match self {
            Sink::One(e) => e.finish(),
            Sink::Lanes(l) => l.finish(),
            Sink::Discard(d) => d.finish(),
        }
    }
}

struct Output {
    convert: convert::Nv12,
    _target: wgpu::Texture,
    target_view: wgpu::TextureView,
    slots: readback::Slots,
    sink: Sink,
    frames: u32,
}

/// Frames converted and waiting for a pipe, by memory: enough to keep two
/// encoder lanes busy through a GOP each at 1080p.
const SLOT_BYTES: u64 = 192 << 20;

fn render_target(device: &wgpu::Device, w: u32, h: u32) -> (wgpu::Texture, wgpu::TextureView) {
    let tex = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("export-target"),
        size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
        view_formats: &[],
    });
    let view = tex.create_view(&Default::default());
    (tex, view)
}

fn encode(args: &[String], ffmpeg: &Path) -> Result<(), String> {
    let out_path = PathBuf::from(arg(args, "--out").ok_or("--out is required")?);
    let input = arg(args, "--input").unwrap_or_else(|| "-".into());
    let no_encode = args.iter().any(|a| a == "--no-encode");
    let preset = arg(args, "--preset");
    let lane_count: usize = arg(args, "--lanes").and_then(|n| n.parse().ok()).unwrap_or(1).max(1);
    let choice = arg(args, "--encoder").unwrap_or_else(|| "auto".into());
    let raw: Box<dyn Read> = if input == "-" { Box::new(io::stdin().lock()) } else { Box::new(File::open(&input).map_err(|e| format!("{input}: {e}"))?) };
    let tee = match arg(args, "--tee") {
        Some(p) => Some(BufWriter::new(File::create(&p).map_err(|e| format!("{p}: {e}"))?)),
        None => None,
    };
    // The device and the RGBA8 pipelines, before the stream starts: a host
    // spawns the sidecar when an export is asked for, so this overlaps the
    // page building the first frame.
    let t_prewarm = Instant::now();
    drop(pollster::block_on(NativeRenderer::new(4, 4))?);
    let prewarm_ms = t_prewarm.elapsed().as_secs_f64() * 1000.0;
    let mut reader = stream::Reader::new(BufReader::with_capacity(1 << 20, Tee { inner: raw, copy: tee }))?;

    let t_start = Instant::now();
    let mut renderer: Option<NativeRenderer> = None;
    let mut output: Option<Output> = None;
    let mut audio: Option<(u32, u32, Vec<u8>)> = None;
    let mut encoder_name = String::new();
    let mut total_frames = 0u32;
    let (mut t_apply, mut t_render, mut t_upload, mut t_push) = (0f64, 0f64, 0f64, 0f64);
    let mut t_first_frame: Option<Instant> = None;
    let video_path = out_path.with_extension("video.mp4");

    while let Some(rec) = reader.next()? {
        let need_r = || "a renderer call came before CREATE".to_string();
        match rec.op {
            op::BEGIN | op::FRAME | op::END | op::AUDIO => {}
            _ if rec.op != op::CREATE && renderer.is_none() => return Err(need_r()),
            _ => {}
        }
        match rec.op {
            op::CREATE => {
                rec.need(2)?;
                renderer = Some(pollster::block_on(NativeRenderer::new(rec.u32(0), rec.u32(1)))?);
            }
            op::BEGIN => {
                rec.need(7)?;
                let r = renderer.as_ref().ok_or_else(need_r)?;
                let (out_w, out_h, fps_milli, frames, bitrate, codec) = (rec.u32(0), rec.u32(1), rec.u32(2), rec.u32(3), rec.u32(4), rec.u32(5));
                total_frames = frames;
                let (rw, _) = r.size();
                let ss = (rw / out_w).max(1);
                let (target, target_view) = render_target(r.device(), out_w * ss, out_h * ss);
                let convert = convert::Nv12::new(r.device(), &target_view, out_w, out_h, ss);
                let slots = readback::Slots::new(r.device(), convert.frame_bytes, (SLOT_BYTES / convert.frame_bytes).clamp(4, 64) as usize);
                let codec = encode::Codec::from_index(codec);
                encoder_name = match choice.as_str() {
                    "auto" => {
                        if encode::encoder_works(ffmpeg, codec.nvenc()) { codec.nvenc().into() } else { codec.software().into() }
                    }
                    "nvenc" => codec.nvenc().into(),
                    "software" => codec.software().into(),
                    other => other.into(),
                };
                let settings = encode::Settings {
                        ffmpeg: ffmpeg.to_path_buf(),
                        encoder: encoder_name.clone(),
                        width: out_w,
                        height: out_h,
                        fps_milli,
                        bitrate,
                        preset: preset.clone(),
                        out: video_path.clone(),
                    };
                let lanes = if encoder_name.contains("nvenc") && codec != encode::Codec::Av1 { lane_count } else { 1 };
                let sink = if no_encode {
                    Sink::Discard(encode::Discard::start())
                } else if lanes > 1 {
                    Sink::Lanes(lanes::Lanes::start(&settings, codec, lanes)?)
                } else {
                    Sink::One(encode::Encoder::start(&settings)?)
                };
                emit(format!(
                    "{{\"event\":\"start\",\"adapter\":{},\"encoder\":{},\"width\":{out_w},\"height\":{out_h},\"supersample\":{ss},\"lanes\":{lanes},\"frames\":{frames}}}",
                    json_str(r.adapter_info()),
                    json_str(&encoder_name)
                ));
                output = Some(Output { convert, _target: target, target_view, slots, sink, frames: 0 });
            }
            op::APPLY => {
                let r = renderer.as_mut().unwrap();
                let t0 = Instant::now();
                r.apply(&rec.words(0))?;
                t_apply += t0.elapsed().as_secs_f64() * 1000.0;
            }
            op::FONT => {
                rec.need(1)?;
                let n = rec.u32(0) as usize;
                let family = std::str::from_utf8(&rec.data[4..4 + n]).map_err(|e| e.to_string())?.to_string();
                let at = 4 + n.div_ceil(4) * 4;
                renderer.as_mut().unwrap().register_font(&rec.data[at..], &family);
            }
            op::IMAGE => {
                rec.need(4)?;
                let t0 = Instant::now();
                let (id, w, h, flags) = (rec.u32(0), rec.u32(1), rec.u32(2), rec.u32(3));
                let mut px = rec.bytes(4).to_vec();
                if flags & 2 == 0 {
                    premultiply(&mut px);
                }
                renderer.as_mut().unwrap().upload_rgba(id, w, h, &px, flags & 1 != 0)?;
                t_upload += t0.elapsed().as_secs_f64() * 1000.0;
            }
            op::SURFACE => {
                rec.need(4)?;
                renderer.as_mut().unwrap().set_surface(rec.u32(0), rec.u32(1), rec.u32(2), rec.u32(3));
            }
            op::SCENE3D => {
                rec.need(3)?;
                renderer.as_mut().unwrap().set_scene3d(rec.u32(0), rec.u32(1), rec.u32(2), &rec.words(3))?;
            }
            op::SCENE3D_BIND => {
                rec.need(4)?;
                renderer.as_mut().unwrap().scene3d_bind(rec.u32(0), rec.u32(1), rec.u32(2), rec.u32(3) != 0);
            }
            op::SCENE3D_PIXELS => {
                rec.need(5)?;
                renderer.as_mut().unwrap().scene3d_pixels(rec.u32(0), rec.u32(1), rec.bytes(5), rec.u32(2), rec.u32(3), rec.u32(4) != 0);
            }
            op::FREE_IMAGE => {
                rec.need(1)?;
                renderer.as_mut().unwrap().free_image(rec.u32(0));
            }
            op::SHADER_ADD => {
                rec.need(2)?;
                let source = std::str::from_utf8(rec.bytes(2)).map_err(|e| e.to_string())?;
                renderer.as_mut().unwrap().shader_add(rec.u32(0), rec.u32(1), source);
            }
            op::SHADER_BUILD => {
                rec.need(1)?;
                renderer.as_mut().unwrap().shader_build(rec.u32(0));
            }
            op::SHADER_REMOVE => {
                rec.need(1)?;
                renderer.as_mut().unwrap().shader_remove(rec.u32(0));
            }
            op::OPTIONS => {
                rec.need(2)?;
                renderer.as_mut().unwrap().set_options(rec.u32(0) != 0, rec.u32(1) != 0);
            }
            op::RESIZE => {
                rec.need(2)?;
                renderer.as_mut().unwrap().resize(rec.u32(0), rec.u32(1));
            }
            op::INVALIDATE => renderer.as_mut().unwrap().invalidate(),
            op::FRAME => {
                let r = renderer.as_mut().ok_or_else(need_r)?;
                let o = output.as_mut().ok_or("FRAME before BEGIN")?;
                t_first_frame.get_or_insert_with(Instant::now);
                let tw = Instant::now();
                let slot = o.slots.take()?;
                t_push += tw.elapsed().as_secs_f64() * 1000.0;
                let t0 = Instant::now();
                r.render_into(&o.target_view, None);
                let mut enc = r.device().create_command_encoder(&Default::default());
                o.convert.record(&mut enc, o.slots.buffer(slot));
                let submission = r.queue().submit([enc.finish()]);
                let frame = o.slots.map(r.device(), slot, submission);
                let _ = r.device().poll(wgpu::PollType::Poll);
                t_render += t0.elapsed().as_secs_f64() * 1000.0;
                o.sink.push(frame)?;
                o.frames += 1;
                if o.frames % 60 == 0 {
                    emit(format!("{{\"event\":\"progress\",\"frame\":{},\"frames\":{total_frames}}}", o.frames));
                }
            }
            op::AUDIO => {
                rec.need(2)?;
                audio = Some((rec.u32(0), rec.u32(1), rec.bytes(2).to_vec()));
            }
            op::END => break,
            other => return Err(format!("unknown record {other}")),
        }
    }

    let r = renderer.ok_or("the stream created no renderer")?;
    let o = output.ok_or("the stream began no export")?;
    let frames = o.frames;
    let t_frames_end = Instant::now();
    o.sink.finish()?;
    let t_encoded = Instant::now();
    if !no_encode && encoder_name != "null" {
        match &audio {
            Some((rate, channels, pcm)) if !pcm.is_empty() => {
                let wav = out_path.with_extension("audio.wav");
                encode::write_wav(&wav, *rate, *channels, pcm)?;
                encode::mux_audio(ffmpeg, &video_path, &wav, &out_path)?;
                let _ = std::fs::remove_file(&wav);
                let _ = std::fs::remove_file(&video_path);
            }
            _ => std::fs::rename(&video_path, &out_path).map_err(|e| format!("{}: {e}", out_path.display()))?,
        }
    }
    let total = t_start.elapsed().as_secs_f64();
    let frame_span = t_first_frame.map_or(0.0, |t| t_frames_end.duration_since(t).as_secs_f64());
    let encode_tail = t_encoded.duration_since(t_frames_end).as_secs_f64();
    let adapter = r.adapter_info().to_string();
    drop(r);
    let _ = adapter;
    emit(format!(
        "{{\"event\":\"done\",\"out\":{},\"encoder\":{},\"frames\":{frames},\"seconds\":{total:.3},\"frameSeconds\":{frame_span:.3},\"encodeTailSeconds\":{encode_tail:.3},\"fps\":{:.1},\"applyMs\":{t_apply:.1},\"renderMs\":{t_render:.1},\"encoderWaitMs\":{t_push:.1},\"writerWaitMs\":{:.1},\"writerWriteMs\":{:.1},\"imageUploadMs\":{t_upload:.1},\"streamBytes\":{},\"prewarmMs\":{prewarm_ms:.1}}}",
        json_str(&out_path.to_string_lossy()),
        json_str(&encoder_name),
        frames as f64 / total.max(1e-9),
        readback::WAIT_NS.load(std::sync::atomic::Ordering::Relaxed) as f64 / 1e6,
        readback::WRITE_NS.load(std::sync::atomic::Ordering::Relaxed) as f64 / 1e6,
        reader.bytes_read
    ));
    Ok(())
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

