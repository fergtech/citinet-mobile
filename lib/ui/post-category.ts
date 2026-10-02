/**
 * Display name for a feed post category. The stored value stays 'PROJECT' (existing posts and the hub API use it)
 * but members see "Proposal", so it doesn't clash with the Projects feature.
 */
export function postCategoryLabel(category: string): string {
  if (category === 'PROJECT') return 'Proposal';
  return category.charAt(0) + category.slice(1).toLowerCase();
}
