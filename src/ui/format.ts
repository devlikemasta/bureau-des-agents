// Petits formats d'affichage, en français.
export const fmtDuration = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')}`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
};

export const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export const fmtDate = (t: number) => new Date(t).toLocaleString('sr-RS', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

export const fileIcon = (ext: string) =>
  ext === 'html' || ext === 'htm' ? '🌐' : ext === 'md' || ext === 'txt' ? '📄' : ext === 'csv' || ext === 'xlsx' ? '📊' : ['png', 'jpg', 'jpeg', 'svg', 'gif', 'webp'].includes(ext) ? '🖼️' : ext === 'pdf' ? '📕' : ['js', 'ts', 'py', 'json', 'css'].includes(ext) ? '💻' : '📁';

/** Les fichiers qu'on peut lire directement dans le bureau. */
export const readable = (ext: string) => ['md', 'txt', 'csv', 'json', 'markdown'].includes(ext);

/** Un chemin affichable à l'écran : le dossier personnel devient « ~ » (pas de nom d'utilisateur dans une vidéo). */
export const tilde = (p: string) => p.replace(/^\/(?:Users|home)\/[^/]+/, '~');
