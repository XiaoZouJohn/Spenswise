export type Season = 'spring' | 'summer' | 'autumn' | 'winter'
type SceneMedia = { poster: string; video: string; illustration: string }
const base: SceneMedia = { poster: '/media/village/village-v1.webp', video: '/media/village/village-v1.mp4', illustration: '/media/village/illustrations-v1.png' }
// Only published assets belong here. A missing seasonal asset deliberately falls back.
export const seasonalMedia: Partial<Record<Season, Partial<SceneMedia>>> = {}
export function villageMedia(date = new Date()) {
  const month = date.getMonth() + 1
  const season: Season = month >= 3 && month <= 5 ? 'spring' : month >= 6 && month <= 8 ? 'summer' : month >= 9 && month <= 11 ? 'autumn' : 'winter'
  return { season, ...base, ...seasonalMedia[season] }
}
