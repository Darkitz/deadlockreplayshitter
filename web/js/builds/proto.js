// Minimal protobuf codec for CMsgHeroBuild (from Build Shitter) (citadel_gcmessages_common.proto).
// Schema source: https://github.com/SteamDatabase/GameTracking-Deadlock/blob/master/Protobufs/citadel_gcmessages_common.proto
// Fields are only written when present in the JS object, so decode -> encode round-trips byte-for-byte.
// Unknown fields are kept in `_unknown` and written back verbatim.

const SCHEMA = {
  CMsgHeroBuild: {
    1: ["hero_build_id", "uint32"],
    2: ["hero_id", "uint32"],
    3: ["author_account_id", "uint32"],
    4: ["last_updated_timestamp", "uint32"],
    5: ["name", "string"],
    6: ["description", "string"],
    7: ["language", "uint32"],
    8: ["version", "uint32"],
    9: ["origin_build_id", "uint32"],
    10: ["details", "Details_V0"],
    11: ["tags", "uint32", true],
    12: ["development_build", "bool"],
    13: ["publish_timestamp", "uint32"],
  },
  Details_V0: {
    1: ["mod_categories", "BuildModCategory", true],
    2: ["ability_order", "AbilityOrder"],
  },
  BuildModCategory: {
    1: ["mods", "BuildModEntry", true],
    2: ["name", "string"],
    3: ["description", "string"],
    4: ["width", "float"],
    5: ["height", "float"],
    6: ["optional", "bool"],
  },
  BuildModEntry: {
    1: ["ability_id", "uint32"],
    2: ["annotation", "string"],
    3: ["required_flex_slots", "uint32"],
    4: ["sell_priority", "uint32"],
    5: ["imbue_target_ability_id", "uint32"],
  },
  AbilityOrder: {
    1: ["currency_changes", "CurrencyChange", true],
  },
  CurrencyChange: {
    1: ["ability_id", "uint32"],
    2: ["currency_type", "int32"],
    3: ["delta", "int32"],
    4: ["annotation", "string"],
  },
};

const VARINT = new Set(["uint32", "int32", "bool"]);
const wireOf = (t) => (VARINT.has(t) ? 0 : t === "float" ? 5 : 2);
const utf8enc = new TextEncoder();
const utf8dec = new TextDecoder();

// ---------- decode ----------

