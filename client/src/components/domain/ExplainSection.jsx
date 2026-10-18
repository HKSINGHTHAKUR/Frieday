import { useEffect, useState } from 'react';
import Badge from '../ui/Badge.jsx';
import Button from '../ui/Button.jsx';
import { apiPost } from '../../lib/apiClient.js';
import { aiExplanationsEnabled } from '../../lib/aiPrefs.js';

/**
 * Per-insight "Explain" interaction (T6.2, design_system.md §11/§26).
 * User-triggered only — no AI request on page load. The deterministic
 * insight is never replaced: every state renders the evidence expander
 * directly after any AI block (zero orphan AI text, Phase 6 DoD).
 * AI-off at the server (501 AI_DISABLED) and provider failures both render
 * the documented deterministic fallback caption, never an AI label.
 */
export default function ExplainSection({ insightId, evidence }) {
  const [state, setState] = useState({ status: 'idle' });
  const [prefEnabled, setPrefEnabled] = useState(aiExplanationsEnabled());

  useEffect(() => {
    const syncPreference = () => setPrefEnabled(aiExplanationsEnabled());
    syncPreference();
    window.addEventListener('frieday:ai-preference-changed', syncPreference);
    return () => window.removeEventListener('frieday:ai-preference-changed', syncPreference);
  }, []);

  async function handleExplain() {
    if (!aiExplanationsEnabled()) {
      setState({ status: 'fallback' });
      return;
    }
    setState({ status: 'loading' });
    try {
      const result = await apiPost(`/api/insights/${insightId}/explain`);
      setState({
        status: result.aiLabel ? 'ready' : 'fallback',
        paraphrase: result.paraphrase,
        whyItMatters: result.whyItMatters,
      });
    } catch (err) {
      // design_system.md §26: AI unavailable is a normal production state —
      // render the subtle fallback caption (no error card, no retry loop).
      // Only genuine/transient failures take the retryable error path.
      if (err && err.code === 'AI_DISABLED') {
        setState({ status: 'fallback' });
        return;
      }
      // Non-blocking: the deterministic insight above remains the source of truth.
      setState({ status: 'error' });
    }
  }

  return (
    <div className="mt-8">
      {state.status === 'idle' && !prefEnabled && (
        <p className="text-xs text-text3">AI explanations are turned off in Settings.</p>
      )}
      {state.status === 'idle' && prefEnabled && (
        <Button variant="secondary" size="sm" onClick={handleExplain}>
          Explain
        </Button>
      )}
      {state.status === 'loading' && (
        <Button variant="secondary" size="sm" disabled loading>
          Explaining…
        </Button>
      )}
      {state.status === 'ready' && (
        <AiSummaryWell paraphrase={state.paraphrase} whyItMatters={state.whyItMatters} />
      )}
      {state.status === 'fallback' && (
        <div className="mt-8 flex flex-wrap items-center gap-8">
          <p className="text-xs text-text3">AI summary unavailable — showing the computed summary.</p>
          {/* design_system.md §26: no error card, no auto retry; the action stays
              available so the user can attempt again later without a stuck state. */}
          <Button variant="secondary" size="sm" onClick={handleExplain}>
            Explain
          </Button>
        </div>
      )}
      {state.status === 'error' && (
        <div className="flex flex-wrap items-center gap-8">
          <p className="text-xs text-text3">
            Could not load an AI summary. The computed summary above stands.
          </p>
          <Button variant="secondary" size="sm" onClick={handleExplain}>
            Retry
          </Button>
        </div>
      )}
      {/* Adjacency guarantee: evidence always follows the AI block (Phase 6 DoD). */}
      {evidence}
    </div>
  );
}

/**
 * AI summary well (design_system.md §11: `--accent-soft` block, §20: info
 * badge). Rendered only for aiLabel=true responses — deterministic fallback
 * is never labeled as AI-generated.
 */
export function AiSummaryWell({ paraphrase, whyItMatters }) {
  return (
    <div className="rounded-md bg-accent-soft p-12" aria-label="AI summary (beta)">
      <Badge tone="info">AI summary (beta)</Badge>
      <p className="mt-8 text-sm text-text2">{paraphrase}</p>
      {whyItMatters && (
        <div className="mt-8">
          <h4 className="text-xs font-medium uppercase tracking-wide text-text3">Why it matters</h4>
          <p className="mt-4 text-sm text-text2">{whyItMatters}</p>
        </div>
      )}
    </div>
  );
}
