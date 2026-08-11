import {Commenter, locateCommitIdBlock, summarizeTag} from './commenter'

export async function isHeadAlreadyReviewed(prNumber: number, headSha: string): Promise<boolean> {
  const commenter = new Commenter()
  const comment = await commenter.findCommentWithTag(summarizeTag(), prNumber)
  if (comment == null) return false
  const reviewedIds = commenter.getReviewedCommitIds(comment.body)
  return reviewedIds.includes(headSha)
}

export async function clearReviewedCommitIds(prNumber: number): Promise<void> {
  const commenter = new Commenter()
  const comment = await commenter.findCommentWithTag(summarizeTag(), prNumber)
  if (comment == null) return

  const block = locateCommitIdBlock(comment.body)
  if (block == null) return

  const newBody =
    comment.body.substring(0, block.start) + comment.body.substring(block.end + block.endTag.length)
  await commenter.comment(newBody.trim(), summarizeTag(), 'replace')
}
