/**
 * Input latency recorder (phase 11 audit). For each gameplay key pressed while the local ball is at rest, the time
 * (ms after the keydown event) until: (a) the input was sent, (b) the tick it's stamped for, as ms on the predicted
 * clock, (c) the predicted action started, (d) the first frame where the ball visibly changed. F3 shows the last
 * rows; `kula.latency.table()` returns them as a markdown table.
 */
export interface LatencyRow {
  key: string;
  down: number; // keydown event.timeStamp (performance.now clock)
  predicting: boolean;
  sent?: number;
  stampInMs?: number; // (stamped tick − predicted tick at the press) × 50
  predStart?: number;
  visible?: number;
}

const MAX_ROWS = 50;

export const latency = {
  rows: [] as LatencyRow[],
  /** The press being measured (only one at a time: the first press from rest). */
  cur: null as LatencyRow | null,

  press(key: string, down: number, atRest: boolean, predicting: boolean): void {
    if (!atRest || (this.cur && this.cur.visible === undefined && down - this.cur.down < 500)) return;
    this.cur = { key, down, predicting };
    this.rows.push(this.cur);
    if (this.rows.length > MAX_ROWS) this.rows.shift();
  },
  sent(t: number, stampInMs?: number): void {
    const r = this.cur;
    if (r && r.sent === undefined) { r.sent = t; r.stampInMs = stampInMs; }
  },
  predStart(t: number): void {
    const r = this.cur;
    if (r && r.predStart === undefined) r.predStart = t; // may come before `sent` (a press from rest starts at once)
  },
  visible(t: number): void {
    const r = this.cur;
    if (r && r.visible === undefined && r.sent !== undefined) r.visible = t;
  },

  /** Rows as ms after keydown. */
  summary(r: LatencyRow): string[] {
    const ms = (t?: number) => (t === undefined ? '-' : (t - r.down).toFixed(1));
    return [r.key, r.predicting ? 'pred' : 'server', ms(r.sent), r.stampInMs === undefined ? '-' : r.stampInMs.toFixed(0), ms(r.predStart), ms(r.visible)];
  },

  table(): string {
    const head = '| key | mode | (a) sent | (b) stamp ahead | (c) predicted start | (d) visible |\n|---|---|---|---|---|---|';
    return [head, ...this.rows.map((r) => `| ${this.summary(r).join(' | ')} |`)].join('\n');
  },

  /** Median and max of (d) per key, for the report. */
  stats(): Record<string, { n: number; median: number; max: number }> {
    const by = new Map<string, number[]>();
    for (const r of this.rows) if (r.visible !== undefined) by.set(r.key, [...(by.get(r.key) ?? []), r.visible - r.down]);
    const out: Record<string, { n: number; median: number; max: number }> = {};
    for (const [k, v] of by) {
      v.sort((a, b) => a - b);
      out[k] = { n: v.length, median: +v[v.length >> 1].toFixed(1), max: +v[v.length - 1].toFixed(1) };
    }
    return out;
  },
};
