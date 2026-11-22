// A fast drop-in for csv-reader 1.0.0: the same answers, read the fast way.
//
// The rules it must match, in short: a U+FEFF at the very start is dropped;
// a record ends at LF or CRLF and a line left with no characters is no
// record; a CR outside quotes that is not followed by LF is dropped (error
// stray_cr); a field that opens with a quote runs to the next quote that is
// not doubled ("" inside it is one quote, each CRLF or lone CR inside it is
// read as LF), and what follows its closing quote up to the next comma or
// line break is appended as it stands (error quote_junk, when the field
// ends); a quote that never closes is a literal character and the text after
// it is read again as unquoted (error unterminated_quote); a quote inside an
// unquoted field is a literal character; fields stay strings, never trimmed
// or converted; columns is the first record when header is true, else null;
// rows are the records after it, each padded with "" (short_row, with
// fields: its field count) or cut (long_row, with extra: the cut fields) to
// the first record's width; each error is {code, line, row} in the order met,
// line the 1-based line its record starts on, row its index in rows (null
// for the header).
//
// Speed comes from never building a field one character at a time. The
// reference walks every character and appends it to a growing string; this
// reader jumps with indexOf (native scanning) to the next delimiter and
// cuts each field out with one slice. Quoted fields take the same shortcut
// whenever they hold no doubled quote and no line break inside, which is
// most of them; only the rare broken shapes fall back to a careful
// character walk. Errors are recorded in exactly the order the reference
// meets them, field errors first, then the record's short_row/long_row.

