/** Include only the destination and its ancestors, with directory boundaries. */
export function isRevealBranch(folder: string, target: string) {
  if (!target) return false
  const normalize = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '')
  const parent = normalize(folder), destination = normalize(target)
  return destination === parent || destination.startsWith(parent + '/')
}
