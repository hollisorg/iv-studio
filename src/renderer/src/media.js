// ComfyUI /view URLs go through the main process's ivmedia:// protocol (see src/main/index.js).
export const media = (url) => (url ? url.replace(/^https?:\/\/[^/]+\/view\?/, 'ivmedia://view/?') : url)
