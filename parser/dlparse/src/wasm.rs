//! Plain C-ABI exports for the browser build (wasm32-unknown-unknown, no wasm-bindgen).
//!
//! JS side (web/js/parse-worker.js):
//!   ptr = dl_alloc(len); copy the demo bytes to memory[ptr..ptr+len]
//!   status = dl_parse(ptr, len, match_id)   // takes ownership of the buffer; 0 = ok
//!   json / error text = memory[dl_result_ptr() .. + dl_result_len()]
//! The module imports `env.progress(game_seconds)` for a progress bar.
use std::cell::RefCell;
use std::io::Cursor;

use crate::{DEFAULT_NOISY_ABILITIES, FORMAT_VERSION, parse_demo};

#[link(wasm_import_module = "env")]
unsafe extern "C" {
    fn progress(t: f32);
}

thread_local! {
    static RESULT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

#[unsafe(no_mangle)]
pub extern "C" fn dl_version() -> u32 {
    FORMAT_VERSION
}

#[unsafe(no_mangle)]
pub extern "C" fn dl_alloc(len: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len);
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// # Safety
/// `ptr` must come from `dl_alloc(len)` and hold `len` initialized bytes; it is freed here.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn dl_parse(ptr: *mut u8, len: usize, match_id: f64) -> i32 {
    let mut data = unsafe { Vec::from_raw_parts(ptr, len, len) };
    // .dem.bz2 straight from Valve's replay servers
    if data.starts_with(b"BZh") {
        let mut out = Vec::with_capacity(len * 4);
        let res = std::io::Read::read_to_end(&mut bzip2_rs::DecoderReader::new(&data[..]), &mut out);
        drop(data);
        if let Err(e) = res {
            RESULT.with(|r| *r.borrow_mut() = format!("bzip2: {e}").into_bytes());
            return 1;
        }
        data = out;
    } else if data.starts_with(&[0x28, 0xb5, 0x2f, 0xfd]) {
        // newer replays: zstd, still named .dem.bz2
        let mut out = Vec::with_capacity(len * 3);
        let res = ruzstd::decoding::StreamingDecoder::new(&data[..])
            .map_err(|e| e.to_string())
            .and_then(|mut d| std::io::Read::read_to_end(&mut d, &mut out).map_err(|e| e.to_string()));
        drop(data);
        if let Err(e) = res {
            RESULT.with(|r| *r.borrow_mut() = format!("zstd: {e}").into_bytes());
            return 1;
        }
        data = out;
    }
    let cb: Box<dyn FnMut(f32)> = Box::new(|t| unsafe { progress(t) });
    let res = parse_demo(Cursor::new(&data[..]), match_id as u64, DEFAULT_NOISY_ABILITIES.to_vec(), Some(cb));
    drop(data);
    let (status, bytes) = match res.and_then(|o| Ok(serde_json::to_vec(&o)?)) {
        Ok(json) => (0, json),
        Err(e) => (1, format!("{e:#}").into_bytes()),
    };
    RESULT.with(|r| *r.borrow_mut() = bytes);
    status
}

#[unsafe(no_mangle)]
pub extern "C" fn dl_result_ptr() -> *const u8 {
    RESULT.with(|r| r.borrow().as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn dl_result_len() -> usize {
    RESULT.with(|r| r.borrow().len())
}

/// frees the result buffer once JS has copied it
#[unsafe(no_mangle)]
pub extern "C" fn dl_result_free() {
    RESULT.with(|r| *r.borrow_mut() = Vec::new());
}
