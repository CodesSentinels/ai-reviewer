const noop = async () => ({data: {}})

export const octokit = {
  repos: {getContent: noop, compareCommits: noop},
  pulls: {get: noop, listCommits: noop, listReviews: noop},
  issues: {listComments: noop},
  git: {getTree: noop}
}
