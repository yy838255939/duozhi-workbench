function safeWebsiteUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) return null
    return url.href
  } catch {
    return null
  }
}

function clampBounds(bounds, size) {
  if (!bounds || !['x', 'y', 'width', 'height'].every((key) => Number.isFinite(bounds[key]))) return null
  const x = Math.max(0, Math.min(size.width, Math.round(bounds.x)))
  const y = Math.max(0, Math.min(size.height, Math.round(bounds.y)))
  return {
    x,
    y,
    width: Math.max(0, Math.min(size.width - x, Math.round(bounds.width))),
    height: Math.max(0, Math.min(size.height - y, Math.round(bounds.height))),
  }
}

module.exports = { safeWebsiteUrl, clampBounds }
