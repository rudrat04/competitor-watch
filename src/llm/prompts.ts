import { readFileSync } from 'node:fs';
import { MAX_DIFF_CHARS } from './defaults.js';

const cache = new Map<string, string>();

/**
 * Prompt templates live in the top-level prompts/ folder (shipped via package.json "files").
 * It sits two levels above both src/llm/ and dist/llm/, so the same path works in both.
 */
export function loadPrompt(
  name: 'triage' | 'analyze' | 'battlecard-create' | 'battlecard-update',
): string {
  let text = cache.get(name);
  if (text === undefined) {
    text = readFileSync(new URL(`../../prompts/${name}.md`, import.meta.url), 'utf8').trim();
    cache.set(name, text);
  }
  return text;
}

/** Wrap untrusted text in a tag; any copy of the closing tag inside it is defused. */
export function fence(tag: string, text: string): string {
  const safe = text.replaceAll(`</${tag}>`, `<\\/${tag}>`);
  return `<${tag}>\n${safe}\n</${tag}>`;
}

/** Cut an over-long diff at a line boundary, saying so explicitly (never silently). */
export function limitDiff(diffText: string, max = MAX_DIFF_CHARS): string {
  if (diffText.length <= max) return diffText;
  const cut = diffText.slice(0, max);
  const kept = cut.slice(0, cut.lastIndexOf('\n') > 0 ? cut.lastIndexOf('\n') : max);
  const dropped = diffText.slice(kept.length).split('\n').length - 1;
  return `${kept}\n[diff truncated: ${dropped} more lines not shown]`;
}
