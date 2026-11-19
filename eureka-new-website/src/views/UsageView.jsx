// Owner-only: where EUREKA's AI spending goes (server/usage.js → GET /api/ai/usage).
import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchUsage } from '../lib/ai';

const TIER_NAME = { free: 'Free', pro: 'Pro', max: 'Max' };
const MODEL_NAME = { 'openai/gpt-oss-20b': 'GPT-OSS 20B', 'openai/gpt-oss-120b': 'GPT-OSS 120B', 'qwen/qwen3.8-27b': 'Qwen 3.8' };
const nameOf = m => MODEL_NAME[m] ?? m;

const usd = n => {
  const v = Number(n) || 0;
  if (v === 0) return '$0.00';
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const int = n => (Number(n) || 0).toLocaleString('en-US');
const tokens = n => {
  const v = Number(n) || 0;
  return v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e4 ? `${(v / 1e3).toFixed(1)}K` : int(v);
};
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '—');

const lastMonths = (n = 6) => {
  const out = [];
  const d = new Date();
  for (let i = 0; i < n; i++) out.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  return out;
};
const monthLabel = m => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

function Stat({ label, value, sub }) {
  return (
    <div className="usage__stat">
      <span>{label}</span>
      <strong>{value}</strong>
      {sub ? <em>{sub}</em> : null}
    </div>
  );
}

