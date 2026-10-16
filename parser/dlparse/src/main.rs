//! dlparse CLI: turns a Deadlock .dem into the JSON event log the website reads.
//!
//! usage: dlparse <demo.dem> <out.json> [match_id] [--ignore-ids a,b,...]
//!        dlparse --version
use std::fs::File;
use std::io::{BufReader, BufWriter};

use dlparse::{DEFAULT_NOISY_ABILITIES, FORMAT_VERSION, parse_demo, summary, warnings};

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("--version") {
        println!("{FORMAT_VERSION}");
        return Ok(());
    }
    if args.len() < 3 {
        anyhow::bail!("usage: dlparse <demo.dem> <out.json> [match_id]");
    }
    let match_id = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(0);
    let noisy = args
        .iter()
        .position(|a| a == "--ignore-ids")
        .and_then(|i| args.get(i + 1))
        .map(|s| s.split(',').filter_map(|x| x.trim().parse().ok()).collect())
        .unwrap_or_else(|| DEFAULT_NOISY_ABILITIES.to_vec());

    let out = parse_demo(BufReader::new(File::open(&args[1])?), match_id, noisy, None)?;
    for w in warnings(&out) {
        eprintln!("warning: {w}");
    }
    serde_json::to_writer(BufWriter::new(File::create(&args[2])?), &out)?;
    eprintln!("ok: {}", summary(&out));
    Ok(())
}
