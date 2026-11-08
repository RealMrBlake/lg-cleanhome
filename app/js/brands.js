/*
 * Markenkacheln: eigene, einheitliche Kacheln für beliebte Apps (Markenfarbe + Name in Schrift).
 * Keine Logos, nur Farbe und Text. Erkannt wird über den App-Namen (match), nicht über die ID,
 * weil LG-IDs je nach Region abweichen.
 *
 * Felder: match (RegExp auf den App-Namen), bg (Hintergrund, auch Verlauf), fg (Schriftfarbe),
 *         text (Beschriftung), style ('heavy' | 'wide' | 'light' | 'round'), size (Schriftgröße in px)
 * Eigene Bilder in custom-icons/ haben Vorrang.
 */
window.CLEANHOME_BRANDS = [
  { match: /^netflix/i, bg: '#000000', fg: '#e50914', text: 'NETFLIX', style: 'heavy', size: 40 },
  { match: /^youtube( tv)?$/i, bg: '#ffffff', fg: '#ff0033', text: '▶ YouTube', style: 'heavy', size: 36 },
  { match: /^youtube kids/i, bg: '#ff0033', fg: '#ffffff', text: 'YouTube Kids', style: 'round', size: 30 },
  { match: /prime video|amazon prime/i, bg: '#0f171e', fg: '#00a8e1', text: 'prime video', style: 'heavy', size: 36 },
  { match: /^disney\s*\+|^disney plus/i, bg: 'linear-gradient(135deg,#0b1240,#1a3c8f)', fg: '#ffffff', text: 'Disney+', style: 'round', size: 42 },
  { match: /^apple tv/i, bg: '#000000', fg: '#ffffff', text: 'Apple TV', style: 'light', size: 38 },
  { match: /^apple music/i, bg: 'linear-gradient(135deg,#fa233b,#fb5c74)', fg: '#ffffff', text: 'Apple Music', style: 'light', size: 34 },
  { match: /^spotify/i, bg: '#121212', fg: '#1ed760', text: 'Spotify', style: 'heavy', size: 40 },
  { match: /^emby/i, bg: '#52b54b', fg: '#ffffff', text: 'emby', style: 'round', size: 46 },
  { match: /^jellyfin/i, bg: 'linear-gradient(135deg,#aa5cc3,#00a4dc)', fg: '#ffffff', text: 'jellyfin', style: 'round', size: 40 },
  { match: /^plex/i, bg: '#1f1f1f', fg: '#e5a00d', text: 'plex', style: 'heavy', size: 46 },
  { match: /^crunchyroll/i, bg: '#f47521', fg: '#ffffff', text: 'crunchyroll', style: 'round', size: 34 },
  { match: /^paramount/i, bg: 'linear-gradient(135deg,#0033a0,#0064ff)', fg: '#ffffff', text: 'Paramount+', style: 'wide', size: 32 },
  { match: /^dazn/i, bg: '#0c161c', fg: '#f7ff1a', text: 'DAZN', style: 'heavy', size: 46 },
  { match: /^twitch/i, bg: '#9146ff', fg: '#ffffff', text: 'twitch', style: 'heavy', size: 42 },
  { match: /^wow\b/i, bg: '#000000', fg: '#ffffff', text: 'WOW', style: 'heavy', size: 46 },
  { match: /^sky\b/i, bg: 'linear-gradient(135deg,#0a1a6b,#e3007a)', fg: '#ffffff', text: 'sky', style: 'round', size: 48 },
  { match: /^rtl\s*\+/i, bg: '#000000', fg: '#ffffff', text: 'RTL+', style: 'heavy', size: 44 },
  { match: /^joyn/i, bg: '#000000', fg: '#ffffff', text: 'joyn', style: 'round', size: 46 },
  { match: /^ard/i, bg: '#003480', fg: '#ffffff', text: 'ARD Mediathek', style: 'wide', size: 28 },
  { match: /^zdf/i, bg: '#fa7d19', fg: '#ffffff', text: 'ZDF', style: 'heavy', size: 46 },
  { match: /^arte/i, bg: '#000000', fg: '#fd4600', text: 'arte', style: 'heavy', size: 46 },
  { match: /^magenta/i, bg: '#e20074', fg: '#ffffff', text: 'MagentaTV', style: 'wide', size: 32 },
  { match: /^waipu/i, bg: '#0f0f23', fg: '#ffffff', text: 'waipu.tv', style: 'round', size: 36 },
  { match: /^zattoo/i, bg: '#ff6c00', fg: '#ffffff', text: 'Zattoo', style: 'round', size: 38 },
  { match: /^kodi/i, bg: 'linear-gradient(135deg,#1c2b3a,#17b2e7)', fg: '#ffffff', text: 'Kodi', style: 'round', size: 44 },
  { match: /^steam link/i, bg: 'linear-gradient(135deg,#0e1a2e,#1b4f8a)', fg: '#ffffff', text: 'Steam Link', style: 'wide', size: 30 },
  { match: /geforce now/i, bg: '#000000', fg: '#76b900', text: 'GeForce NOW', style: 'wide', size: 28 },
  { match: /^xbox/i, bg: '#107c10', fg: '#ffffff', text: 'Xbox', style: 'heavy', size: 44 },
  { match: /^mubi/i, bg: '#001489', fg: '#ffffff', text: 'MUBI', style: 'heavy', size: 44 },
  { match: /^tidal/i, bg: '#000000', fg: '#ffffff', text: 'TIDAL', style: 'wide', size: 38 },
  { match: /^deezer/i, bg: '#a238ff', fg: '#ffffff', text: 'deezer', style: 'heavy', size: 42 }
];
