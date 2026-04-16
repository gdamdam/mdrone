/**
 * Legacy deity-preview stubs. The deity gallery and HALO & RAYS
 * visualizer were removed when MeditateView collapsed to a single
 * pitch-mandala. These stubs stay so MeditateView's one remaining
 * cleanup call (`clearDeityPreview()`) doesn't need conditional
 * guards; removing the import would cascade needless churn.
 */

export function clearDeityPreview(): void { /* no-op */ }
