/** Thrown when a job is interrupted by shutdown (SIGTERM). The job is left
 *  `running` so `claim_media_job()` re-claims it once its heartbeat goes stale. */
export class AbortedError extends Error {
  constructor(message = 'aborted') {
    super(message);
    this.name = 'AbortedError';
  }
}
