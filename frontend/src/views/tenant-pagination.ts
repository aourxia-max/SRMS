export function pageAfterDeleting(page: number, itemCount: number) {
  return page > 1 && itemCount === 1 ? page - 1 : page
}
