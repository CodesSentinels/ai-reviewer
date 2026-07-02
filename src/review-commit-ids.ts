import {
  Commenter,
  COMMIT_ID_START_TAG,
  COMMIT_ID_END_TAG,
  SUMMARIZE_TAG
} from './commenter'

export async function isHeadAlreadyReviewed(
  prNumber: number,
  headSha: string
): Promise<boolean> {
  const commenter = new Commenter()
  const comment = await commenter.findCommentWithTag(SUMMARIZE_TAG, prNumber)
  if (comment == null) return false
  const reviewedIds = commenter.getReviewedCommitIds(comment.body)
  return reviewedIds.includes(headSha)
}

export async function clearReviewedCommitIds(
  prNumber: number
): Promise<void> {
  const commenter = new Commenter()
  const comment = await commenter.findCommentWithTag(SUMMARIZE_TAG, prNumber)
  if (comment == null) return

  const start = comment.body.indexOf(COMMIT_ID_START_TAG)
  const end = comment.body.indexOf(COMMIT_ID_END_TAG)
  if (start === -1 || end === -1) return

  const newBody =
    comment.body.substring(0, start) +
    comment.body.substring(end + COMMIT_ID_END_TAG.length)
  await commenter.comment(newBody.trim(), SUMMARIZE_TAG, 'replace')
}
