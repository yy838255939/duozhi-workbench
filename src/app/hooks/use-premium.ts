// This GPL fork includes local interface features without upstream activation.
// Provider subscriptions and API billing remain with the respective providers.
export function usePremium() {
  return { activated: true, isLoading: false, error: undefined }
}
