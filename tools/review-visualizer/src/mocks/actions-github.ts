export const context = {
  repo: {owner: 'visualizer', repo: 'demo'},
  payload: {
    pull_request: {
      number: 1,
      head: {sha: 'head-mock'},
      base: {sha: 'base-mock'}
    }
  },
  eventName: 'pull_request'
}
