/** Provider descriptions can include one-time codes. Classify, never echo them. */
export function oauthErrorMessage(
  error: string | null,
  code: string | null,
  description: string | null,
): string {
  if (
    description?.toLowerCase().includes('unable to exchange external code') ||
    code === 'provider_token_exchange_failed'
  ) {
    return 'Google rejected the sign-in connection. The library owner needs to check the Google client ID and secret in the authentication settings.'
  }
  if (
    code === 'bad_oauth_state' ||
    code === 'flow_state_expired' ||
    code === 'flow_state_not_found'
  ) {
    return 'Your sign-in request expired. Start again using Continue with Google in this browser.'
  }
  if (error === 'access_denied' && (!code || code === 'access_denied')) {
    return 'Google sign-in was cancelled or access was declined. Please try again.'
  }
  return 'The sign-in service could not complete Google sign-in. Please try again or contact the library owner.'
}
