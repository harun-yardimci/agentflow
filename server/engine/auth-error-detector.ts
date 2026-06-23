/**
 * Authentication / session-expiry detection for CLI error messages.
 *
 * When a provider CLI reports that the user's session expired or credentials
 * are invalid (typically a 401), retrying is pointless — every attempt fails
 * instantly and burns the retry budget, then the task (and its dependents)
 * fail for what is really a fixable local-auth problem.
 *
 * Instead we park the task in `auth_required` (without consuming a retry) and
 * surface an actionable signal. Unlike rate limits, there is NO auto-resume
 * timer: the user must re-login in their terminal first, then manually retry.
 *
 * IMPORTANT — patterns must be conservative. The `errorMsg` we receive is not
 * always a clean CLI error: when stderr is empty the caller falls back to the
 * agent's own result text (see task-runner.ts), so arbitrary task output can
 * flow in here. A false positive parks the task FOREVER waiting on a human, so
 * every pattern requires failure-framed, auth-specific phrasing — never a bare
 * verb ("please run …"), a bare route ("/login"), a bare status word
 * ("unauthorized"), or an env-var name. Generic words must co-occur with an
 * auth signal (e.g. 401 next to "unauthorized"/"auth").
 */

export interface AuthErrorInfo {
  /** Substring that triggered the match; used for logs/notifications. */
  matched: string;
}

/** Phrases that signal an auth/session problem across every provider. */
const COMMON_PATTERNS: RegExp[] = [
  /invalid api ?key/i,
  /api ?key (?:is )?(?:not valid|invalid)/i,
  /(?:oauth|auth(?:entication)?|access|bearer|session) token (?:has |have )?expired/i,
  /(?:session|token|credentials?) (?:has |have )?expired/i,
  /invalid authentication credentials/i,
  /credentials? (?:are )?(?:invalid|expired|missing)/i,
  /authentication (?:failed|error|required)/i,
  /\bnot (?:logged in|authenticated|signed in)\b/i,
  /\bre-?authenticate\b/i,
  // Require a login/sign-in object after the verb so benign instructions like
  // "please run npm test" don't match.
  /please (?:re-?)?(?:run\s+)?(?:\/login|login|log[ -]?in|sign[ -]?in|authenticate)/i,
  // 401 only when it co-occurs with auth wording — a task that merely asserts
  // "expects 401" in its output should not be parked.
  /\b401\b[\s\S]{0,40}(?:unauthor|auth)/i,
  /(?:unauthor|authentic)\w*[\s\S]{0,40}\b401\b/i,
];

/** Extra phrases specific to a single provider's CLI. */
const PROVIDER_PATTERNS: Record<string, RegExp[]> = {
  claude: [/please run \/login/i],
  codex: [/codex login/i],
  gemini: [
    /api key not valid/i,
    /invalid authentication credentials/i,
    /set (?:an )?auth(?:entication)? method/i,
  ],
};

export function detectAuthError(
  errorMsg: string,
  provider: string,
): AuthErrorInfo | null {
  if (!errorMsg) return null;

  const patterns = [...COMMON_PATTERNS, ...(PROVIDER_PATTERNS[provider] ?? [])];
  for (const re of patterns) {
    const m = errorMsg.match(re);
    if (m) return { matched: m[0] };
  }

  return null;
}
