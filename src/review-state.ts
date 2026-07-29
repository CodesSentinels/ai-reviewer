import {octokit} from './octokit'

export type ReviewState = 'active' | 'paused'

export const REVIEW_STATE_START_TAG = '<!-- codesentinel-review-state:start -->'
export const REVIEW_STATE_END_TAG = '<!-- codesentinel-review-state:end -->'

export function getReviewStateFromBody(body = ''): ReviewState {
  const start = body.indexOf(REVIEW_STATE_START_TAG)
  const end = body.indexOf(REVIEW_STATE_END_TAG)
  if (start === -1 || end === -1) return 'active'

  const block = body.slice(start + REVIEW_STATE_START_TAG.length, end)
  return block.includes('state: paused') ? 'paused' : 'active'
}

export function writeReviewStateToBody(
  body: string,
  state: ReviewState
): string {
  const start = body.indexOf(REVIEW_STATE_START_TAG)
  const end = body.indexOf(REVIEW_STATE_END_TAG)
  const stateBlock = `${REVIEW_STATE_START_TAG}
state: ${state}
${REVIEW_STATE_END_TAG}`

  if (start !== -1 && end !== -1) {
    const before = body.slice(0, start).trimEnd()
    const after = body.slice(end + REVIEW_STATE_END_TAG.length).trim()
    return [before, stateBlock, after].filter(Boolean).join('\n\n')
  }

  return [body.trimEnd(), stateBlock].filter(Boolean).join('\n\n')
}

export async function getReviewState(
  owner: string,
  repo: string,
  pullNumber: number
): Promise<ReviewState> {
  const pr = await octokit.pulls.get({
    owner,
    repo,
    pull_number: pullNumber
  })
  return getReviewStateFromBody(pr.data.body ?? '')
}

export async function setReviewState(
  owner: string,
  repo: string,
  pullNumber: number,
  state: ReviewState
): Promise<void> {
  const pr = await octokit.pulls.get({
    owner,
    repo,
    pull_number: pullNumber
  })
  await octokit.pulls.update({
    owner,
    repo,
    pull_number: pullNumber,
    body: writeReviewStateToBody(pr.data.body ?? '', state)
  })
}