// Daily estimated cost: one series, columns from a shared baseline, hover/focus tooltip per day.
function DailyCost({ daily }) {
  const [hover, setHover] = useState(null);
  const wrap = useRef(null);
  const max = Math.max(...daily.map(d => d.costUSD), 0);
  const top = max > 0 ? niceCeil(max) : 1;
  const H = 180;
  const ticks = [0, top / 2, top];
  const today = new Date().toISOString().slice(0, 10);
  const shown = hover !== null ? daily[hover] : null;
  return (
    <figure className="usage__chart" ref={wrap}>
      <figcaption>Estimated AI cost per day</figcaption>
      <div className="usage__plot" style={{ height: H + 24 }} onMouseLeave={() => setHover(null)}>
        <div className="usage__grid" style={{ height: H }}>
          {ticks
            .slice()
            .reverse()
            .map(t => (
              <span key={t} style={{ bottom: `${(t / top) * 100}%` }}>
                <i>{usd(t)}</i>
              </span>
            ))}
        </div>
        <div className="usage__cols" style={{ height: H }} role="list" aria-label="Estimated cost by day">
          {daily.map((d, i) => (
            <button
              key={d.day}
              type="button"
              role="listitem"
              className="usage__col"
              data-active={hover === i ? '' : undefined}
              data-future={d.day > today ? '' : undefined}
              aria-label={`${d.day}: ${usd(d.costUSD)}, ${int(d.requests)} requests`}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            >
              <span className="usage__bar" style={{ height: d.costUSD > 0 ? `max(2px, ${(d.costUSD / top) * 100}%)` : 0 }} />
            </button>
          ))}
        </div>
        <div className="usage__xaxis">
          {daily.map((d, i) => (
            <span key={d.day}>{i === 0 || (i + 1) % 5 === 0 ? Number(d.day.slice(8)) : ''}</span>
          ))}
        </div>
        {shown ? (
          <div className="usage__tip" style={{ left: `${((hover + 0.5) / daily.length) * 100}%` }} role="status">
            <strong>{usd(shown.costUSD)}</strong>
            <span>{new Date(`${shown.day}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}</span>
            <span>
              {int(shown.requests)} requests · {tokens(shown.input)} in · {tokens(shown.output)} out
            </span>
            {shown.failed ? <span>{int(shown.failed)} failed</span> : null}
          </div>
        ) : null}
      </div>
    </figure>
  );
}
function niceCeil(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}

export default function UsageView() {
  const months = useMemo(() => lastMonths(), []);
  const [month, setMonth] = useState(months[0]);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    fetchUsage(month)
      .then(d => live && setData(d))
      .catch(e => live && setError(e.message || 'Couldn’t load usage.'))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [month, tick]);

  const t = data?.total ?? {};
  const maxTier = data?.perTier?.find(x => x.tier === 'max') ?? {};
  const totalFailed = t.failed ?? 0;
  const attempts = (t.requests ?? 0) + totalFailed;

  return (
    <section className="usage">
      <header className="usage__head">
        <div>
          <h2>AI usage &amp; costs</h2>
          <p>Only you can see this page. Costs are estimates from token counts and the prices in server/config.js.</p>
        </div>
        <div className="usage__filters">
          <label>
            <span>Month</span>
            <select value={month} onChange={e => setMonth(e.target.value)}>
              {months.map(m => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn btn--ghost-line btn--sm" onClick={() => setTick(n => n + 1)} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </header>

      {error ? <div className="usage__notice usage__notice--error">{error}</div> : null}
      {data?.storage === 'memory' ? (
        <div className="usage__notice">
          These numbers are kept in one server’s memory, so they reset when it restarts and miss requests served by other server instances. Connect Upstash Redis (UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN) for complete, permanent totals.
        </div>
      ) : null}

      {data ? (
        <div data-loading={loading ? '' : undefined} className="usage__body">
          <div className="usage__stats">
            <Stat label="Estimated cost" value={usd(t.costUSD)} sub={`${monthLabel(data.month)}`} />
            <Stat label="Chat messages" value={int(t.messages)} sub={`${int(t.tasks)} revision-tool requests`} />
            <Stat label="Tokens" value={`${tokens(t.input)} in`} sub={`${tokens(t.output)} out · ${tokens(t.cached)} cached`} />
            <Stat label="Qwen escalation" value={pct(t.escalated, maxTier.auto)} sub={`${int(t.escalated)} of ${int(maxTier.auto)} auto-routed Max messages`} />
            <Stat label="Failed requests" value={int(totalFailed)} sub={`${pct(totalFailed, attempts)} of attempts`} />
            <Stat label="Fallbacks" value={int(t.fallbacks)} sub="answered by a backup model" />
          </div>

          <DailyCost daily={data.daily} />

          <div className="usage__tables">
            <table className="usage__table">
              <caption>By plan</caption>
              <thead>
                <tr>
                  <th scope="col">Plan</th>
                  <th scope="col">Messages</th>
                  <th scope="col">Requests</th>
                  <th scope="col">Students</th>
                  <th scope="col">Tokens in / out</th>
                  <th scope="col">Cost</th>
                  <th scope="col">Cost per student</th>
                </tr>
              </thead>
              <tbody>
                {data.perTier.map(r => (
                  <tr key={r.tier}>
                    <th scope="row">{TIER_NAME[r.tier]}</th>
                    <td>{int(r.messages)}</td>
                    <td>{int(r.requests)}</td>
                    <td>{int(r.users)}</td>
                    <td>
                      {tokens(r.input)} / {tokens(r.output)}
                    </td>
                    <td>{usd(r.costUSD)}</td>
                    <td>{r.users ? usd(r.costUSD / r.users) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <table className="usage__table">
              <caption>By model</caption>
              <thead>
                <tr>
                  <th scope="col">Model</th>
                  <th scope="col">Requests</th>
                  <th scope="col">Tokens in / out</th>
                  <th scope="col">Cost</th>
                  <th scope="col">Share of cost</th>
                  <th scope="col">Failed</th>
                  <th scope="col">As fallback</th>
                </tr>
              </thead>
              <tbody>
                {data.perModel.map(r => (
                  <tr key={r.model}>
                    <th scope="row">{nameOf(r.model)}</th>
                    <td>{int(r.requests)}</td>
                    <td>
                      {tokens(r.input)} / {tokens(r.output)}
                    </td>
                    <td>{usd(r.costUSD)}</td>
                    <td>{pct(r.costUSD, t.costUSD)}</td>
                    <td>{int(r.failed)}</td>
                    <td>{int(r.fallbacks)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <table className="usage__table">
              <caption>Highest-cost students this month</caption>
              <thead>
                <tr>
                  <th scope="col">Student</th>
                  <th scope="col">Plan</th>
                  <th scope="col">Requests</th>
                  <th scope="col">Tokens in / out</th>
                  <th scope="col">Cost</th>
                  <th scope="col">Of monthly cap</th>
                </tr>
              </thead>
              <tbody>
                {data.topUsers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="usage__empty">
                      No AI requests recorded for {monthLabel(data.month)} yet.
                    </td>
                  </tr>
                ) : (
                  data.topUsers.map(r => {
                    const cap = data.limits?.[r.tier]?.monthlyBudgetUSD;
                    return (
                      <tr key={r.user}>
                        <th scope="row" title={r.user.startsWith('m:') ? 'Whop membership id' : 'Browser id (Free plan)'}>
                          {r.user.replace(/^[mdi]:/, '')}
                        </th>
                        <td>{TIER_NAME[r.tier] ?? r.tier}</td>
                        <td>{int(r.requests)}</td>
                        <td>
                          {tokens(r.input)} / {tokens(r.output)}
                        </td>
                        <td>{usd(r.costUSD)}</td>
                        <td>{cap ? pct(r.costUSD, cap) : 'no cap'}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>

            {data.limits ? (
              <table className="usage__table">
                <caption>Current limits (server/config.js · PLAN_LIMITS_JSON)</caption>
                <thead>
                  <tr>
                    <th scope="col">Plan</th>
                    <th scope="col">Requests / day</th>
                    <th scope="col">Per minute</th>
                    <th scope="col">Monthly cap per student</th>
                    <th scope="col">Images</th>
                  </tr>
                </thead>
                <tbody>
                  {['free', 'pro', 'max'].map(k => (
                    <tr key={k}>
                      <th scope="row">{TIER_NAME[k]}</th>
                      <td>{int(data.limits[k]?.daily)}</td>
                      <td>{int(data.limits[k]?.perMinute)}</td>
                      <td>{data.limits[k]?.monthlyBudgetUSD ? usd(data.limits[k].monthlyBudgetUSD) : 'none'}</td>
                      <td>{data.visionPlans?.includes(k) ? 'Yes' : 'No'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>
          {t.estimated ? <p className="usage__foot">{int(t.estimated)} requests had no token counts from the provider, so their tokens were estimated from text length.</p> : null}
        </div>
      ) : !error ? (
        <div className="usage__notice">Loading usage…</div>
      ) : null}
    </section>
  );
}
