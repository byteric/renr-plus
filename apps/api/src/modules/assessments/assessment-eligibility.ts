/**
 * For a closed cycle with a positive frozen base, hide any small cohort,
 * including its complements within eligible staff and within issued codes.
 * Legacy and empty bases keep the original technical projection.
 */
export function participationProtected(
  eligible: number | null,
  responses: number,
  minimum: number,
  issued: number,
): boolean {
  return (
    eligible !== null &&
    eligible > 0 &&
    (responses < minimum || eligible - responses < minimum || issued - responses < minimum)
  );
}
