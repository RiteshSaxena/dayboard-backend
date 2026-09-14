export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export function slugify(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 44);
  return slug || 'org';
}

export const now = (): number => Date.now();
