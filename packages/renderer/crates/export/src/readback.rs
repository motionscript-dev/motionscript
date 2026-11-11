//! Readback slots: NV12 frames land in mapped buffers that an encoder's writer
//! thread writes straight into ffmpeg's pipe, then frees. Copying a frame out
//! on the render loop first cost ~1-1.5 ms per 1080p frame, more than the
//! render; here the loop only renders, converts and maps.

use std::io::{self, Write};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;

pub struct Slots {
    buffers: Vec<wgpu::Buffer>,
    free_tx: mpsc::Sender<usize>,
    free_rx: mpsc::Receiver<usize>,
}

/// One converted frame on its way to a pipe.
pub struct Frame {
    slot: usize,
    buffer: wgpu::Buffer,
    ready: Arc<AtomicBool>,
    device: wgpu::Device,
    /// The submission that wrote it: a writer waits for that one, not the GPU's latest.
    submission: wgpu::SubmissionIndex,
    free: mpsc::Sender<usize>,
}

impl Slots {
    pub fn new(device: &wgpu::Device, frame_bytes: u64, count: usize) -> Slots {
        let (free_tx, free_rx) = mpsc::channel();
        let buffers = (0..count)
            .map(|i| {
                let _ = free_tx.send(i);
                device.create_buffer(&wgpu::BufferDescriptor {
                    label: Some("nv12-readback"),
                    size: frame_bytes,
                    usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
                    mapped_at_creation: false,
                })
            })
            .collect();
        Slots { buffers, free_tx, free_rx }
    }

    /// A free slot, waiting for a writer to free one if all are in flight
    /// (the encoders' backpressure).
    pub fn take(&self) -> Result<usize, String> {
        self.free_rx.recv().map_err(|_| "readback slots closed".to_string())
    }

    pub fn buffer(&self, slot: usize) -> &wgpu::Buffer {
        &self.buffers[slot]
    }

    /// Maps `slot` (its copy was submitted) and returns it as a frame for a writer.
    pub fn map(&self, device: &wgpu::Device, slot: usize, submission: wgpu::SubmissionIndex) -> Frame {
        let ready = Arc::new(AtomicBool::new(false));
        let flag = ready.clone();
        let buffer = self.buffers[slot].clone();
        buffer.slice(..).map_async(wgpu::MapMode::Read, move |r| {
            if r.is_ok() {
                flag.store(true, Ordering::Release);
            }
        });
        Frame { slot, buffer, ready, device: device.clone(), submission, free: self.free_tx.clone() }
    }
}

impl Frame {
    /// Waits for the GPU, writes the frame's bytes to `w`, frees the slot.
    pub fn write_to(self, w: &mut impl Write) -> io::Result<()> {
        let t0 = std::time::Instant::now();
        while !self.ready.load(Ordering::Acquire) {
            self.device
                .poll(wgpu::PollType::Wait { submission_index: Some(self.submission.clone()), timeout: None }).map_err(|e| io::Error::other(format!("poll: {e}")))?;
        }
        let t1 = std::time::Instant::now();
        {
            let data = self.buffer.slice(..).get_mapped_range().map_err(|e| io::Error::other(format!("map: {e:?}")))?;
            w.write_all(&data)?;
        }
        let t2 = std::time::Instant::now();
        self.buffer.unmap();
        WAIT_NS.fetch_add(t1.duration_since(t0).as_nanos() as u64, Ordering::Relaxed);
        WRITE_NS.fetch_add(t2.duration_since(t1).as_nanos() as u64, Ordering::Relaxed);
        let _ = self.free.send(self.slot);
        Ok(())
    }
}

/// Summed over every writer: waiting for the GPU, and writing into the pipe (`done` reports both).
pub static WAIT_NS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
pub static WRITE_NS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
