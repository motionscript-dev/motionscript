//! A named pipe with a large buffer, for frames into ffmpeg on Windows. An
//! inherited anonymous pipe (what `Stdio::piped` makes) moved raw 1080p NV12
//! at about 1 GB/s, ~340 fps, below what NVENC encodes.

use std::io;
use std::ptr::null;

use windows_sys::Win32::Foundation::{CloseHandle, ERROR_PIPE_CONNECTED, GENERIC_READ, GetLastError, HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::Storage::FileSystem::{CreateFileW, FILE_FLAG_FIRST_PIPE_INSTANCE, OPEN_EXISTING, PIPE_ACCESS_OUTBOUND, WriteFile};
use windows_sys::Win32::System::Pipes::{ConnectNamedPipe, CreateNamedPipeW, PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_BYTE, PIPE_WAIT};

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

pub struct Pipe {
    handle: HANDLE,
    pub name: String,
}

unsafe impl Send for Pipe {}

impl Pipe {
    pub fn create(buffer: u32) -> io::Result<Pipe> {
        static N: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let name = format!(r"\\.\pipe\ms-export-{}-{}", std::process::id(), N.fetch_add(1, std::sync::atomic::Ordering::Relaxed));
        let w = wide(&name);
        let handle = unsafe {
            CreateNamedPipeW(
                w.as_ptr(),
                PIPE_ACCESS_OUTBOUND | FILE_FLAG_FIRST_PIPE_INSTANCE,
                PIPE_TYPE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
                1,
                buffer,
                0,
                0,
                null(),
            )
        };
        if handle == INVALID_HANDLE_VALUE {
            return Err(io::Error::last_os_error());
        }
        Ok(Pipe { handle, name })
    }

    /// Blocks until the reader opens the pipe.
    pub fn connect(&self) -> io::Result<()> {
        let ok = unsafe { ConnectNamedPipe(self.handle, std::ptr::null_mut()) };
        if ok == 0 && unsafe { GetLastError() } != ERROR_PIPE_CONNECTED {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }

    /// Opens the pipe as its own reader, so a `connect` waiting on a reader
    /// that died before opening it returns.
    pub fn unblock(name: &str) {
        let w = wide(name);
        let h = unsafe { CreateFileW(w.as_ptr(), GENERIC_READ, 0, null(), OPEN_EXISTING, 0, std::ptr::null_mut()) };
        if h != INVALID_HANDLE_VALUE {
            unsafe { CloseHandle(h) };
        }
    }
}

impl io::Write for Pipe {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let mut n = 0u32;
        let len = buf.len().min(u32::MAX as usize) as u32;
        let ok = unsafe { WriteFile(self.handle, buf.as_ptr(), len, &mut n, std::ptr::null_mut()) };
        if ok == 0 { Err(io::Error::last_os_error()) } else { Ok(n as usize) }
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl Drop for Pipe {
    fn drop(&mut self) {
        unsafe { CloseHandle(self.handle) };
    }
}
