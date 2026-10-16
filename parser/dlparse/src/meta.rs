//! dlmeta: Valve match metadata (`<match>_<salt>.meta.bz2` from replayNNN.valve.net) → JSON.
//!
//! usage: dlmeta <file.meta(.bz2)> <out.json>
//!
//! The file is a zstd frame (current matches; older ones are bzip2 and must be decompressed by
//! the caller) holding CMsgMatchMetaData, whose `match_details` bytes are
//! CMsgMatchMetaDataContents. Output mirrors the protobuf field names: {"match_info": {...}}.
use std::fs;
use std::io::Read;

use prost::Message;
use valveprotos::deadlock::{CMsgMatchMetaData, CMsgMatchMetaDataContents};

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        anyhow::bail!("usage: dlmeta <file.meta> <out.json>");
    }
    let raw = fs::read(&args[1])?;
    let data = if raw.starts_with(&[0x28, 0xb5, 0x2f, 0xfd]) {
        let mut out = Vec::new();
        ruzstd::streaming_decoder::StreamingDecoder::new(raw.as_slice())?.read_to_end(&mut out)?;
        out
    } else if raw.starts_with(b"BZh") {
        anyhow::bail!("bzip2 metadata: decompress first");
    } else {
        raw
    };
    let meta = CMsgMatchMetaData::decode(data.as_slice())?;
    let contents = CMsgMatchMetaDataContents::decode(meta.match_details())?;
    fs::write(&args[2], serde_json::to_vec(&contents)?)?;
    eprintln!("ok: match {}", meta.match_id());
    Ok(())
}
