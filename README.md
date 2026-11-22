# Read broken CSV files faster

[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/c/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/gelaspec/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/c/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/gelaspec/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/c/csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own csv-reader 1.0.0: `solve.js` answers
every case's `{text, header}` with exactly the same `{columns, rows,
errors}` the reference returns, including every broken-row quirk — BOM,
stray CRs, quoted fields with doubled quotes and line breaks inside, junk
after a closing quote, quotes that never close, short and long rows — and
does it by scanning with `indexOf` and cutting each field out with one
slice, instead of walking the text one character at a time.

`main.ts` is the driver the harness runs: it reads every case from
`/input/cases.json`, answers each with `run`, and writes
`/output/answers.json`.

## Check it

From the unpacked kit directory:

```sh
node cli/makefun.mjs grade-local --kit . --bot <repository> --driver process
```
