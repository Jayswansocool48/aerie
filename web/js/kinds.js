// The kinds of wallpaper, as Studio and the menus name them, and the filters Studio offers.

export const KIND_LABEL = {
  image: 'Picture', video: 'Video', web: 'Web page', url: 'Web site', scene: 'Wallpaper Engine scene',
  model: '3D model', shader: 'Shader', parallax: '2D parallax', stage: '3D scene',
};
export const KIND_ICON = {
  image: 'image', video: 'video', web: 'web', url: 'globe', scene: 'layers', model: 'cube', shader: 'code', parallax: 'layers', stage: 'mountains',
};

/** Studio's type filters, like Wallpaper Engine's: 2D, 3D, video, web, shaders. */
export const FILTERS = [
  { id: 'all', label: 'All', match: () => true },
  { id: '2d', label: '2D', match: w => w.type === 'image' || w.type === 'parallax' || w.type === 'scene' },
  { id: '3d', label: '3D', match: w => w.type === 'model' || w.type === 'stage' },
  { id: 'video', label: 'Video', match: w => w.type === 'video' },
  { id: 'web', label: 'Web', match: w => w.type === 'web' || w.type === 'url' },
  { id: 'shader', label: 'Shaders', match: w => w.type === 'shader' },
  { id: 'audio', label: 'Reacts to music', match: w => !!w.audio },
];

export const SOURCES = [
  { id: 'any', label: 'Anywhere', match: () => true },
  { id: 'default', label: 'Comes with Aerie', match: w => w.source === 'default' },
  { id: 'mine', label: 'Mine', match: w => !['default', 'steam', 'wallpaper-engine', 'lively', 'openverse', 'polyhaven'].includes(w.source) },
  { id: 'we', label: 'Wallpaper Engine', match: w => w.source === 'steam' || w.source === 'wallpaper-engine' },
  { id: 'lively', label: 'Lively', match: w => w.source === 'lively' },
  { id: 'online', label: 'Openverse & Poly Haven', match: w => w.source === 'openverse' || w.source === 'polyhaven' },
];

export function sourceLabel(w) {
  return {
    default: 'Comes with Aerie', steam: 'Steam Workshop', 'wallpaper-engine': 'Wallpaper Engine', lively: 'Lively',
    url: 'Web site', file: 'Your file', folder: 'Your folder', made: 'Made in Aerie', openverse: 'Openverse',
    polyhaven: 'Poly Haven', painted: 'Painted by AI',
  }[w.source] || 'Yours';
}

/** Can Aerie play it inside Studio's preview? (Web wallpapers play only on the desktop, in their sandbox.) */
export const previewable = w => !['web', 'url'].includes(w?.type);
