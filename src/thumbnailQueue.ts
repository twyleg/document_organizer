// Bound PDF parsing/rendering work even when a long list becomes visible at once.
let active = 0
const queue: Array<() => void> = []

export function queueThumbnail(task: () => Promise<void>) {
  return new Promise<void>((resolve, reject) => {
    const run = () => {
      active++
      task()
        .then(resolve, reject)
        .finally(() => {
          active--
          queue.shift()?.()
        })
    }
    if (active < 2) {
      run()
    } else {
      queue.push(run)
    }
  })
}
