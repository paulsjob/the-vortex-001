import type { SavedTemplate } from '../../store/useTemplateStore';

const toBase64Url = (value: string) => btoa(unescape(encodeURIComponent(value))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const fromBase64Url = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  return decodeURIComponent(escape(atob(padded)));
};

export const encodeTemplatePayload = (template: SavedTemplate): string => toBase64Url(JSON.stringify(template));

export const decodeTemplatePayload = (encoded: string): SavedTemplate | null => {
  try {
    return JSON.parse(fromBase64Url(encoded)) as SavedTemplate;
  } catch {
    return null;
  }
};

export const buildTemplateFeedUrl = (origin: string, template: SavedTemplate): string => {
  const payload = encodeTemplatePayload(template);
  return `${origin}/template-feed/${template.id}?tpl=${payload}`;
};

export const buildOutputFeedUrl = (origin: string, template: SavedTemplate): string => {
  const payload = encodeTemplatePayload(template);
  return `${origin}/output-feed?tpl=${payload}`;
};