function readVarint(buf, pos) {
  let result = 0n;
  let shift = 0n;
  for (;;) {
    if (pos >= buf.length) throw new Error("Truncated varint");
    const b = buf[pos++];
    result |= BigInt(b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7n;
  }
  return [result, pos];
}

function decodeMessage(buf, type, lenient = false) {
  const schema = SCHEMA[type];
  const out = {};
  let pos = 0;
  while (pos < buf.length) {
    if (lenient) {
      // cut-off input: keep every field that was complete, drop the partial one
      try {
        const next = {};
        const end = skipField(buf, pos);
        Object.assign(next, decodeMessage(buf.subarray(pos, end), type));
        for (const [k, v] of Object.entries(next)) out[k] = Array.isArray(v) && Array.isArray(out[k]) ? [...out[k], ...v] : v;
        pos = end;
        continue;
      } catch {
        break;
      }
    }
    const start = pos;
    let key;
    [key, pos] = readVarint(buf, pos);
    const field = Number(key >> 3n);
    const wire = Number(key & 7n);

    let raw, value;
    if (wire === 0) [raw, pos] = readVarint(buf, pos);
    else if (wire === 5) { raw = buf.subarray(pos, pos + 4); pos += 4; }
    else if (wire === 1) { raw = buf.subarray(pos, pos + 8); pos += 8; }
    else if (wire === 2) {
      let len;
      [len, pos] = readVarint(buf, pos);
      raw = buf.subarray(pos, pos + Number(len));
      pos += Number(len);
    } else throw new Error(`Unsupported wire type ${wire}`);
    if (pos > buf.length) throw new Error("Truncated message");

    const def = schema[field];
    if (!def || (wireOf(def[1]) !== wire && !(def[2] && wire === 2 && VARINT.has(def[1])))) {
      (out._unknown ??= []).push(btoa(String.fromCharCode(...buf.subarray(start, pos))));
      continue;
    }
    const [name, ftype, repeated] = def;

    // packed repeated scalars
    if (repeated && VARINT.has(ftype) && wire === 2) {
      let p = 0;
      while (p < raw.length) {
        let v;
        [v, p] = readVarint(raw, p);
        (out[name] ??= []).push(scalar(v, ftype));
      }
      continue;
    }

    if (wire === 0) value = scalar(raw, ftype);
    else if (ftype === "float") value = new DataView(raw.buffer, raw.byteOffset, 4).getFloat32(0, true);
    else if (ftype === "string") value = utf8dec.decode(raw);
    else value = decodeMessage(raw, ftype);

    if (repeated) (out[name] ??= []).push(value);
    else out[name] = value;
  }
  return out;
}

/** end offset of the field starting at `pos` (throws when it runs past the buffer) */
function skipField(buf, pos) {
  let key, len;
  [key, pos] = readVarint(buf, pos);
  const wire = Number(key & 7n);
  if (wire === 0) [, pos] = readVarint(buf, pos);
  else if (wire === 5) pos += 4;
  else if (wire === 1) pos += 8;
  else if (wire === 2) { [len, pos] = readVarint(buf, pos); pos += Number(len); }
  else throw new Error(`Unsupported wire type ${wire}`);
  if (pos > buf.length) throw new Error("Truncated message");
  return pos;
}

function scalar(v, t) {
  if (t === "bool") return v !== 0n;
  if (t === "int32") return Number(BigInt.asIntN(32, v));
  return Number(BigInt.asUintN(32, v));
}

// ---------- encode ----------

function writeVarint(bytes, v) {
  let n = BigInt.asUintN(64, BigInt(v));
  do {
    let b = Number(n & 0x7fn);
    n >>= 7n;
    if (n) b |= 0x80;
    bytes.push(b);
  } while (n);
}

function encodeMessage(obj, type) {
  const schema = SCHEMA[type];
  const bytes = [];
  const fields = Object.keys(schema).map(Number).sort((a, b) => a - b);
  for (const field of fields) {
    const [name, ftype, repeated] = schema[field];
    const v = obj[name];
    if (v === undefined || v === null) continue;
    for (const item of repeated ? v : [v]) {
      writeVarint(bytes, (field << 3) | wireOf(ftype));
      if (ftype === "bool") writeVarint(bytes, item ? 1 : 0);
      else if (ftype === "int32") writeVarint(bytes, BigInt(item | 0));
      else if (ftype === "uint32") writeVarint(bytes, item >>> 0);
      else if (ftype === "float") {
        const f = new Uint8Array(4);
        new DataView(f.buffer).setFloat32(0, item, true);
        bytes.push(...f);
      } else {
        const sub = ftype === "string" ? utf8enc.encode(item) : encodeMessage(item, ftype);
        writeVarint(bytes, sub.length);
        for (const b of sub) bytes.push(b);
      }
    }
  }
  for (const u of obj._unknown ?? []) {
    for (const c of atob(u)) bytes.push(c.charCodeAt(0));
  }
  return Uint8Array.from(bytes);
}

export const decodeHeroBuild = (bytes) => decodeMessage(bytes, "CMsgHeroBuild");
/** demos carry the selected build cut off at its first zero byte (the game networks it as a C
 *  string): decode the fields that made it, usually id, hero, author, time and name */
export const decodeHeroBuildPrefix = (bytes) => decodeMessage(bytes, "CMsgHeroBuild", true);
export const encodeHeroBuild = (obj) => encodeMessage(obj, "CMsgHeroBuild");