/** csv-reader 1.0.0's answer for one case's input {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  const N = text.length;
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;

  // The record being read: the line it starts on and the index in rows it
  // takes (null: the header). Field helpers below read these as they stand.
  let recordLine = 1;
  let recordRow = null;

  function strayCr() {
    errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
  }

  // An unquoted field starting at pos, with `initial` already built ('' for
  // a plain field, '"' for a quote that never closed, quoted text for junk
  // after a closing quote). Returns {value, ended, added}: ended 0 at a
  // comma, 1 at a line break, 2 at the end of the text; added counts the
  // characters kept during this call.
  function unquoted(initial) {
    const p = pos;
    const iC = text.indexOf(',', p);
    const iL = text.indexOf('\n', p);
    const iR = text.indexOf('\r', p);
    let end = -1;
    let ended = 2;
    if (iC !== -1) {
      end = iC;
      ended = 0;
    }
    if (iL !== -1 && (end === -1 || iL < end)) {
      end = iL;
      ended = 1;
    }
    if (iR !== -1 && (end === -1 || iR < end)) {
      // A CR here ends the field only as half of a CRLF; a lone CR is a
      // stray one, dropped, and the field goes on: the slow walk below.
      if (text.charCodeAt(iR + 1) === 10) {
        end = iR;
        ended = 1;
      } else {
        return unquotedSlow(initial, p);
      }
    }
    if (end === -1) {
      pos = N;
      const value = initial === '' ? text.slice(p) : initial + text.slice(p);
      return { value, ended: 2, added: N - p };
    }
    const value = initial === '' ? text.slice(p, end) : initial + text.slice(p, end);
    if (ended === 0) {
      pos = end + 1;
      return { value, ended: 0, added: end - p };
    }
    pos = end + 1 + (text.charCodeAt(end) === 13 ? 1 : 0);
    line += 1;
    return { value, ended: 1, added: end - p };
  }

  // The slow unquoted walk, used only when a lone CR is the nearest
  // delimiter: each stray CR is dropped (and recorded), the rest is kept
  // in slices between the CRs.
  function unquotedSlow(initial, p) {
    let value = initial;
    let start = p;
    let added = 0;
    while (p < N) {
      const c = text.charCodeAt(p);
      if (c === 44) {
        value += text.slice(start, p);
        added += p - start;
        pos = p + 1;
        return { value, ended: 0, added };
      }
      if (c === 10) {
        value += text.slice(start, p);
        added += p - start;
        pos = p + 1;
        line += 1;
        return { value, ended: 1, added };
      }
      if (c === 13) {
        if (text.charCodeAt(p + 1) === 10) {
          value += text.slice(start, p);
          added += p - start;
          pos = p + 2;
          line += 1;
          return { value, ended: 1, added };
        }
        strayCr();
        value += text.slice(start, p);
        added += p - start;
        p += 1;
        start = p;
        continue;
      }
      p += 1;
    }
    value += text.slice(start, p);
    added += p - start;
    pos = p;
    return { value, ended: 2, added };
  }

  // A quoted field whose opening quote is at `open` (on line openLine): the
  // slow route, for fields with doubled quotes, line breaks inside, junk
  // after the closing quote, or a quote that never closes.
  function quotedSlow(open, openLine) {
    let p = open + 1;
    let start = p;
    let value = '';
    let closed = false;
    while (p < N) {
      const c = text.charCodeAt(p);
      if (c === 34) {
        if (text.charCodeAt(p + 1) === 34) {
          value += text.slice(start, p);
          value += '"';
          p += 2;
          start = p;
          continue;
        }
        value += text.slice(start, p);
        p += 1;
        closed = true;
        break;
      }
      if (c === 13) {
        // CRLF and a lone CR inside quotes are each one LF.
        value += text.slice(start, p);
        value += '\n';
        line += 1;
        p += text.charCodeAt(p + 1) === 10 ? 2 : 1;
        start = p;
        continue;
      }
      if (c === 10) line += 1;
      p += 1;
    }
    if (!closed) {
      // The quote never closes: it is a literal character, and the text
      // after it is read again as unquoted, from the line it opened on.
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      return unquoted('"');
    }
    pos = p;
    if (p >= N) return { value, ended: 2 };
    const c = text.charCodeAt(p);
    if (c === 44) {
      pos = p + 1;
      return { value, ended: 0 };
    }
    if (c === 10) {
      pos = p + 1;
      line += 1;
      return { value, ended: 1 };
    }
    if (c === 13 && text.charCodeAt(p + 1) === 10) {
      pos = p + 2;
      line += 1;
      return { value, ended: 1 };
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    const junk = unquoted(value);
    if (junk.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return junk;
  }

  while (pos < N) {
    // Lines with no characters are no records.
    while (pos < N) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= N) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast record: no quote anywhere in the line and no CR except, at
    // most, the CR of a CRLF line break. Such a record is one slice cut by
    // split(','), with no field-by-field walk. Anything else (a quote, a
    // stray CR, a line break inside quotes) takes the careful path below.
    let fields = null;
    let quoted = false;
    const le = text.indexOf('\n', pos);
    const lend = le === -1 ? N : le;
    const qi = text.indexOf('"', pos);
    const ri = text.indexOf('\r', pos);
    if (
      (qi === -1 || qi >= lend) &&
      (ri === -1 || ri >= lend || (le !== -1 && ri === lend - 1))
    ) {
      const end = le !== -1 && ri === lend - 1 ? lend - 1 : lend;
      fields = text.slice(pos, end).split(',');
      pos = le === -1 ? N : le + 1;
      if (le !== -1) line += 1;
    }

    if (fields === null) {
      fields = [];
      let ended = 0;
      do {
      let value;
      if (text.charCodeAt(pos) === 34) {
        quoted = true;
        const open = pos;
        const openLine = line;
        const q = text.indexOf('"', open + 1);
        const nl = text.indexOf('\n', open + 1);
        const cr = text.indexOf('\r', open + 1);
        if (
          q !== -1 &&
          text.charCodeAt(q + 1) !== 34 &&
          (nl === -1 || nl > q) &&
          (cr === -1 || cr > q)
        ) {
          // Fast quoted field: no doubled quote, no line break inside, so
          // the text between the quotes is the field as it stands.
          value = text.slice(open + 1, q);
          const a = q + 1;
          if (a >= N) {
            pos = a;
            ended = 2;
          } else {
            const c = text.charCodeAt(a);
            if (c === 44) {
              pos = a + 1;
              ended = 0;
            } else if (c === 10) {
              pos = a + 1;
              line += 1;
              ended = 1;
            } else if (c === 13 && text.charCodeAt(a + 1) === 10) {
              pos = a + 2;
              line += 1;
              ended = 1;
            } else {
              pos = a;
              const junk = unquoted(value);
              if (junk.added > 0) {
                errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
              }
              value = junk.value;
              ended = junk.ended;
            }
          }
        } else {
          const r = quotedSlow(open, openLine);
          value = r.value;
          ended = r.ended;
        }
      } else {
        quoted = false;
        const r = unquoted('');
        value = r.value;
        ended = r.ended;
      }
      fields.push(value);
      } while (ended === 0);
    }

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
