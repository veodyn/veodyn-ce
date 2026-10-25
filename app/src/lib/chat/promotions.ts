import type { ChatPromotion } from './wire'

export function isApplied(promotion: ChatPromotion): boolean {
  return (promotion.status === 'done' || promotion.status === 'partial') && promotion.targetId !== null
}

export function appliedPromotions(promotions: ChatPromotion[]): ChatPromotion[] {
  return promotions.filter(isApplied)
}

export function lastApplied(promotions: ChatPromotion[]): ChatPromotion | undefined {
  return appliedPromotions(promotions).at(-1)
}

export function upsertPromotion(promotions: ChatPromotion[], promotion: ChatPromotion): ChatPromotion[] {
  const index = promotions.findIndex((one) => one.id === promotion.id)
  if (index === -1) return [...promotions, promotion]
  return promotions.map((one, at) => (at === index ? promotion : one))
}
