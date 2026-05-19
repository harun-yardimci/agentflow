import { getDb } from '../db/connection.js';

export interface SafetyCheckResult {
  allowed: boolean;
  violations: SafetyViolation[];
}

export interface SafetyViolation {
  ruleId: string;
  ruleType: string;
  pattern: string;
  severity: 'block' | 'warn' | 'approve';
  description: string;
  matchedText: string;
}

interface SafetyRule {
  id: string;
  rule_type: string;
  pattern: string;
  severity: string;
  description: string | null;
  enabled: number;
}

// Default safety rules - seeded into DB on first run
const DEFAULT_RULES = [
  // Command blacklist - dangerous shell commands
  { id: 'cmd-rm-rf', rule_type: 'command_blacklist', pattern: 'rm\\s+(-[a-zA-Z]*f[a-zA-Z]*\\s+|.*-rf|.*--no-preserve-root)', severity: 'block', description: 'Recursive force delete' },
  { id: 'cmd-mkfs', rule_type: 'command_blacklist', pattern: 'mkfs\\.', severity: 'block', description: 'Filesystem format command' },
  { id: 'cmd-dd', rule_type: 'command_blacklist', pattern: 'dd\\s+if=.*of=/dev/', severity: 'block', description: 'Raw disk write' },
  { id: 'cmd-fork-bomb', rule_type: 'command_blacklist', pattern: ':\\(\\)\\s*\\{\\s*:\\|:\\s*&\\s*\\}\\s*;\\s*:', severity: 'block', description: 'Fork bomb' },
  { id: 'cmd-chmod-777', rule_type: 'command_blacklist', pattern: 'chmod\\s+(-[a-zA-Z]*\\s+)*777\\s', severity: 'warn', description: 'World-writable permissions' },
  { id: 'cmd-curl-pipe', rule_type: 'command_blacklist', pattern: 'curl\\s+.*\\|\\s*(sudo\\s+)?(ba)?sh', severity: 'block', description: 'Pipe remote script to shell' },
  { id: 'cmd-wget-pipe', rule_type: 'command_blacklist', pattern: 'wget\\s+.*\\|\\s*(sudo\\s+)?(ba)?sh', severity: 'block', description: 'Pipe remote script to shell' },

  // SQL blacklist - destructive database operations
  { id: 'sql-drop-db', rule_type: 'command_blacklist', pattern: 'DROP\\s+DATABASE', severity: 'block', description: 'Drop database command' },
  { id: 'sql-drop-table', rule_type: 'command_blacklist', pattern: 'DROP\\s+TABLE', severity: 'warn', description: 'Drop table command' },
  { id: 'sql-truncate', rule_type: 'command_blacklist', pattern: 'TRUNCATE\\s+TABLE', severity: 'warn', description: 'Truncate table command' },

  // Environment blacklist - secrets and sensitive vars
  { id: 'env-aws-key', rule_type: 'env_blacklist', pattern: 'AWS_SECRET_ACCESS_KEY', severity: 'block', description: 'AWS secret key exposure' },
  { id: 'env-private-key', rule_type: 'env_blacklist', pattern: '-----BEGIN\\s+(RSA\\s+)?PRIVATE\\s+KEY-----', severity: 'block', description: 'Private key in output' },
  { id: 'env-password', rule_type: 'env_blacklist', pattern: '(PASSWORD|PASSWD|DB_PASS)\\s*=\\s*[^\\s]+', severity: 'warn', description: 'Password in environment' },

  // Path blacklist - system directories
  { id: 'path-system', rule_type: 'path_blacklist', pattern: '^/(etc|usr|bin|sbin|boot|sys|proc)/', severity: 'block', description: 'System directory access' },
  { id: 'path-ssh', rule_type: 'path_blacklist', pattern: '\\.ssh/', severity: 'block', description: 'SSH directory access' },
  { id: 'path-env-file', rule_type: 'path_blacklist', pattern: '\\.env(\\.local|\\.production|\\.staging)?$', severity: 'warn', description: 'Environment file access' },
];

export function seedSafetyRules(): void {
  const db = getDb();
  const count = db.prepare('SELECT COUNT(*) as count FROM safety_rules').get() as { count: number };
  if (count.count > 0) return;

  const insert = db.prepare(
    'INSERT INTO safety_rules (id, rule_type, pattern, severity, description, enabled) VALUES (?, ?, ?, ?, ?, 1)'
  );
  const tx = db.transaction(() => {
    for (const rule of DEFAULT_RULES) {
      insert.run(rule.id, rule.rule_type, rule.pattern, rule.severity, rule.description);
    }
  });
  tx();
}

function loadRules(): SafetyRule[] {
  const db = getDb();
  return db.prepare('SELECT * FROM safety_rules WHERE enabled = 1').all() as SafetyRule[];
}

/** Check a command string against safety rules */
export function checkCommand(command: string): SafetyCheckResult {
  const rules = loadRules().filter((r) => r.rule_type === 'command_blacklist');
  const violations: SafetyViolation[] = [];

  for (const rule of rules) {
    try {
      const regex = new RegExp(rule.pattern, 'i');
      const match = command.match(regex);
      if (match) {
        violations.push({
          ruleId: rule.id,
          ruleType: rule.rule_type,
          pattern: rule.pattern,
          severity: rule.severity as 'block' | 'warn' | 'approve',
          description: rule.description ?? 'Safety rule violation',
          matchedText: match[0],
        });
      }
    } catch {
      // Invalid regex — skip
    }
  }

  const blocked = violations.some((v) => v.severity === 'block');
  return { allowed: !blocked, violations };
}

/** Check file paths against safety rules */
export function checkPath(filePath: string, projectRoot: string): SafetyCheckResult {
  const rules = loadRules().filter((r) => r.rule_type === 'path_blacklist');
  const violations: SafetyViolation[] = [];

  // Ensure path is within project root
  const normalizedPath = filePath.replace(/\\/g, '/');
  const normalizedRoot = projectRoot.replace(/\\/g, '/');

  if (!normalizedPath.startsWith(normalizedRoot) && !normalizedPath.startsWith('.')) {
    violations.push({
      ruleId: 'path-outside-project',
      ruleType: 'path_whitelist',
      pattern: normalizedRoot,
      severity: 'block',
      description: `Path outside project root: ${normalizedPath}`,
      matchedText: normalizedPath,
    });
  }

  for (const rule of rules) {
    try {
      const regex = new RegExp(rule.pattern, 'i');
      const match = normalizedPath.match(regex);
      if (match) {
        violations.push({
          ruleId: rule.id,
          ruleType: rule.rule_type,
          pattern: rule.pattern,
          severity: rule.severity as 'block' | 'warn' | 'approve',
          description: rule.description ?? 'Safety rule violation',
          matchedText: match[0],
        });
      }
    } catch {
      // Invalid regex — skip
    }
  }

  const blocked = violations.some((v) => v.severity === 'block');
  return { allowed: !blocked, violations };
}

/** Check output text for secrets/sensitive data */
export function checkOutput(output: string): SafetyCheckResult {
  const rules = loadRules().filter((r) => r.rule_type === 'env_blacklist');
  const violations: SafetyViolation[] = [];

  for (const rule of rules) {
    try {
      const regex = new RegExp(rule.pattern, 'i');
      const match = output.match(regex);
      if (match) {
        violations.push({
          ruleId: rule.id,
          ruleType: rule.rule_type,
          pattern: rule.pattern,
          severity: rule.severity as 'block' | 'warn' | 'approve',
          description: rule.description ?? 'Sensitive data detected in output',
          matchedText: '[REDACTED]',
        });
      }
    } catch {
      // Invalid regex — skip
    }
  }

  const blocked = violations.some((v) => v.severity === 'block');
  return { allowed: !blocked, violations };
}

/** Get all safety rules for management UI */
export function listRules(): SafetyRule[] {
  const db = getDb();
  return db.prepare('SELECT * FROM safety_rules ORDER BY rule_type, id').all() as SafetyRule[];
}

/** Toggle a safety rule on/off */
export function toggleRule(ruleId: string, enabled: boolean): void {
  const db = getDb();
  db.prepare('UPDATE safety_rules SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, ruleId);
}
